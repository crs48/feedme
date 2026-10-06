import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Support } from '../src/lib/model';
let db: DatabaseSync;
const mock = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn(), portal: vi.fn(), protect: vi.fn() }));
vi.mock('stripe', () => ({ default: class { accounts = { retrieve: mock.retrieve }; billingPortal = { configurations: { create: mock.portal } }; checkout = { sessions: { create: mock.create } }; } }));
vi.mock('../src/lib/config', () => ({ config: () => ({ stripeKey: 'sk_test_fixture', origin: 'https://feedme.example' }) }));
vi.mock('../src/lib/habitat', () => ({ privateSpace: () => 'space', protectCheckoutIntent: mock.protect }));
vi.mock('../src/lib/db', async (original) => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => db }));
import { openDatabase, putRecord, readRecord, setKv } from '../src/lib/db';
import { checkout } from '../src/lib/payments';
const intent: Support = { id: 'tip-1', projectId: 'sauna', amount: 1000, currency: 'usd', visibility: 'anonymous', note: 'A private note', status: 'pending', refundedAmount: 0, disputed: false, createdAt: '2026-09-25T12:00:00Z', allocations: [
  { projectId: 'sauna', amount: 667, activityId: 'a' }, { projectId: 'writing', amount: 333, activityId: 'b' },
] };
const items = [{ title: 'Sauna', amount: 667 }, { title: 'Writing', amount: 333 }];
describe('split Stripe Checkout contract', () => {
  beforeEach(() => {
    db = openDatabase(':memory:'); setKv(db, 'app', 'stripe-account', 'acct_creator');
    mock.protect.mockReset().mockResolvedValue(undefined);
    mock.portal.mockReset().mockResolvedValue({ id: 'bpc_test', login_page: { url: 'https://billing.stripe.com/test' } });
    mock.retrieve.mockReset().mockResolvedValue({ charges_enabled: true, payouts_enabled: true });
    mock.create.mockReset().mockResolvedValue({ id: 'cs_one', url: 'https://checkout.stripe.com/one' });
  });
  afterEach(() => db.close());
  it('creates one connected-account session with exact line items and the parent payment reference', async () => {
    await expect(checkout(intent, items)).resolves.toBe('https://checkout.stripe.com/one');
    const [params, options] = mock.create.mock.calls[0];
    expect(params.line_items.map((line: { price_data: { unit_amount: number } }) => line.price_data.unit_amount)).toEqual([667, 333]);
    expect(params.metadata).toEqual({ feedme_support_id: 'tip-1' });
    expect(params.payment_intent_data.metadata).toEqual(params.metadata);
    expect(options).toEqual({ stripeAccount: 'acct_creator', idempotencyKey: 'feedme-checkout-tip-1' });
    expect(params.cancel_url).toMatch(/^https:\/\/feedme.example\/\?/);
    expect(JSON.stringify(params)).not.toContain('A private note');
    expect(readRecord<Support>(db, 'support', intent.id)?.status).toBe('pending');
  });
  it.each([['monthly', 'month'], ['yearly', 'year']] as const)('creates %s subscriptions with exact recurring prices and cancellation management', async (frequency, interval) => {
    await checkout({ ...intent, frequency }, items);
    const [params, options] = mock.create.mock.calls[0];
    expect(params.mode).toBe('subscription');
    expect(params.subscription_data.metadata).toEqual({ feedme_support_id: intent.id });
    expect(params).not.toHaveProperty('payment_intent_data');
    expect(params.line_items.map((line: { price_data: unknown }) => line.price_data)).toEqual(items.map((item) => ({ currency: 'usd', unit_amount: item.amount, recurring: { interval }, product_data: { name: `Support: ${item.title}` } })));
    expect(options.stripeAccount).toBe('acct_creator');
    expect(mock.portal.mock.calls[0][0]).toMatchObject({ login_page: { enabled: true }, features: { subscription_cancel: { enabled: true, mode: 'at_period_end' }, subscription_update: { enabled: false } } });
    expect(mock.portal.mock.calls[0][1].stripeAccount).toBe('acct_creator');
    expect(readRecord<Support>(db, 'support', intent.id)?.status).toBe('pending');
  });
  it('charges one creator item for 100 recurring picks and returns cancellations to review', async () => {
    const picks = Array.from({ length: 100 }, (_, i) => ({ projectId: `target-${i}`, count: 1 }));
    const gift = { ...intent, frequency: 'monthly' as const, picks, allocations: picks.map(p => ({ projectId: p.projectId, amount: 10, activityId: p.projectId })) };
    await checkout(gift, [{ title: 'A tip for Alex', amount: gift.amount }]);
    const params = mock.create.mock.calls[0][0];
    expect(params.line_items).toHaveLength(1); expect(params.line_items[0].price_data.unit_amount).toBe(1000);
    expect(params.cancel_url).toContain('/checkout/review?token=tip-1&notice=');
    expect(readRecord<Support>(db, 'support', gift.id)?.picks).toEqual(picks);
    expect(mock.protect).toHaveBeenCalledOnce();
  });
  it('reuses a customer only with a matching server-side browser capability', async () => {
    putRecord(db, 'support', 'older', { ...intent, id: 'older', accountId: 'acct_creator', frequency: 'monthly', subscriptionId: 'sub_old' });
    putRecord(db, 'subscription', 'older', { customerId: 'cus_old' });
    setKv(db, 'checkout-owner', intent.id, 'browser-hash');
    setKv(db, 'checkout-owner', 'older', 'another-browser');
    await checkout({ ...intent, frequency: 'yearly' }, items);
    expect(mock.create.mock.calls[0][0]).not.toHaveProperty('customer');
    setKv(db, 'checkout-owner', 'older', 'browser-hash');
    await checkout({ ...intent, frequency: 'yearly' }, items);
    expect(mock.create.mock.calls[1][0]).toHaveProperty('customer', 'cus_old');
  });
  it('rejects more than 20 recurring items without contacting Stripe', async () => {
    await expect(checkout({ ...intent, amount: 2100, frequency: 'monthly' }, Array.from({ length: 21 }, () => ({ title: 'Project', amount: 100 })))).rejects.toThrow('20 projects');
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('preserves a webhook that settles the payment before the Checkout response returns', async () => {
    mock.create.mockImplementation(async () => {
      putRecord(db, 'support', intent.id, { ...readRecord<Support>(db, 'support', intent.id)!, status: 'paid', paymentIntentId: 'pi_one' });
      return { id: 'cs_one', url: 'https://checkout.stripe.com/one' };
    });
    await checkout(intent, items);
    expect(readRecord<Support>(db, 'support', intent.id)).toMatchObject({ status: 'paid', checkoutId: 'cs_one', paymentIntentId: 'pi_one' });
  });
  it('does not create a Stripe checkout when remote intent protection fails', async () => {
    mock.protect.mockRejectedValue(new Error('Habitat unavailable'));
    await expect(checkout(intent, items)).rejects.toThrow('Habitat unavailable');
    expect(mock.create).not.toHaveBeenCalled();
    expect(readRecord<Support>(db, 'support', intent.id)?.accountId).toBe('acct_creator');
  });
  it('rejects line items that do not add up to the stored total before contacting Stripe', async () => {
    await expect(checkout(intent, [{ title: 'Sauna', amount: 999 }])).rejects.toThrow('match the total');
    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.retrieve).not.toHaveBeenCalled();
  });
});
