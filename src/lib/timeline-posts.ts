import { z } from 'zod';
import { parsePostView, type TextSegment } from './bsky-content';
import { config } from './config';
import { getDb, getKv, readRecord, setKv } from './db';
import { blueskyPostUrl, POST, type SocialRecord } from './social-model';

type PostExcerpt = { url: string; segments: TextSegment[]; sensitive: boolean };
const excerpt = (input: unknown) => {
  const post = parsePostView(input);
  // An explicit text-only projection: no image, embed, private receipt fields,
  // or hidden content behind a moderation warning reaches the timeline.
  return post && { uri: post.uri, value: { url: post.url, segments: post.sensitive ? [] : post.segments, sensitive: post.sensitive } };
};

export const timelinePosts = async (inputs: string[]): Promise<Map<string, PostExcerpt>> => {
  const uris = [...new Set(inputs.filter((uri) => blueskyPostUrl(uri)))];
  const result = new Map<string, PostExcerpt>();
  if (config().demo) {
    for (const uri of uris) {
      const [, , actor, , rkey] = uri.split('/');
      const record = readRecord<SocialRecord>(getDb(), `demo-social:${actor}:${POST}`, rkey);
      const post = record && record.uri === uri && excerpt({ ...record, record: record.value, author: { did: actor } });
      if (post) result.set(uri, post.value);
    }
    return result;
  }
  const missing = uris.filter((uri) => {
    const cached = getKv<PostExcerpt | null>(getDb(), 'timeline-post', uri);
    if (cached) result.set(uri, cached);
    return cached === undefined;
  });
  await Promise.all(Array.from({ length: Math.ceil(missing.length / 20) }, async (_, index) => {
    const batch = missing.slice(index * 20, (index + 1) * 20);
    try {
      const params = new URLSearchParams(batch.map((uri) => ['uris', uri]));
      const response = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${params}`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) return;
      const data = z.object({ posts: z.array(z.unknown()).max(20) }).parse(await response.json());
      const posts = new Map(data.posts.flatMap((input) => {
        const post = excerpt(input);
        return post && batch.includes(post.uri) ? [[post.uri, post.value] as const] : [];
      }));
      for (const uri of batch) {
        const post = posts.get(uri);
        if (post) result.set(uri, post);
        // Recheck deletions and moderation changes within a minute. A failed
        // refresh must not fall back to the original locally saved post text.
        setKv(getDb(), 'timeline-post', uri, post || null, 60_000);
      }
    } catch { /* A missing public post never prevents the payment timeline loading. */ }
  }));
  return result;
};
