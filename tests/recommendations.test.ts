import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined, creator: vi.fn(), transport: vi.fn(), demo: true }));
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: state.demo, ownerDid: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' }) }));
vi.mock('../src/lib/db', async (original) => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => state.db! }));
vi.mock('../src/lib/public-repo', () => ({ discoverCreator: state.creator }));
vi.mock('../src/lib/auth', () => ({ oauthClient: async () => ({ restore: async (did: string) => ({ did, fetchHandler: state.transport }) }) }));
import { openDatabase, putRecord, listRecords } from '../src/lib/db';
import { recommend, recommendations } from '../src/lib/recommendations';
import { demoFriends } from '../src/lib/seed';
import { publishProtocol, PROTOCOL_AUTHORITY, protocolSchemas } from '../src/lib/protocol';
const actor = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', subject = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
beforeEach(() => { state.db = openDatabase(':memory:'); state.demo = true; state.creator.mockReset(); state.transport.mockReset(); state.creator.mockResolvedValue({ did: subject, name: 'Sam', handle: 'sam.example', bio: 'hello', url: 'https://sam.example' }); });
afterEach(() => state.db!.close());
describe('portable recommendations', () => {
  it('publishes in the acting account, updates one record, and removes it from the home circle', async () => {
    await recommend(actor, subject, 'Helpful open source tools.');
    await recommend(actor, subject, 'Thoughtful tools, warmly recommended.');
    const saved = await recommendations(actor); expect(saved).toHaveLength(1); expect(saved[0].uri).toContain(`at://${actor}/fund.feedme.recommendation/`);
    expect(saved[0].value).toMatchObject({ did: subject, url: 'https://sam.example', description: 'Thoughtful tools, warmly recommended.' });
    expect(listRecords(state.db!, 'friend')).toHaveLength(1);
    await recommend(actor, subject, '', false); expect(await recommendations(actor)).toEqual([]); expect(listRecords(state.db!, 'friend')).toEqual([]);
  });
  it('keeps a visitor recommendation out of the host creator’s circle', async () => {
    await recommend(subject, demoFriends[0].did, 'A community worth supporting.');
    expect(await recommendations(subject)).toHaveLength(1); expect(listRecords(state.db!, 'friend')).toEqual([]);
  });
  it('reuses a local recommendation that has not synced yet, rather than duplicating it', async () => {
    const friend = { ...demoFriends[0], did: subject }; putRecord(state.db!, 'friend', friend.id, friend);
    await recommend(actor, subject, 'A new recommendation.');
    expect(await recommendations(actor)).toHaveLength(1); expect(listRecords(state.db!, 'friend')).toHaveLength(1);
  });
  it('requires a real discoverable profile and rejects self-recommendations', async () => {
    await expect(recommend(actor, actor, 'My own work')).rejects.toThrow('another creator');
    state.creator.mockResolvedValue(null); await expect(recommend(actor, subject, 'Nice work')).rejects.toThrow('discoverable');
    expect(await recommendations(actor)).toEqual([]);
  });
  it('uses the same record key after a lost provider response', async () => {
    state.demo = false;
    state.transport.mockImplementation(async (path: string) => path.includes('listRecords') ? Response.json({ records: [] }) : new Response('offline', { status: 503 }));
    await expect(recommend(actor, subject, 'Thoughtful work.')).rejects.toThrow();
    await expect(recommend(actor, subject, 'Thoughtful work.')).rejects.toThrow();
    const writes = state.transport.mock.calls.filter(([,init]) => init.method === 'POST').map(([,init]) => JSON.parse(init.body));
    expect(writes).toHaveLength(2); expect(writes[0].rkey).toBe(writes[1].rkey); expect(writes[0].repo).toBe(actor);
  });
  it('pins official schema publication to the feedme.fund DID', async () => {
    await expect(publishProtocol(actor)).rejects.toThrow('@feedme.fund');
    expect(protocolSchemas).toHaveLength(12);
    expect(await publishProtocol(PROTOCOL_AUTHORITY)).toBe(12);
    const records = listRecords<{ value: { $type: string; id: string } }>(state.db!, `demo-social:${PROTOCOL_AUTHORITY}:com.atproto.lexicon.schema`);
    expect(records.every((r) => r.value.$type === 'com.atproto.lexicon.schema' && r.value.id.startsWith('fund.feedme.'))).toBe(true);
  });
});
