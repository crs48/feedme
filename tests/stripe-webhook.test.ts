import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import type { DatabaseSync } from 'node:sqlite';
import type Stripe from 'stripe';
import type { Support } from '../src/lib/model';
let db: DatabaseSync;
const mock = vi.hoisted(() => ({ own: false, badSignature: false, event: undefined as Stripe.Event | undefined, payments: vi.fn(), paymentIntent: vi.fn(), invoice: vi.fn(), subscription: vi.fn() }));
vi.mock('../src/lib/config', () => ({ config: () => ({ stripeMode: mock.own ? 'own-account' : 'connect', stripeAccountId: 'acct_creator', demo: false, stripeKey: 'rk_test_fixture', stripeWebhookSecret: 'whsec_test', ownerDid: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' }) }));
vi.mock('../src/lib/db', async (original) => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => db }));
vi.mock('../src/lib/payments', async (original) => ({ ...await original<typeof import('../src/lib/payments')>(), connectedAccount: () => 'acct_creator', stripeClient: () => ({
  webhooks: { constructEvent: () => { if (mock.badSignature) throw new Error('invalid signature'); return mock.event; } }, invoicePayments: { list: mock.payments }, paymentIntents: { retrieve: mock.paymentIntent }, invoices: { retrieve: mock.invoice }, subscriptions: { retrieve: mock.subscription },
}) }));
import { openDatabase, putRecord, readRecord, listRecords, setKv } from '../src/lib/db';
import { POST } from '../src/pages/api/stripe/webhook';
import { netSupport } from '../src/lib/model';
import { invoiceSupportId } from '../src/lib/recurring';
const root: Support = { id: 'root', projectId: 'sauna', amount: 3000, frequency: 'yearly', currency: 'usd', visibility: 'private', supporterDid: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', note: '', status: 'pending', refundedAmount: 0, disputed: false, accountId: 'acct_creator', createdAt: '2026-09-26T01:00:00Z' };
const invoice = { id: 'in_first', total: 3000, amount_due: 3000, amount_paid: 3000, currency: 'usd', customer: 'cus_one', billing_reason: 'subscription_create', status: 'paid', created: 100, status_transitions: { paid_at: 100 }, parent: { subscription_details: { subscription: 'sub_one', metadata: { feedme_support_id: root.id } } } } as unknown as Stripe.Invoice;
const deliver = async (id: string, type: string, object: unknown) => {
  mock.event = { id, type, livemode: false, created: 100, ...(mock.own ? {} : { account: 'acct_creator' }), data: { object } } as Stripe.Event;
  return POST({ request: new Request('https://feedme.example/api/stripe/webhook', { method: 'POST', body: '{}' }) } as APIContext);
};
describe('connected-account recurring webhook routing', () => {
  beforeEach(() => {
    mock.own = false; mock.badSignature = false; db = openDatabase(':memory:'); putRecord(db, 'support', root.id, root);
    mock.payments.mockReset().mockResolvedValue({ data: [{ invoice: 'in_first', amount_paid: 3000, currency: 'usd', payment: { type: 'payment_intent', payment_intent: 'pi_first' } }], has_more: false });
    mock.paymentIntent.mockReset().mockResolvedValue({ status: 'succeeded', amount_received: 3000, currency: 'usd', customer: 'cus_one', metadata: {} });
    mock.invoice.mockReset().mockResolvedValue(invoice); mock.subscription.mockReset();
  });
  afterEach(() => { db.close(); vi.restoreAllMocks(); });
  it('processes own-account invoices without a Connect header and deduplicates delivery', async () => {
    mock.own = true; setKv(db, 'app', 'stripe-binding', { accountId: 'acct_creator', mode: 'own-account', livemode: false });
    await deliver('evt_own', 'invoice.paid', invoice); await deliver('evt_own', 'invoice.paid', invoice);
    expect(readRecord<Support>(db, 'support', root.id)?.status).toBe('paid');
    expect(mock.payments.mock.calls[0][1]).toEqual({});
    expect(listRecords<Support>(db, 'support')).toHaveLength(1);
  });
  it('rejects malformed signatures before any payment mutation', async () => {
    mock.badSignature = true;
    expect((await deliver('evt_invalid', 'invoice.paid', invoice)).status).toBe(400);
    expect(mock.payments).not.toHaveBeenCalled();
    expect(readRecord<Support>(db, 'support', root.id)?.status).toBe('pending');
  });
  it('verifies invoice payments before applying the signed event and deduplicates redelivery', async () => {
    expect((await deliver('evt_paid', 'invoice.paid', invoice)).status).toBe(200);
    expect((await deliver('evt_paid', 'invoice.paid', invoice)).status).toBe(200);
    expect(readRecord<Support>(db, 'support', root.id)).toMatchObject({ status: 'paid', invoiceId: 'in_first', paymentIntentId: 'pi_first', frequency: 'yearly' });
    expect(listRecords<Support>(db, 'support').reduce((sum, s) => sum + netSupport(s), 0)).toBe(3000);
  });
  it('asks Stripe to retry when a refund precedes its renewal ledger entry, then applies it to that invoice only', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await deliver('evt_first', 'invoice.paid', invoice);
    const renewal = { ...invoice, id: 'in_next', billing_reason: 'subscription_cycle' } as Stripe.Invoice;
    mock.invoice.mockResolvedValue(renewal);
    mock.payments.mockResolvedValue({ data: [{ invoice: 'in_next', amount_paid: 3000, currency: 'usd', payment: { type: 'payment_intent', payment_intent: 'pi_next' } }], has_more: false });
    const charge = { id: 'ch_next', payment_intent: 'pi_next', amount_refunded: 3000, currency: 'usd', metadata: {} };
    expect((await deliver('evt_refund', 'charge.refunded', charge)).status).toBe(500);
    expect((await deliver('evt_renewal', 'invoice.paid', renewal)).status).toBe(200);
    expect((await deliver('evt_refund', 'charge.refunded', charge)).status).toBe(200);
    expect(readRecord<Support>(db, 'support', invoiceSupportId(root.id, renewal))?.status).toBe('refunded');
    expect(readRecord<Support>(db, 'support', root.id)?.status).toBe('paid');
  });
  it('leaves contributions pending when payment verification is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mock.paymentIntent.mockRejectedValueOnce(new Error('provider unavailable'));
    expect((await deliver('evt_paid', 'invoice.paid', invoice)).status).toBe(500);
    expect(readRecord<Support>(db, 'support', root.id)?.status).toBe('pending');
    expect(db.prepare('SELECT * FROM events').all()).toHaveLength(0);
  });
  it('uses the latest subscription snapshot for delayed update events', async () => {
    const subscription = { id: 'sub_one', customer: 'cus_one', metadata: { feedme_support_id: root.id }, status: 'active', cancel_at_period_end: false, items: { data: [{ current_period_end: 200 }] } };
    mock.subscription.mockResolvedValue({ ...subscription, cancel_at_period_end: true });
    expect((await deliver('evt_update', 'customer.subscription.updated', subscription)).status).toBe(200);
    expect(readRecord(db, 'subscription', root.id)).toHaveProperty('cancelAtPeriodEnd', true);
    expect(mock.subscription).toHaveBeenCalledWith('sub_one', {}, { stripeAccount: 'acct_creator' });
  });
});
