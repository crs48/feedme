import { z } from 'zod';
import { config } from './config';
import { NS, profileSchema, type Profile } from './model';
import { publicJson, PublicHttpError } from './public-network';
import { profileUri, resolvePublicIdentity, xrpcUrl } from './public-identity';
import { saveProfile } from './repository';

export type Publication = { state: 'ready'; token: string; profile?: Profile } | { state: 'demo' | 'unavailable'; token: '' };
export const readPublication = async (): Promise<Publication> => {
  const cfg = config(); if (cfg.demo) return { state: 'demo', token: '' };
  try {
    const { pds } = await resolvePublicIdentity(cfg.ownerDid);
    try {
      const record = z.object({ uri: z.literal(profileUri(cfg.ownerDid)), cid: z.string().min(1).max(256), value: profileSchema.extend({ $type: z.literal(`${NS}.profile`) }) }).parse(await publicJson(xrpcUrl(pds, 'com.atproto.repo.getRecord', { repo: cfg.ownerDid, collection: `${NS}.profile`, rkey: 'self' }), { maxBytes: 65_536 }));
      return { state: 'ready', token: record.cid, profile: profileSchema.parse(record.value) };
    } catch (error) {
      if (error instanceof PublicHttpError && error.code === 'RecordNotFound') return { state: 'ready', token: 'absent' };
      throw error;
    }
  } catch { return { state: 'unavailable', token: '' }; }
};
export const publicationConflict = (remote: Profile | undefined, origin: string, discoverable: boolean) => Boolean(remote && ((remote.feedmeUrl && remote.feedmeUrl !== origin) || (remote.discoverable === false && discoverable)));
export const publishProfile = async (value: unknown, token: string, confirmed: boolean) => {
  const cfg = config(); const profile = profileSchema.parse(value);
  if (cfg.demo) return saveProfile(profile, null);
  const remote = await readPublication();
  if (remote.state !== 'ready') throw new Error('Your current PDS profile could not be checked. Reload Settings and retry; nothing was published.');
  if (remote.token !== token) throw new Error('Your PDS profile changed since you opened Settings. Reload and review it before publishing.');
  if (publicationConflict(remote.profile, cfg.origin, profile.discoverable !== false) && !confirmed) throw new Error('Confirm the change to your existing discovery preference or Feedme address before publishing.');
  return saveProfile(profile, remote.token === 'absent' ? null : remote.token);
};
export const launchPostUrl = (origin: string) => {
  const intro = `My Feedme is live: ${origin}`;
  const description = '\nSee what I’m working on and support what you’d like to see more of.';
  return `https://bsky.app/intent/compose?${new URLSearchParams({ text: `${intro}${intro.length + description.length < 292 ? description : ''} #Feedme` })}`;
};
