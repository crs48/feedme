import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { DatabaseSync } from 'node:sqlite';
import { applyStripeEvent } from '../src/lib/payments';
import { invoiceSupportId, recurringRefundSupportId, verifiedInvoicePayment, type Subscription, type BillingEventContext } from '../src/lib/recurring';
import { openDatabase, putRecord, readRecord, listRecords, pendingWrites } from '../src/lib/db';
import { netSupport, type Support } from '../src/lib/model';

const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const root: Support = { id: 'tip-root', projectId: 'sauna', amount: 3000, currency: 'usd', frequency: 'monthly', visibility: 'anonymous', note: 'Private encouragement', status: 'pending', refundedAmount: 0, disputed: false, createdAt: '2026-09-25T12:00:00Z', accountId: 'acct_creator', announceAnonymously: true,
  allocations: [{ projectId: 'sauna', amount: 2000, activityId: 'first-a' }, { projectId: 'writing', amount: 1000, activityId: 'first-b' }] };
const invoice = (id = 'in_first', reason = 'subscription_create', overrides = {}) => ({
  id, billing_reason: reason, parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_one', metadata: { feedme_support_id: root.id } } },
  customer: 'cus_one', total: 3000, amount_due: 3000, amount_paid: 3000, currency: 'usd', status: 'paid', created: 100, status_transitions: { paid_at: 101 }, ...overrides,
}) as unknown as Stripe.Invoice;
const event = (id: string, type: string, object: unknown, created = 100) => ({ id, type, account: 'acct_creator', created, data: { object } }) as Stripe.Event;
const verified = (invoiceId = 'in_first', paymentIntentId = 'pi_first'): BillingEventContext => ({ payment: { invoiceId, paymentIntentId, amount: 3000, currency: 'usd', customerId: 'cus_one' } });
const session = { id: 'cs_one', mode: 'subscription', metadata: { feedme_support_id: root.id }, client_reference_id: root.id, amount_total: 3000, currency: 'usd', payment_status: 'paid', subscription: 'sub_one', customer: 'cus_one' };

describe('recurring payment ledger', () => {
  let db: DatabaseSync;
  beforeEach(() => { db = openDatabase(':memory:'); putRecord(db, 'support', root.id, root); });
  afterEach(() => db.close());
  const apply = (id: string, type: string, object: unknown, context: BillingEventContext = {}, created = 100) => applyStripeEvent(db, event(id, type, object, created), owner, 'acct_creator', undefined, context);
  const amount = () => listRecords<Support>(db, 'support').reduce((sum, s) => sum + netSupport(s), 0);
  const paid = () => apply('evt_first', 'invoice.paid', invoice(), verified());
  it('never counts a subscription redirect or completed Checkout as a payment', () => {
    apply('evt_checkout', 'checkout.session.completed', session);
    expect(amount()).toBe(0);
    expect(readRecord(db, 'subscription', root.id)).toMatchObject({ customerId: 'cus_one', subscriptionId: 'sub_one' });
    paid(); expect(amount()).toBe(3000);
  });
  it('expires unpaid subscription Checkouts without removing later paid contributions', () => {
    apply('evt_expired', 'checkout.session.expired', { ...session, subscription: null, customer: null, payment_status: 'unpaid' });
    expect(readRecord<Support>(db, 'support', root.id)?.status).toBe('failed');
    paid();
    apply('evt_late_expired', 'checkout.session.expired', { ...session, payment_status: 'unpaid' });
    expect(amount()).toBe(3000);
  });
  it('accepts invoice-before-Checkout delivery, deduplicates invoice IDs across different events, and preserves each renewal split', () => {
    paid(); apply('evt_checkout', 'checkout.session.completed', session);
    apply('evt_duplicate_first', 'invoice.paid', invoice(), verified());
    const renewal = invoice('in_next', 'subscription_cycle', { created: 200, status_transitions: { paid_at: 201 } });
    apply('evt_next', 'invoice.paid', renewal, verified('in_next', 'pi_next'));
    apply('evt_duplicate_next', 'invoice.paid', renewal, verified('in_next', 'pi_next'));
    expect(amount()).toBe(6000);
    expect(listRecords(db, 'support')).toHaveLength(2);
    const second = readRecord<Support>(db, 'support', invoiceSupportId(root.id, renewal))!;
    expect(second).toMatchObject({ recurringRootId: root.id, invoiceId: 'in_next', paymentIntentId: 'pi_next', frequency: 'monthly', visibility: 'anonymous', createdAt: '1970-01-01T00:03:21.000Z' });
    expect(second.allocations?.map((part) => part.amount)).toEqual([2000, 1000]);
    expect(second.allocations?.map((part) => part.activityId)).not.toEqual(root.allocations?.map((part) => part.activityId));
    const publicWrites = pendingWrites(db).filter((row) => row.destination === 'public');
    expect(publicWrites).toHaveLength(4);
    expect(JSON.stringify(publicWrites)).not.toMatch(/Private encouragement|cus_one|sub_one|pi_first|pi_next|recurringRootId|frequency/);
  });
  it('records a failed renewal without counting it, then settles exactly once after a successful retry', () => {
    paid();
    const renewal = invoice('in_next', 'subscription_cycle');
    apply('evt_failed', 'invoice.payment_failed', { ...renewal, amount_paid: 0, status: 'open' });
    expect(amount()).toBe(3000);
    apply('evt_next', 'invoice.paid', renewal, verified('in_next', 'pi_next'));
    apply('evt_late_failed', 'invoice.payment_failed', { ...renewal, amount_paid: 0, status: 'open' });
    expect(amount()).toBe(6000);
  });
  it('refunds only the affected renewal and never resurrects it on a repeated invoice', () => {
    paid(); const renewal = invoice('in_next', 'subscription_cycle');
    apply('evt_next', 'invoice.paid', renewal, verified('in_next', 'pi_next'));
    apply('evt_refund', 'charge.refunded', { payment_intent: 'pi_next', amount_refunded: 3000, currency: 'usd' });
    apply('evt_late_paid', 'invoice.paid', renewal, verified('in_next', 'pi_next'));
    expect(amount()).toBe(3000);
    expect(readRecord<Support>(db, 'support', root.id)?.status).toBe('paid');
  });
  it('rejects forged bindings, altered amounts, unsupported adjustments, and unpaid invoices atomically', () => {
    for (const bad of [{ total: 100 }, { amount_due: 1 }, { currency: 'eur' }, { amount_paid: 0 }, { status: 'open' }, { billing_reason: 'subscription_update' }]) {
      expect(() => apply('evt_bad', 'invoice.paid', invoice('in_first', 'subscription_create', bad), verified())).toThrow();
    }
    expect(() => apply('evt_unverified', 'invoice.paid', invoice())).toThrow();
    expect(amount()).toBe(0);
    expect(readRecord(db, 'subscription', root.id)).toBeUndefined();
    paid();
    expect(() => apply('evt_bad_customer', 'checkout.session.completed', { ...session, customer: 'cus_other' })).toThrow();
    expect(() => apply('evt_bad_subscription', 'checkout.session.completed', { ...session, subscription: 'sub_other' })).toThrow();
    expect(() => apply('evt_rebound_invoice', 'invoice.paid', invoice('in_other'), verified('in_other', 'pi_other'))).toThrow();
    expect(amount()).toBe(3000);
  });
  it('preserves paid tips after cancellation and ignores late subscription state changes', () => {
    paid();
    const subscription = { id: 'sub_one', customer: 'cus_one', metadata: { feedme_support_id: root.id }, status: 'canceled', cancel_at_period_end: false, items: { data: [{ current_period_end: 200 }] } };
    apply('evt_stop', 'customer.subscription.deleted', subscription, {}, 200);
    apply('evt_old_active', 'customer.subscription.updated', { ...subscription, status: 'active' }, {}, 100);
    expect(readRecord<Subscription>(db, 'subscription', root.id)?.status).toBe('canceled');
    expect(amount()).toBe(3000);
  });
});

