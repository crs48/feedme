import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import Stripe from 'stripe';
import { applyStripeEvent } from '../src/lib/payments';
import { openDatabase, pendingWrites, putRecord, readRecord } from '../src/lib/db';
import { supportParts, netSupport, type Support } from '../src/lib/model';

const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const initial: Support = { id: 'tip-1', projectId: 'sauna', amount: 2500, currency: 'usd', visibility: 'public', supporterDid: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', note: 'Private', status: 'pending', refundedAmount: 0, disputed: false, createdAt: '2026-09-25T12:00:00.000Z', accountId: 'acct_creator' };
const event = (id: string, type = 'checkout.session.completed', overrides: Record<string, unknown> = {}, created = 100) => ({
  id, type, created, account: 'acct_creator', data: { object: { id: 'cs_123', mode: 'payment', metadata: { feedme_support_id: 'tip-1' }, client_reference_id: 'tip-1', amount_total: 2500, currency: 'usd', payment_status: 'paid', payment_intent: 'pi_123', ...overrides } },
}) as unknown as Stripe.Event;

describe('verified Stripe events', () => {
  let db: DatabaseSync;
  beforeEach(() => { db = openDatabase(':memory:'); putRecord(db, 'support', initial.id, initial); });
  afterEach(() => db.close());
  const current = () => readRecord<Support>(db, 'support', initial.id)!;
  it('requires paid status; a completed but unpaid checkout remains pending', () => {
    applyStripeEvent(db, event('evt_pending', undefined, { payment_status: 'unpaid' }), owner, 'acct_creator');
    expect(current().status).toBe('pending');
    applyStripeEvent(db, event('evt_paid', 'checkout.session.async_payment_succeeded'), owner, 'acct_creator');
    expect(current().status).toBe('paid');
  });
  it('records the first verified payment time and preserves it on duplicate or failure events', () => {
    applyStripeEvent(db, event('timestamp-paid', 'checkout.session.completed', {}, 1790337600), owner, 'acct_creator');
    expect(current().paidAt).toBe('2026-09-25T12:00:00.000Z');
    applyStripeEvent(db, event('timestamp-again', 'checkout.session.completed', {}, 1790424000), owner, 'acct_creator');
    expect(current().paidAt).toBe('2026-09-25T12:00:00.000Z');
  });
  it('deduplicates deliveries and creates private and consented public writes', () => {
    expect(applyStripeEvent(db, event('evt_1'), owner, 'acct_creator')).toBe('processed');
    expect(applyStripeEvent(db, event('evt_1'), owner, 'acct_creator')).toBe('duplicate');
    expect(pendingWrites(db)).toHaveLength(2);
    expect(pendingWrites(db).find((r) => r.destination === 'public')?.value).not.toHaveProperty('note');
  });
  it.each(['anonymous', 'private'] as const)('never publishes %s support', (visibility) => {
    putRecord(db, 'support', initial.id, { ...initial, visibility });
    applyStripeEvent(db, event('evt_1'), owner, 'acct_creator');
    expect(pendingWrites(db).map((x) => x.destination)).toEqual(['private']);
  });
  it('publishes only consented anonymous activity and removes it on a full refund', () => {
    putRecord(db, 'support', initial.id, { ...initial, visibility: 'anonymous', announceAnonymously: true, activityId: 'independent-public-key' });
    applyStripeEvent(db, event('evt_anon_paid'), owner, 'acct_creator');
    const activity = pendingWrites(db).find((row) => row.collection === 'social.feedme.activity')!;
    expect(activity.rkey).toBe('independent-public-key');
    expect(Object.keys(activity.value as object).sort()).toEqual(['$type', 'createdAt', 'project', 'visibility']);
    expect(JSON.stringify(activity.value)).not.toMatch(/Private|2500|bbbb|pi_|cs_/);
    applyStripeEvent(db, event('evt_anon_refund', 'charge.refunded', { amount_refunded: 2500 }), owner, 'acct_creator');
    expect(pendingWrites(db).find((row) => row.collection === 'social.feedme.activity')?.value).toBeNull();
  });
  it('rejects a mismatched amount, currency, account, or checkout without recording the event', () => {
    for (const overrides of [{ amount_total: 50 }, { currency: 'eur' }, { mode: 'subscription' }, { client_reference_id: 'another' }]) {
      expect(() => applyStripeEvent(db, event('evt_bad', undefined, overrides), owner, 'acct_creator')).toThrow();
    }
    expect(() => applyStripeEvent(db, { ...event('evt_bad'), account: 'acct_other' }, owner, 'acct_creator')).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS count FROM events').get()).toEqual({ count: 0 });
    expect(current().status).toBe('pending');
  });
  it('does not regress a paid record when delayed failure arrives', () => {
    applyStripeEvent(db, event('evt_paid'), owner, 'acct_creator');
    applyStripeEvent(db, event('evt_failed', 'checkout.session.async_payment_failed', { payment_status: 'unpaid' }), owner, 'acct_creator');
    expect(current().status).toBe('paid');
  });
  it('applies cumulative partial refunds and never regresses on older deliveries', () => {
    applyStripeEvent(db, event('evt_paid'), owner, 'acct_creator');
    applyStripeEvent(db, event('evt_refund1', 'charge.refunded', { amount_refunded: 1500 }), owner, 'acct_creator');
    applyStripeEvent(db, event('evt_refund2', 'charge.refunded', { amount_refunded: 500 }), owner, 'acct_creator');
    expect(current().refundedAmount).toBe(1500);
    const acknowledgment = pendingWrites(db).find((r) => r.destination === 'public')?.value;
    expect(acknowledgment).toHaveProperty('amount', 1000);
  });
  it('handles a refund before checkout completion and prevents later resurrection', () => {
    applyStripeEvent(db, event('evt_refund', 'charge.refunded', { amount_refunded: 2500 }), owner, 'acct_creator');
    applyStripeEvent(db, event('evt_paid'), owner, 'acct_creator');
    expect(current().status).toBe('refunded');
    expect(pendingWrites(db).find((r) => r.destination === 'public')?.value).toBeNull();
  });
  it('honors a closed dispute even if its creation arrives later', () => {
    applyStripeEvent(db, event('evt_paid'), owner, 'acct_creator');
    applyStripeEvent(db, event('evt_close', 'charge.dispute.closed', { id: 'dp_1', status: 'won' }, 200), owner, 'acct_creator');
    applyStripeEvent(db, event('evt_open', 'charge.dispute.created', { id: 'dp_1' }, 100), owner, 'acct_creator');
    expect(current().status).toBe('paid');
    expect(current().disputed).toBe(false);
  });
  it('reconciles a dispute before Checkout using the server-retrieved intent reference', () => {
    applyStripeEvent(db, event('evt_open', 'charge.dispute.created', { id: 'dp_1' }), owner, 'acct_creator', initial.id);
    applyStripeEvent(db, event('evt_paid'), owner, 'acct_creator');
    expect(current().status).toBe('disputed');
    expect(current().paymentIntentId).toBe('pi_123');
  });
  it('never associates a missing payment intent with an unrelated pending support', () => {
    expect(() => applyStripeEvent(db, event('evt_open', 'charge.dispute.created', { payment_intent: null }), owner, 'acct_creator')).toThrow();
    expect(current().status).toBe('pending');
  });
  it('rejects a forged webhook signature using the actual Stripe verifier', () => {
    const stripe = new Stripe('sk_test_fake');
    const payload = JSON.stringify(event('evt_signed'));
    const secret = 'whsec_test';
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(stripe.webhooks.constructEvent(payload, header, secret).id).toBe('evt_signed');
    expect(() => stripe.webhooks.constructEvent(payload.replace('2500', '2501'), header, secret)).toThrow();
  });
  it('settles a split once and publishes separate project amounts without exposing the parent allocation', () => {
    putRecord(db, 'support', initial.id, { ...initial, allocations: [
      { projectId: 'sauna', amount: 1700, activityId: 'part-a' }, { projectId: 'writing', amount: 800, activityId: 'part-b' },
    ] });
    applyStripeEvent(db, event('evt_split'), owner, 'acct_creator');
    expect(applyStripeEvent(db, event('evt_split'), owner, 'acct_creator')).toBe('duplicate');
    const acks = pendingWrites(db).filter((r) => r.collection === 'social.feedme.acknowledgment');
    expect(acks.map((r) => (r.value as { amount: number }).amount)).toEqual([1700, 800]);
    expect(pendingWrites(db).filter((r) => r.destination === 'private')).toHaveLength(2);
    for (const row of pendingWrites(db).filter((r) => r.destination === 'public')) {
      expect(row.value).not.toHaveProperty('note');
      expect(row.value).not.toHaveProperty('allocations');
      expect(row.value).not.toHaveProperty('paymentIntentId');
    }
    applyStripeEvent(db, event('evt_partial_split', 'charge.refunded', { amount_refunded: 1800 }), owner, 'acct_creator');
    expect(supportParts(current()).map(netSupport)).toEqual([0, 700]);
    expect(pendingWrites(db).find((r) => r.rkey === 'part-a')?.value).toBeNull();
    applyStripeEvent(db, event('evt_old_split', 'charge.refunded', { amount_refunded: 100 }), owner, 'acct_creator');
    expect(supportParts(current()).map(netSupport)).toEqual([0, 700]);
    applyStripeEvent(db, event('evt_full_split', 'charge.refunded', { amount_refunded: 2500 }), owner, 'acct_creator');
    expect(pendingWrites(db).filter((r) => r.destination === 'public').every((r) => r.value === null)).toBe(true);
  });
  it('disputes and restores all parts together; anonymous activities omit all amounts', () => {
    putRecord(db, 'support', initial.id, { ...initial, visibility: 'anonymous', supporterDid: undefined, announceAnonymously: true, allocations: [
      { projectId: 'sauna', amount: 1700, activityId: 'anon-a' }, { projectId: 'writing', amount: 800, activityId: 'anon-b' },
    ] });
    applyStripeEvent(db, event('evt_split_paid'), owner, 'acct_creator');
    const publicRows = () => pendingWrites(db).filter((r) => r.destination === 'public');
    expect(publicRows()).toHaveLength(2);
    expect(publicRows().every((r) => Object.keys(r.value as object).sort().join() === '$type,createdAt,project,visibility')).toBe(true);
    applyStripeEvent(db, event('evt_split_disputed', 'charge.dispute.created', { id: 'dp_split' }), owner, 'acct_creator');
    expect(supportParts(current()).map(netSupport)).toEqual([0, 0]);
    expect(publicRows().every((r) => r.value === null)).toBe(true);
    applyStripeEvent(db, event('evt_split_won', 'charge.dispute.closed', { id: 'dp_split', status: 'won' }, 200), owner, 'acct_creator');
    expect(supportParts(current()).map(netSupport)).toEqual([1700, 800]);
    expect(publicRows().every((r) => r.value !== null)).toBe(true);
  });
});
