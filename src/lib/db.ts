import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config';
import { migrateProtocol } from './protocol-migration';
import { demoFriends, demoProfile, demoProjects, demoSupports, demoUpdates } from './seed';

export const openDatabase = (path: string) => {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS kv (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, expires INTEGER, PRIMARY KEY(namespace,key));
    CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, destination TEXT NOT NULL, collection TEXT NOT NULL, rkey TEXT NOT NULL, value TEXT, attempts INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0, error TEXT, UNIQUE(destination,collection,rkey));
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, created INTEGER NOT NULL);
  `);
  return db;
};
let database: DatabaseSync;
export const getDb = () => {
  if (database) { migrateProtocol(database, config()); return database; }
  const cfg = config();
  mkdirSync(cfg.dataDir, { recursive: true, mode: 0o700 });
  const path = join(cfg.dataDir, cfg.demo ? 'demo.sqlite' : 'feedme.sqlite');
  database = openDatabase(path);
  chmodSync(path, 0o600);
  if (!database.prepare("SELECT 1 FROM kv WHERE namespace='app' AND key='initialized'").get()) {
    const data = cfg.demo ? {
      profile: [demoProfile], project: demoProjects, update: demoUpdates, friend: demoFriends, support: demoSupports,
    } : { profile: [{ name: 'Your corner of the internet', handle: '', bio: 'A home for the things I’m making and the people who make them possible.', location: '', website: '' }], project: [], update: [], friend: [], support: [] };
    transaction(database, () => {
      Object.entries(data).forEach(([kind, values]) => values.forEach((value) => {
        const id = 'id' in value ? value.id : 'self';
        putRecord(database, kind, String(id), value);
      }));
      setKv(database, 'app', 'initialized', true);
    });
  }
  if (cfg.demo && !getKv(database, 'app', 'social-demo-seed')) {
    transaction(database, () => {
      for (const friend of demoFriends) {
        const existing = readRecord<{ did: string }>(database, 'friend', friend.id);
        if (existing && !existing.did) putRecord(database, 'friend', friend.id, { ...existing, did: friend.did });
      }
      setKv(database, 'app', 'social-demo-seed', true);
    });
  }
  if (cfg.demo && !getKv(database, 'app', 'portrait-demo-seed')) {
    transaction(database, () => {
      // Update only the old stock identities, preserving user-created tips and every payment field.
      for (const seed of demoSupports) {
        const existing = readRecord<{ visibility: string; supporterDid?: string; createdAt: string }>(database, 'support', seed.id);
        if (existing?.visibility === 'public' && existing.supporterDid === 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' && existing.createdAt === seed.createdAt)
          putRecord(database, 'support', seed.id, { ...existing, supporterDid: seed.supporterDid });
      }
      setKv(database, 'app', 'portrait-demo-seed', true);
    });
  }
  migrateProtocol(database, cfg);
  return database;
};

const encryptionKey = () => process.env.DATA_ENCRYPTION_KEY ? Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'hex') : null;
const seal = (value: unknown) => {
  const json = JSON.stringify(value);
  const key = encryptionKey();
  if (!key) return json;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  return `enc:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${body.toString('base64')}`;
};
const unseal = <T>(value: string): T => {
  if (!value.startsWith('enc:')) return JSON.parse(value) as T;
  const key = encryptionKey();
  if (!key) throw new Error('The database encryption key is required.');
  const [, iv, tag, body] = value.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString()) as T;
};
export const transaction = <T>(db: DatabaseSync, fn: () => T): T => {
  db.exec('BEGIN IMMEDIATE');
  try { const value = fn(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
};
export const putRecord = (db: DatabaseSync, kind: string, id: string, value: unknown) =>
  db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value').run(kind, id, seal(value));
export const readRecord = <T>(db: DatabaseSync, kind: string, id: string): T | undefined => {
  const row = db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind, id) as { value: string } | undefined;
  return row ? unseal<T>(row.value) : undefined;
};
export const listRecords = <T>(db: DatabaseSync, kind: string): T[] =>
  (db.prepare('SELECT value FROM records WHERE kind=? ORDER BY rowid DESC').all(kind) as { value: string }[]).map((row) => unseal<T>(row.value));
export const setKv = (db: DatabaseSync, ns: string, key: string, value: unknown, ttl?: number) =>
  db.prepare('INSERT INTO kv VALUES (?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,expires=excluded.expires')
    .run(ns, key, seal(value), ttl ? Date.now() + ttl : null);
export const getKv = <T>(db: DatabaseSync, ns: string, key: string): T | undefined => {
  const row = db.prepare('SELECT value,expires FROM kv WHERE namespace=? AND key=?').get(ns, key) as { value: string; expires: number | null } | undefined;
  if (!row) return undefined;
  if (row.expires && row.expires < Date.now()) { deleteKv(db, ns, key); return undefined; }
  return unseal<T>(row.value);
};
export const deleteKv = (db: DatabaseSync, ns: string, key: string) => db.prepare('DELETE FROM kv WHERE namespace=? AND key=?').run(ns, key);
export type OutboxEntry = { id: number; destination: 'public' | 'private'; collection: string; rkey: string; value: unknown | null; attempts: number; revision: number };
export const enqueue = (db: DatabaseSync, destination: OutboxEntry['destination'], collection: string, rkey: string, value: unknown | null) =>
  db.prepare(`INSERT INTO outbox(destination,collection,rkey,value) VALUES(?,?,?,?)
    ON CONFLICT(destination,collection,rkey) DO UPDATE SET value=excluded.value,attempts=0,revision=outbox.revision+1,error=NULL`).run(destination, collection, rkey, seal(value));
export const pendingWrites = (db: DatabaseSync): OutboxEntry[] =>
  (db.prepare('SELECT * FROM outbox ORDER BY id LIMIT 50').all() as unknown as (Omit<OutboxEntry, 'value'> & { value: string })[])
    .map((row) => ({ ...row, value: unseal(row.value) }));
