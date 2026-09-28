import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { config } from './config';
import { habitatCall, readPrivateRecord } from './habitat';
import { CHECKPOINT, RECOVERY, RECOVERY_INDEX, checkpointSchema, indexSchema, recoveryEnvelopeSchema, parsePortableValue, hashValue, inventoryDigest, recoveryKey, type Checkpoint, type RecoveryEnvelope } from './recovery-model';
import { getDb, getKv, listRecords, openDatabase, putRecord, readRecord, setKv, transaction } from './db';
import { NS, type Support, type Project, type Update } from './model';
import type { Subscription } from './recurring';
import { backupKey, snapshotDatabase } from './backups';
import { reconcileStripe } from './recovery-stripe';

export const discoverRecoverySpaces = async () => {
  const found: { space: string; checkpoint: Checkpoint | null }[] = []; const seen = new Set<string>(); let cursor: string | undefined;
  do {
    const result = z.object({ spaces: z.array(z.object({ uri: z.string().startsWith('at://'), isOwner: z.boolean() })).max(1000), cursor: z.string().optional() }).parse(await habitatCall('network.habitat.space.listSpaces', { did: config().ownerDid, type: `${NS}.receipts`, limit: 100, cursor }, true));
    for (const item of result.spaces) if (item.isOwner && !found.some(f => f.space === item.uri)) {
      const record = await readPrivateRecord(item.uri, CHECKPOINT, 'self');
      const parsed = checkpointSchema.safeParse(record?.value);
      if (parsed.success && parsed.data.owner === config().ownerDid && parsed.data.space === item.uri) found.push({ space: item.uri, checkpoint: parsed.data });
      else found.push({ space: item.uri, checkpoint: null });
    }
    cursor = result.cursor;
    if (cursor && (seen.has(cursor) || seen.size >= 100)) throw new Error('Habitat repeated its recovery-space cursor. No partial listing was accepted.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return found;
};
export const downloadRecovery = async (space: string) => {
  const result = await readPrivateRecord(space, CHECKPOINT, 'self');
  const checkpoint = checkpointSchema.parse(result?.value);
  if (checkpoint.owner !== config().ownerDid || checkpoint.space !== space) throw new Error('Recovery checkpoint belongs to another creator or space.');
  const entries: RecoveryEnvelope[] = []; const logical = new Set<string>(); const physical = new Set<string>(); let bytes = 0;
  for (const key of checkpoint.indexes) {
    const index = indexSchema.parse((await readPrivateRecord(space, RECOVERY_INDEX, key))?.value);
    if (hashValue(index) !== key || index.owner !== checkpoint.owner || index.instance !== checkpoint.instance) throw new Error('Recovery index failed integrity validation.');
    for (const rkey of index.records) {
      if (physical.has(rkey)) throw new Error('Duplicate recovery record.'); physical.add(rkey);
      const value = recoveryEnvelopeSchema.parse((await readPrivateRecord(space, RECOVERY, rkey))?.value);
      bytes += value.json.length;
      if (bytes > 64 * 1024 * 1024) throw new Error('Recovery exceeds the 64 MiB logical-data limit.');
      if (hashValue(value) !== rkey || value.owner !== checkpoint.owner || value.instance !== checkpoint.instance) throw new Error('Recovery record failed integrity validation.');
      parsePortableValue(value, JSON.parse(value.json));
      const location = recoveryKey(value);
      if (logical.has(location)) throw new Error('Duplicate logical record in checkpoint.'); logical.add(location);
      entries.push(value);
    }
  }
  if (entries.length !== checkpoint.count || inventoryDigest(entries.map(e => ({ rkey: recoveryKey(e), digest: hashValue(e) }))) !== checkpoint.digest) throw new Error('The recovery checkpoint is incomplete.');
  return { checkpoint, entries };
};
export const validateRecoveryRelations = (db: DatabaseSync) => {
  if (!readRecord(db, 'profile', 'self')) throw new Error('Recovery has no creator profile.');
  const projects = new Set(listRecords<Project>(db, 'project').map(p => p.id));
  const supports = listRecords<Support>(db, 'support'); const payments = new Map(supports.map(s => [s.id, s]));
  const account = getKv<string>(db, 'app', 'stripe-account');
  for (const s of supports) {
    if (![s.projectId, ...(s.allocations || []).map(a => a.projectId)].every(p => projects.has(p))) throw new Error('A recovered payment refers to a missing project.');
    if (s.recurringRootId && !payments.has(s.recurringRootId)) throw new Error('A renewal has no original allocation intent.');
    if (s.accountId && account !== s.accountId) throw new Error('A recovered payment belongs to a different Stripe account.');
    if (!s.accountId && ['paid', 'refunded', 'disputed'].includes(s.status)) throw new Error('A settled payment has no Stripe account binding.');
  }
  for (const s of listRecords<Subscription>(db, 'subscription')) {
    const root = payments.get(s.id);
    if (!root || root.accountId !== s.accountId || root.subscriptionId !== s.subscriptionId || s.accountId !== account) throw new Error('Recovered subscription binding is incomplete.');
  }
  for (const u of listRecords<Update>(db, 'update')) if (!projects.has(u.projectId)) throw new Error('An update refers to a missing project.');
  for (const row of db.prepare("SELECT key FROM kv WHERE namespace='support-share-id'").all() as { key: string }[]) {
    const share = getKv<string>(db, 'support-share-id', row.key)!;
    if (!payments.has(row.key) || getKv(db, 'support-share-payment', share) !== row.key) throw new Error('A recovered public share link is incomplete.');
  }
  for (const row of db.prepare("SELECT key FROM kv WHERE namespace='support-share-payment'").all() as { key: string }[]) {
    const payment = getKv<string>(db, 'support-share-payment', row.key)!;
    if (getKv(db, 'support-share-id', payment) !== row.key) throw new Error('A recovered public share link is inconsistent.');
  }
};
export const importRecovery = (db: DatabaseSync, checkpoint: Checkpoint, entries: RecoveryEnvelope[]) => transaction(db, () => {
  if (db.prepare('SELECT 1 FROM records LIMIT 1').get()) throw new Error('Import requires an empty staging database.');
  if (checkpoint.count !== entries.length || inventoryDigest(entries.map(e => ({ rkey: recoveryKey(e), digest: hashValue(e) }))) !== checkpoint.digest) throw new Error('The recovery checkpoint is incomplete.');
  for (const entry of entries) {
    if (entry.owner !== checkpoint.owner || entry.instance !== checkpoint.instance) throw new Error('Recovery identity mismatch.');
    const value = parsePortableValue(entry, JSON.parse(entry.json));
    if (entry.table === 'records') putRecord(db, entry.kind, entry.key, value); else setKv(db, entry.kind, entry.key, value);
  }
  setKv(db, 'app', 'initialized', true); setKv(db, 'app', 'owner-did', checkpoint.owner); setKv(db, 'app', 'protocol-version', NS); setKv(db, 'app', 'private-space', checkpoint.space);
  setKv(db, 'recovery', 'instance', checkpoint.instance); setKv(db, 'recovery', 'checkpoint', checkpoint); setKv(db, 'recovery', 'paused', true);
  // Record the exact remote checkpoint from which the candidate was built.
  db.prepare("INSERT INTO sync_receipts VALUES ('private',?,?,?,?,?)").run(CHECKPOINT, 'self', hashValue(checkpoint), null, new Date().toISOString());
  validateRecoveryRelations(db);
});
export type RecoveryReport = { id: string; createdAt: string; checkpointAt: string; source: string; projects: number; payments: number; subscriptions: number; file: string; stripe: string };
export const stageHabitatRecovery = async (space: string) => {
  const key = backupKey(); // Fail before downloading private data if no recovery key is configured.
  const { checkpoint, entries } = await downloadRecovery(space);
  const root = join(config().dataDir, 'recovery'); await mkdir(root, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(join(root, '.stage-')); await chmod(temp, 0o700);
  const db = openDatabase(join(temp, 'candidate.sqlite'));
  try {
    importRecovery(db, checkpoint, entries);
    const stripe = await reconcileStripe(db);
    validateRecoveryRelations(db);
    const id = randomUUID(); const file = join(root, `${id}.fmbak`);
    const report: RecoveryReport = { id, createdAt: new Date().toISOString(), checkpointAt: checkpoint.createdAt, source: space, projects: listRecords(db, 'project').length, payments: listRecords(db, 'support').length, subscriptions: listRecords(db, 'subscription').length, file, stripe };
    setKv(db, 'recovery', 'report', report);
    await writeFile(file, await snapshotDatabase(db, config().ownerDid, key), { mode: 0o600, flag: 'wx', flush: true });
    setKv(getDb(), 'recovery', 'candidate', report);
    return report;
  } finally { db.close(); await rm(temp, { recursive: true, force: true }); }
};
