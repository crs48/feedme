import { config } from './config';
import { enqueue, getDb, getKv, readRecord, listRecords, setKv, transaction } from './db';
import { downloadRecovery, validateRecoveryRelations } from './recovery-import';
import { CHECKPOINT, hashValue, type Checkpoint } from './recovery-model';
import { privateSpace, readPrivateRecord } from './habitat';
import { reconcileStripe } from './recovery-stripe';
import { NS, projectSchema, updateSchema, friendSchema, type Support, type Project } from './model';
import { queueSupport } from './support-ledger';

export type VerificationStatus = { attemptedAt: string; verifiedAt?: string; error?: string };
let verification: Promise<VerificationStatus | undefined> | undefined;
export const verifyRecovery = (force = false) => verification ??= verify(force).finally(() => { verification = undefined; });
const verify = async (force: boolean): Promise<VerificationStatus | undefined> => {
  const db = getDb(); const space = privateSpace(); if (config().demo || !space || getKv(db, 'recovery', 'paused')) return;
  const checkpoint = getKv<Checkpoint>(db, 'recovery', 'checkpoint'); if (!checkpoint) return;
  const previous = getKv<VerificationStatus>(db, 'recovery', 'verification');
  if (!force && previous && Date.now() - Date.parse(previous.attemptedAt) < (previous.error ? 3600_000 : 86400_000)) return previous;
  const attemptedAt = new Date().toISOString();
  try {
    const remote = await downloadRecovery(space);
    const current = getKv<Checkpoint>(db, 'recovery', 'checkpoint');
    if (hashValue(current) === hashValue(checkpoint) && hashValue(remote.checkpoint) !== hashValue(checkpoint)) {
      setKv(db, 'recovery', 'paused', true);
      throw new Error('Another writer changed the recovery checkpoint. Publishing and checkout are paused.');
    }
    const status = { attemptedAt, verifiedAt: new Date().toISOString() }; setKv(db, 'recovery', 'verification', status); return status;
  } catch { const status = { ...previous, attemptedAt, error: 'Remote recovery could not be verified. Reconnect the creator account and check Habitat; inspect any other Feedme server before resuming.' }; setKv(db, 'recovery', 'verification', status); return status; }
};
let resuming: Promise<void> | undefined;
export const resumeRecovery = () => resuming ??= resume().finally(() => { resuming = undefined; });
const resume = async () => {
  const db = getDb(); if (!getKv(db, 'recovery', 'paused')) throw new Error('This server is already running.');
  const space = privateSpace(); if (!space) throw new Error('The restored database has no private Habitat space.');
  const remote = await readPrivateRecord(space, CHECKPOINT, 'self');
  const expected = getKv<Checkpoint>(db, 'recovery', 'checkpoint');
  if (remote && (!expected || hashValue(remote.value) !== hashValue(expected))) throw new Error('Habitat has a different checkpoint. Restore its latest copy before resuming this older database.');
  validateRecoveryRelations(db);
  await reconcileStripe(db); // Recheck after downtime, while webhooks and mutations are still paused.
  validateRecoveryRelations(db);
  transaction(db, () => {
    // Restoring elsewhere must not silently replace the creator's advertised site.
    for (const [kind, collection, schema] of [['project', 'project', projectSchema], ['update', 'update', updateSchema], ['friend', 'recommendation', friendSchema]] as const) {
      for (const value of listRecords(db, kind)) {
        const record = schema.parse(value); if (('status' in record && record.status === 'draft') || ('libcard' in record && record.libcard) || ('projectId' in record && readRecord<Project>(db, 'project', record.projectId)?.libcard)) continue;
        enqueue(db, 'public', `${NS}.${collection}`, record.id, { $type: `${NS}.${collection}`, ...record });
      }
    }
    for (const support of listRecords<Support>(db, 'support')) queueSupport(db, support, config().ownerDid);
    setKv(db, 'recovery', 'backfilled', false); setKv(db, 'recovery', 'paused', false); setKv(db, 'recovery', 'resumed-at', new Date().toISOString());
  });
};
