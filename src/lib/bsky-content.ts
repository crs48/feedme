import { z } from 'zod';
import { safeWebUrl } from './markdown';
import { blueskyPostUrl } from './social-model';
import { didSchema } from './model';

export type TextSegment = { text: string; href?: string };
export type PostMedia = { images: { url: string; alt: string }[]; video?: { url: string; poster?: string; alt: string }; external?: { url: string; title: string; description: string; image?: string } };
export type PostView = PostMedia & { uri: string; cid: string; url: string; text: string; createdAt: string; author: string; did: string; avatar?: string; segments: TextSegment[]; tags: string[]; demo?: boolean; sensitive: boolean };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === 'string' ? value : '';
const facetSchema = z.object({ index: z.object({ byteStart: z.number().int().nonnegative(), byteEnd: z.number().int().nonnegative() }), features: z.array(z.record(z.string(), z.unknown())) });
export const richText = (text: string, facets: unknown): TextSegment[] => {
  const bytes = Buffer.from(text, 'utf8');
  const boundaries = new Set([0]);
  let byteOffset = 0;
  for (const char of text) { byteOffset += Buffer.byteLength(char); boundaries.add(byteOffset); }
  const parsed = z.array(facetSchema).safeParse(facets);
  const segments: TextSegment[] = [];
  let end = 0;
  for (const facet of (parsed.success ? parsed.data : []).sort((a, b) => a.index.byteStart - b.index.byteStart)) {
    const { byteStart: start, byteEnd: finish } = facet.index;
    if (start < end || finish <= start || !boundaries.has(start) || !boundaries.has(finish)) continue;
    const feature = facet.features[0];
    const href = feature?.$type === 'app.bsky.richtext.facet#link' ? safeWebUrl(feature.uri)
      : feature?.$type === 'app.bsky.richtext.facet#mention' && didSchema.safeParse(feature.did).success ? `https://bsky.app/profile/${encodeURIComponent(String(feature.did))}`
      : feature?.$type === 'app.bsky.richtext.facet#tag' && typeof feature.tag === 'string' ? `https://bsky.app/search?q=${encodeURIComponent(`#${feature.tag}`)}` : undefined;
    if (!href) continue;
    if (start > end) segments.push({ text: bytes.subarray(end, start).toString() });
    segments.push({ text: bytes.subarray(start, finish).toString(), href });
    end = finish;
  }
  if (end < bytes.length) segments.push({ text: bytes.subarray(end).toString() });
  return segments;
};
export const postMedia = (input: unknown): PostMedia => {
  let embed = object(input);
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view') embed = object(embed.media);
  const images = embed.$type === 'app.bsky.embed.images#view' && Array.isArray(embed.images) ? embed.images.slice(0, 4).flatMap((value) => {
    const image = object(value), url = safeWebUrl(image.fullsize);
    return url ? [{ url, alt: string(image.alt).slice(0, 2000) }] : [];
  }) : [];
  const playlist = embed.$type === 'app.bsky.embed.video#view' && safeWebUrl(embed.playlist);
  const external = embed.$type === 'app.bsky.embed.external#view' ? object(embed.external) : {};
  const externalUrl = safeWebUrl(external.uri);
  return { images,
    ...(playlist ? { video: { url: playlist, poster: safeWebUrl(embed.thumbnail), alt: string(embed.alt) || 'Video from this post' } } : {}),
    ...(externalUrl ? { external: { url: externalUrl, title: string(external.title).slice(0, 300), description: string(external.description).slice(0, 1000), image: safeWebUrl(external.thumb) } } : {}),
  };
};
export const parsePostView = (input: unknown): PostView | undefined => {
  const post = object(input), record = object(post.record), author = object(post.author), viewer = object(author.viewer);
  const uri = string(post.uri), url = blueskyPostUrl(uri), text = string(record.text), did = string(author.did), createdAt = string(record.createdAt);
  if (!url || !uri.startsWith(`at://${did}/`) || !didSchema.safeParse(did).success || !Number.isFinite(Date.parse(createdAt)) || text.length > 10000 || viewer.muted || viewer.blocking || viewer.blockedBy) return undefined;
  const labels = Array.isArray(post.labels) ? post.labels.map((l) => string(object(l).val)) : [];
  if (labels.includes('!hide')) return undefined;
  const authorLabels = Array.isArray(author.labels) ? author.labels.map((l) => string(object(l).val)) : [];
  const avatar = authorLabels.some((label) => ['!hide', '!warn', 'porn', 'sexual', 'nudity', 'graphic-media'].includes(label)) ? undefined : safeWebUrl(author.avatar);
  return { uri, cid: string(post.cid), url, text, createdAt, did, avatar, author: string(author.displayName) || (string(author.handle) ? `@${string(author.handle)}` : did), segments: richText(text, record.facets), tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === 'string') : [], sensitive: labels.some((label) => ['porn', 'sexual', 'nudity', 'graphic-media', '!warn'].includes(label)), ...postMedia(post.embed) };
};
