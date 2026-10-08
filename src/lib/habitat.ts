import { oauthClient } from './auth';
import { config } from './config';
import { getDb, getKv, setKv, deleteKv, pendingWrites, transaction, readRecord } from './db';
import { NS, type Profile } from './model';
import { CHECKPOINT, RECOVERY, RECOVERY_INDEX, hashValue, type Checkpoint } from './recovery-model';
import { localCheckpoint, prepareRecovery } from './recovery-tracking';

// Pinned contract: habitat-network/habitat@85654a07. Queries are GET, procedures POST.
export const habitatCall = async <T>(method: string, payload: Record<string, unknown>, query = false): Promise<T> => {
  if (config().sandbox && !query && method.startsWith('com.atproto.')) throw new Error('Public AT Protocol writes are disabled in the sandbox.');
  const session = await (await oauthClient()).restore(config().ownerDid);
  const params = new URLSearchParams(Object.entries(payload).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  const response = await session.fetchHandler(`/xrpc/${method}${query ? `?${params}` : ''}`, {
    method: query ? 'GET' : 'POST', ...(query ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(15_000),
  });
  // Bound untrusted private-repository responses, including servers that ignore pagination.
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (reader) try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 64 * 1024 * 1024) throw new Error('Habitat response exceeds the recovery size limit.'); chunks.push(value); } } finally { await reader.cancel(); }
  const body = Buffer.concat(chunks).toString();
  if (!response.ok) {
    let code = ''; try { code = JSON.parse(body).error; } catch { /* Do not expose provider response bodies. */ }
    if (method.endsWith('.deleteRecord') && code === 'RecordNotFound') return undefined as T;
    if (method.endsWith('.getRecord') && ['RecordNotFound', 'NotFound'].includes(code)) return undefined as T;
    throw new Error(`Habitat ${method} returned ${response.status}. Reconnect your account and retry.`);
  }
  return body ? JSON.parse(body) as T : undefined as T;
};
export const privateSpace = () => getKv<string>(getDb(), 'app', 'private-space');
export const privateSpaceType = () => `${NS}.${config().sandbox ? 'sandboxReceipts' : 'receipts'}`;
export const createPrivateSpace = async () => {
  if (privateSpace()) return privateSpace();
  const { discoverRecoverySpaces } = await import('./recovery-import');
  if ((await discoverRecoverySpaces()).some(s => s.checkpoint)) throw new Error('A saved Feedme already exists. Open Data & backups to restore it before creating new storage.');
  const { uri } = await habitatCall<{ uri: string }>('network.habitat.simplespace.createSpace', {
    did: config().ownerDid, type: privateSpaceType(),
    config: { policy: 'member-list', appAccess: { $type: 'network.habitat.simplespace.defs#open' } },
  });
  if (!uri?.startsWith('at://')) throw new Error('Habitat did not return a valid private space.');
  setKv(getDb(), 'app', 'private-space', uri);
  return uri;
};
export const readPrivateRecord = (space: string, collection: string, rkey: string) => habitatCall<{ value: unknown; cid: string } | undefined>('network.habitat.space.getRecord', { space, repo: config().ownerDid, collection, rkey }, true);

