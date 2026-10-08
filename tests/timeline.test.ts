import { describe, expect, it, vi } from 'vitest';
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
    expect(first.entries.every((e) => e.projects.some((p) => p.projectId === 'sauna'))).toBe(true);
  });
});

const split: Support = { ...sample, allocations: [
  { projectId: 'sauna', amount: 500, activityId: 'sauna-activity' },
  { projectId: 'writing', amount: 2000, activityId: 'writing-activity' },
] };

describe('payment-level supporter timeline', () => {
  it('links the confirmed shared post only to its public payment, once per split', () => {
    const uri = `at://${sample.supporterDid}/app.bsky.feed.post/3mposttest2222`;
    const sharedPost = vi.fn((s: Support) => s.id === split.id ? uri : undefined);
    const feed = supporterTimeline([split, { ...split, id: 'another-payment' }], owner, undefined, 0, 12, sharedPost);
    expect(feed.entries.filter((entry) => 'postUri' in entry)).toEqual([expect.objectContaining({ postUri: uri })]);
    expect(sharedPost).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(feed)).not.toMatch(/secret|NOTE|activity|checkout|picks/);
    expect(supporterTimeline([split], owner, 'writing', 0, 12, sharedPost).entries[0]).toHaveProperty('postUri', uri);
  });
  it('does not look up shared posts for anonymous, private, or unpaid support', () => {
    const sharedPost = vi.fn();
    const feed = supporterTimeline([
      { ...split, visibility: 'anonymous', announceAnonymously: true },
      { ...split, visibility: 'private' }, { ...split, status: 'pending' },
      { ...split, refundedAmount: split.amount }, { ...split, disputed: true },
    ], owner, undefined, 0, 12, sharedPost);
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0]).not.toHaveProperty('postUri');
    expect(sharedPost).not.toHaveBeenCalled();
  });
  it('rejects foreign or invalid post references and resolves only the visible page', () => {
    for (const uri of [undefined, `at://${owner}/app.bsky.feed.post/3mposttest2222`,
      `at://${sample.supporterDid}/fund.feedme.support/secret`, 'javascript:alert(1)']) {
      expect(supporterTimeline([split], owner, undefined, 0, 12, () => uri).entries[0]).not.toHaveProperty('postUri');
    }
    const sharedPost = vi.fn(() => undefined);
    const records = Array.from({ length: 30 }, (_, i) => ({ ...split, id: `tip-${i}` }));
    supporterTimeline(records, owner, undefined, 1, 12, sharedPost);
    expect(sharedPost).toHaveBeenCalledTimes(12);
  });
  it('shows a split payment once with its exact total and an allowlisted breakdown', () => {
    const feed = supporterTimeline([split], owner);
    expect(feed.total).toBe(1);
    expect(feed.entries).toEqual([{
      visibility: 'public', supporter: sample.supporterDid, amount: 2500, createdAt: sample.createdAt,
      projects: [{ projectId: 'sauna', amount: 500 }, { projectId: 'writing', amount: 2000 }],
    }]);
    expect(JSON.stringify(feed)).not.toMatch(/secret|NOTE|activity|checkout|picks/);
  });
  it('does not merge distinct payments from the same person at the same time', () => {
    const feed = supporterTimeline([split, { ...split, id: 'another-payment' }], owner);
    expect(feed.total).toBe(2);
    expect(feed.entries).toHaveLength(2);
  });
  it('paginates payments, and finds projects beyond the first allocation', () => {
    const records = Array.from({ length: 13 }, (_, i) => ({ ...split, id: `payment-${String(i).padStart(2, '0')}`, amount: 2500 + i,
      allocations: split.allocations!.map((part, index) => ({ ...part, amount: part.amount + (index === 0 ? i : 0) })),
    }));
    const first = supporterTimeline(records, owner, 'writing');
    const last = supporterTimeline([...records].reverse(), owner, 'writing', 1);
    expect(first.total).toBe(13);
    expect(first.entries).toHaveLength(12);
    expect(first.hasOlder).toBe(true);
    expect(last.entries).toHaveLength(1);
    expect(last.entries[0]).toMatchObject({ amount: 2500 });
    expect(last.hasNewer).toBe(true);
    expect(last.hasOlder).toBe(false);
    expect(supporterTimeline(records, owner, 'missing').total).toBe(0);
  });
  it('uses verified payment time and keeps legacy single-project tips', () => {
    const paidAt = '2026-09-26T00:00:00Z';
    const feed = supporterTimeline([sample, { ...split, id: 'later', paidAt }], owner);
    expect(feed.entries.map((e) => e.createdAt)).toEqual([paidAt, sample.createdAt]);
    expect(feed.entries[1].projects).toEqual([{ projectId: 'sauna', amount: 2500 }]);
  });
  it('keeps refunded parts consistent with the ledger and omits fully reversed tips', () => {
    const partial = { ...split, refundedAmount: 700 };
    expect(supporterTimeline([partial], owner).entries[0]).toMatchObject({ amount: 1800, projects: [{ projectId: 'writing', amount: 1800 }] });
    expect(supporterTimeline([partial], owner, 'sauna').total).toBe(0);
    for (const support of [
      { ...split, refundedAmount: 2500 }, { ...split, disputed: true },
      ...(['pending', 'failed', 'refunded', 'disputed'] as const).map((status) => ({ ...split, status })),
    ]) expect(supporterTimeline([support], owner).entries).toEqual([]);
  });
  it('groups opted-in anonymous support without revealing identity, amount, or private notes', () => {
    const anonymous: Support = { ...split, visibility: 'anonymous', announceAnonymously: true };
    const feed = supporterTimeline([anonymous], owner);
    expect(feed.entries).toEqual([{
      visibility: 'anonymous', createdAt: sample.createdAt,
      projects: [{ projectId: 'sauna' }, { projectId: 'writing' }],
    }]);
    expect(JSON.stringify(feed)).not.toMatch(/amount|2500|500|2000|bbbb|secret|NOTE|activity|supporter|picks/);
    expect(supporterTimeline([{ ...anonymous, announceAnonymously: false }], owner).total).toBe(0);
    expect(supporterTimeline([{ ...anonymous, activityId: undefined }], owner).total).toBe(0);
    expect(supporterTimeline([{ ...anonymous, visibility: 'private' }], owner).total).toBe(0);
    expect(supporterTimeline([{ ...split, supporterDid: undefined }], owner).total).toBe(0);
  });
});
