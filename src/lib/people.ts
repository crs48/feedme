import { config } from './config';
import { getDb, getKv, setKv } from './db';
import { demoPerson } from './demo-media';
import { didSchema } from './model';
import { safeWebUrl } from './markdown';

export type Person = { did: string; name: string; handle: string; avatar?: string; bio?: string };
// Display metadata only. Never use AppView handles or names to grant access.
export const people = async (identifiers: string[]): Promise<Map<string, Person>> => {
  const ids = [...new Set(identifiers)].filter((id) => didSchema.safeParse(id).success);
  const result = new Map<string, Person>();
  const missing: string[] = [];
  for (const did of ids) {
    const demo = config().demo && demoPerson(did);
    const cached = config().demo ? undefined : getKv<Person>(getDb(), 'person', did);
    if (demo) result.set(did, { did, name: demo.name, handle: '', avatar: demo.avatar });
    else if (cached) result.set(did, cached);
    else if (!config().demo) missing.push(did);
  }
  await Promise.all(Array.from({ length: Math.ceil(missing.length / 25) }, async (_, index) => {
    const batch = missing.slice(index * 25, (index + 1) * 25);
    try {
      const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles');
      batch.forEach((did) => url.searchParams.append('actors', did));
      const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) return;
      const data = await response.json() as { profiles?: { did: string; displayName?: string; handle: string; avatar?: string; description?: string }[] };
      for (const p of data.profiles || []) {
        if (!batch.includes(p.did) || typeof p.handle !== 'string') continue;
        const person: Person = { did: p.did, name: (p.displayName || p.handle).slice(0, 80), handle: p.handle.slice(0, 253), avatar: safeWebUrl(p.avatar || '') || undefined, bio: p.description?.slice(0, 500) };
        result.set(p.did, person);
        setKv(getDb(), 'person', p.did, person, 3600_000);
      }
    } catch { /* Public display metadata is optional; the permanent DID remains available. */ }
  }));
  return result;
};
