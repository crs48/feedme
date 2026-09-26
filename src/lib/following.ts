import { z } from 'zod';
import { config } from './config';
import { profile, updates, project } from './repository';
import { blueskyPostUrl, parseProjectUri, projectTag, projectUri, type Follow } from './social-model';
import { readSocialRecords, socialClient } from './social-repo';

export type FollowingPost = { uri: string; url: string; text: string; createdAt: string; author: string; did: string; projectTitle?: string };
const feedSchema = z.object({ cursor: z.string().optional(), feed: z.array(z.object({ post: z.object({
  uri: z.string(), author: z.object({ did: z.string(), handle: z.string(), displayName: z.string().optional(), viewer: z.object({ muted: z.boolean().optional(), blocking: z.string().optional(), blockedBy: z.boolean().optional() }).optional() }),
  record: z.object({ text: z.string().max(10000), createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value))), tags: z.array(z.string()).optional() }),
}) })) });
export const parseFeed = (input: unknown, subscriptions?: Follow[]): { posts: FollowingPost[]; cursor?: string } => {
  const data = feedSchema.parse(input);
  const posts = data.feed.flatMap(({ post }) => {
    const url = blueskyPostUrl(post.uri);
    const viewer = post.author.viewer;
    if (!url || !post.uri.startsWith(`at://${post.author.did}/`) || viewer?.muted || viewer?.blocking || viewer?.blockedBy) return [];
    const subscription = subscriptions?.find(({ value }) => parseProjectUri(value.subject)?.did === post.author.did && post.record.tags?.includes(projectTag(value.subject)));
    if (subscriptions && !subscription) return [];
    return [{ uri: post.uri, url, text: post.record.text, createdAt: post.record.createdAt, author: post.author.displayName || `@${post.author.handle}`, did: post.author.did, projectTitle: subscription?.value.title }];
  });
  return { posts, cursor: data.cursor };
};

const demoFeed = async (actor: string, subscriptions: Follow[], projectsOnly: boolean) => {
  const own = config().ownerDid;
  const posts: FollowingPost[] = updates().flatMap((update) => {
    const p = project(update.projectId);
    if (!p || !subscriptions.some(({ value }) => value.subject === (projectsOnly ? projectUri(own, p.id) : own))) return [];
    return [{ uri: `demo:${update.id}`, url: `/support/${p.id}`, text: update.text, createdAt: update.createdAt, author: profile().name, did: own, projectTitle: p.title }];
  });
  if (!projectsOnly) {
    const shared = await readSocialRecords(actor, 'app.bsky.feed.post');
    for (const record of shared) posts.push({ uri: record.uri, url: '/following?view=people', text: String(record.value.text), createdAt: String(record.value.createdAt), author: 'You · demo post', did: actor });
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
  const results = await Promise.allSettled(authors.map(async (did) => parseFeed(await request('app.bsky.feed.getAuthorFeed', {
    actor: did, limit: 100, filter: 'posts_no_replies', ...(cursor && authors.length === 1 ? { cursor } : {}),
  }, false, true), subscriptions)));
  const posts = results.flatMap((result) => result.status === 'fulfilled' ? result.value.posts : []);
  return {
    posts: [...new Map(posts.map((post) => [post.uri, post])).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    cursor: authors.length === 1 && results[0]?.status === 'fulfilled' ? results[0].value.cursor : undefined,
    warnings: results.some((result) => result.status === 'rejected') ? ['Some creators’ updates could not be loaded. Try refreshing in a moment.'] : [],
  };
};
