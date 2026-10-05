import { z } from 'zod';
import { parseDocument } from 'yaml';

export const targetId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const libcardSourceSchema = z.object({
  repo: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/).refine(v => !v.endsWith('/.') && !v.endsWith('/..')),
  ref: z.string().min(1).max(200).refine(v => !/[\s?#\\]/.test(v) && v.split('/').every(p => p && p !== '.' && p !== '..')),
});
export type LibcardSource = z.infer<typeof libcardSourceSchema>;
export const sourceKey = (source: LibcardSource) => `${source.repo}@${source.ref}`;
export const rawRoot = (source: LibcardSource) => `https://raw.githubusercontent.com/${source.repo}/${encodeURIComponent(source.ref)}/`;
export const destinationSchema = z.url().max(2048).refine(value => ['https:', 'http:', 'mailto:', 'tel:', 'sms:'].includes(new URL(value).protocol), 'Unsupported link scheme.');
export const libcardMetadataSchema = z.object({
  source: libcardSourceSchema, kind: z.enum(['creator', 'link', 'social']), url: destinationSchema.nullable(),
  present: z.boolean(), hidden: z.boolean(), sourceAspiration: z.number().int().min(0).max(100_000_000),
  aspirationOverride: z.number().int().min(0).max(100_000_000).optional(),
});
const optIn = z.object({
  id: targetId.refine(id => !['creator', 'amount'].includes(id), 'This ID is reserved.'),
  blurb: z.string().trim().max(240).default(''), aspiration: z.number().int().min(0).max(1_000_000).optional(),
});
const item = z.object({ label: z.string().trim().min(1).max(100), url: destinationSchema, kind: z.enum(['link', 'social']), feedme: optIn.optional() });
export const libcardDocumentSchema = z.object({
  profile: z.object({ name: z.string().trim().min(1).max(80), tagline: z.string().max(500).default(''), location: z.string().max(80).default(''), avatar: z.url().max(2048).refine(v => new URL(v).protocol === 'https:').optional() }),
  about: z.string().max(2000).default(''), items: z.array(item).max(500),
}).superRefine((doc, ctx) => {
  const ids = doc.items.flatMap(i => i.feedme ? [i.feedme.id] : []);
  if (ids.length > 99 || new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Use at most 99 unique opted-in target IDs across links and socials.' });
});
export const libcardSnapshotSchema = z.object({ source: libcardSourceSchema, document: libcardDocumentSchema, hash: z.string().regex(/^[a-f0-9]{64}$/), etag: z.string().max(512).optional(), checkedAt: z.iso.datetime() });
export type LibcardDocument = z.infer<typeof libcardDocumentSchema>;
export type LibcardSnapshot = z.infer<typeof libcardSnapshotSchema>;
export const avatarUrl = (value: unknown, source: LibcardSource): string | undefined => {
  if (typeof value !== 'string' || value.length > 2048 || !value || value.startsWith('//')) return;
  try {
    if (/^https:\/\//i.test(value)) { const url = new URL(value); return url.username || url.password ? undefined : url.href; }
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || /[?#\\]/.test(value)) return;
    const parts = decodeURIComponent(value).replace(/^\//, '').split('/');
    if (parts.some(p => !p || p === '.' || p === '..' || /[\\?#]/.test(p))) return;
    return `${rawRoot(source)}public/${parts.map(encodeURIComponent).join('/')}`;
  } catch { return; }
};
export const parseLibcard = (text: string, source: LibcardSource): LibcardDocument => {
  if (Buffer.byteLength(text) > 256 * 1024) throw new Error('LibCard config exceeds 256 KiB.');
  const parsed = parseDocument(text, { version: '1.2', uniqueKeys: true });
  if (parsed.errors.length || parsed.warnings.length) throw new Error('LibCard YAML could not be parsed. Check syntax and duplicate mapping keys.');
  const raw = z.object({
    profile: z.object({ name: z.string(), tagline: z.string().optional(), location: z.string().optional(), avatar: z.unknown().optional() }),
    links: z.array(z.object({ label: z.string(), url: z.string(), feedme: optIn.optional() })).default([]),
    socials: z.array(z.object({ platform: z.string(), label: z.string().optional(), url: z.string(), feedme: optIn.optional() })).default([]),
    blocks: z.array(z.object({ type: z.string(), markdown: z.string().optional() })).default([]),
  }).parse(parsed.toJS({ maxAliasCount: 0 }));
  const result = libcardDocumentSchema.parse({
    profile: { ...raw.profile, avatar: avatarUrl(raw.profile.avatar, source) },
    about: raw.blocks.find(b => b.type === 'text' && b.markdown)?.markdown?.slice(0, 2000) || '',
    items: [...raw.links.map(i => ({ ...i, kind: 'link' })), ...raw.socials.map(i => ({ label: i.label || i.platform, url: i.url, feedme: i.feedme, kind: 'social' }))],
  });
  if (Buffer.byteLength(JSON.stringify(result)) > 128 * 1024) throw new Error('Normalized LibCard config exceeds 128 KiB.');
  return result;
};
