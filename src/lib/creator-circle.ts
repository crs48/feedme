import { config } from './config';
import { friends } from './repository';
import { publicCollection } from './public-repo';
import { friendSchema, NS, type Friend } from './model';
import { getDb, getKv, setKv } from './db';

type CircleCache = { friends: Friend[]; partial: boolean; fetchedAt: number };
// Refresh on the existing sync worker, not while rendering a creator's homepage.
// Keep the last successful snapshot through provider outages.
export const refreshCreatorCircle = async () => {
  if (config().demo) return;
  const cached = getKv<CircleCache>(getDb(), 'public-circle', config().ownerDid);
  if (cached && Date.now() - cached.fetchedAt < 60_000) return;
  try {
    const result = await publicCollection(config().ownerDid, `${NS}.recommendation`);
    const values = result.records.flatMap((r) => { const f = friendSchema.safeParse(r.value); return f.success && r.value.$type === `${NS}.recommendation` ? [f.data] : []; });
    setKv(getDb(), 'public-circle', config().ownerDid, { friends: values, partial: Boolean(result.cursor), fetchedAt: Date.now() });
  } catch { /* Keep the last known public circle. The next sync retries. */ }
};
export const creatorCircle = (): Friend[] => {
  if (config().demo) return friends();
  const data = getKv<CircleCache>(getDb(), 'public-circle', config().ownerDid);
  if (!data) return friends();
  const pending = new Set((getDb().prepare('SELECT rkey FROM outbox WHERE destination=? AND collection=?').all('public', `${NS}.recommendation`) as { rkey: string }[]).map((r) => r.rkey));
  // A complete remote snapshot reflects removals made by other clients.
  return [...new Map([...data.friends.filter((f) => !pending.has(f.id)), ...friends().filter((f) => data.partial || pending.has(f.id))].map((f) => [f.did || f.id, f])).values()];
};
