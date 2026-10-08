import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { config } from './config';
import { getDb, getKv, setKv } from './db';
import { accountIdentifier } from './identity-settings';
import { didSchema } from './model';
import { publicJson } from './public-network';
import { xrpcUrl, type PublicReader } from './public-identity';

const publicProfileSchema = z.object({
  did: didSchema, handle: z.string().max(253), displayName: z.string().max(640).optional(),
  description: z.string().max(10_000).optional(), avatar: z.string().max(2048).optional(),
});
export type CreatorBluesky = { did: string; name: string; handle: string; bio: string; avatar?: string };
type CachedProfile = { attemptedAt: number; profile?: CreatorBluesky };
const pending = new WeakMap<DatabaseSync, Map<string, Promise<void>>>();
const refreshInterval = 15 * 60_000;

const actor = () => {
  const cfg = config();
  if (!cfg.libcard || (cfg.demo && !cfg.libcardRemoteDemo)) return;
  // Live display data follows the pinned owner DID, never a reassigned handle.
  // Remote demos may show a real profile without changing their fictional login.
  return (cfg.libcardRemoteDemo ? cfg.identities.owner : cfg.ownerDid) || undefined;
};
export const cachedCreatorBluesky = (): CreatorBluesky | undefined => {
  const id = actor();
  return id ? getKv<CachedProfile>(getDb(), 'creator-bluesky', id)?.profile : undefined;
};
const avatarUrl = (input?: string) => {
  if (!input) return;
  try {
    const url = new URL(input);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* Invalid optional media must not replace the last valid identity. */ }
};

// This is a local public-metadata cache, not an identity authority or a PDS write.
// Keep the last successful response indefinitely so an outage cannot erase a bio.
export const refreshCreatorBluesky = async (read: PublicReader = publicJson): Promise<void> => {
  const id = actor();
  if (!id) return;
  const db = getDb();
  if (getKv(db, 'recovery', 'paused')) return;
  const active = pending.get(db)?.get(id);
  if (active) return active;
  const previous = getKv<CachedProfile>(db, 'creator-bluesky', id);
  const attemptedAt = Date.now();
  if (previous && attemptedAt - previous.attemptedAt < refreshInterval) return;
  setKv(db, 'creator-bluesky', id, { ...previous, attemptedAt });
  const request = (async () => {
    try {
      const p = publicProfileSchema.parse(await read(xrpcUrl('https://public.api.bsky.app', 'app.bsky.actor.getProfile', { actor: id }), { maxBytes: 65_536 }));
      if (id.startsWith('did:') && p.did !== id) return;
      const handle = accountIdentifier(p.handle);
      if (handle.startsWith('did:') || handle === 'handle.invalid') return;
      if (!id.startsWith('did:') && handle !== id) return;
      if (getKv(db, 'recovery', 'paused')) return;
      const profile: CreatorBluesky = {
        did: p.did, handle, name: (p.displayName?.trim() || handle).slice(0, 80),
        bio: (p.description || '').slice(0, 500), avatar: avatarUrl(p.avatar),
      };
      setKv(db, 'creator-bluesky', id, { attemptedAt, profile });
    } catch { /* Serve the last-good profile and retry on the next interval. */ }
  })();
  const requests = pending.get(db) || new Map<string, Promise<void>>();
  pending.set(db, requests);
  requests.set(id, request);
  try { await request; } finally { requests.delete(id); }
};
