import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
const mocks = vi.hoisted(() => ({ demo: false, fetch: vi.fn() }));
let db: DatabaseSync;
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: mocks.demo }) }));
vi.mock('../src/lib/db', async (original) => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => db }));
import { openDatabase, putRecord } from '../src/lib/db';
import { timelinePosts } from '../src/lib/timeline-posts';

const actor = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const uri = `at://${actor}/app.bsky.feed.post/3mposttest2222`;
const record = {
  $type: 'app.bsky.feed.post', text: 'More of this!', createdAt: '2026-10-08T20:37:32Z',
  facets: [{ index: { byteStart: 0, byteEnd: 4 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com/' }] }],
  embed: { $type: 'app.bsky.embed.external', external: { uri: 'https://creator.example/share/card', thumb: 'private-blob' } },
};
const post = { uri, author: { did: actor, handle: 'supporter.example', avatar: 'https://example.com/avatar.jpg' }, cid: 'original-cid', record,
  embed: { $type: 'app.bsky.embed.external#view', external: { uri: 'https://creator.example/share/card', thumb: 'https://example.com/card.png' } },
};
describe('text-only timeline shares', () => {
  beforeEach(() => {
    db = openDatabase(':memory:'); mocks.demo = false; mocks.fetch.mockReset(); vi.stubGlobal('fetch', mocks.fetch);
    mocks.fetch.mockImplementation(async () => Response.json({ posts: [post] }));
  });
  afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('returns only public text, safe facet links and the Bluesky URL, never embed images', async () => {
    const result = await timelinePosts([uri]);
    expect(result.get(uri)).toEqual({
      url: `https://bsky.app/profile/${encodeURIComponent(actor)}/post/3mposttest2222`,
      segments: [{ text: 'More', href: 'https://example.com/' }, { text: ' of this!' }], sensitive: false,
    });
    expect(JSON.stringify([...result])).not.toMatch(/thumb|embed|blob|avatar|card|cid/);
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(new URL(url).searchParams.getAll('uris')).toEqual([uri]);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('deduplicates references and caches public results for at most a minute', async () => {
    vi.useFakeTimers();
    await timelinePosts([uri, uri]);
    await timelinePosts([uri]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    mocks.fetch.mockImplementation(async () => Response.json({ posts: [] }));
    expect((await timelinePosts([uri])).size).toBe(0);
    await timelinePosts([uri]);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it('omits deleted, hidden, mismatched, and unrequested posts', async () => {
    for (const posts of [[], [{ ...post, labels: [{ val: '!hide' }] }], [{ ...post, author: { did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' } }],
      [{ ...post, uri: `at://${actor}/app.bsky.feed.post/another` }]]) {
      db.exec("DELETE FROM kv WHERE namespace='timeline-post'");
      mocks.fetch.mockImplementation(async () => Response.json({ posts }));
      expect((await timelinePosts([uri])).size).toBe(0);
    }
  });
  it('retains a content warning and original-post link without exposing sensitive text', async () => {
    mocks.fetch.mockImplementation(async () => Response.json({ posts: [{ ...post, labels: [{ val: '!warn' }] }] }));
    expect((await timelinePosts([uri])).get(uri)).toEqual({ url: expect.stringContaining('bsky.app/profile/'), segments: [], sensitive: true });
  });
  it('never serves expired or saved post text when the public network is unavailable', async () => {
    vi.useFakeTimers();
    await timelinePosts([uri]);
    vi.advanceTimersByTime(60_001);
    for (const failure of [() => { throw new Error('Offline'); }, () => new Response('', { status: 503 }), () => Response.json({ posts: 'invalid' })]) {
      mocks.fetch.mockImplementation(failure);
      expect((await timelinePosts([uri])).size).toBe(0);
    }
  });
  it('does not request invalid or absent references, and batches large pages', async () => {
    expect((await timelinePosts(['javascript:alert(1)', 'https://example.com/'])).size).toBe(0);
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockImplementation(async () => Response.json({ posts: [] }));
    await timelinePosts(Array.from({ length: 25 }, (_, i) => `at://${actor}/app.bsky.feed.post/post${i}`));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls.map(([url]) => new URL(url).searchParams.getAll('uris').length)).toEqual([20, 5]);
  });
  it('uses only existing local public posts in the offline demo', async () => {
    mocks.demo = true;
    expect((await timelinePosts([uri])).size).toBe(0);
    putRecord(db, `demo-social:${actor}:app.bsky.feed.post`, '3mposttest2222', { uri, cid: 'demo', value: record });
    expect((await timelinePosts([uri])).get(uri)?.segments).toEqual([{ text: 'More', href: 'https://example.com/' }, { text: ' of this!' }]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
