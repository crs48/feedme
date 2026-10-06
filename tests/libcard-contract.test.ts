import { describe, expect, it, vi } from 'vitest';
import consumer from './fixtures/libcard/public-response.json';
import { assertLibcardResponse, checkLibcardEndpoint, contractOrigin, libcardHeaders } from '../scripts/libcard-contract.mjs';

const origin = 'https://creator-feedme.example';
const allowlisted = () => ({ creatorName: consumer.creatorName, origin, defaultAmountCents: consumer.defaultAmountCents,
  targets: consumer.targets.map(({ id, label, url, kind, publicCount, publicShareMillis }) => ({ id, label, url, kind, publicCount, publicShareMillis })),
});
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' };

describe('LibCard consumer contract and deployment check', () => {
  it('accepts the committed consumer example including unknown future fields', () => {
    expect(assertLibcardResponse(consumer, origin)).toEqual(consumer);
    expect(assertLibcardResponse({ ...consumer, targets: consumer.targets.map(t => ({ ...t, publicCount: 0, publicShareMillis: 0 })) }, origin)).toBeTruthy();
  });
  it('rejects mismatched origins, malformed signals, and private fields on the provider endpoint', async () => {
    expect(() => assertLibcardResponse(consumer, 'https://crs.tips')).toThrow('origin');
    for (const body of [
      { ...consumer, defaultAmountCents: 99 }, { ...consumer, defaultAmountCents: 100001 },
      { ...consumer, targets: [consumer.targets[0], consumer.targets[0]] },
      { ...consumer, targets: [{ ...consumer.targets[0], publicShareMillis: 1001 }] },
      { ...consumer, targets: [{ ...consumer.targets[0], publicCount: Number.MAX_SAFE_INTEGER + 1 }] },
      { ...consumer, targets: [{ ...consumer.targets[0], publicShareMillis: 999 }] },
    ]) expect(() => assertLibcardResponse(body, origin)).toThrow();
    const response = { ...allowlisted(), note: 'must-never-be-public' };
    await expect(checkLibcardEndpoint(origin, async (_url, options) => new Response(options?.method === 'HEAD' ? null : JSON.stringify(response), { headers }))).rejects.toThrow();
  });
  it('sends the exact credential-free consumer request for HEAD and GET', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => new Response(options?.method === 'HEAD' ? null : JSON.stringify(allowlisted()), { headers }));
    expect(await checkLibcardEndpoint(origin, fetcher)).toEqual(allowlisted());
    expect(fetcher.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([[`${origin}/api/public/libcard`, 'HEAD'], [`${origin}/api/public/libcard`, 'GET']]);
    for (const [, options] of fetcher.mock.calls) expect(options).toEqual({ method: expect.any(String), headers: libcardHeaders, credentials: 'omit', redirect: 'manual', signal: expect.any(AbortSignal) });
  });
  it.each([301, 302, 307, 308, 404, 503])('fails deployment readiness on HTTP %i without following redirects', async status => {
    await expect(checkLibcardEndpoint(origin, async () => new Response(null, { status, headers: { location: 'https://elsewhere.example' } }))).rejects.toThrow('must return 200 directly');
  });
  it('bounds the body, requires public caching, and rejects session cookies', async () => {
    await expect(checkLibcardEndpoint(origin, async (_url, options) => new Response(options?.method === 'HEAD' ? null : 'x'.repeat(256 * 1024 + 1), { headers }))).rejects.toThrow('256 KiB');
    for (const [key, value] of [['Cache-Control', 'private, no-store'], ['Set-Cookie', 'session=fixture']]) {
      const altered = new Headers(headers); altered.set(key, value);
      await expect(checkLibcardEndpoint(origin, async () => new Response(null, { headers: altered }))).rejects.toThrow();
    }
    expect(contractOrigin('https://crs.tips/')).toBe('https://crs.tips');
    for (const value of ['http://crs.tips', 'https://localhost', 'https://127.0.0.1', 'https://crs.tips/path', 'https://user:pass@crs.tips', 'https://crs.tips?q=1']) expect(() => contractOrigin(value)).toThrow();
  });
});
