import { describe, expect, it } from 'vitest';
import { publicTipActivity, type Support } from '../src/lib/model';
import { supporterTimeline } from '../src/lib/support-timeline';
const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const sample: Support = { id: 'receipt-secret', activityId: 'public-id', projectId: 'sauna', amount: 2500, currency: 'usd', visibility: 'public', supporterDid: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', note: 'SECRET NOTE', status: 'paid', refundedAmount: 0, disputed: false, createdAt: '2026-09-25T12:00:00Z', checkoutId: 'cs_secret', paymentIntentId: 'pi_secret', accountId: 'acct_secret' };
describe('supporter timeline privacy', () => {
  it('publishes public tips through a strict allowlist, net of refunds', () => {
    const entry = publicTipActivity({ ...sample, refundedAmount: 500 }, owner)!;
    expect(entry.visibility === 'public' && entry.amount).toBe(2000);
    expect(Object.keys(entry).sort()).toEqual(['$type', 'amount', 'createdAt', 'currency', 'project', 'supporter', 'visibility']);
    expect(JSON.stringify(entry)).not.toMatch(/SECRET|secret|public-id/);
  });
  it('requires new explicit consent for anonymous entries and drops all identity and money fields', () => {
    expect(publicTipActivity({ ...sample, visibility: 'anonymous' }, owner)).toBeNull();
    const entry = publicTipActivity({ ...sample, visibility: 'anonymous', announceAnonymously: true }, owner)!;
    expect(Object.keys(entry).sort()).toEqual(['$type', 'createdAt', 'project', 'visibility']);
    expect(JSON.stringify(entry)).not.toMatch(/2500|bbbb|SECRET|receipt|public-id|usd/i);
    expect(publicTipActivity({ ...sample, visibility: 'anonymous', announceAnonymously: true, activityId: undefined }, owner)).toBeNull();
  });
  it('never exposes private, pending, failed, disputed, or fully refunded tips', () => {
    expect(publicTipActivity({ ...sample, visibility: 'private', announceAnonymously: true }, owner)).toBeNull();
    for (const status of ['pending', 'failed', 'refunded', 'disputed'] as const) expect(publicTipActivity({ ...sample, status }, owner)).toBeNull();
    expect(publicTipActivity({ ...sample, refundedAmount: sample.amount }, owner)).toBeNull();
  });
  it('orders newest first, paginates stably, and filters by project before paging', () => {
    const records = Array.from({ length: 30 }, (_, i) => ({ ...sample, id: `receipt-${i}`, activityId: `activity-${i}`, projectId: i % 2 ? 'other' : 'sauna', createdAt: new Date(Date.UTC(2026, 8, i + 1)).toISOString() }));
    const first = supporterTimeline(records, owner, 'sauna');
    const second = supporterTimeline(records, owner, 'sauna', 1);
    expect(first.entries).toHaveLength(12); expect(first.hasOlder).toBe(true);
    expect(second.entries).toHaveLength(3); expect(second.hasOlder).toBe(false); expect(second.hasNewer).toBe(true);
    expect(first.entries[0].createdAt).toBe(records[28].createdAt);
    expect(first.entries.every((e) => e.project.endsWith('/sauna'))).toBe(true);
  });
});
