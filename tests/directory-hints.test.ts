import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined, json: vi.fn(), url: 'https://directory.example/v1.json' }));
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: false, directoryUrl: state.url }) }));
vi.mock('../src/lib/db', async (original) => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => state.db! }));
vi.mock('../src/lib/public-network', async (original) => ({ ...await original<typeof import('../src/lib/public-network')>(), publicJson: state.json }));
import { openDatabase } from '../src/lib/db';
import { directoryHints } from '../src/lib/directory-hints';
const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
beforeEach(() => { state.db = openDatabase(':memory:'); state.url = 'https://directory.example/v1.json'; state.json.mockReset(); });
afterEach(() => state.db!.close());
const snapshot = () => { const now = new Date().toISOString(); return { schemaVersion: 1, generatedAt: now, source: { relays: ['https://relay.example'], partial: false }, creators: [{ did, name: 'Creator', bio: 'Public work', profileUri: `at://${did}/fund.feedme.profile/self`, profileCid: 'cid', advertisementCheckedAt: now, siteCheckedAt: now, lastVerifiedAt: now, siteStatus: 'reachable', url: 'https://creator.example' }] }; };
describe('replaceable directory hints', () => {
  it('returns only candidate DIDs, caches the snapshot and never sends viewer context', async () => {
    state.json.mockResolvedValue(snapshot());
    expect(await directoryHints()).toEqual({ dids: [did], partial: false });
    expect(await directoryHints()).toEqual({ dids: [did], partial: false });
    expect(state.json).toHaveBeenCalledExactlyOnceWith(state.url, { maxBytes: 2_000_001 });
  });
  it('fails open to direct discovery on outage, disabled configuration, or stale/future exports', async () => {
    state.json.mockRejectedValue(new Error('Unavailable')); expect(await directoryHints()).toBeUndefined();
    for (const generatedAt of ['2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z']) {
      state.url += '?test'; state.json.mockResolvedValue({ ...snapshot(), generatedAt }); expect(await directoryHints()).toBeUndefined();
    }
    state.url = ''; state.json.mockClear(); expect(await directoryHints()).toBeUndefined(); expect(state.json).not.toHaveBeenCalled();
  });
});
