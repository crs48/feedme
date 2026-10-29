import type { DatabaseSync } from 'node:sqlite';
import type { BackupStore } from '../src/lib/backup-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined, store: undefined as BackupStore | undefined }));
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: false, ownerDid: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' }) }));
vi.mock('../src/lib/db', async original => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => state.db! }));
vi.mock('../src/lib/backup-store', async original => ({ ...await original<typeof import('../src/lib/backup-store')>(), backupStore: () => state.store }));
import { getKv, openDatabase } from '../src/lib/db';
import { backupRetryDelay, runBackup, type BackupStatus } from '../src/lib/backups';

const files = new Map<string, Buffer>();
const put = vi.fn(async (name: string, body: Buffer) => { files.set(name, body); });
const get = vi.fn(async (name: string) => files.get(name)!);
const minute = 60_000;
const advance = (duration: number) => vi.setSystemTime(Date.now() + duration);
beforeEach(() => {
  state.db = openDatabase(':memory:'); files.clear(); put.mockClear(); get.mockReset();
  get.mockImplementation(async name => files.get(name)!);
  state.store = { identity: 'worker-fixture', remote: true, put, get, list: async () => [], remove: async name => { files.delete(name); } };
  vi.stubEnv('BACKUP_ENCRYPTION_KEY', '77'.repeat(32)); vi.stubEnv('DATA_ENCRYPTION_KEY', '');
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { state.db!.close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('automatic backup scheduling', () => {
  it('backs off persistent failures, cleans each failed object and resets after recovery', async () => {
    get.mockResolvedValue(Buffer.from('bad readback'));
    const first = await runBackup();
    expect(first).toMatchObject({ failures: 1, nextAttemptAt: '2026-10-29T00:15:00.000Z' });
    expect(files.size).toBe(0); expect(put).toHaveBeenCalledTimes(1);
    advance(minute); await runBackup(); expect(put).toHaveBeenCalledTimes(1);
    advance(14 * minute); const second = await runBackup();
    expect(second).toMatchObject({ failures: 2, nextAttemptAt: '2026-10-29T00:45:00.000Z' });
    expect(put).toHaveBeenCalledTimes(2); expect(files.size).toBe(0);
    advance(29 * minute); await runBackup(); expect(put).toHaveBeenCalledTimes(2);
    advance(minute); get.mockImplementation(async name => files.get(name)!);
    const recovered = await runBackup();
    expect(recovered).toMatchObject({ failures: 0, nextAttemptAt: '2026-10-29T01:00:00.000Z' });
    expect(recovered?.error).toBeUndefined(); expect(recovered?.verifiedAt).toBeTruthy();
    expect(put).toHaveBeenCalledTimes(3); expect(files.size).toBe(1);
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('preserves last-good status and only logs a new failure when an attempt runs', async () => {
    const saved = await runBackup(); advance(15 * minute);
    get.mockImplementation(async () => { throw new Error('secret-provider-response'); });
    const failure = await runBackup();
    expect(failure).toMatchObject({ key: saved!.key, verifiedAt: saved!.verifiedAt, failures: 1 });
    await runBackup(); expect(console.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret-provider-response');
    expect(failure?.error).not.toContain('secret-provider-response');
    expect(files.has(saved!.key!)).toBe(true);
  });

  it('allows a manual retry during backoff and coalesces concurrent attempts', async () => {
    get.mockResolvedValue(Buffer.from('bad readback')); await runBackup();
    get.mockImplementation(async name => files.get(name)!);
    const [first, second] = await Promise.all([runBackup(true), runBackup(true)]);
    expect(first).toEqual(second); expect(first?.error).toBeUndefined();
    expect(put).toHaveBeenCalledTimes(2);
    expect(getKv<BackupStatus>(state.db!, 'backup', 'status')?.failures).toBe(0);
  });

  it('caps automatic backoff at six hours', () => {
    expect([1, 2, 3, 4, 5, 6, 100].map(backupRetryDelay)).toEqual([15, 30, 60, 120, 240, 360, 360].map(n => n * minute));
  });

  it('does not present an old retained snapshot as fresh and promptly schedules current data', async () => {
    const list = vi.fn<BackupStore['list']>(async () => { throw new Error('retention unavailable'); });
    state.store!.list = list;
    const failed = await runBackup(); expect(failed?.error).toContain('retention');
    const originalKey = [...files.keys()][0];
    advance(6 * 3600_000); list.mockResolvedValue([]);
    const recovered = await runBackup();
    expect(recovered).toMatchObject({ key: originalKey, createdAt: '2026-10-29T00:00:00.000Z', verifiedAt: '2026-10-29T06:00:00.000Z', nextAttemptAt: '2026-10-29T06:00:00.000Z' });
    expect(put).toHaveBeenCalledTimes(1);
    const fresh = await runBackup();
    expect(fresh?.key).not.toBe(originalKey); expect(fresh?.createdAt).toBe('2026-10-29T06:00:00.000Z');
    expect(put).toHaveBeenCalledTimes(2);
  });
});
