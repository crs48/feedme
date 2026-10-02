import { z } from 'zod';
import { didSchema, NS, profileSchema } from './model';
import { getDb, getKv, setKv, readRecord } from './db';
import { publicJson, PublicHttpError } from './public-network';
import { config } from './config';
import { demoCreators } from './discovery-demo';
import { creatorFromRecord, resolvePublicIdentity, siteDeclaration, xrpcUrl, type CreatorProfile } from './public-identity';
export { creatorFromRecord, didDocumentUrl, xrpcUrl, type CreatorProfile } from './public-identity';

export const publicPds = async (did: string) => {
  const cached = getKv<string>(getDb(), 'discovery-pds', did); if (cached) return cached;
  const { pds } = await resolvePublicIdentity(did);
  setKv(getDb(), 'discovery-pds', did, pds, 300_000); return pds;
};
export const discoverCreator = async (did: string, fresh = false): Promise<CreatorProfile | null> => {
  didSchema.parse(did);
  if (config().demo) {
    if (did === config().ownerDid) { const p = profileSchema.parse(readRecord(getDb(), 'profile', 'self')); return { did, name: p.name, handle: p.handle, bio: p.bio, avatar: p.avatar, url: config().origin }; }
    return demoCreators.find((p) => p.did === did) || null;
  }
  const cached = !fresh && getKv<{ creator: CreatorProfile | null }>(getDb(), 'discovery-profile', did);
  if (cached) return cached.creator;
  let creator: CreatorProfile | null;
  try { creator = creatorFromRecord(did, await publicJson(xrpcUrl(await publicPds(did), 'com.atproto.repo.getRecord', { repo: did, collection: `${NS}.profile`, rkey: 'self' }))); }
  catch (error) {
    // Only an explicit absent record is a negative result; outages remain retryable.
    if (!(error instanceof PublicHttpError) || error.code !== 'RecordNotFound') throw error;
    creator = null;
  }
  if (creator) {
    if (siteDeclaration(did, creator.url, await publicJson(new URL('/.well-known/feedme', creator.url).href, { maxBytes: 65_536 })).mode === 'demo') creator = null;
  }
  setKv(getDb(), 'discovery-profile', did, { creator }, creator ? 300_000 : 60_000); return creator;
};
export const publicCollection = async (did: string, collection: string) => {
  const result = z.object({ records: z.array(z.object({ uri: z.string(), value: z.record(z.string(), z.unknown()) })).max(100), cursor: z.string().optional() }).parse(await publicJson(xrpcUrl(await publicPds(did), 'com.atproto.repo.listRecords', { repo: did, collection, limit: '100' })));
  return { ...result, records: result.records.filter((record) => record.uri.startsWith(`at://${did}/${collection}/`)) };
};
