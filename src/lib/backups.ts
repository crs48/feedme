import { assertDatabaseCompatible } from './database-migrations';
import { backup, DatabaseSync } from 'node:sqlite';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { config } from './config';
import { deleteKv, getDb, getKv, setKv, seal, unseal } from './db';
import { backupStore, expiredBackups, type BackupStore } from './backup-store';

const MAGIC = Buffer.from('FMEBK1');
const MAX_SIZE = 256 * 1024 * 1024;
const payloadSchema = z.object({ format: z.literal(1), owner: z.string().min(1), createdAt: z.iso.datetime(), dataKey: z.string().regex(/^(?:[a-f0-9]{64})?$/i), sqlite: z.string().min(1) });
export const backupKey = (value = process.env.BACKUP_ENCRYPTION_KEY) => { if (!/^[a-f0-9]{64}$/i.test(value || '')) throw new Error('Configure a separate 64-character BACKUP_ENCRYPTION_KEY and save it outside this server.'); if (value === process.env.DATA_ENCRYPTION_KEY) throw new Error('Use a different key for backups and the local database.'); return Buffer.from(value!, 'hex'); };
export const encryptBackup = (payload: z.infer<typeof payloadSchema>, key: Buffer) => {
  const body = gzipSync(JSON.stringify(payloadSchema.parse(payload)));
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
};
export const decryptBackup = (data: Buffer, key: Buffer) => {
  if (data.length > 400 * 1024 * 1024 || !data.subarray(0, 6).equals(MAGIC)) throw new Error('Unsupported or oversized backup.');
  try { const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(6, 18)); cipher.setAAD(MAGIC); cipher.setAuthTag(data.subarray(18, 34));
    const json = gunzipSync(Buffer.concat([cipher.update(data.subarray(34)), cipher.final()]), { maxOutputLength: MAX_SIZE * 2 });
    return payloadSchema.parse(JSON.parse(json.toString()));
  } catch { throw new Error('Backup could not be authenticated. Check the recovery key and file integrity.'); }
};
export const validateDatabase = (db: DatabaseSync, key: Buffer | null) => {
  assertDatabaseCompatible(db);
  const checks = db.prepare('PRAGMA integrity_check').all();
  if (checks.length !== 1 || Object.values(checks[0])[0] !== 'ok') throw new Error('SQLite integrity check failed.');
  for (const table of ['records', 'kv', 'outbox']) {
    for (const row of db.prepare(`SELECT value FROM ${table}`).iterate() as Iterable<{ value: string }>) if (row.value !== null) unseal(row.value, key);
  }
};
export const snapshotDatabase = async (db: DatabaseSync, owner: string, key: Buffer, dataKey = process.env.DATA_ENCRYPTION_KEY || '') => {
  const directory = await mkdtemp(join(tmpdir(), 'feedme-backup-')); await chmod(directory, 0o700);
  const path = join(directory, 'snapshot.sqlite');
  try {
    await backup(db, path); await chmod(path, 0o600);
    const copy = new DatabaseSync(path, { readOnly: true });
    try { validateDatabase(copy, dataKey ? Buffer.from(dataKey, 'hex') : null); } finally { copy.close(); }
    const bytes = await readFile(path); if (bytes.length > MAX_SIZE) throw new Error('This database exceeds the built-in 256 MiB backup limit. Use a SQLite backup tool for larger databases.');
    return encryptBackup({ format: 1, owner, createdAt: new Date().toISOString(), dataKey, sqlite: bytes.toString('base64') }, key);
  } finally { await rm(directory, { recursive: true, force: true }); }
};
// A restored copy starts paused. Reconciliation must complete before it can publish or accept tips.
export const restoreSnapshot = async (body: Buffer, path: string, owner: string, key: Buffer, newDataKey = process.env.DATA_ENCRYPTION_KEY || '') => {
  const payload = decryptBackup(body, key);
  if (payload.owner !== owner) throw new Error('This backup belongs to another creator.');
  if (!/^(?:[a-f0-9]{64})?$/i.test(newDataKey)) throw new Error('Invalid destination database encryption key.');
  const bytes = Buffer.from(payload.sqlite, 'base64'); if (bytes.length > MAX_SIZE || !bytes.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) throw new Error('Invalid SQLite backup.');
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600, flush: true });
  const db = new DatabaseSync(path);
  try {
    validateDatabase(db, payload.dataKey ? Buffer.from(payload.dataKey, 'hex') : null);
    db.exec('BEGIN IMMEDIATE');
    try {
      const oldKey = payload.dataKey ? Buffer.from(payload.dataKey, 'hex') : null; const nextKey = newDataKey ? Buffer.from(newDataKey, 'hex') : null;
      // INTEGER PRIMARY KEY aliases (outbox.id) otherwise rename this result
      // column to `id`, leaving an undefined parameter during restore.
      for (const table of ['records', 'kv', 'outbox']) for (const row of db.prepare(`SELECT rowid AS backup_rowid,value FROM ${table}`).all() as { backup_rowid: number; value: string }[]) if (row.value !== null)
        db.prepare(`UPDATE ${table} SET value=? WHERE rowid=?`).run(seal(unseal(row.value, oldKey), nextKey), row.backup_rowid);
      db.prepare("DELETE FROM kv WHERE namespace IN ('session','login-binding','oauth-state','oauth-session','credentials','checkout-form','checkout-owner','checkout-url')").run();
      db.exec("DELETE FROM kv WHERE (namespace='recovery' AND key IN ('pending-checkpoint','candidate','spaces','verification','sync-error','reconciled-at','resumed-at')) OR namespace='backup'");
      db.exec('DELETE FROM outbox'); // Never replay stale financial/public projections from an old snapshot.
      db.prepare("INSERT INTO kv VALUES ('recovery','paused',?,NULL) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value").run(seal(true, nextKey));
      db.prepare("INSERT INTO kv VALUES ('recovery','restored-at',?,NULL) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value").run(seal(new Date().toISOString(), nextKey));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    validateDatabase(db, newDataKey ? Buffer.from(newDataKey, 'hex') : null); db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE');
  } catch (error) { db.close(); await rm(path, { force: true }); throw error; }
  db.close(); return { createdAt: payload.createdAt, owner: payload.owner };
};
export type BackupStatus = { attemptedAt: string; createdAt?: string; verifiedAt?: string; key?: string; remote?: boolean; error?: string; failures?: number; nextAttemptAt?: string };
const interval = 15 * 60_000;
export const backupRetryDelay = (failures: number) => Math.min(6 * 3600_000, interval * 2 ** Math.min(5, Math.max(0, failures - 1)));
type BackupStage = 'snapshot' | 'write' | 'verification' | 'retention' | 'cleanup' | 'destination';
class BackupFailure extends Error {
  constructor(readonly stage: BackupStage) { super(`Backup failed during ${stage}. Check the destination, permissions, encryption key, and server disk space, then retry.`); }
}
type BackupAttempt = { key: string; destination: string; digest: string; createdAt?: string; verifiedAt?: string };
const digest = (body: Buffer) => createHash('sha256').update(body).digest('hex');
let backupPromise: Promise<BackupStatus | undefined> | undefined;
export const runBackup = (force = false) => backupPromise ??= run(force).finally(() => { backupPromise = undefined; });
const run = async (force: boolean): Promise<BackupStatus | undefined> => {
  const cfg = config(); if (cfg.demo) return;
  const db = getDb(); const status = getKv<BackupStatus>(db, 'backup', 'status');
  if (!force && status && Date.now() < Date.parse(status.nextAttemptAt || new Date(Date.parse(status.attemptedAt) + interval).toISOString())) return status;
  const attemptedAt = new Date().toISOString();
  try {
    const store = backupStore(); if (!store) { if (force) throw new Error('Configure an S3 bucket or BACKUP_DIR first.'); return; }
    // Persist the schedule before I/O so a restart cannot create a retry storm.
    setKv(db, 'backup', 'status', { ...status, attemptedAt, nextAttemptAt: new Date(Date.now() + interval).toISOString() });
    const result = await performBackup(db, cfg.ownerDid, backupKey(), store);
    // Finishing delayed retention verifies the old snapshot, not today's data.
    // Schedule a fresh snapshot on the next worker tick if that one is overdue.
    const next = { attemptedAt, ...result, failures: 0, nextAttemptAt: new Date(Math.max(Date.now(), Date.parse(result.createdAt) + interval)).toISOString() }; setKv(db, 'backup', 'status', next); return next;
  } catch (error) {
    const failures = (status?.failures || 0) + 1;
    const stage = error instanceof BackupFailure ? error.stage : 'snapshot';
    const next = { ...status, attemptedAt, failures, nextAttemptAt: new Date(Date.now() + backupRetryDelay(failures)).toISOString(), error: new BackupFailure(stage).message };
    setKv(db, 'backup', 'status', next);
    // Bounded, secret-free operator signal; never log provider bodies or keys.
    console.error(`Backup failed during ${stage}; automatic retry in ${backupRetryDelay(failures) / 60_000} minutes.`);
    return next;
  }
};
export const performBackup = async (db: DatabaseSync, owner: string, key: Buffer, store: BackupStore) => {
  let attempt = getKv<BackupAttempt>(db, 'backup', 'attempt');
  if (attempt && attempt.destination !== store.identity) throw new BackupFailure('destination');
  const cleanup = async (current: BackupAttempt) => {
    try { await store.remove(current.key); deleteKv(db, 'backup', 'attempt'); }
    catch { throw new BackupFailure('cleanup'); }
  };
  // Only discard this installation's explicitly tracked, unverified attempt.
  // If cleanup fails, keep its marker and block new files, including after restart.
  if (attempt && !attempt.verifiedAt) { await cleanup(attempt); attempt = undefined; }
  let stage: BackupStage = 'snapshot';
  try {
    if (!attempt) {
      const body = await snapshotDatabase(db, owner, key);
      attempt = { key: `feedme-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.fmbak`, destination: store.identity, digest: digest(body) };
      setKv(db, 'backup', 'attempt', attempt);
      stage = 'write'; await store.put(attempt.key, body);
    }
    stage = 'verification';
    const returned = await store.get(attempt.key);
    if (digest(returned) !== attempt.digest) throw new BackupFailure(stage);
    // Reverify the stored object before retrying retention; preserve every
    // existing backup if readback, authentication, or restore validation fails.
    const directory = await mkdtemp(join(tmpdir(), 'feedme-verify-'));
    let createdAt: string;
    try { await chmod(directory, 0o700); ({ createdAt } = await restoreSnapshot(returned, join(directory, 'verified.sqlite'), owner, key)); }
    finally { await rm(directory, { recursive: true, force: true }); }
    attempt = { ...attempt, createdAt, verifiedAt: new Date().toISOString() };
    setKv(db, 'backup', 'attempt', attempt);
    stage = 'retention';
    for (const old of expiredBackups(await store.list())) if (old.key !== attempt.key) await store.remove(old.key);
    deleteKv(db, 'backup', 'attempt');
    return { key: attempt.key, createdAt, verifiedAt: attempt.verifiedAt!, remote: store.remote };
  } catch {
    if (attempt && !attempt.verifiedAt) await cleanup(attempt);
    // A verified attempt stays pinned until retention succeeds. Retrying this
    // phase reuses its file instead of accumulating another verified snapshot.
    throw new BackupFailure(stage);
  }
};
