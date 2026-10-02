import { describe, expect, it } from 'vitest';
import { boundedDirectoryReader, collectDirectory, observeCreator } from '../src/lib/directory-collector';
import { DAY, directorySnapshotSchema, publicDirectoryCreators, type DirectoryCandidate } from '../src/lib/directory-model';
import { profileUri, type PublicReader } from '../src/lib/public-identity';
import { PublicHttpError } from '../src/lib/public-network';
const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', second = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const time = '2026-10-02T12:00:00.000Z';
const marker = (owner = did) => ({ uri: profileUri(owner), cid: 'bafyreiprofile', value: { $type: 'fund.feedme.profile', name: 'Example Creator', handle: 'spoof.example', bio: 'A public introduction.', location: '', website: '', feedmeUrl: 'https://creator.example', discoverable: true, privateNote: 'DO NOT EXPORT' } });
const transport: PublicReader = async (input) => {
  const url = new URL(input); const owner = url.searchParams.get('repo') || url.searchParams.get('actor') || did;
  if (url.pathname.includes('listReposByCollection')) return { repos: [{ did }] };
  if (url.hostname === 'plc.directory') return { id: decodeURIComponent(url.pathname.slice(1)), alsoKnownAs: ['at://creator.example'], service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }] };
  if (url.pathname.includes('getRecord')) return marker(owner);
  if (url.pathname.includes('getProfile')) return { did: owner, handle: 'creator.example' };
  if (url.pathname.includes('resolveHandle')) return { did };
  if (url.pathname === '/.well-known/feedme') return { did, protocol: 'fund.feedme', url: 'https://creator.example', profile: profileUri(did), mode: 'live' };
  throw new Error('Unexpected request');
};
const observe = (read: PublicReader = transport, previous?: DirectoryCandidate) => observeCreator(did, read, time, previous);
describe('public creator directory', () => {
  it('checks both identity directions and emits only allowlisted public fields', async () => {
    const { snapshot } = await collectDirectory({ read: transport, now: new Date(time) });
    expect(snapshot.creators).toHaveLength(1);
    expect(snapshot.creators[0]).toMatchObject({ did, handle: 'creator.example', url: 'https://creator.example', siteStatus: 'reachable' });
    expect(JSON.stringify(snapshot)).not.toMatch(/DO NOT EXPORT|privateNote|spoof.example/);
    expect(directorySnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });
  it('does not display a handle without reciprocal identity resolution', async () => {
    const result = await observe(async (url, options) => url.includes('resolveHandle') ? { did: second } : transport(url, options));
    expect(result.creator?.handle).toBeUndefined(); expect(result.creator?.url).toBeDefined();
  });
  it('withdraws opt-outs and missing records, including during a relay outage', async () => {
    const first = await collectDirectory({ read: transport, now: new Date(time) });
    for (const absent of [false, true]) {
      const read: PublicReader = async (url, options) => {
        if (url.includes('listReposByCollection')) throw new Error('Relay down');
        if (url.includes('getRecord')) { if (absent) throw new PublicHttpError(400, 'RecordNotFound'); return { ...marker(), value: { ...marker().value, discoverable: false } }; }
        return transport(url, options);
      };
      const result = await collectDirectory({ previous: first.state, read, now: new Date(time) });
      expect(result.snapshot.creators).toEqual([]); expect(result.state.candidates[0]).not.toHaveProperty('creator');
      expect(result.snapshot.source.partial).toBe(true);
    }
  });
  it('suppresses mismatches, demos, public hide labels, and policy exclusions', async () => {
    const first = await observe();
    for (const change of [{ did: second }, { profile: profileUri(second) }, { url: 'https://evil.example' }, { mode: 'demo' }]) {
      const result = await observe(async (url, options) => url.includes('.well-known/feedme') ? { ...await transport(url, options) as object, ...change } : transport(url, options), first);
      expect(result.creator).toBeUndefined();
    }
    const hidden = await observe(async (url, options) => url.includes('getProfile') ? { did, handle: 'creator.example', labels: [{ val: '!hide' }] } : transport(url, options), first);
    expect(hidden.outcome).toBe('suppressed');
    const suppressed = await collectDirectory({ policy: { suppressed: [did] }, read: transport });
    expect(suppressed.snapshot.creators).toEqual([]); expect(suppressed.stats.checked).toBe(0);
  });
  it('keeps unreachable previously checked sites without their outbound links and expires stale consent', async () => {
    const first = await observe();
    const offline: PublicReader = async (url, options) => { if (url.includes('.well-known/feedme')) throw new Error('offline'); return transport(url, options); };
    const failed = await observe(offline, first);
    const failedAgain = await observe(offline, failed);
    expect(failedAgain.creator).toMatchObject({ siteStatus: 'unreachable', lastVerifiedAt: time });
    expect(failedAgain.creator?.url).toBeUndefined();
    expect(publicDirectoryCreators([failedAgain], Date.parse(time) + DAY)).toHaveLength(1);
    expect(publicDirectoryCreators([failedAgain], Date.parse(time) + 8 * DAY)).toEqual([]);
    const unknown = await observe(async () => { throw new Error('PDS unavailable'); }, first);
    expect(unknown.creator?.advertisementCheckedAt).toBe(time); expect(unknown.creator?.url).toBeUndefined();
  });
  it('does not carry site verification over to a newly advertised domain', async () => {
    const first = await observe();
    const moved = await observe(async (url, options) => {
      if (url.includes('getRecord')) return { ...marker(), value: { ...marker().value, feedmeUrl: 'https://new.example' } };
      if (url.includes('.well-known/feedme')) throw new Error('Offline');
      return transport(url, options);
    }, first);
    expect(publicDirectoryCreators([moved], Date.parse(time))).toEqual([]);
  });
  it('follows PDS migrations and lets a previously withdrawn creator rejoin', async () => {
    const requests: string[] = [];
    const result = await observe(async (url, options) => {
      requests.push(url);
      if (url.includes('plc.directory')) return { id: did, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://new-pds.example' }] };
      return transport(url, options);
    }, { did, outcome: 'withdrawn', attemptedAt: time });
    expect(result.creator?.url).toBe('https://creator.example');
    expect(requests.some(url => url.startsWith('https://new-pds.example/'))).toBe(true);
    expect(requests.some(url => url.startsWith('https://pds.example/'))).toBe(false);
  });
  it('rejects candidate-controlled internal PDS and site destinations before requesting them', async () => {
    for (const internal of ['https://127.1', 'https://169.254.169.254', 'https://[::1]', 'http://creator.example']) {
      const requests: string[] = [];
      const read: PublicReader = async (url, options) => {
        requests.push(url);
        if (url.includes('plc.directory')) return { id: did, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: internal }] };
        return transport(url, options);
      };
      expect((await observe(read)).creator).toBeUndefined(); expect(requests).toHaveLength(1);
      const result = await observe(async (url, options) => url.includes('getRecord') ? { ...marker(), value: { ...marker().value, feedmeUrl: internal } } : transport(url, options));
      expect(result.creator).toBeUndefined();
    }
  });
  it('cools throttled providers for the run without blocking independent hosts', async () => {
    const calls: string[] = [];
    const read = boundedDirectoryReader(async url => { calls.push(url); if (url.includes('slow.example')) throw new PublicHttpError(429); return {}; }, Date.now() + 1000);
    const results = await Promise.allSettled([read('https://slow.example/1'), read('https://slow.example/2'), read('https://other.example/1')]);
    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected', 'fulfilled']);
    expect(calls).toEqual(['https://slow.example/1', 'https://other.example/1']);
  });
  it('paginates and deduplicates candidates, detecting repeated cursors', async () => {
    let pages = 0;
    const result = await collectDirectory({ now: new Date(time), read: async (url, options) => {
      if (url.includes('listReposByCollection')) { pages++; return { repos: [{ did }, { did }], cursor: 'repeat' }; }
      return transport(url, options);
    } });
    expect(pages).toBe(2); expect(result.stats.checked).toBe(1); expect(result.snapshot.source.partial).toBe(true); expect(result.state.cursor).toBeUndefined();
  });
  it('preserves partial scan cursors and fairly checks old and new candidates', async () => {
    const first = await collectDirectory({ read: transport, now: new Date(time) });
    const checked: string[] = [];
    const result = await collectDirectory({ previous: first.state, now: new Date(time), maxChecks: 2, maxPages: 1, read: async (url, options) => {
      if (url.includes('listReposByCollection')) return { repos: [{ did: second }], cursor: 'next-page' };
      if (url.includes('getRecord')) checked.push(new URL(url).searchParams.get('repo')!);
      return transport(url, options);
    } });
    expect(checked).toEqual(expect.arrayContaining([did, second])); expect(result.state.cursor).toBe('next-page');
    expect(result.snapshot.source.partial).toBe(true);
  });
  it('never lets a failed moderation read approve a new candidate', async () => {
    const result = await observe(async (url, options) => { if (url.includes('getProfile')) throw new Error('Unavailable'); return transport(url, options); });
    expect(result.outcome).toBe('error'); expect(result.creator).toBeUndefined();
  });
  it('rebuilds from seeds without a relay and keeps exhausted budgets explicit', async () => {
    const result = await collectDirectory({ policy: { seeds: [did] }, read: async (url, options) => { if (url.includes('listReposByCollection')) throw new Error('Offline'); return transport(url, options); }, now: new Date(time) });
    expect(result.snapshot.creators).toHaveLength(1); expect(result.snapshot.source.partial).toBe(true);
    const exhausted = await collectDirectory({ policy: { seeds: [did] }, budgetMs: 0, read: transport });
    expect(exhausted.stats.checked).toBe(0); expect(exhausted.snapshot.source.partial).toBe(true);
  });
});