// Immutable content-addressed records are safe to retry after a lost response. Checkpoint
// conflict detection is advisory: Habitat has no CAS, so exactly one server must write.
export const writeVerifiedPrivate = async (space: string, collection: string, rkey: string, record: unknown) => {
  const db = getDb();
  const digest = hashValue(record);
  const before = await readPrivateRecord(space, collection, rkey);
  const last = db.prepare("SELECT digest FROM sync_receipts WHERE destination='private' AND collection=? AND rkey=?").get(collection, rkey) as { digest: string } | undefined;
  if (before && hashValue(before.value) !== digest && (!last || hashValue(before.value) !== last.digest)) throw new Error('Remote recovery data changed unexpectedly. Stop other Feedme servers and review recovery before retrying.');
  if (!before || hashValue(before.value) !== digest) await habitatCall('network.habitat.space.putRecord', { space, repo: config().ownerDid, collection, rkey, record });
  const after = await readPrivateRecord(space, collection, rkey);
  if (!after || hashValue(after.value) !== digest) throw new Error('Habitat did not return the record just saved. It remains queued for retry.');
  db.prepare("INSERT INTO sync_receipts VALUES ('private',?,?,?,?,?) ON CONFLICT(destination,collection,rkey) DO UPDATE SET digest=excluded.digest,cid=excluded.cid,verified_at=excluded.verified_at").run(collection, rkey, digest, after.cid, new Date().toISOString());
};
let syncPromise: Promise<{ sent: number; failed: number }> | undefined;
export const drainOutbox = () => syncPromise ??= drain().finally(() => { syncPromise = undefined; });
const drain = async () => {
  if (config().demo) return { sent: 0, failed: 0 };
  const db = getDb();
  if (getKv(db, 'recovery', 'paused')) return { sent: 0, failed: 0 };
  const space = privateSpace();
  if (space) prepareRecovery(db, config().ownerDid);
  let sent = 0, failed = 0;
  const unavailable = new Set<string>();
  const started = Date.now();
  const rows = [...pendingWrites(db, 'private'), ...(config().sandbox ? [] : pendingWrites(db, 'public'))];
  for (const row of rows) {
    if (Date.now() - started > 25_000) break;
    if (unavailable.has(row.destination)) continue;
    try {
      const isPrivate = row.destination === 'private';
      if (isPrivate && !space) throw new Error('Create a private Habitat space in the studio first.');
      if (isPrivate && [RECOVERY, RECOVERY_INDEX, CHECKPOINT].includes(row.collection)) {
        if (!row.value) throw new Error('Recovery snapshots are immutable.');
        await writeVerifiedPrivate(space!, row.collection, row.rkey, row.value);
      } else {
        const method = isPrivate ? 'network.habitat.space' : 'com.atproto.repo';
        const condition = !isPrivate && row.collection === `${NS}.profile` ? getKv<{ profile: Profile; cid: string | null }>(db, 'profile-publication', 'expected') : undefined;
        if (!isPrivate && row.collection === `${NS}.profile` && row.value && (!condition || hashValue({ $type: `${NS}.profile`, ...condition.profile }) !== hashValue(row.value))) throw new Error('Review and save your public profile in Settings before publishing its discovery address.');
        let result: { cid?: string } | undefined;
        try { result = await habitatCall<{ cid?: string }>(`${method}.${row.value === null ? 'deleteRecord' : 'putRecord'}`, {
          repo: config().ownerDid, collection: row.collection, rkey: row.rkey,
          ...(isPrivate ? { space } : {}), ...(row.value === null ? {} : { record: row.value }),
          ...(condition ? { swapRecord: condition.cid } : {}),
        }); } catch (error) {
          if (!condition) throw error;
          // A successful write with a lost response may fail CAS on retry. Only
          // the exact intended remote value can acknowledge that queued write.
          const remote = await habitatCall<{ cid: string; value: unknown } | undefined>('com.atproto.repo.getRecord', { repo: config().ownerDid, collection: row.collection, rkey: row.rkey }, true);
          if (!remote || hashValue(remote.value) !== hashValue(row.value)) throw new Error('Your PDS profile changed or could not be published. Reload Settings, review its current address and save again.');
          result = remote;
        }
        db.prepare('INSERT INTO sync_receipts VALUES (?,?,?,?,?,?) ON CONFLICT(destination,collection,rkey) DO UPDATE SET digest=excluded.digest,cid=excluded.cid,verified_at=excluded.verified_at').run(row.destination, row.collection, row.rkey, hashValue(row.value), result?.cid || null, new Date().toISOString());
      }
      const removed = db.prepare('DELETE FROM outbox WHERE id=? AND revision=?').run(row.id, row.revision);
      if (Number(removed.changes) && row.collection === `${NS}.profile`) deleteKv(db, 'profile-publication', 'expected');
      sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Synchronization failed';
      db.prepare('UPDATE outbox SET attempts=attempts+1,error=? WHERE id=? AND revision=?').run(message, row.id, row.revision);
      setKv(db, 'recovery', 'sync-error', { at: new Date().toISOString(), message });
      failed++; unavailable.add(row.destination);
    }
  }
  if (space && readRecord(db, 'profile', 'self') && !unavailable.has('private') && !db.prepare('SELECT 1 FROM recovery_dirty LIMIT 1').get() && !db.prepare('SELECT 1 FROM outbox WHERE collection=? LIMIT 1').get(RECOVERY)) {
    const current = localCheckpoint(db, config().ownerDid, space);
    const { indexes, checkpoint } = getKv<typeof current>(db, 'recovery', 'pending-checkpoint') || current;
    const prior = getKv<Checkpoint>(db, 'recovery', 'checkpoint');
    if (prior?.digest !== checkpoint.digest || !prior) try {
      setKv(db, 'recovery', 'pending-checkpoint', { indexes, checkpoint });
      for (const index of indexes) await writeVerifiedPrivate(space, RECOVERY_INDEX, hashValue(index), index);
      await writeVerifiedPrivate(space, CHECKPOINT, 'self', checkpoint);
      transaction(db, () => { setKv(db, 'recovery', 'checkpoint', checkpoint); setKv(db, 'recovery', 'pending-checkpoint', null); setKv(db, 'recovery', 'sync-error', null); });
    } catch (error) { failed++; setKv(db, 'recovery', 'sync-error', { at: new Date().toISOString(), message: error instanceof Error ? error.message : 'Checkpoint verification failed.' }); }
  }
  return { sent, failed };
};
export const protectCheckoutIntent = async () => {
  const result = await drainOutbox();
  const db = getDb(); const space = privateSpace();
  const saved = getKv<Checkpoint>(db, 'recovery', 'checkpoint');
  if (!space || result.failed || db.prepare('SELECT 1 FROM recovery_dirty LIMIT 1').get() || !saved || saved.digest !== localCheckpoint(db, config().ownerDid, space).checkpoint.digest)
    throw new Error('Private storage is still protecting this tip. No checkout was opened. Please retry shortly.');
};
