import { parseArgs } from 'node:util';
import { copyFile, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { config } from '../src/lib/config';
import { acquireDataLock } from './data-lock.mjs';
import { backupKey, restoreSnapshot, performBackup } from '../src/lib/backups';
import { backupStore } from '../src/lib/backup-store';
import { getKv, openDatabase, readRecord, setKv } from '../src/lib/db';
import { reconcileStripe } from '../src/lib/recovery-stripe';
import { validateRecoveryRelations } from '../src/lib/recovery-import';
import { rememberIdentity } from '../src/lib/identity-settings';
import { didSchema } from '../src/lib/model';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { file: { type: 'string' }, object: { type: 'string' }, owner: { type: 'string' } } });
const fsync = async (path: string) => { const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); } };
const command = positionals[0];
if (!['backup', 'restore', 'list'].includes(command)) throw new Error('Usage: pnpm data backup | list | restore --file <snapshot.fmbak> --owner <did> (or --object <backup-name>). Stop the server before backup or restore.');
const cfg = config(); const store = backupStore();
if (command === 'list') {
  if (!store) throw new Error('Configure a backup destination first.');
  console.log(JSON.stringify(await store.list(), null, 2));
} else {
  const release = acquireDataLock(cfg.dataDir);
  const filename = cfg.libcardRemoteDemo ? 'demo-libcard.sqlite' : cfg.demo ? 'demo.sqlite' : 'feedme.sqlite';
  const livePath = join(cfg.dataDir, filename);
  try {
    if (command === 'backup') {
      if (!store) throw new Error('Configure a backup destination first.');
      await stat(livePath); const db = openDatabase(livePath);
      try { const owner = values.owner || cfg.ownerDid || getKv<string>(db, 'app', 'owner-did'); if (!owner) throw new Error('Supply --owner with your permanent DID.'); console.log(await performBackup(db, owner, backupKey(), store)); } finally { db.close(); }
    } else {
      const owner = didSchema.parse(values.owner || cfg.ownerDid);
      if (cfg.ownerDid && owner !== cfg.ownerDid) throw new Error('The supplied DID does not match the configured creator.');
      rememberIdentity(cfg.dataDir, cfg.identities.owner, owner);
      const body = values.file ? await readFile(resolve(values.file)) : values.object && store ? await store.get(values.object) : undefined;
      if (!body) throw new Error('Supply --file or --object.');
      const directory = join(cfg.dataDir, 'recovery'); await mkdir(directory, { recursive: true, mode: 0o700 });
      const staged = join(directory, `restore-${Date.now()}.sqlite`);
      await restoreSnapshot(body, staged, owner, backupKey());
      const candidate = openDatabase(staged);
      try {
        if (getKv(candidate, 'app', 'owner-did') && getKv(candidate, 'app', 'owner-did') !== owner) throw new Error('The database owner does not match the backup envelope.');
        if (!readRecord(candidate, 'profile', 'self')) throw new Error('The candidate has no creator profile.');
        setKv(candidate, 'app', 'owner-did', owner);
        if (!cfg.demo) { validateRecoveryRelations(candidate); await reconcileStripe(candidate); validateRecoveryRelations(candidate); }
        setKv(candidate, 'recovery', 'paused', true); candidate.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE');
      } catch (error) { candidate.close(); await rm(staged, { force: true }); throw error; }
      candidate.close();
      // Checkpoint the stopped old database before retaining it. Moving just its main file would lose WAL data.
      let prior: string | undefined;
      try { await stat(livePath); const old = openDatabase(livePath); try { old.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE'); } finally { old.close(); } prior = join(directory, `previous-${Date.now()}.sqlite`); await copyFile(livePath, prior); await fsync(prior); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await fsync(staged); await rename(staged, livePath); await fsync(cfg.dataDir);
      console.log(`Restored for ${owner}. ${prior ? `Previous database retained at ${prior}. ` : ''}Restart Feedme, sign in as the creator, then review and resume in Dashboard → Data & backups. Payments and publishing remain paused.`);
    }
  } finally { release(); }
}
