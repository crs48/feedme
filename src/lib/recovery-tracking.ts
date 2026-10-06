import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { enqueue, getKv, readRecord, setKv, transaction } from './db';
import { CHECKPOINT, checkpointSchema, RECOVERY, RECOVERY_INDEX, hashValue, inventoryDigest, portableLocation, recoveryEnvelope, recoveryKey, type Checkpoint, type RecoveryLocation } from './recovery-model';

export const installRecoveryTracking = (db: DatabaseSync) => {
  db.exec(`CREATE TABLE IF NOT EXISTS recovery_dirty (source TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY(source,kind,key));
    CREATE TABLE IF NOT EXISTS recovery_inventory (rkey TEXT PRIMARY KEY, digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_receipts (destination TEXT NOT NULL, collection TEXT NOT NULL, rkey TEXT NOT NULL, digest TEXT NOT NULL, cid TEXT, verified_at TEXT NOT NULL, PRIMARY KEY(destination,collection,rkey));`);
  for (const [table, kind, key] of [['records', 'kind', 'id'], ['kv', 'namespace', 'key']]) {
    const condition = table === 'records' ? "KIND IN ('profile','project','update','friend','support','subscription','admin-event')" : "((NAMESPACE='libcard' AND KEY='snapshot') OR NAMESPACE IN ('support-share-id','support-share-payment','payment-order') OR (NAMESPACE='app' AND KEY IN ('stripe-account','legacy-payment-projections')))";
    for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
      const ref = action === 'DELETE' ? 'OLD' : 'NEW';
      const when = condition.replace(/\b(KIND|NAMESPACE|KEY)\b/g, `${ref}.$1`);
      db.exec(`CREATE TRIGGER IF NOT EXISTS recovery_${table}_${action.toLowerCase()} AFTER ${action} ON ${table} WHEN ${when}
        BEGIN INSERT INTO recovery_dirty VALUES ('${table}',${ref}.${kind},${ref}.${key}) ON CONFLICT(source,kind,key) DO NOTHING; END;`);
    }
  }
};
export const recoveryInstance = (db: DatabaseSync) => {
  let instance = getKv<string>(db, 'recovery', 'instance');
  if (!instance) { instance = randomUUID(); setKv(db, 'recovery', 'instance', instance); }
  return instance;
};
export const prepareRecovery = (db: DatabaseSync, owner: string) => transaction(db, () => {
  const instance = recoveryInstance(db);
  if (!getKv(db, 'recovery', 'backfilled')) {
    for (const row of db.prepare('SELECT kind,id AS key FROM records').all() as { kind: string; key: string }[])
      if (portableLocation({ table: 'records', ...row })) db.prepare("INSERT OR IGNORE INTO recovery_dirty VALUES ('records',?,?)").run(row.kind, row.key);
    for (const row of db.prepare('SELECT namespace AS kind,key FROM kv').all() as { kind: string; key: string }[])
      if (portableLocation({ table: 'kv', ...row })) db.prepare("INSERT OR IGNORE INTO recovery_dirty VALUES ('kv',?,?)").run(row.kind, row.key);
    setKv(db, 'recovery', 'backfilled', true);
  }
  const dirty = db.prepare('SELECT source AS "table",kind,key FROM recovery_dirty').all() as RecoveryLocation[];
  for (const location of dirty) {
    const value = location.table === 'records' ? readRecord(db, location.kind, location.key) : getKv(db, location.kind, location.key);
    const rkey = recoveryKey(location);
    const record = value === undefined ? null : recoveryEnvelope(owner, instance, location, value);
    if (record) enqueue(db, 'private', RECOVERY, hashValue(record), record);
    if (record) db.prepare('INSERT INTO recovery_inventory VALUES (?,?) ON CONFLICT(rkey) DO UPDATE SET digest=excluded.digest').run(rkey, hashValue(record));
    else db.prepare('DELETE FROM recovery_inventory WHERE rkey=?').run(rkey);
  }
  db.exec('DELETE FROM recovery_dirty');
  return dirty.length;
});
export const localRecoveryInventory = (db: DatabaseSync) => db.prepare('SELECT rkey,digest FROM recovery_inventory').all() as { rkey: string; digest: string }[];
export const localCheckpoint = (db: DatabaseSync, owner: string, space: string) => {
  const inventory = localRecoveryInventory(db);
  const keys = inventory.map(r => r.digest).sort();
  const indexes = Array.from({ length: Math.ceil(keys.length / 500) }, (_, n) => ({ $type: RECOVERY_INDEX, version: 1, owner, instance: recoveryInstance(db), records: keys.slice(n * 500, (n + 1) * 500) }));
  return { indexes, checkpoint: checkpointSchema.parse({ $type: CHECKPOINT, version: 1, owner, instance: recoveryInstance(db), space, indexes: indexes.map(hashValue), digest: inventoryDigest(inventory), count: inventory.length, createdAt: new Date().toISOString() } satisfies Checkpoint) };
};
export const recoveryPending = (db: DatabaseSync) => Number((db.prepare('SELECT (SELECT COUNT(*) FROM recovery_dirty) + (SELECT COUNT(*) FROM outbox) AS count').get() as { count: number }).count);
