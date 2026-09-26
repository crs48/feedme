import { createHash } from 'node:crypto';
import { z } from 'zod';
import { didSchema, NS } from './model';

export const FOLLOW = 'app.bsky.graph.follow';
export const PROJECT_FOLLOW = `${NS}.follow`;
export const POST = 'app.bsky.feed.post';
export type FollowKind = 'creator' | 'project';
export const collectionFor = (kind: FollowKind) => kind === 'creator' ? FOLLOW : PROJECT_FOLLOW;
export const projectUri = (did: string, id: string) => `at://${did}/${NS}.project/${id}`;
export const parseProjectUri = (uri: string) => {
  const match = /^at:\/\/([^/]+)\/social\.feedme\.project\/([a-z0-9][a-z0-9-]{0,63})$/.exec(uri);
  return match && didSchema.safeParse(match[1]).success ? { did: match[1], id: match[2] } : undefined;
};
export const projectSubject = z.string().refine((value) => Boolean(parseProjectUri(value)), 'Choose a valid project.');
export const projectTag = (uri: string) => `feedme-${createHash('sha256').update(projectSubject.parse(uri)).digest('hex').slice(0, 32)}`;
export const followSchema = z.object({
  $type: z.string(), subject: z.string(), createdAt: z.iso.datetime(), title: z.string().max(100).optional(),
});
export type FollowRecord = z.infer<typeof followSchema>;
export type SocialRecord = { uri: string; cid: string; value: Record<string, unknown> };
export type Follow = { uri: string; cid: string; value: FollowRecord };
export const publicPostText = (input: unknown) => {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Write a public message first.');
  const text = input.trim();
  if ([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length > 300 || Buffer.byteLength(text, 'utf8') > 3000)
    throw new Error('Keep your public post to 300 characters and 3,000 UTF-8 bytes.');
  return text;
};
export const shortPostText = (text: string) => {
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
  let result = '';
  for (const segment of segments.slice(0, 299)) {
    if (Buffer.byteLength(result + segment, 'utf8') > 2997) break;
    result += segment;
  }
  return result.length < text.length ? `${result}…` : result;
};
export const projectPost = (text: string, project: { title: string; summary: string; uri: string; url: string }, createdAt: string) => ({
  $type: POST, text: publicPostText(text), createdAt, tags: [projectTag(project.uri)],
  embed: { $type: 'app.bsky.embed.external', external: { uri: project.url, title: project.title, description: project.summary } },
});
export const blueskyPostUrl = (uri: string) => {
  const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([a-zA-Z0-9._~:-]+)$/.exec(uri);
  return match && didSchema.safeParse(match[1]).success ? `https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${encodeURIComponent(match[2])}` : undefined;
};
