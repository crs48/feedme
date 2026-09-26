import { config } from './config';
import { getDb, getKv, setKv } from './db';
import { parsePostView, type PostView } from './bsky-content';
import { profile, updates } from './repository';
import { projectTag, projectUri } from './social-model';
import { readSocialRecords } from './social-repo';
import { z } from 'zod';
import { demoNoteImages, demoPerson } from './demo-media';

const publicQuery = async (method: 'app.bsky.feed.getAuthorFeed' | 'app.bsky.feed.getPosts', params: URLSearchParams) => {
  const response = await fetch(`https://public.api.bsky.app/xrpc/${method}?${params}`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Bluesky could not load these posts. Please try again.');
  return z.object({ posts: z.array(z.unknown()).optional(), feed: z.array(z.object({ post: z.unknown() })).optional(), cursor: z.string().max(2048).optional() }).parse(await response.json());
};
export const postUriFromInput = (input: string) => {
  const native = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([234567abcdefghijklmnopqrstuvwxyz]{13})$/.exec(input);
  if (native) return input;
  try {
    const url = new URL(input);
    const match = /^\/profile\/([^/]+)\/post\/([234567abcdefghijklmnopqrstuvwxyz]{13})\/?$/.exec(url.pathname);
    if (url.protocol === 'https:' && url.hostname === 'bsky.app' && match) return `at://${decodeURIComponent(match[1])}/app.bsky.feed.post/${match[2]}`;
  } catch { /* Report one actionable error for all unsupported input. */ }
  throw new Error('Paste a Bluesky post URL or an app.bsky.feed.post AT URI.');
};
export const loadOwnPost = async (input: string) => {
  const uri = postUriFromInput(input);
  const response = await publicQuery('app.bsky.feed.getPosts', new URLSearchParams({ uris: uri }));
  const post = parsePostView(response.posts?.[0]);
  if (!post || post.did !== config().ownerDid) throw new Error('Choose a public Bluesky post authored by this creator.');
  return post;
};
export const projectLog = async (projectId?: string, cursor?: string, linkedPage = 0) => {
  const owner = config().ownerDid;
  const associated = updates().filter((u) => (!projectId || u.projectId === projectId) && u.postUri);
  const linked = associated.slice(linkedPage * 20, linkedPage * 20 + 20).map((u) => u.postUri!);
  if (config().demo) {
    const shared = await readSocialRecords(owner, 'app.bsky.feed.post');
    const posts = shared.flatMap((record) => {
      const post = parsePostView({ ...record, record: record.value, author: { did: owner, displayName: profile().name, handle: profile().handle }, embed: record.value.embed });
      return post && (!projectId || post.tags.includes(projectTag(projectUri(owner, projectId))) || linked.includes(post.uri)) ? [{ ...post, avatar: demoPerson(owner)?.avatar, demo: true, url: projectId ? `/support/${projectId}` : '/updates' }] : [];
    });
    // Seed notes are illustrative posts, with no external writes in demo mode.
    for (const note of updates().filter((u) => !u.postUri && (!projectId || u.projectId === projectId))) posts.push({ uri: `demo:${note.id}`, cid: 'demo', url: `/support/${note.projectId}`, author: profile().name, handle: profile().handle, did: owner, avatar: demoPerson(owner)?.avatar, text: note.text, createdAt: note.createdAt, segments: [{ text: note.text }], images: demoNoteImages(note.id), tags: [], sensitive: false, demo: true });
    return { posts: posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), cursor: undefined, moreLinked: false, unavailable: false };
  }
  const cacheKey = JSON.stringify([owner, projectId, cursor, linked, linkedPage]);
  type Result = { posts: PostView[]; cursor?: string; moreLinked: boolean; unavailable: boolean };
  const cached = getKv<Result>(getDb(), 'project-log', cacheKey);
  if (cached) return cached;
  const results = await Promise.allSettled([
    cursor || linkedPage === 0 ? publicQuery('app.bsky.feed.getAuthorFeed', new URLSearchParams({ actor: owner, limit: '100', filter: 'posts_no_replies', ...(cursor ? { cursor } : {}) })) : Promise.resolve({ feed: [], cursor: undefined }),
    linked.length ? publicQuery('app.bsky.feed.getPosts', new URLSearchParams(linked.map((uri) => ['uris', uri]))) : Promise.resolve({ posts: [] }),
  ]);
  const author = results[0].status === 'fulfilled' ? results[0].value : undefined;
  const references = results[1].status === 'fulfilled' ? results[1].value : undefined;
  const posts = [...(author?.feed?.map((entry) => entry.post) || []), ...(references?.posts || [])].flatMap((value) => {
    const post = parsePostView(value);
    return post && post.did === owner && (!projectId || post.tags.includes(projectTag(projectUri(owner, projectId))) || linked.includes(post.uri)) ? [post] : [];
  });
  const result: Result = { posts: [...new Map(posts.map((post) => [post.uri, post])).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), cursor: author?.cursor, moreLinked: associated.length > (linkedPage + 1) * 20, unavailable: results.some((result) => result.status === 'rejected') };
  if (!result.unavailable) setKv(getDb(), 'project-log', cacheKey, result, 30_000);
  return result;
};
