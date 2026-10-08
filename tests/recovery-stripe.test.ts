import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { DatabaseSync } from 'node:sqlite';
const cfg = vi.hoisted(() => ({ stripeMode: 'connect', stripeAccountId: 'acct_one', stripeKey: 'rk_test_fixture', ownerDid: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' }));
vi.mock('../src/lib/config', () => ({ config: () => cfg }));
import { openDatabase, putRecord, readRecord, setKv, getKv } from '../src/lib/db';
import { reconcileStripe } from '../src/lib/recovery-stripe';
import type { Support } from '../src/lib/model';
import { invoiceSupportId } from '../src/lib/recurring';
let db: DatabaseSync;
const original: Support = { id: 'tip', projectId: 'sauna', amount: 1100, currency: 'usd', visibility: 'anonymous', note: 'Keep private', status: 'pending', refundedAmount: 0, disputed: false, accountId: 'acct_one', createdAt: '2026-09-25T12:00:00Z', allocations: [{ projectId: 'sauna', amount: 1100, activityId: 'activity' }] };
const iterable = (items: unknown[]) => ({ async *[Symbol.asyncIterator]() { yield* items; } });
const provider = (overrides: { sessions?: unknown[]; subscriptions?: unknown[]; invoices?: unknown[]; disputes?: unknown[]; intent?: unknown } = {}) => {
  const sessions = overrides.sessions || [{ id: 'cs_one', metadata: { feedme_support_id: 'tip' }, client_reference_id: 'tip', amount_total: 1100, currency: 'usd', mode: 'payment', payment_intent: 'pi_one', status: 'complete' }];
  const intent = overrides.intent || { id: 'pi_one', metadata: { feedme_support_id: 'tip' }, amount: 1100, amount_received: 1100, currency: 'usd', status: 'succeeded', customer: 'cus_one', latest_charge: { amount: 1100, amount_refunded: 300, paid: true, currency: 'usd', created: 1_790_337_600 } };
  return {
    accounts: { retrieve: vi.fn(async () => ({ id: 'acct_one' })) },
    checkout: { sessions: { list: vi.fn(() => iterable(sessions.map(s => ({ livemode: false, ...s as object })))) } },
    subscriptions: { list: vi.fn(() => iterable(overrides.subscriptions || [])) },
    invoices: { list: vi.fn(() => iterable(overrides.invoices || [])) },
    invoicePayments: { list: vi.fn(async () => ({ has_more: false, data: [{ invoice: 'in_next', amount_paid: 1100, currency: 'usd', payment: { type: 'payment_intent', payment_intent: 'pi_one' } }] })) },
    paymentIntents: { retrieve: vi.fn(async (..._args: unknown[]) => intent) },
    disputes: { list: vi.fn(() => iterable(overrides.disputes || [])) },
  };
};
describe('read-only Stripe recovery reconciliation', () => {
  beforeEach(() => { cfg.stripeMode = 'connect'; db = openDatabase(':memory:'); setKv(db, 'app', 'stripe-account', 'acct_one'); putRecord(db, 'support', original.id, original); });
  afterEach(() => db.close());
  it('restores own-account history using its original binding and no Connect header', async () => {
    cfg.stripeMode = 'own-account';
    setKv(db, 'app', 'stripe-binding', { accountId: 'acct_one', mode: 'own-account', livemode: false });
    const client = provider(); await reconcileStripe(db, client as unknown as Stripe);
    expect(readRecord(db, 'support', original.id)).toMatchObject({ status: 'paid', refundedAmount: 300 });
    expect(client.paymentIntents.retrieve.mock.calls[0][2]).toEqual({});
    expect(getKv(db, 'app', 'stripe-binding')).toMatchObject({ mode: 'own-account', livemode: false });
  });
  it('finds checkout/payment IDs lost after issuing Stripe Checkout and accounts for later refunds', async () => {
    const client = provider(); await reconcileStripe(db, client as unknown as Stripe);
    expect(readRecord(db, 'support', original.id)).toMatchObject({ checkoutId: 'cs_one', paymentIntentId: 'pi_one', status: 'paid', refundedAmount: 300, visibility: 'anonymous', allocations: original.allocations });
    expect(getKv(db, 'recovery', 'reconciled-at')).toBeTruthy(); expect(db.prepare('SELECT COUNT(*) AS n FROM outbox').get()?.n).toBe(0);
    expect(client.paymentIntents.retrieve.mock.calls[0][2]).toEqual({ stripeAccount: 'acct_one' });
  });
  it('fails closed on missing allocation intents or mismatched amounts', async () => {
    const missing = provider({ sessions: [{ metadata: { feedme_support_id: 'missing' } }] });
    await expect(reconcileStripe(db, missing as unknown as Stripe)).rejects.toThrow('missing');
    const wrong = provider({ intent: { amount: 999, currency: 'usd' } }); await expect(reconcileStripe(db, wrong as unknown as Stripe)).rejects.toThrow('mismatch');
    expect(getKv(db, 'recovery', 'reconciled-at')).toBeUndefined();
  });
  it('restores current dispute state, including a won dispute', async () => {
    await reconcileStripe(db, provider({ disputes: [{ id: 'dp_one', status: 'lost' }] }) as unknown as Stripe);
    expect(readRecord(db, 'support', original.id)).toMatchObject({ disputed: true, status: 'disputed' });
    await reconcileStripe(db, provider({ disputes: [{ id: 'dp_one', status: 'won' }] }) as unknown as Stripe);
    expect(readRecord(db, 'support', original.id)).toMatchObject({ disputed: false, status: 'paid' });
    expect(getKv(db, 'payment-order', 'dispute:dp_one')).toMatchObject({ closed: true });
  });
  it('rebuilds a missing renewal with stable IDs and current cancellation state', async () => {
    putRecord(db, 'support', original.id, { ...original, frequency: 'monthly' });
    const subscription = { id: 'sub_one', customer: 'cus_one', metadata: { feedme_support_id: 'tip' }, status: 'canceled', cancel_at_period_end: false, items: { data: [{ current_period_end: 123 }] } };
    const invoice = { id: 'in_next', customer: 'cus_one', parent: { subscription_details: { subscription: 'sub_one', metadata: { feedme_support_id: 'tip' } } }, billing_reason: 'subscription_cycle', total: 1100, amount_due: 1100, amount_paid: 1100, currency: 'usd', status: 'paid', created: 1_790_337_600, status_transitions: { paid_at: 1_790_337_600 } };
    const adjustment = { ...invoice, id: 'in_trial', billing_reason: 'subscription_update', total: 0, amount_due: 0, amount_paid: 0 };
    const client = provider({ sessions: [{ id: 'cs_one', metadata: { feedme_support_id: 'tip' }, client_reference_id: 'tip', amount_total: 1100, currency: 'usd', mode: 'subscription', subscription: 'sub_one', customer: 'cus_one' }], subscriptions: [subscription], invoices: [adjustment, invoice] });
    await reconcileStripe(db, client as unknown as Stripe);
    expect(client.invoicePayments.list).toHaveBeenCalledTimes(1);
    const id = invoiceSupportId('tip', { id: invoice.id, billing_reason: 'subscription_cycle' });
    expect(readRecord(db, 'support', id)).toMatchObject({ recurringRootId: 'tip', invoiceId: 'in_next', paymentIntentId: 'pi_one', status: 'paid', refundedAmount: 300, visibility: 'anonymous' });
    expect(readRecord(db, 'subscription', 'tip')).toMatchObject({ status: 'canceled' });
    const activity = readRecord<Support>(db, 'support', id)?.activityId;
    await reconcileStripe(db, client as unknown as Stripe); expect(readRecord<Support>(db, 'support', id)?.activityId).toBe(activity);
    expect(db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='support'").get()?.n).toBe(2);
  });
});
