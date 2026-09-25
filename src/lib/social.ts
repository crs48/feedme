import { z } from 'zod';
import { config } from './config';
const feedSchema = z.object({ feed: z.array(z.object({ post: z.object({ uri: z.string(), record: z.object({ text: z.string(), createdAt: z.string() }) }) })) });
type SocialPost = { text: string; url: string; createdAt: string };
let cached: { expires: number; posts: SocialPost[] } | undefined;
export const socialFeed = async (): Promise<SocialPost[]> => {
  if (config().demo) return [];
  if (cached && cached.expires > Date.now()) return cached.posts;
  try {
    const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed');
    url.search = new URLSearchParams({ actor: config().ownerDid, limit: '5', filter: 'posts_no_replies' }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return cached?.posts || [];
    const data = feedSchema.parse(await response.json());
    const posts = data.feed.flatMap(({ post }) => {
      const match = /^at:\/\/(did:[^/]+)\/app.bsky.feed.post\/([a-zA-Z0-9._~:-]+)$/.exec(post.uri);
      return match && match[1] === config().ownerDid ? [{ text: post.record.text, createdAt: post.record.createdAt, url: `https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${encodeURIComponent(match[2])}` }] : [];
    });
    cached = { posts, expires: Date.now() + 120_000 };
    return posts;
  } catch { return cached?.posts || []; }
};
