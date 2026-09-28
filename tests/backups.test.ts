import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupKey, decryptBackup, snapshotDatabase, restoreSnapshot, performBackup, validateDatabase } from '../src/lib/backups';
import { fileBackupStore, expiredBackups, type BackupStore } from '../src/lib/backup-store';
import { openDatabase, putRecord, setKv, unseal } from '../src/lib/db';

const dirs: string[] = []; const key = Buffer.alloc(32, 7); const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const temporary = async () => { const dir = await mkdtemp(join(tmpdir(), 'feedme-backup-test-')); dirs.push(dir); return dir; };
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); delete process.env.DATA_ENCRYPTION_KEY; });

describe('encrypted, verified SQLite backups', () => {
  it('backs up committed WAL data and restores with a new database key, paused and without sessions', async () => {
    const root = await temporary(); process.env.DATA_ENCRYPTION_KEY = '11'.repeat(32);
    const db = openDatabase(join(root, 'original.sqlite'));
    try {
      putRecord(db, 'support', 'secret', { note: 'Private support note' }); setKv(db, 'oauth-session', owner, { token: 'refresh-secret' });
      const body = await snapshotDatabase(db, owner, key);
      expect(body.includes(Buffer.from('Private support note'))).toBe(false);
      const destination = join(root, 'recovered.sqlite'); await restoreSnapshot(body, destination, owner, key, '22'.repeat(32));
      const restored = new DatabaseSync(destination);
      try { validateDatabase(restored, Buffer.from('22'.repeat(32), 'hex')); const value = restored.prepare("SELECT value FROM records WHERE id='secret'").get()?.value; expect(unseal(String(value), Buffer.from('22'.repeat(32), 'hex'))).toEqual({ note: 'Private support note' }); expect(restored.prepare("SELECT 1 FROM kv WHERE namespace='oauth-session'").get()).toBeUndefined(); expect(unseal(String(restored.prepare("SELECT value FROM kv WHERE namespace='recovery' AND key='paused'").get()?.value), Buffer.from('22'.repeat(32), 'hex'))).toBe(true); } finally { restored.close(); }
      expect(await readFile(join(root, 'original.sqlite'))).toBeDefined();
    } finally { db.close(); }
  });
  it('refuses wrong keys, corruption, mismatched owners and overwriting existing files', async () => {
    const root = await temporary(); const db = openDatabase(':memory:'); const body = await snapshotDatabase(db, owner, key); db.close();
    expect(() => decryptBackup(body, Buffer.alloc(32, 9))).toThrow('authenticated'); const damaged = Buffer.from(body); damaged[damaged.length - 1] ^= 1; expect(() => decryptBackup(damaged, key)).toThrow('authenticated');
    await expect(restoreSnapshot(body, join(root, 'wrong.sqlite'), 'did:wrong', key)).rejects.toThrow('another creator');
    const path = join(root, 'existing.sqlite'); await writeFile(path, 'keep me'); await expect(restoreSnapshot(body, path, owner, key)).rejects.toThrow(); expect(await readFile(path, 'utf8')).toBe('keep me');
    expect(() => backupKey('short')).toThrow('separate');
  });
  it('uploads, reads back and actually restores a snapshot before calling it verified', async () => {
    const db = openDatabase(':memory:'); const store = fileBackupStore(await temporary());
    try { const status = await performBackup(db, owner, key, store); expect(status.verifiedAt).toBeTruthy(); const list = await store.list(); expect(list).toHaveLength(1); expect(new Date(list[0].createdAt).toISOString()).toContain('T'); expect(decryptBackup(await store.get(status.key), key).owner).toBe(owner); } finally { db.close(); }
  });
  it('never prunes history after a failed readback', async () => {
    const db = openDatabase(':memory:'); let deleted = false;
    const store: BackupStore = { remote: true, put: async () => {}, get: async () => Buffer.from('broken'), list: async () => [], remove: async () => { deleted = true; } };
    try { await expect(performBackup(db, owner, key, store)).rejects.toThrow('readback'); expect(deleted).toBe(false); } finally { db.close(); }
  });
  it('preserves recent, daily and monthly history while expiring older duplicates', () => {
    const items = Array.from({ length: 2000 }, (_, n) => ({ key: `k${n}`, createdAt: new Date(Date.UTC(2026, 8, 27) - n * 86400_000 / 4).toISOString() }));
    const expired = new Set(expiredBackups(items).map(x => x.key));
    expect(items.slice(0, 96).every(x => !expired.has(x.key))).toBe(true); expect(expired.has('k1999')).toBe(true);
    const kept = items.filter(x => !expired.has(x.key)); expect(new Set(kept.map(x => x.createdAt.slice(0, 7))).size).toBe(12);
  });
});
