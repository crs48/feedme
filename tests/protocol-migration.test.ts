import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase, pendingWrites, putRecord, setKv, getKv, enqueue } from '../src/lib/db';
import { migrateProtocol } from '../src/lib/protocol-migration';
import { demoProfile, demoProjects, demoSupports } from '../src/lib/seed';
import { queueSupport } from '../src/lib/support-ledger';
import { projectTags, projectUri, sameProject } from '../src/lib/social-model';
let db: DatabaseSync;
const ownerDid = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
beforeEach(() => { db = openDatabase(':memory:'); }); afterEach(() => db.close());
describe('fund.feedme migration', () => {
  it('republishes only public records and removes stale legacy payment projections without touching private spaces', () => {
    putRecord(db, 'profile', 'self', { ...demoProfile, privateSecret: 'PRIVATE' });
    putRecord(db, 'project', demoProjects[0].id, demoProjects[0]);
    putRecord(db, 'project', 'draft', { ...demoProjects[1], id: 'draft', status: 'draft', description: 'PRIVATE' });
    const tip = { ...demoSupports[0], note: 'PRIVATE', activityId: 'activity', paymentIntentId: 'pi_PRIVATE' };
    putRecord(db, 'support', tip.id, tip);
    setKv(db, 'app', 'private-space', 'at://existing/social.feedme.receipts/original');
    enqueue(db, 'public', 'social.feedme.activity', 'orphan', { amount: 999 });
    migrateProtocol(db, { demo: false, ownerDid, origin: 'https://feedme.example' });
    const publicWrites = pendingWrites(db).filter((r) => r.destination === 'public');
    expect(JSON.stringify(publicWrites)).not.toContain('PRIVATE');
    expect(publicWrites.some((r) => r.rkey === 'draft')).toBe(false);
    expect(publicWrites.some((r) => r.collection === 'fund.feedme.profile')).toBe(false);
    expect(publicWrites.filter((r) => r.collection.startsWith('social.feedme.')).every((r) => r.value === null)).toBe(true);
    expect(getKv(db, 'app', 'private-space')).toBe('at://existing/social.feedme.receipts/original');
    const before = pendingWrites(db); migrateProtocol(db, { demo: false, ownerDid, origin: 'https://feedme.example' }); expect(pendingWrites(db)).toEqual(before);
    queueSupport(db, { ...tip, refundedAmount: tip.amount, status: 'refunded' }, ownerDid);
    expect(pendingWrites(db).filter((r) => r.collection.endsWith('.acknowledgment')).every((r) => r.value === null)).toBe(true);
  });
  it('keeps old project references and hashed post tags usable', () => {
    const canonical = projectUri(ownerDid, 'sauna'); const legacy = canonical.replace('fund.feedme', 'social.feedme');
    expect(sameProject(canonical, legacy)).toBe(true);
    expect(projectTags(canonical)).toEqual(projectTags(legacy));
    expect(projectTags(canonical)).toHaveLength(2);
  });
  it('does not publish a newly initialized or demo profile as a side effect of opening the database', () => {
    putRecord(db, 'profile', 'self', demoProfile);
    migrateProtocol(db, { demo: false, ownerDid, origin: 'https://feedme.example' });
    expect(pendingWrites(db)).toEqual([]);
  });
});
