import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ fetch: vi.fn(), notes: [] as { projectId: string; postUri: string }[] }));
const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
let db: DatabaseSync;
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: false, ownerDid: owner }) }));
vi.mock('../src/lib/repository', () => ({ updates: () => mock.notes, profile: () => ({ name: 'Alex', handle: 'alex.test' }) }));
vi.mock('../src/lib/db', async (original) => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => db }));
import { openDatabase } from '../src/lib/db';
import { projectLog, loadOwnPost } from '../src/lib/project-log';
import { projectTag, projectUri } from '../src/lib/social-model';
const post = (did = owner, key = '3mposttest222') => ({ uri: `at://${did}/app.bsky.feed.post/${key}`, cid: 'cid', author: { did, handle: 'alex.test' }, record: { text: 'Progress!', createdAt: '2026-09-25T12:00:00Z', tags: [projectTag(projectUri(owner, 'sauna'))] } });
describe('native project log', () => {
  beforeEach(() => { db = openDatabase(':memory:'); mock.fetch.mockReset(); mock.notes = []; vi.stubGlobal('fetch', mock.fetch); });
  afterEach(() => { db.close(); vi.unstubAllGlobals(); });
  it('merges tagged posts and explicit references, deduplicates them, and rejects other authors', async () => {
    mock.notes = [{ projectId: 'sauna', postUri: post().uri }];
    mock.fetch.mockImplementation(async (url: string) => Response.json(url.includes('getAuthorFeed') ? { feed: [{ post: post() }, { post: post('did:plc:bbbbbbbbbbbbbbbbbbbbbbbb') }], cursor: 'older' } : { posts: [post()] }));
    const result = await projectLog('sauna');
    expect(result.posts).toHaveLength(1); expect(result.cursor).toBe('older');
    expect(result.posts[0].uri).toBe(post().uri);
  });
  it('does not render a deleted imported post from its locally saved text', async () => {
    mock.notes = [{ projectId: 'sauna', postUri: post().uri }];
    mock.fetch.mockImplementation(async () => Response.json({ feed: [], posts: [] }));
    expect((await projectLog('sauna')).posts).toEqual([]);
  });
  it('does not restart the author feed while paging remaining linked posts', async () => {
    mock.notes = Array.from({ length: 30 }, (_, i) => ({ projectId: 'sauna', postUri: `at://${owner}/app.bsky.feed.post/3mposttest${String(i).padStart(3, '2')}` }));
    mock.fetch.mockImplementation(async () => Response.json({ posts: [] }));
    await projectLog('sauna', undefined, 1);
    expect(mock.fetch).toHaveBeenCalledTimes(1);
    expect(mock.fetch.mock.calls[0][0]).toContain('getPosts');
    expect(new URL(mock.fetch.mock.calls[0][0]).searchParams.getAll('uris')).toHaveLength(10);
  });
  it('only imports a post after verifying the author DID', async () => {
    mock.fetch.mockResolvedValue(Response.json({ posts: [post('did:plc:bbbbbbbbbbbbbbbbbbbbbbbb')] }));
    await expect(loadOwnPost('https://bsky.app/profile/alex.test/post/3mposttest222')).rejects.toThrow('authored');
  });
});
