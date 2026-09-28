import { mkdirSync, chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';

// Keep an exclusive SQLite transaction on a separate sentinel file. Kernel locks
// are released even after SIGKILL; a stale PID/hostname file cannot block restart.
// Shared-volume access must have working SQLite file locks. This does not fence
// another server using a different disk against the same remote Habitat space.
const registry = Symbol.for('feedme.writer.locks');
const locks = globalThis[registry] ||= new Map();
export const acquireDataLock = (directory) => {
  const root = resolve(directory);
  if (locks.has(root)) return () => {};
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = join(root, '.feedme-writer.sqlite');
  const db = new DatabaseSync(path); chmodSync(path, 0o600);
  try { db.exec('PRAGMA busy_timeout=0; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE'); }
  catch { db.close(); throw new Error('Another Feedme process owns this data directory. Stop it before restoring or starting a second server.'); }
  locks.set(root, db);
  const release = () => { if (locks.get(root) !== db) return; db.exec('ROLLBACK'); db.close(); locks.delete(root); };
  process.once('exit', release); return release;
};
