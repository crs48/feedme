import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
const state = vi.hoisted(() => ({ json: vi.fn(), transport: vi.fn(), db: undefined as DatabaseSync | undefined, directoryUrl: undefined as string | undefined }));
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: false, ownerDid: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', discoveryRelay: 'https://relay.example', directoryUrl: state.directoryUrl }) }));
vi.mock('../src/lib/db', async (original) => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => state.db! }));
vi.mock('../src/lib/public-network', async (original) => ({ ...await original<typeof import('../src/lib/public-network')>(), publicJson: state.json }));
vi.mock('../src/lib/social-repo', () => ({ socialClient: async () => state.transport }));
import { openDatabase } from '../src/lib/db';
import { discover, readGraph } from '../src/lib/discovery';
import { discoverCreator } from '../src/lib/public-repo';
import { PublicHttpError } from '../src/lib/public-network';
import { demoProfile } from '../src/lib/seed';
const actor = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', other = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const person = { did: other, handle: 'other.example', displayName: 'Other' };
beforeEach(() => { state.db = openDatabase(':memory:'); state.directoryUrl = undefined; state.json.mockReset(); state.transport.mockReset(); }); afterEach(() => state.db!.close());
const publicTransport = (url: string) => {
  if (url.includes('plc.directory')) return { id: other, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }] };
  if (url.includes('getRecord')) return { uri: `at://${other}/fund.feedme.profile/self`, value: { ...demoProfile, $type: 'fund.feedme.profile', feedmeUrl: 'https://other.example', discoverable: true } };
  if (url.includes('.well-known/feedme')) return { did: other, url: 'https://other.example', protocol: 'fund.feedme', profile: `at://${other}/fund.feedme.profile/self` };
  if (url.includes('listReposByCollection')) return { repos: [{ did: other }], cursor: 'next-page' };
  throw new Error('Unexpected public request');
};
describe('discovery adapters', () => {
  it('uses snapshot DIDs as hints, rechecks their sites, then continues with the relay', async () => {
    const now = new Date().toISOString(); state.directoryUrl = 'https://index.example/v1.json';
    const snapshot = { schemaVersion: 1, generatedAt: now, source: { relays: ['https://relay.example'], partial: true }, creators: [{ did: other, name: 'Untrusted snapshot name', bio: 'Public hint', url: 'https://wrong.example', profileUri: `at://${other}/fund.feedme.profile/self`, profileCid: 'cid', advertisementCheckedAt: now, siteCheckedAt: now, lastVerifiedAt: now, siteStatus: 'reachable' }] };
    state.json.mockImplementation((url: string) => url === state.directoryUrl ? snapshot : publicTransport(url));
    state.transport.mockResolvedValue({ profiles: [person] });
    const result = await discover(actor, 'explore');
    expect(result.cards[0].url).toBe('https://other.example'); expect(result.nextCursor).toBe('relay:');
    expect(result.warnings.join(' ')).toContain('partial');
    expect(state.json.mock.calls.some(([url]) => String(url).includes('listReposByCollection'))).toBe(false);
    await discover(actor, 'explore', 0, 0, result.nextCursor);
    expect(state.json.mock.calls.some(([url]) => String(url).includes('listReposByCollection'))).toBe(true);
    state.transport.mockResolvedValue({ profiles: [{ ...person, viewer: { muted: true } }] });
    expect((await discover(actor, 'explore')).cards).toEqual([]);
  });
  it('keeps relay discovery available when the optional directory is offline', async () => {
    state.directoryUrl = 'https://index.example/v1.json';
    state.json.mockImplementation((url: string) => { if (url === state.directoryUrl) throw new Error('offline'); return publicTransport(url); });
    state.transport.mockResolvedValue({ profiles: [person] });
    expect((await discover(actor, 'explore')).cards[0].did).toBe(other);
  });
  it('requires matching site identity and caches validated profiles', async () => {
    state.json.mockImplementation(publicTransport);
    expect((await discoverCreator(other))?.url).toBe('https://other.example');
    expect((await discoverCreator(other))?.did).toBe(other);
    expect(state.json).toHaveBeenCalledTimes(3);
    state.json.mockImplementation((url: string) => url.includes('.well-known/feedme') ? { did: actor, url: 'https://other.example', protocol: 'fund.feedme' } : publicTransport(url));
    await expect(discoverCreator(other, true)).rejects.toThrow();
  });
  it('does not cache network failure as absence, but caches an explicit missing record briefly', async () => {
    state.json.mockImplementation((url: string) => { if (url.includes('getRecord')) throw new Error('offline'); return publicTransport(url); });
    await expect(discoverCreator(other)).rejects.toThrow('offline');
    state.json.mockImplementation(publicTransport);
    expect(await discoverCreator(other)).not.toBeNull();
  });
  it('understands the PDS RecordNotFound error without treating an arbitrary 404 as missing', async () => {
    state.json.mockImplementation((url: string) => { if (url.includes('getRecord')) throw new PublicHttpError(400, 'RecordNotFound'); return publicTransport(url); });
    expect(await discoverCreator(other)).toBeNull();
    const calls = state.json.mock.calls.length; expect(await discoverCreator(other)).toBeNull(); expect(state.json).toHaveBeenCalledTimes(calls);
  });
  it('paginates graph reads, deduplicates DIDs and reports a bounded partial scan', async () => {
    state.transport.mockResolvedValueOnce({ subject: { did: actor }, follows: [person], cursor: 'next' }).mockResolvedValueOnce({ subject: { did: actor }, follows: [person] });
    expect(await readGraph(actor, actor, 'follows')).toEqual({ people: [person], limited: false });
    expect(state.transport.mock.calls[1][1].cursor).toBe('next');
    state.transport.mockResolvedValue({ subject: { did: other }, follows: [person], cursor: 'more' });
    expect((await readGraph(actor, other, 'follows', 1)).limited).toBe(true);
  });
  it('filters directory results against current viewer blocks and fails closed when moderation is unavailable', async () => {
    state.json.mockImplementation(publicTransport);
    state.transport.mockResolvedValue({ profiles: [{ ...person, viewer: { blockedBy: true } }] });
    expect((await discover(actor, 'explore')).cards).toEqual([]);
    state.transport.mockRejectedValue(new Error('offline'));
    const result = await discover(actor, 'explore'); expect(result.cards).toEqual([]); expect(result.warnings.join(' ')).toContain('visibility');
    state.transport.mockResolvedValue({ profiles: [{ ...person, viewer: { following: 'at://follow' } }] });
    const visible = await discover(actor, 'explore'); expect(visible.cards[0].connection.following).toBe(true); expect(visible.nextCursor).toBe('relay:next-page');
  });
});
