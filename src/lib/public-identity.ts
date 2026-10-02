import { z } from 'zod';
import { didSchema, NS, profileSchema } from './model';
import { publicJson, publicUrl } from './public-network';

// Public protocol helpers deliberately have no app config, database or OAuth imports.
export type PublicReader = (url: string, options?: { maxBytes?: number }) => Promise<unknown>;
export const profileUri = (did: string) => `at://${didSchema.parse(did)}/${NS}.profile/self`;
export const publicOriginUrl = (input: string) => {
  if (input.length > 2048) throw new Error('Public origin is too long.');
  const url = publicUrl(input);
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('A Feedme home must be an HTTPS origin.');
  return url.origin;
};
export const xrpcUrl = (origin: string, method: string, params: Record<string, string>) => {
  const url = new URL(`/xrpc/${method}`, publicUrl(origin));
  url.search = new URLSearchParams(params).toString(); return url.href;
};
export const didDocumentUrl = (did: string) => {
  didSchema.max(512).parse(did);
  if (did.startsWith('did:plc:')) return `https://plc.directory/${encodeURIComponent(did)}`;
  const parts = did.slice(8).split(':').map(decodeURIComponent);
  if (parts.some((part) => !part || /[/\\?#@]/.test(part) || part === '..' || part === '.')) throw new Error('Invalid DID web path.');
  return publicUrl(`https://${parts.shift()}/${parts.length ? `${parts.join('/')}/did.json` : '.well-known/did.json'}`).href;
};
export const resolvePublicIdentity = async (did: string, read: PublicReader = publicJson) => {
  const doc = z.object({ id: z.literal(did), alsoKnownAs: z.array(z.string().max(2048)).max(100).default([]), service: z.array(z.object({ id: z.string(), type: z.string(), serviceEndpoint: z.string() })).max(100).default([]) }).parse(await read(didDocumentUrl(did), { maxBytes: 65_536 }));
  const service = doc.service.find((s) => (s.id === '#atproto_pds' || s.id === `${did}#atproto_pds`) && s.type === 'AtprotoPersonalDataServer');
  if (!service) throw new Error('This account has no public PDS.');
  return { pds: publicOriginUrl(service.serviceEndpoint), handles: doc.alsoKnownAs.filter((v) => /^at:\/\/[^/]+$/.test(v)).map((v) => v.slice(5)) };
};
export type CreatorProfile = { did: string; name: string; handle: string; bio: string; url: string; avatar?: string };
export const creatorFromRecord = (did: string, input: unknown): CreatorProfile | null => {
  const record = z.object({ uri: z.literal(profileUri(did)), value: profileSchema.extend({ $type: z.literal(`${NS}.profile`) }) }).parse(input);
  if (record.value.discoverable === false || !record.value.feedmeUrl) return null;
  const { name, handle, bio, avatar } = record.value;
  return { did, name, handle, bio, avatar, url: publicOriginUrl(record.value.feedmeUrl) };
};
export const siteDeclaration = (did: string, origin: string, input: unknown) => z.object({
  did: z.literal(did), url: z.literal(origin), protocol: z.literal(NS), profile: z.literal(profileUri(did)), mode: z.enum(['live', 'demo']).optional(),
}).parse(input);
