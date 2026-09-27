import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined, read: vi.fn() }));
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: false, ownerDid: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' }) }));
vi.mock('../src/lib/db', async (original) => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => state.db! }));
vi.mock('../src/lib/public-repo', () => ({ publicCollection: state.read }));
import { openDatabase, putRecord, enqueue, getKv } from '../src/lib/db';
import { creatorCircle, refreshCreatorCircle } from '../src/lib/creator-circle';
import { demoFriends } from '../src/lib/seed';
const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
beforeEach(() => { state.db = openDatabase(':memory:'); state.read.mockReset(); }); afterEach(() => state.db!.close());
describe('portable public circles', () => {
  it('renders locally without network and replaces an old local endorsement with a complete PDS snapshot', async () => {
    putRecord(state.db!, 'friend', demoFriends[0].id, demoFriends[0]);
    expect(creatorCircle()).toEqual([demoFriends[0]]); expect(state.read).not.toHaveBeenCalled();
    state.read.mockResolvedValue({ records: [{ uri: `at://${owner}/fund.feedme.recommendation/${demoFriends[1].id}`, value: { $type: 'fund.feedme.recommendation', ...demoFriends[1], privateNote: 'SECRET' } }] });
    await refreshCreatorCircle();
    expect(creatorCircle()).toEqual([demoFriends[1]]);
    expect(JSON.stringify(getKv(state.db!, 'public-circle', owner))).not.toContain('SECRET');
  });
  it('shows a pending local edit instead of an older public copy', async () => {
    state.read.mockResolvedValue({ records: [{ value: { $type: 'fund.feedme.recommendation', ...demoFriends[0] } }] });
    await refreshCreatorCircle();
    const edited = { ...demoFriends[0], description: 'Updated locally.' }; putRecord(state.db!, 'friend', edited.id, edited); enqueue(state.db!, 'public', 'fund.feedme.recommendation', edited.id, edited);
    expect(creatorCircle()).toEqual([edited]);
  });
});
