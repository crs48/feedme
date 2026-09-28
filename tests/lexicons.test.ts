import { readdirSync, readFileSync } from 'node:fs';
import { Lexicons } from '@atproto/lexicon';
import { describe, expect, it } from 'vitest';
import { recoveryEnvelope, hashValue, CHECKPOINT, RECOVERY_INDEX } from '../src/lib/recovery-model';
import { demoFriends, demoProfile, demoProjects, demoSupports, demoUpdates } from '../src/lib/seed';
import { profileSchema, privateReceipt, publicAcknowledgment, publicTipActivity } from '../src/lib/model';

const schemas = readdirSync(new URL('../lexicons/', import.meta.url)).filter((name) => name.endsWith('.json')).map((name) => JSON.parse(readFileSync(new URL(`../lexicons/${name}`, import.meta.url), 'utf8')));
describe('wire record contracts', () => {
  it('registers every lexicon and validates the records produced by the application', () => {
    const lexicons = new Lexicons(schemas);
    const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'; const instance = '00000000-0000-4000-8000-000000000001';
    const envelope = recoveryEnvelope(owner, instance, { table: 'records', kind: 'profile', key: 'self' }, { ...demoProfile, avatar: undefined });
    const index = { $type: RECOVERY_INDEX, version: 1, owner, instance, records: [hashValue(envelope)] };
    const records = [
      envelope, index, { $type: CHECKPOINT, version: 1, owner, instance, space: 'at://did:web:pear.example/network.habitat.space/test', indexes: [hashValue(index)], count: 1, digest: 'a'.repeat(64), createdAt: '2026-09-27T12:00:00Z' },
      ...demoProjects.map((p) => ({ $type: 'fund.feedme.project', ...p })),
      { $type: 'fund.feedme.profile', ...demoProfile },
      { $type: 'fund.feedme.profile', ...profileSchema.parse({ ...demoProfile, avatar: '' }) },
      { $type: 'fund.feedme.profile', ...profileSchema.parse({ ...demoProfile, avatar: 'https://cdn.bsky.app/avatar.jpg' }) },
      ...demoFriends.map((p) => ({ $type: 'fund.feedme.recommendation', ...p })),
      ...demoUpdates.map((p) => ({ $type: 'fund.feedme.update', ...p })),
      privateReceipt(demoSupports[0]), privateReceipt({ ...demoSupports[0], frequency: 'monthly', subscriptionId: 'sub_private', invoiceId: 'in_private' }), publicAcknowledgment(demoSupports[0], 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa')!,
      publicTipActivity(demoSupports[0], 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa')!,
      publicTipActivity({ ...demoSupports[0], visibility: 'anonymous', announceAnonymously: true, activityId: 'public-id' }, 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa')!,
      { $type: 'fund.feedme.follow', subject: 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/fund.feedme.project/sauna', title: 'A sauna', createdAt: '2026-09-25T12:00:00Z' },
    ];
    for (const record of records) expect(lexicons.validate(record.$type, record).success).toBe(true);
  });
});
