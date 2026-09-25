import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import Stripe from 'stripe';
import { applyStripeEvent } from '../src/lib/payments';
import { openDatabase, pendingWrites, putRecord, readRecord } from '../src/lib/db';
import { type Support } from '../src/lib/model';

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
});
