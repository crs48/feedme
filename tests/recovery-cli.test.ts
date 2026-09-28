import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { openDatabase, getKv, putRecord, readRecord } from '../src/lib/db';
import { snapshotDatabase } from '../src/lib/backups';
import { acquireDataLock } from '../scripts/data-lock.mjs';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { force: true, recursive: true }))); });
const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'feedme-cli-test-')); dirs.push(root);
  const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'; const key = '33'.repeat(32);
  const candidate = openDatabase(':memory:'); putRecord(candidate, 'profile', 'self', { name: 'Recovered creator' });
  const snapshot = await snapshotDatabase(candidate, owner, Buffer.from(key, 'hex')); candidate.close();
  const file = join(root, 'candidate.fmbak'); await writeFile(file, snapshot);
  const current = openDatabase(join(root, 'demo.sqlite')); putRecord(current, 'profile', 'self', { name: 'Previous creator' }); current.close();
  const run = () => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/data.ts', 'restore', '--file', file, '--owner', owner], { cwd: resolve('.'), env: { ...process.env, FEEDME_MODE: 'demo', DATA_DIR: root, DATA_ENCRYPTION_KEY: '', BACKUP_ENCRYPTION_KEY: key }, encoding: 'utf8' });
  return { root, file, run };
};
describe('offline restore activation', () => {
  it('refuses activation while an app owns the directory, then preserves the previous database and starts paused', async () => {
    const { root, run } = await setup(); const release = acquireDataLock(root);
    try { const locked = run(); expect(locked.status).not.toBe(0); expect(locked.stderr).toContain('Another Feedme process'); } finally { release(); }
    const restored = run(); expect(restored.status, restored.stderr).toBe(0);
    const live = openDatabase(join(root, 'demo.sqlite')); try { expect(readRecord(live, 'profile', 'self')).toEqual({ name: 'Recovered creator' }); expect(getKv(live, 'recovery', 'paused')).toBe(true); } finally { live.close(); }
    const [previous] = (await readdir(join(root, 'recovery'))).filter(name => name.startsWith('previous-'));
    const old = openDatabase(join(root, 'recovery', previous)); try { expect(readRecord(old, 'profile', 'self')).toEqual({ name: 'Previous creator' }); } finally { old.close(); }
  });
  it('automatically releases the writer lock after a forced process exit', async () => {
    const { root, run } = await setup();
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import { acquireDataLock } from './scripts/data-lock.mjs'; acquireDataLock(process.argv[1]); console.log('locked'); setInterval(() => {}, 1000);`, root], { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await new Promise<void>((resolve, reject) => { child.stdout.once('data', () => resolve()); child.once('error', reject); child.once('exit', code => reject(new Error('Lock process exited: ' + code))); });
      expect(run().status).not.toBe(0);
      const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await stopped;
      const restored = run(); expect(restored.status, restored.stderr).toBe(0);
    } finally { if (child.exitCode === null && !child.killed) child.kill('SIGKILL'); }
  });
  it('leaves the current database intact when decryption or candidate validation fails', async () => {
    const { root, file, run } = await setup(); await writeFile(file, 'bad snapshot');
    const result = run(); expect(result.status).not.toBe(0);
    const live = openDatabase(join(root, 'demo.sqlite')); try { expect(readRecord(live, 'profile', 'self')).toEqual({ name: 'Previous creator' }); } finally { live.close(); }
  });
});
