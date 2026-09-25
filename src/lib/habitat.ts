import { oauthClient } from './auth';
import { config } from './config';
import { getDb, getKv, setKv, pendingWrites } from './db';
import { NS } from './model';

// Current Habitat APIs, reviewed at upstream 85654a07. The proposal's
// com.atproto.space namespace is not the implementation's network.habitat.space.
export const habitatCall = async <T>(method: string, payload: Record<string, unknown>): Promise<T> => {
  const session = await (await oauthClient()).restore(config().ownerDid);
  const response = await session.fetchHandler(`/xrpc/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Habitat ${method} returned ${response.status}. Reconnect your account and retry.`);
  const body = await response.text();
  return body ? JSON.parse(body) as T : undefined as T;
};
export const privateSpace = () => getKv<string>(getDb(), 'app', 'private-space');
export const createPrivateSpace = async () => {
  if (privateSpace()) return privateSpace();
  // A unique key avoids adopting an existing space with unknown permissions.
  const { uri } = await habitatCall<{ uri: string }>('network.habitat.simplespace.createSpace', {
    did: config().ownerDid, type: `${NS}.receipts`,
    config: { policy: 'member-list', appAccess: { $type: 'network.habitat.simplespace.defs#open' } },
  });
  if (!uri?.startsWith('at://')) throw new Error('Habitat did not return a valid private space.');
  setKv(getDb(), 'app', 'private-space', uri);
  return uri;
};
let syncPromise: Promise<{ sent: number; failed: number }> | undefined;
export const drainOutbox = () => syncPromise ??= drain().finally(() => { syncPromise = undefined; });
const drain = async () => {
  if (config().demo) return { sent: 0, failed: 0 };
  const db = getDb();
  let sent = 0, failed = 0;
  for (const row of pendingWrites(db)) {
    try {
      const isPrivate = row.destination === 'private';
      const space = privateSpace();
      if (isPrivate && !space) throw new Error('Create a private Habitat space in the studio first.');
      const method = isPrivate ? 'network.habitat.space' : 'com.atproto.repo';
      await habitatCall(`${method}.${row.value === null ? 'deleteRecord' : 'putRecord'}`, {
        repo: config().ownerDid, collection: row.collection, rkey: row.rkey,
        ...(isPrivate ? { space } : {}), ...(row.value === null ? {} : { record: row.value }),
      });
      db.prepare('DELETE FROM outbox WHERE id=? AND revision=?').run(row.id, row.revision);
      sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Synchronization failed';
      db.prepare('UPDATE outbox SET attempts=attempts+1,error=? WHERE id=? AND revision=?').run(message, row.id, row.revision);
      failed++;
      // One unavailable provider should not hold an HTTP request open for all 50 records.
      break;
    }
  }
  return { sent, failed };
};
