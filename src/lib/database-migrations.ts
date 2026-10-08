import type { DatabaseSync } from 'node:sqlite';
import { installRecoveryTracking } from './recovery-tracking';

export type Migration = { version: number; apply: (db: DatabaseSync) => void };
// Append migrations; never change a migration already included in a release.
export const migrations: readonly Migration[] = [{ version: 1, apply: db => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS kv (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, expires INTEGER, PRIMARY KEY(namespace,key));
    CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, destination TEXT NOT NULL, collection TEXT NOT NULL, rkey TEXT NOT NULL, value TEXT, attempts INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0, error TEXT, UNIQUE(destination,collection,rkey));
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, created INTEGER NOT NULL);
  `);
  installRecoveryTracking(db);
} }, { version: 2, apply: db => {
  for (const action of ['insert', 'update', 'delete']) db.exec(`DROP TRIGGER IF EXISTS recovery_kv_${action}`);
  installRecoveryTracking(db);
  db.exec("INSERT OR IGNORE INTO recovery_dirty SELECT 'kv',namespace,key FROM kv WHERE namespace='libcard' AND key='snapshot'");
} }, { version: 3, apply: db => {
  for (const action of ['insert', 'update', 'delete']) db.exec(`DROP TRIGGER IF EXISTS recovery_kv_${action}`);
  installRecoveryTracking(db);
  db.exec("INSERT OR IGNORE INTO recovery_dirty SELECT 'kv',namespace,key FROM kv WHERE namespace='app' AND key='stripe-binding'");
} }];
export const databaseVersion = migrations.at(-1)!.version;
export const readDatabaseVersion = (db: DatabaseSync) => Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
export const assertDatabaseCompatible = (db: DatabaseSync, supported = databaseVersion) => {
  const version = readDatabaseVersion(db);
  if (version > supported) throw new Error(`Database schema ${version} is newer than supported schema ${supported}. Use a compatible Feedme release or restore a compatible backup; do not downgrade this database.`);
  return version;
};
export const migrateDatabase = (db: DatabaseSync, steps: readonly Migration[] = migrations) => {
  if (!steps.length || steps.some((step, i) => step.version !== i + 1)) throw new Error('Database migrations must have consecutive versions starting at 1.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const version = assertDatabaseCompatible(db, steps.at(-1)!.version);
    for (const step of steps.filter(step => step.version > version)) {
      step.apply(db);
      db.exec(`PRAGMA user_version=${step.version}`);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
};
