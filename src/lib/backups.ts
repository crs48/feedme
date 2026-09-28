import { backup, DatabaseSync } from 'node:sqlite';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { config } from './config';
import { getDb, getKv, setKv, seal, unseal } from './db';
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
      for (const table of ['records', 'kv', 'outbox']) for (const row of db.prepare(`SELECT rowid,value FROM ${table}`).all() as { rowid: number; value: string }[]) if (row.value !== null)
        db.prepare(`UPDATE ${table} SET value=? WHERE rowid=?`).run(seal(unseal(row.value, oldKey), nextKey), row.rowid);
      db.prepare("DELETE FROM kv WHERE namespace IN ('session','login-binding','oauth-state','oauth-session','credentials','checkout-form','checkout-owner','checkout-url')").run();
      db.exec("DELETE FROM kv WHERE (namespace='recovery' AND key IN ('pending-checkpoint','candidate','spaces','verification','sync-error','reconciled-at','resumed-at')) OR (namespace='backup' AND key='status')");
      db.exec('DELETE FROM outbox'); // Never replay stale financial/public projections from an old snapshot.
      db.prepare("INSERT INTO kv VALUES ('recovery','paused',?,NULL) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value").run(seal(true, nextKey));
      db.prepare("INSERT INTO kv VALUES ('recovery','restored-at',?,NULL) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value").run(seal(new Date().toISOString(), nextKey));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    validateDatabase(db, newDataKey ? Buffer.from(newDataKey, 'hex') : null); db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE');
  } catch (error) { db.close(); await rm(path, { force: true }); throw error; }
  db.close(); return { createdAt: payload.createdAt, owner: payload.owner };
};
export type BackupStatus = { attemptedAt: string; verifiedAt?: string; key?: string; remote?: boolean; error?: string };
let backupPromise: Promise<BackupStatus | undefined> | undefined;
export const runBackup = (force = false) => backupPromise ??= run(force).finally(() => { backupPromise = undefined; });
const run = async (force: boolean): Promise<BackupStatus | undefined> => {
  const cfg = config(); if (cfg.demo) return;
  const db = getDb(); const status = getKv<BackupStatus>(db, 'backup', 'status');
  if (!force && status && Date.now() - Date.parse(status.attemptedAt) < (status.error ? 60_000 : 15 * 60_000)) return status;
  const attemptedAt = new Date().toISOString();
  try {
    const store = backupStore(); if (!store) { if (force) throw new Error('Configure an S3 bucket or BACKUP_DIR first.'); return; }
    const result = await performBackup(db, cfg.ownerDid, backupKey(), store);
    const next = { attemptedAt, ...result }; setKv(db, 'backup', 'status', next); return next;
  } catch { const next = { ...status, attemptedAt, error: 'Backup failed. Check the destination, permissions, encryption key, and server disk space, then retry.' }; setKv(db, 'backup', 'status', next); return next; }
};
export const performBackup = async (db: DatabaseSync, owner: string, key: Buffer, store: BackupStore) => {
  const body = await snapshotDatabase(db, owner, key);
  const name = `feedme-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.fmbak`;
  await store.put(name, body);
  const returned = await store.get(name);
  if (!returned.equals(body)) throw new Error('Backup readback differed from the uploaded snapshot.');
  // Exercise authenticated decrypt, SQLite opening, every encrypted row, and rekeying on every backup.
  const directory = await mkdtemp(join(tmpdir(), 'feedme-verify-')); await chmod(directory, 0o700);
  try { await restoreSnapshot(returned, join(directory, 'verified.sqlite'), owner, key); } finally { await rm(directory, { recursive: true, force: true }); }
  for (const old of expiredBackups(await store.list())) await store.remove(old.key);
  return { key: name, verifiedAt: new Date().toISOString(), remote: store.remote };
};
