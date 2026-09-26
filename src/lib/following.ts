import { z } from 'zod';
import { config } from './config';
import { profile, updates, project } from './repository';
import { blueskyPostUrl, parseProjectUri, projectTag, projectUri, type Follow } from './social-model';
import { readSocialRecords, socialClient } from './social-repo';
import { parsePostView, type PostView } from './bsky-content';
import { demoNoteImages, demoPerson } from './demo-media';

export type FollowingPost = PostView & { projectTitle?: string };
const feedSchema = z.object({ cursor: z.string().optional(), feed: z.array(z.object({ post: z.looseObject({
  uri: z.string(), author: z.object({ did: z.string(), handle: z.string(), displayName: z.string().optional(), avatar: z.unknown().optional(), labels: z.array(z.unknown()).optional(), viewer: z.object({ muted: z.boolean().optional(), blocking: z.string().optional(), blockedBy: z.boolean().optional() }).optional() }),
  record: z.looseObject({ text: z.string().max(10000), createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value))), tags: z.array(z.string()).optional() }),
}) })) });
export const parseFeed = (input: unknown, subscriptions?: Follow[], references: { subject: string; uri: string }[] = []): { posts: FollowingPost[]; cursor?: string } => {
  const data = feedSchema.parse(input);
  const posts = data.feed.flatMap(({ post }) => {
    const url = blueskyPostUrl(post.uri);
    const viewer = post.author.viewer;
    if (!url || !post.uri.startsWith(`at://${post.author.did}/`) || viewer?.muted || viewer?.blocking || viewer?.blockedBy) return [];
    const subscription = subscriptions?.find(({ value }) => parseProjectUri(value.subject)?.did === post.author.did && (post.record.tags?.includes(projectTag(value.subject)) || references.some((ref) => ref.subject === value.subject && ref.uri === post.uri)));
    if (subscriptions && !subscription) return [];
    const normalized = parsePostView(post);
    return normalized ? [{ ...normalized, projectTitle: subscription?.value.title }] : [];
  });
  return { posts, cursor: data.cursor };
};

const demoFeed = async (actor: string, subscriptions: Follow[], projectsOnly: boolean) => {
  const own = config().ownerDid;
  const posts: FollowingPost[] = updates().flatMap((update) => {
    const p = project(update.projectId);
    if (!p || !subscriptions.some(({ value }) => value.subject === (projectsOnly ? projectUri(own, p.id) : own))) return [];
    return [{ uri: `demo:${update.id}`, cid: 'demo', url: `/support/${p.id}`, text: update.text, createdAt: update.createdAt, author: profile().name, handle: profile().handle, did: own, avatar: demoPerson(own)?.avatar, projectTitle: p.title, images: demoNoteImages(update.id), tags: [], sensitive: false, demo: true, segments: [{ text: update.text }] }];
  });
  if (!projectsOnly) {
    const shared = await readSocialRecords(actor, 'app.bsky.feed.post');
    for (const record of shared) posts.push({ uri: record.uri, cid: 'demo', url: '/following?view=people', text: String(record.value.text), createdAt: String(record.value.createdAt), author: 'You · demo post', did: actor, avatar: demoPerson(actor)?.avatar, images: [], tags: [], sensitive: false, demo: true, segments: [{ text: String(record.value.text) }] });
  }
  return { posts: posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), warnings: [] as string[] };
};
export const followingFeed = async (actor: string, subscriptions: Follow[], projectsOnly: boolean, cursor?: string) => {
  if (config().demo) return { ...await demoFeed(actor, subscriptions, projectsOnly), cursor: undefined };
  const request = await socialClient(actor);
  if (!projectsOnly) {
    const data = parseFeed(await request('app.bsky.feed.getTimeline', { limit: 30, ...(cursor ? { cursor } : {}) }, false, true));
    return { ...data, warnings: [] as string[] };
  }
  const authors = [...new Set(subscriptions.map(({ value }) => parseProjectUri(value.subject)!.did))];
  const references = updates().flatMap((update) => update.postUri && subscriptions.some(({ value }) => value.subject === projectUri(config().ownerDid, update.projectId)) ? [{ subject: projectUri(config().ownerDid, update.projectId), uri: update.postUri }] : []).slice(0, 25);
  const results = await Promise.allSettled(authors.map(async (did) => parseFeed(await request('app.bsky.feed.getAuthorFeed', {
    actor: did, limit: 100, filter: 'posts_no_replies', ...(cursor && authors.length === 1 ? { cursor } : {}),
  }, false, true), subscriptions)));
  const posts = results.flatMap((result) => result.status === 'fulfilled' ? result.value.posts : []);
  if (references.length && !cursor) {
    try {
      const linked = z.object({ posts: z.array(z.unknown()) }).parse(await request('app.bsky.feed.getPosts', { uris: references.map((ref) => ref.uri) }, false, true));
      posts.push(...parseFeed({ feed: linked.posts.map((post) => ({ post })) }, subscriptions, references).posts);
    } catch { results.push({ status: 'rejected', reason: 'Linked posts unavailable' }); }
  }
  return {
    posts: [...new Map(posts.map((post) => [post.uri, post])).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    cursor: authors.length === 1 && results[0]?.status === 'fulfilled' ? results[0].value.cursor : undefined,
    warnings: results.some((result) => result.status === 'rejected') ? ['Some creators’ updates could not be loaded. Try refreshing in a moment.'] : [],
  };
};
