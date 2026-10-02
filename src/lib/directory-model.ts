import { z } from 'zod';
import { didSchema } from './model';
import { profileUri, publicOriginUrl } from './public-identity';

export const DIRECTORY_URL = 'https://feedme.fund/directory/v1.json';
export const DIRECTORY_RELAY = 'https://relay1.us-east.bsky.network';
export const DAY = 86_400_000;
export const originSchema = z.string().max(2048).refine((value) => { try { return publicOriginUrl(value) === value; } catch { return false; } }, 'Invalid public origin');
const timestamp = z.iso.datetime();
export const directoryCreatorSchema = z.object({
  did: didSchema, handle: z.string().regex(/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/).max(253).optional(),
  name: z.string().min(1).max(80), bio: z.string().max(500), url: originSchema.optional(),
  profileUri: z.string().max(1024), profileCid: z.string().min(1).max(256),
  advertisementCheckedAt: timestamp, siteCheckedAt: timestamp, lastVerifiedAt: timestamp.optional(),
  siteStatus: z.enum(['reachable', 'unreachable', 'unknown']),
}).refine((value) => value.profileUri === profileUri(value.did), 'Profile must belong to the creator')
  .refine((value) => !value.url || (value.siteStatus === 'reachable' && Boolean(value.lastVerifiedAt)), 'Only verified sites have links');
export type DirectoryCreator = z.infer<typeof directoryCreatorSchema>;
export const directorySnapshotSchema = z.object({
  schemaVersion: z.literal(1), generatedAt: timestamp,
  source: z.object({ relays: z.array(originSchema).max(4), completedAt: timestamp.optional(), partial: z.boolean() }),
  creators: z.array(directoryCreatorSchema).max(5000),
});
export type DirectorySnapshot = z.infer<typeof directorySnapshotSchema>;
export const candidateSchema = z.object({
  did: didSchema, attemptedAt: timestamp.optional(), advertisedUrl: originSchema.optional(),
  outcome: z.enum(['listed', 'withdrawn', 'suppressed', 'mismatch', 'unverified', 'error']).optional(),
  creator: directoryCreatorSchema.optional(),
}).refine((value) => !value.creator || value.creator.did === value.did, 'Candidate identity mismatch');
export type DirectoryCandidate = z.infer<typeof candidateSchema>;
export const directoryStateSchema = z.object({
  schemaVersion: z.literal(1), relay: originSchema,
  cursor: z.string().max(2048).optional(), completedAt: timestamp.optional(),
  candidates: z.array(candidateSchema).max(5000),
});
export type DirectoryState = z.infer<typeof directoryStateSchema>;
export const directoryPolicySchema = z.object({
  seeds: z.array(didSchema).max(1000).default([]), suppressed: z.array(didSchema).max(5000).default([]),
});
export const emptyDirectory = (): DirectorySnapshot => ({ schemaVersion: 1, generatedAt: '1970-01-01T00:00:00.000Z', source: { relays: [], partial: true }, creators: [] });
export const freshDirectory = (snapshot: DirectorySnapshot, now = Date.now()) => {
  const time = Date.parse(snapshot.generatedAt);
  return time <= now + 300_000 && time > now - 2 * DAY;
};
export const publicDirectoryCreators = (entries: DirectoryCandidate[], now: number): DirectoryCreator[] => entries.flatMap(({ creator }) => {
  if (!creator?.lastVerifiedAt || Date.parse(creator.advertisementCheckedAt) < now - 7 * DAY || Date.parse(creator.advertisementCheckedAt) > now + 300_000) return [];
  const recent = Date.parse(creator.lastVerifiedAt) >= now - 2 * DAY && Date.parse(creator.lastVerifiedAt) <= now + 300_000;
  return [directoryCreatorSchema.parse({ ...creator, ...(!recent ? { url: undefined, siteStatus: 'unknown' } : {}) })];
}).sort((a,b) => a.name.localeCompare(b.name, 'en') || a.did.localeCompare(b.did));
