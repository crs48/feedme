import { z } from 'zod';
import { didSchema, NS, profileSchema } from './model';
import { getDb, getKv, setKv, readRecord } from './db';
import { publicJson, PublicHttpError, publicUrl } from './public-network';
import { config } from './config';
import { demoCreators } from './discovery-demo';

export type CreatorProfile = { did: string; name: string; handle: string; bio: string; url: string; avatar?: string };
export const xrpcUrl = (origin: string, method: string, params: Record<string, string>) => {
  const url = new URL(`/xrpc/${method}`, publicUrl(origin));
  url.search = new URLSearchParams(params).toString(); return url.href;
};
export const didDocumentUrl = (did: string) => {
  didSchema.parse(did);
  if (did.startsWith('did:plc:')) return `https://plc.directory/${encodeURIComponent(did)}`;
  const parts = did.slice(8).split(':').map(decodeURIComponent);
  if (parts.some((part) => !part || /[/\\?#@]/.test(part) || part === '..' || part === '.')) throw new Error('Invalid DID web path.');
  return publicUrl(`https://${parts.shift()}/${parts.length ? `${parts.join('/')}/did.json` : '.well-known/did.json'}`).href;
};
export const publicPds = async (did: string) => {
  const cached = getKv<string>(getDb(), 'discovery-pds', did); if (cached) return cached;
  const doc = z.object({ id: z.literal(did), service: z.array(z.object({ id: z.string(), type: z.string(), serviceEndpoint: z.string() })).default([]) }).parse(await publicJson(didDocumentUrl(did)));
  const service = doc.service.find((s) => (s.id === '#atproto_pds' || s.id === `${did}#atproto_pds`) && s.type === 'AtprotoPersonalDataServer');
  if (!service) throw new Error('This account has no public PDS.');
  const pds = publicUrl(service.serviceEndpoint).origin;
  setKv(getDb(), 'discovery-pds', did, pds, 300_000); return pds;
};
export const creatorFromRecord = (did: string, input: unknown): CreatorProfile | null => {
  const record = z.object({ uri: z.literal(`at://${did}/${NS}.profile/self`), value: profileSchema.extend({ $type: z.literal(`${NS}.profile`) }) }).parse(input);
  if (record.value.discoverable === false || !record.value.feedmeUrl) return null;
  const url = publicUrl(record.value.feedmeUrl);
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('A Feedme home must be an HTTPS origin.');
  const { name, handle, bio, avatar } = record.value;
  return { did, name, handle, bio, avatar, url: url.origin };
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
    z.object({ did: z.literal(did), url: z.literal(creator.url), protocol: z.literal(NS) }).parse(await publicJson(new URL('/.well-known/feedme', creator.url).href));
  }
  setKv(getDb(), 'discovery-profile', did, { creator }, creator ? 300_000 : 60_000); return creator;
};
export const publicCollection = async (did: string, collection: string) => {
  const result = z.object({ records: z.array(z.object({ uri: z.string(), value: z.record(z.string(), z.unknown()) })).max(100), cursor: z.string().optional() }).parse(await publicJson(xrpcUrl(await publicPds(did), 'com.atproto.repo.listRecords', { repo: did, collection, limit: '100' })));
  return { ...result, records: result.records.filter((record) => record.uri.startsWith(`at://${did}/${collection}/`)) };
};
