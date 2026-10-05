import type { DatabaseSync } from 'node:sqlite';
import { enqueue, putRecord, getKv, readRecord } from './db';
import { NS, LEGACY_NS, privateReceipt, publicAcknowledgment, publicTipActivity, supportParts, type Support, type Project } from './model';

export const queueSupport = (db: DatabaseSync, s: Support, ownerDid: string) => {
  putRecord(db, 'support', s.id, s);
  for (const part of supportParts(s)) {
    const managed = Boolean(s.picks || readRecord<Project>(db, 'project', part.projectId)?.libcard);
    enqueue(db, 'private', `${NS}.support`, part.id, privateReceipt(part));
    if (managed) continue;
    if (getKv(db, 'app', 'legacy-payment-projections')) {
      if (part.visibility === 'public') enqueue(db, 'public', `${LEGACY_NS}.acknowledgment`, part.id, null);
      if (part.activityId && (part.visibility === 'public' || part.announceAnonymously)) enqueue(db, 'public', `${LEGACY_NS}.activity`, part.activityId, null);
    }

    if (part.visibility === 'public') enqueue(db, 'public', `${NS}.acknowledgment`, part.id, publicAcknowledgment(part, ownerDid));
    if (part.activityId && (part.visibility === 'public' || part.announceAnonymously)) enqueue(db, 'public', `${NS}.activity`, part.activityId, publicTipActivity(part, ownerDid));
  }
};
