import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

// A shared data directory is still a single-writer deployment. Never break another host's lock.
export const acquireDataLock = (directory) => {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, '.feedme-writer.lock');
  const ownerPath = join(path, 'owner.json');
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner; try { owner = JSON.parse(readFileSync(ownerPath, 'utf8')); } catch { throw new Error('The data directory is locked. Stop its server before recovering an incomplete lock.'); }
    if (owner.host === hostname() && owner.pid === process.pid) return () => {};
    let alive = true;
    if (owner.host === hostname() && Number.isInteger(owner.pid) && owner.pid > 0) { try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; } }
    if (alive) throw new Error('Another Feedme process owns this data directory. Stop it before restoring or starting a second server.');
    rmSync(path, { recursive: true }); mkdirSync(path, { mode: 0o700 });
  }
  writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, host: hostname() }), { mode: 0o600, flag: 'wx' });
  const release = () => { try { const owner = JSON.parse(readFileSync(ownerPath, 'utf8')); if (owner.pid === process.pid && owner.host === hostname()) rmSync(path, { recursive: true }); } catch { /* Already released. */ } };
  process.once('exit', release); return release;
};
