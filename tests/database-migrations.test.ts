import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateDatabase, readDatabaseVersion } from '../src/lib/database-migrations';
import { openDatabase, seal, readRecord, pendingWrites } from '../src/lib/db';

const paths: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const path of paths.splice(0)) rmSync(path, { force: true, recursive: true }); });
const databasePath = () => { const path = mkdtempSync(join(tmpdir(), 'feedme-upgrade-')); paths.push(path); return join(path, 'test.sqlite'); };

describe('database release compatibility', () => {
  it('upgrades the pre-versioning schema while preserving encrypted records, events and queued writes', () => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', '12'.repeat(32));
    const path = databasePath(); const old = new DatabaseSync(path);
    // Schema shipped before numbered migrations. No new migration code builds this fixture.
    old.exec(`
      CREATE TABLE records (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE kv (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, expires INTEGER, PRIMARY KEY(namespace,key));
      CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, destination TEXT NOT NULL, collection TEXT NOT NULL, rkey TEXT NOT NULL, value TEXT, attempts INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0, error TEXT, UNIQUE(destination,collection,rkey));
      CREATE TABLE events (id TEXT PRIMARY KEY, created INTEGER NOT NULL);
    `);
    const support = { id: 'support-1', amount: 2200, visibility: 'private' };
    old.prepare('INSERT INTO records VALUES (?,?,?)').run('support', support.id, seal(support));
    old.prepare('INSERT INTO outbox(destination,collection,rkey,value,attempts) VALUES (?,?,?,?,?)').run('private', 'fund.feedme.support', support.id, seal(support), 3);
    expect((old.prepare('SELECT value FROM records').get() as { value: string }).value).toMatch(/^enc:/);
    old.exec("INSERT INTO events VALUES ('evt_paid',123)");
    old.close();
    const next = openDatabase(path);
    expect(readDatabaseVersion(next)).toBe(2);
    expect(readRecord(next, 'support', support.id)).toEqual(support);
    expect(pendingWrites(next)[0]).toMatchObject({ attempts: 3, value: support });
    expect(next.prepare('SELECT * FROM events').all()).toEqual([{ id: 'evt_paid', created: 123 }]);
    // New recovery tracking is installed, including the trigger on a subsequent update.
    next.prepare('UPDATE records SET value=? WHERE id=?').run(seal({ ...support, amount: 4400 }), support.id);
    expect(next.prepare('SELECT key FROM recovery_dirty').all()).toEqual([{ key: support.id }]);
    next.close();
    const reopened = openDatabase(path);
    expect(readRecord(reopened, 'support', support.id)).toEqual({ ...support, amount: 4400 });
    reopened.close();
  });

  it('upgrades existing version-one triggers and backfills the portable LibCard snapshot', () => {
    const db = openDatabase(':memory:');
    db.exec('PRAGMA user_version=1; DELETE FROM recovery_dirty');
    for (const action of ['insert','update','delete']) {
      db.exec(`DROP TRIGGER recovery_kv_${action}`);
      const ref = action === 'delete' ? 'OLD' : 'NEW';
      db.exec(`CREATE TRIGGER recovery_kv_${action} AFTER ${action} ON kv WHEN ${ref}.namespace='app' BEGIN INSERT OR IGNORE INTO recovery_dirty VALUES ('kv',${ref}.namespace,${ref}.key); END`);
    }
    db.prepare('INSERT INTO kv VALUES (?,?,?,NULL)').run('libcard','snapshot',seal({ fixture: true }));
    expect(db.prepare('SELECT * FROM recovery_dirty').all()).toEqual([]);
    migrateDatabase(db);
    expect(readDatabaseVersion(db)).toBe(2);
    expect(db.prepare('SELECT * FROM recovery_dirty').all()).toEqual([{ source: 'kv', kind: 'libcard', key: 'snapshot' }]);
    db.exec('DELETE FROM recovery_dirty');
    db.prepare('UPDATE kv SET value=? WHERE namespace=?').run(seal({ fixture: false }),'libcard');
    expect(db.prepare('SELECT * FROM recovery_dirty').all()).toEqual([{ source: 'kv', kind: 'libcard', key: 'snapshot' }]);
    db.close();
  });
  it('rolls back every migration in the batch when a later migration fails', () => {
    const db = new DatabaseSync(':memory:');
    expect(() => migrateDatabase(db, [
      { version: 1, apply: db => db.exec('CREATE TABLE partial (value TEXT)') },
      { version: 2, apply: () => { throw new Error('deliberate failure'); } },
    ])).toThrow('deliberate failure');
    expect(readDatabaseVersion(db)).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='partial'").get()).toBeUndefined();
    db.close();
  });

  it('refuses a newer database before changing its journal or schema', () => {
    const path = databasePath(); const future = new DatabaseSync(path);
    future.exec('CREATE TABLE future (value TEXT); PRAGMA user_version=99'); future.close();
    expect(() => openDatabase(path)).toThrow('newer than supported');
    const db = new DatabaseSync(path, { readOnly: true });
    expect(readDatabaseVersion(db)).toBe(99);
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' });
    expect(db.prepare('SELECT name FROM sqlite_master').all()).toEqual([{ name: 'future' }]);
    db.close();
  });

  it('applies pending migrations once and rejects missing version steps', () => {
    const db = new DatabaseSync(':memory:'); let calls = 0;
    const steps = [{ version: 1, apply: () => { calls++; } }];
    migrateDatabase(db, steps); migrateDatabase(db, steps);
    expect(calls).toBe(1);
    expect(() => migrateDatabase(db, [...steps, { version: 3, apply: () => {} }])).toThrow('consecutive');
    db.close();
  });
});
