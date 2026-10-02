import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request } from 'node:https';

// Public discovery must never turn a DID document or profile into an internal fetch.
const denied = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) denied.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
denied.addSubnet('2001::', 23, 'ipv6'); denied.addSubnet('2001:db8::', 32, 'ipv6'); denied.addSubnet('2002::', 16, 'ipv6');
export const publicAddress = (address: string) => isIP(address) === 4 ? !denied.check(address, 'ipv4') : isIP(address) === 6 && globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6');
export const publicUrl = (input: string) => {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !url.hostname.includes('.') || url.hostname.endsWith('.local') || url.hostname === 'localhost') throw new Error('Use a public HTTPS address.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !publicAddress(host)) throw new Error('Private network addresses are not allowed.');
  return url;
};
export class PublicHttpError extends Error { constructor(readonly status: number, readonly code?: string) { super(`Public provider returned HTTP ${status}.`); } }
export const publicJson = async (input: string, { maxBytes = 2_000_000 }: { maxBytes?: number } = {}): Promise<unknown> => {
  const url = publicUrl(input);
  const signal = AbortSignal.timeout(5000);
  const addresses = await Promise.race([lookup(url.hostname, { all: true }), new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('Discovery timed out.')), { once: true }))]);
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('The provider must resolve to a public address.');
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(url, { signal, family: pinned.family, headers: { accept: 'application/json' },
      // Pin the validated result: a second DNS lookup could otherwise rebind to localhost.
      lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
    }, (res) => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) req.destroy(new Error('Discovery response is too large.')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          let code: string | undefined;
          try { const body = JSON.parse(text); if (typeof body?.error === 'string' && body.error.length < 100) code = body.error; } catch { /* Providers can return HTML error pages. */ }
          reject(new PublicHttpError(res.statusCode || 502, code)); return;
        }
        try { resolve(JSON.parse(text)); } catch { reject(new Error('Invalid discovery response.')); }
      });
    });
    req.on('error', reject); req.end();
  });
};
