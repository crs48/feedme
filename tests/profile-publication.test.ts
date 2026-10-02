import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined, json: vi.fn(), demo: false }));
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: state.demo, ownerDid: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', origin: 'https://feedme.example' }) }));
vi.mock('../src/lib/db', async (original) => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => state.db! }));
vi.mock('../src/lib/public-network', async (original) => ({ ...await original<typeof import('../src/lib/public-network')>(), publicJson: state.json }));
import { openDatabase, pendingWrites, getKv, putRecord } from '../src/lib/db';
import { publishProfile, readPublication, launchPostUrl } from '../src/lib/profile-publication';
import { saveProject } from '../src/lib/repository';
import { demoProfile, demoProjects } from '../src/lib/seed';
import { PublicHttpError } from '../src/lib/public-network';
const did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const remote = (value: object = {}) => ({ uri: `at://${did}/fund.feedme.profile/self`, cid: 'current-cid', value: { $type: 'fund.feedme.profile', ...demoProfile, feedmeUrl: 'https://feedme.example', discoverable: true, ...value } });
beforeEach(() => {
  state.db = openDatabase(':memory:'); state.demo = false; state.json.mockReset();
  state.json.mockImplementation(async (url: string) => url.includes('plc.directory') ? { id: did, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }] } : remote());
});
afterEach(() => state.db!.close());
describe('explicit creator announcement', () => {
  it('records the reviewed remote version atomically with the public announcement', async () => {
    await publishProfile({ ...demoProfile, discoverable: true, privateSecret: 'PRIVATE' }, 'current-cid', false);
    const queued = pendingWrites(state.db!);
    expect(queued).toHaveLength(1); expect(queued[0].value).toMatchObject({ feedmeUrl: 'https://feedme.example', discoverable: true });
    expect(queued[0].value).not.toHaveProperty('privateSecret');
    expect(getKv(state.db!, 'profile-publication', 'expected')).toMatchObject({ cid: 'current-cid' });
  });
  it('creates an absent announcement with a null record precondition', async () => {
    state.json.mockImplementation(async (url: string) => { if (url.includes('getRecord')) throw new PublicHttpError(400, 'RecordNotFound'); return { id: did, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }] }; });
    expect(await readPublication()).toMatchObject({ state: 'ready', token: 'absent' });
    await publishProfile(demoProfile, 'absent', false);
    expect(getKv(state.db!, 'profile-publication', 'expected')).toMatchObject({ cid: null });
  });
  it('requires a fresh version and explicit confirmation for remote opt-out or a different site', async () => {
    for (const value of [{ discoverable: false }, { feedmeUrl: 'https://previous.example' }]) {
      state.json.mockImplementation(async (url: string) => url.includes('plc.directory') ? { id: did, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.example' }] } : remote(value));
      await expect(publishProfile({ ...demoProfile, discoverable: true }, 'current-cid', false)).rejects.toThrow('Confirm');
      await expect(publishProfile(demoProfile, 'older-cid', true)).rejects.toThrow('changed');
      expect(pendingWrites(state.db!)).toEqual([]);
    }
    await publishProfile(demoProfile, 'current-cid', true); expect(pendingWrites(state.db!)).toHaveLength(1);
  });
  it('never publishes from an unavailable read or from demo setup', async () => {
    state.json.mockRejectedValue(new Error('offline'));
    await expect(publishProfile(demoProfile, '', false)).rejects.toThrow('could not be checked');
    expect(pendingWrites(state.db!)).toEqual([]);
    state.demo = true; await publishProfile(demoProfile, '', false); expect(pendingWrites(state.db!)).toEqual([]);
  });
  it('does not announce a creator as a side effect of publishing a project', () => {
    putRecord(state.db!, 'profile', 'self', demoProfile); saveProject(demoProjects[0]);
    expect(pendingWrites(state.db!).map(r => r.collection)).toEqual(['fund.feedme.project']);
  });
  it('only prepares a Bluesky composer link, with a reviewable launch message', () => {
    const url = new URL(launchPostUrl('https://feedme.example'));
    expect(url.origin + url.pathname).toBe('https://bsky.app/intent/compose');
    expect(url.searchParams.get('text')).toContain('https://feedme.example');
    expect(url.searchParams.get('text')).toContain('#Feedme');
    expect(pendingWrites(state.db!)).toEqual([]);
  });
});