describe('Stripe invoice adapter', () => {
  const payment = { invoice: 'in_first', amount_paid: 3000, currency: 'usd', payment: { type: 'payment_intent', payment_intent: 'pi_first' } };
  const fixture = () => ({ invoicePayments: { list: vi.fn().mockResolvedValue({ data: [payment], has_more: false }) }, paymentIntents: { retrieve: vi.fn().mockResolvedValue({ id: 'pi_first', status: 'succeeded', amount_received: 3000, currency: 'usd', customer: 'cus_one' }) }, invoices: { retrieve: vi.fn().mockResolvedValue(invoice()) } });
  it('verifies actual invoice payments in the connected account', async () => {
    const stripe = fixture();
    await expect(verifiedInvoicePayment(stripe as unknown as Stripe, invoice(), 'acct_creator')).resolves.toEqual(verified().payment);
    expect(stripe.invoicePayments.list).toHaveBeenCalledWith({ invoice: 'in_first', status: 'paid', limit: 100 }, { stripeAccount: 'acct_creator' });
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_first', {}, { stripeAccount: 'acct_creator' });
  });
  it('rejects out-of-band payments and mismatched customers instead of publishing unpaid support', async () => {
    const stripe = fixture(); stripe.invoicePayments.list.mockResolvedValueOnce({ data: [], has_more: false });
    await expect(verifiedInvoicePayment(stripe as unknown as Stripe, invoice(), 'acct_creator')).rejects.toThrow();
    stripe.paymentIntents.retrieve.mockResolvedValueOnce({ status: 'succeeded', amount_received: 3000, currency: 'usd', customer: 'cus_other' });
    await expect(verifiedInvoicePayment(stripe as unknown as Stripe, invoice(), 'acct_creator')).rejects.toThrow();
  });
  it('finds the exact invoice for refund events arriving before its local payment record', async () => {
    const stripe = fixture(); stripe.invoices.retrieve.mockResolvedValueOnce(invoice('in_next', 'subscription_cycle'));
    await expect(recurringRefundSupportId(stripe as unknown as Stripe, 'pi_next', 'acct_creator')).resolves.toBe(invoiceSupportId(root.id, invoice('in_next', 'subscription_cycle')));
    expect(stripe.invoicePayments.list).toHaveBeenCalledWith({ payment: { type: 'payment_intent', payment_intent: 'pi_next' }, status: 'paid', limit: 100 }, { stripeAccount: 'acct_creator' });
  });
});
