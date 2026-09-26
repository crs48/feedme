import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
const mocks = vi.hoisted(() => ({ transport: vi.fn(), restore: vi.fn(), demo: false }));
let db: DatabaseSync;
const actor = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: mocks.demo, ownerDid: owner }) }));
vi.mock('../src/lib/auth', () => ({ oauthClient: async () => ({ restore: mocks.restore }), digest: (input: string) => createHash('sha256').update(input).digest('hex') }));
vi.mock('../src/lib/db', async (original) => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => db }));
import { openDatabase, setKv } from '../src/lib/db';
import { changeFollow, publishPost, readFollows } from '../src/lib/social-repo';
import { FOLLOW, projectTag, projectUri, publicPostText, shortPostText } from '../src/lib/social-model';
import { parseFeed } from '../src/lib/following';
import { canShareTip } from '../src/lib/tip-sharing';
import type { Support } from '../src/lib/model';

describe('actor-scoped social records', () => {
  beforeEach(() => {
    db = openDatabase(':memory:'); mocks.demo = false; mocks.transport.mockReset(); mocks.restore.mockReset();
    mocks.restore.mockImplementation(async (did: string) => ({ did, fetchHandler: mocks.transport }));
  });
  afterEach(() => db.close());
  const record = (subject = owner, rkey = '3mfollowtest22') => ({ uri: `at://${actor}/${FOLLOW}/${rkey}`, cid: 'bafytest', value: { $type: FOLLOW, subject, createdAt: '2026-09-25T12:00:00Z' } });
  it('finds an existing native follow on a later PDS page without duplicating it', async () => {
    mocks.transport.mockResolvedValueOnce(Response.json({ records: [], cursor: 'next' })).mockResolvedValueOnce(Response.json({ records: [record()] }));
    await changeFollow(actor, 'creator', owner, true);
    expect(mocks.transport).toHaveBeenCalledTimes(2);
    expect(mocks.transport.mock.calls[1][0]).toContain('cursor=next');
    expect(mocks.restore.mock.calls.every(([did]) => did === actor)).toBe(true);
  });
  it('does not turn an incomplete list into an unfollowed state', async () => {
    mocks.transport.mockImplementation(async () => Response.json({ records: [], cursor: 'loop' }));
    await expect(changeFollow(actor, 'creator', owner, true)).rejects.toThrow('completely');
    expect(mocks.transport.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
  });
  it('writes to the supporter repo with a stable TID when a provider response is lost', async () => {
    mocks.transport.mockImplementation(async (path: string) => path.includes('listRecords') ? Response.json({ records: [] }) : new Response('offline', { status: 503 }));
    await expect(changeFollow(actor, 'creator', owner, true)).rejects.toThrow();
    await expect(changeFollow(actor, 'creator', owner, true)).rejects.toThrow();
    const writes = mocks.transport.mock.calls.filter(([, init]) => init.method === 'POST').map(([, init]) => JSON.parse(init.body));
    expect(writes[0]).toEqual(writes[1]);
    expect(writes[0].repo).toBe(actor);
    expect(writes[0].rkey).toMatch(/^[234567abcdefghijklmnopqrstuvwxyz]{13}$/);
  });
  it('only deletes matching follows in the authenticated repo and uses compare-and-swap', async () => {
    mocks.transport.mockResolvedValueOnce(Response.json({ records: [record(), record('did:plc:dddddddddddddddddddddddd', 'another')] })).mockResolvedValueOnce(Response.json({}));
    await changeFollow(actor, 'creator', owner, false);
    expect(JSON.parse(mocks.transport.mock.calls[1][1].body)).toEqual({ repo: actor, collection: FOLLOW, rkey: '3mfollowtest22', swapRecord: 'bafytest' });
    mocks.transport.mockResolvedValueOnce(Response.json({ records: [{ ...record(), uri: `at://${owner}/${FOLLOW}/foreign` }] }));
    await expect(changeFollow(actor, 'creator', owner, false)).rejects.toThrow('another account');
  });
  it('keeps public post retries idempotent and does not accept changed text', async () => {
    mocks.transport.mockResolvedValue(Response.json({}));
    const payload = { $type: 'app.bsky.feed.post', text: 'A public cheer', createdAt: '2026-09-25T12:00:00Z' };
    const first = await publishPost(actor, 'tip:one', payload);
    expect(await publishPost(actor, 'tip:one', payload)).toBe(first);
    expect(mocks.transport).toHaveBeenCalledTimes(1);
    await expect(publishPost(actor, 'tip:one', { ...payload, text: 'Other' })).rejects.toThrow('different text');
  });
  it('uses no network in demo, and project subscriptions are portable AT URIs', async () => {
    mocks.demo = true;
    const subject = projectUri(owner, 'sauna');
    await changeFollow(actor, 'project', subject, true, 'Sauna');
    expect((await readFollows(actor, 'project'))[0].value.subject).toBe(subject);
    await changeFollow(actor, 'project', subject, false);
    expect(await readFollows(actor, 'project')).toEqual([]);
    expect(mocks.restore).not.toHaveBeenCalled();
  });
  it('requires confirmed support and receipt access before sharing', () => {
    const s: Support = { id: 's1', projectId: 'sauna', amount: 1500, currency: 'usd', visibility: 'anonymous', note: 'SECRET', status: 'paid', refundedAmount: 0, disputed: false, createdAt: '2026-09-25T12:00:00Z' };
    const user = { did: actor };
    expect(canShareTip(s, user, undefined)).toBe(false);
    setKv(db, 'checkout-owner', s.id, createHash('sha256').update('browser').digest('hex'));
    expect(canShareTip(s, user, 'browser')).toBe(true);
    expect(canShareTip(s, undefined, 'browser')).toBe(false);
    expect(canShareTip({ ...s, status: 'pending' }, user, 'browser')).toBe(false);
    expect(canShareTip({ ...s, refundedAmount: 1500 }, user, 'browser')).toBe(false);
    expect(canShareTip({ ...s, visibility: 'private', supporterDid: actor }, user, undefined)).toBe(true);
  });
});

describe('public content contracts', () => {
  it('keeps avatar metadata through feed validation without losing profile moderation labels', () => {
    const author = { did: owner, handle: 'alex.test', avatar: 'https://cdn.bsky.app/avatar.jpg' };
    const post = { uri: `at://${owner}/app.bsky.feed.post/3mposttest2222`, author, record: { text: 'Update', createdAt: '2026-09-25T12:00:00Z' } };
    expect(parseFeed({ feed: [{ post }] }).posts[0].avatar).toBe(author.avatar);
    expect(parseFeed({ feed: [{ post: { ...post, author: { ...author, labels: [{ val: 'nudity' }] } } }] }).posts[0].avatar).toBeUndefined();
    expect(parseFeed({ feed: [{ post: { ...post, author: { ...author, avatar: 'javascript:alert(1)' } } }] }).posts[0].avatar).toBeUndefined();
  });
  it('counts graphemes and bytes and truncates without breaking emoji', () => {
    expect(publicPostText('👩‍🌾'.repeat(200))).toBe('👩‍🌾'.repeat(200));
    expect(() => publicPostText('x'.repeat(301))).toThrow();
    expect(() => publicPostText('👩‍👩‍👧‍👦'.repeat(200))).toThrow();
    expect(publicPostText(shortPostText('👩‍👩‍👧‍👦'.repeat(300)))).toContain('…');
  });
  it('matches a project tag only on posts by the project creator', () => {
    const subject = projectUri(owner, 'sauna');
    const post = (did: string) => ({ post: { uri: `at://${did}/app.bsky.feed.post/3mposttest2222`, author: { did, handle: 'someone.example' }, record: { text: 'Project news', createdAt: '2026-09-25T12:00:00Z', tags: [projectTag(subject)] } } });
    const subscriptions = [{ uri: 'at://follow', cid: 'cid', value: { $type: 'social.feedme.follow', subject, createdAt: '2026-09-25T12:00:00Z' } }];
    expect(parseFeed({ feed: [post(owner), post(actor)] }, subscriptions).posts.map((p) => p.did)).toEqual([owner]);
  });
});
