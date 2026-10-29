import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupKey, decryptBackup, snapshotDatabase, restoreSnapshot, performBackup, validateDatabase } from '../src/lib/backups';
import { fileBackupStore, expiredBackups } from '../src/lib/backup-store';
import { getKv, openDatabase, putRecord, setKv, unseal } from '../src/lib/db';

const dirs: string[] = []; const key = Buffer.alloc(32, 7); const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const temporary = async () => { const dir = await mkdtemp(join(tmpdir(), 'feedme-backup-test-')); dirs.push(dir); return dir; };
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); delete process.env.DATA_ENCRYPTION_KEY; vi.useRealTimers(); });

describe('encrypted, verified SQLite backups', () => {
  it('backs up committed WAL data and restores with a new database key, paused and without sessions', async () => {
    const root = await temporary(); process.env.DATA_ENCRYPTION_KEY = '11'.repeat(32);
    const db = openDatabase(join(root, 'original.sqlite'));
    try {
      putRecord(db, 'support', 'secret', { note: 'Private support note' }); setKv(db, 'oauth-session', owner, { token: 'refresh-secret' });
      // Nonempty outboxes previously failed because SELECT rowid returned `id`.
      db.prepare('INSERT INTO outbox(destination,collection,rkey,value) VALUES(?,?,?,?)').run('private', 'synthetic', 'queued', JSON.stringify({ queued: true }));
      db.prepare('INSERT INTO outbox(destination,collection,rkey,value) VALUES(?,?,?,?)').run('public', 'synthetic', 'deleted', 'null');
      setKv(db, 'backup', 'attempt', { key: 'old-attempt' });
      const body = await snapshotDatabase(db, owner, key);
      expect(body.includes(Buffer.from('Private support note'))).toBe(false);
      const destination = join(root, 'recovered.sqlite'); await restoreSnapshot(body, destination, owner, key, '22'.repeat(32));
      const restored = new DatabaseSync(destination);
      try { validateDatabase(restored, Buffer.from('22'.repeat(32), 'hex')); const value = restored.prepare("SELECT value FROM records WHERE id='secret'").get()?.value; expect(unseal(String(value), Buffer.from('22'.repeat(32), 'hex'))).toEqual({ note: 'Private support note' }); expect(restored.prepare("SELECT 1 FROM kv WHERE namespace='oauth-session'").get()).toBeUndefined(); expect(unseal(String(restored.prepare("SELECT value FROM kv WHERE namespace='recovery' AND key='paused'").get()?.value), Buffer.from('22'.repeat(32), 'hex'))).toBe(true); } finally { restored.close(); }
      expect(await readFile(join(root, 'original.sqlite'))).toBeDefined();
      expect(db.prepare('SELECT COUNT(*) AS n FROM outbox').get()?.n).toBe(2);
      const cleared = new DatabaseSync(destination);
      try {
        expect(cleared.prepare('SELECT COUNT(*) AS n FROM outbox').get()?.n).toBe(0);
        expect(cleared.prepare("SELECT COUNT(*) AS n FROM kv WHERE namespace='backup'").get()?.n).toBe(0);
      } finally { cleared.close(); }
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
  it('removes only its failed attempt, never history, after failed readback', async () => {
    const db = openDatabase(':memory:'); const backing = fileBackupStore(await temporary());
    const prior = await performBackup(db, owner, key, backing);
    const store = { ...backing, get: async () => Buffer.from('broken'), list: vi.fn(backing.list), remove: vi.fn(backing.remove) };
    try {
      await expect(performBackup(db, owner, key, store)).rejects.toThrow('verification');
      expect(store.list).not.toHaveBeenCalled(); expect(store.remove).toHaveBeenCalledTimes(1);
      expect((await backing.list()).map(item => item.key)).toEqual([prior.key]);
      expect(getKv(db, 'backup', 'attempt')).toBeUndefined();
    } finally { db.close(); }
  });
  it('cleans up failed restore verification, beyond a successful byte-for-byte readback', async () => {
    const db = openDatabase(':memory:'); const backing = fileBackupStore(await temporary());
    const store = { ...backing, get: async (name: string) => { const bytes = await backing.get(name); process.env.DATA_ENCRYPTION_KEY = 'invalid'; return bytes; }, list: vi.fn(backing.list) };
    try {
      await expect(performBackup(db, owner, key, store)).rejects.toThrow('verification');
      expect(store.list).not.toHaveBeenCalled(); expect(await backing.list()).toEqual([]);
    } finally { db.close(); }
  });
  it('blocks new files while cleanup fails, and resumes after reopening the database', async () => {
    const root = await temporary(); let db = openDatabase(join(root, 'source.sqlite'));
    const backing = fileBackupStore(join(root, 'backups'));
    const store = { ...backing, put: vi.fn(backing.put), get: async () => Buffer.from('broken'), remove: vi.fn(async () => { throw new Error('unavailable'); }) };
    try {
      await expect(performBackup(db, owner, key, store)).rejects.toThrow('cleanup');
      const pending = getKv(db, 'backup', 'attempt'); expect(pending).toBeDefined();
      db.close(); db = openDatabase(join(root, 'source.sqlite'));
      await expect(performBackup(db, owner, key, store)).rejects.toThrow('cleanup');
      expect(store.put).toHaveBeenCalledTimes(1); expect(getKv(db, 'backup', 'attempt')).toEqual(pending);
      await performBackup(db, owner, key, backing);
      expect(await backing.list()).toHaveLength(1); expect(getKv(db, 'backup', 'attempt')).toBeUndefined();
    } finally { db.close(); }
  });
  it('cleans up an interrupted partial and refuses cleanup against a different destination', async () => {
    const root = await temporary(); const db = openDatabase(':memory:'); const store = fileBackupStore(root);
    const name = 'feedme-2026-10-29T00-00-00-000Z-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.fmbak';
    setKv(db, 'backup', 'attempt', { key: name, destination: store.identity, digest: 'interrupted' });
    await writeFile(join(root, `${name}.partial`), 'incomplete');
    const other = { ...store, identity: 'different', put: vi.fn(store.put), remove: vi.fn(store.remove) };
    try {
      await expect(performBackup(db, owner, key, other)).rejects.toThrow('destination');
      expect(other.put).not.toHaveBeenCalled(); expect(other.remove).not.toHaveBeenCalled();
      await performBackup(db, owner, key, store);
      expect(await readdir(root)).toHaveLength(1); expect((await readdir(root))[0]).toMatch(/\.fmbak$/);
    } finally { db.close(); }
  });
  it('cleans up a successful upload whose response was lost', async () => {
    const db = openDatabase(':memory:'); const backing = fileBackupStore(await temporary());
    const store = { ...backing, put: async (name: string, body: Buffer) => { await backing.put(name, body); throw new Error('lost response'); } };
    try { await expect(performBackup(db, owner, key, store)).rejects.toThrow('write'); expect(await backing.list()).toEqual([]); }
    finally { db.close(); }
  });
  it('retries retention using the same verified file instead of creating more snapshots', async () => {
    const root = await temporary(); let db = openDatabase(join(root, 'source.sqlite')); const backing = fileBackupStore(join(root, 'backups'));
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
    const objects = Array.from({ length: 150 }, (_, n) => ({ key: `history-${n}`, createdAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString() }));
    const list = vi.fn(async () => [...objects, ...await backing.list()]);
    const remove = vi.fn(async (_name: string): Promise<void> => { throw new Error('retention denied'); });
    const store = { ...backing, put: vi.fn(backing.put), list, remove };
    try {
      await expect(performBackup(db, owner, key, store)).rejects.toThrow('retention');
      const attempt = getKv<{ key: string; verifiedAt: string }>(db, 'backup', 'attempt')!;
      expect(attempt.verifiedAt).toBeTruthy();
      db.close(); db = openDatabase(join(root, 'source.sqlite'));
      vi.setSystemTime(new Date('2026-10-29T06:00:00Z'));
      await expect(performBackup(db, owner, key, store)).rejects.toThrow('retention');
      expect(store.put).toHaveBeenCalledTimes(1); expect(await backing.list()).toHaveLength(1);
      remove.mockResolvedValue(undefined);
      const result = await performBackup(db, owner, key, store);
      expect(result.key).toBe(attempt.key); expect(store.put).toHaveBeenCalledTimes(1);
      expect(result.createdAt).toBe('2026-10-29T00:00:00.000Z');
      expect(result.verifiedAt).toBe('2026-10-29T06:00:00.000Z');
      expect(remove).not.toHaveBeenCalledWith(attempt.key);
      expect(getKv(db, 'backup', 'attempt')).toBeUndefined();
    } finally { db.close(); }
  });
  it('requires fresh readback verification before resuming retention', async () => {
    const db = openDatabase(':memory:'); const backing = fileBackupStore(await temporary());
    const saved = await performBackup(db, owner, key, backing); const body = await backing.get(saved.key);
    setKv(db, 'backup', 'attempt', { key: saved.key, destination: backing.identity, digest: createHash('sha256').update(body).digest('hex'), verifiedAt: saved.verifiedAt });
    const store = { ...backing, put: vi.fn(backing.put), get: async () => Buffer.from('tampered'), list: vi.fn(backing.list), remove: vi.fn(backing.remove) };
    try {
      await expect(performBackup(db, owner, key, store)).rejects.toThrow('verification');
      expect(store.put).not.toHaveBeenCalled(); expect(store.list).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled();
      expect(getKv(db, 'backup', 'attempt')).toBeDefined();
    } finally { db.close(); }
  });
  it('removes partial files after a failed local rename', async () => {
    const root = await temporary(); const store = fileBackupStore(root);
    const name = 'feedme-2026-10-29T00-00-00-000Z-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.fmbak';
    await mkdir(join(root, name));
    await expect(store.put(name, Buffer.from('synthetic'))).rejects.toThrow();
    expect(await readdir(root)).toEqual([name]);
  });
  it('preserves recent, daily and monthly history while expiring older duplicates', () => {
    const items = Array.from({ length: 2000 }, (_, n) => ({ key: `k${n}`, createdAt: new Date(Date.UTC(2026, 8, 27) - n * 86400_000 / 4).toISOString() }));
    const expired = new Set(expiredBackups(items).map(x => x.key));
    expect(items.slice(0, 96).every(x => !expired.has(x.key))).toBe(true); expect(expired.has('k1999')).toBe(true);
    const kept = items.filter(x => !expired.has(x.key)); expect(new Set(kept.map(x => x.createdAt.slice(0, 7))).size).toBe(12);
  });
});
