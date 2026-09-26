import type { DatabaseSync } from 'node:sqlite';
import { enqueue, putRecord } from './db';
import { NS, privateReceipt, publicAcknowledgment, publicTipActivity, supportParts, type Support } from './model';

export const queueSupport = (db: DatabaseSync, s: Support, ownerDid: string) => {
  putRecord(db, 'support', s.id, s);
  for (const part of supportParts(s)) {
    enqueue(db, 'private', `${NS}.support`, part.id, privateReceipt(part));
    if (part.visibility === 'public') enqueue(db, 'public', `${NS}.acknowledgment`, part.id, publicAcknowledgment(part, ownerDid));
    if (part.activityId && (part.visibility === 'public' || part.announceAnonymously)) enqueue(db, 'public', `${NS}.activity`, part.activityId, publicTipActivity(part, ownerDid));
  }
};
