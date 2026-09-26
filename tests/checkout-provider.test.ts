import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Support } from '../src/lib/model';
let db: DatabaseSync;
const mock = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn() }));
vi.mock('stripe', () => ({ default: class { accounts = { retrieve: mock.retrieve }; checkout = { sessions: { create: mock.create } }; } }));
vi.mock('../src/lib/config', () => ({ config: () => ({ stripeKey: 'sk_test_fixture', origin: 'https://feedme.example' }) }));
vi.mock('../src/lib/habitat', () => ({ privateSpace: () => 'space' }));
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
  it('preserves a webhook that settles the payment before the Checkout response returns', async () => {
    mock.create.mockImplementation(async () => {
      putRecord(db, 'support', intent.id, { ...readRecord<Support>(db, 'support', intent.id)!, status: 'paid', paymentIntentId: 'pi_one' });
      return { id: 'cs_one', url: 'https://checkout.stripe.com/one' };
    });
    await checkout(intent, items);
    expect(readRecord<Support>(db, 'support', intent.id)).toMatchObject({ status: 'paid', checkoutId: 'cs_one', paymentIntentId: 'pi_one' });
  });
  it('rejects line items that do not add up to the stored total before contacting Stripe', async () => {
    await expect(checkout(intent, [{ title: 'Sauna', amount: 999 }])).rejects.toThrow('match the total');
    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.retrieve).not.toHaveBeenCalled();
  });
});
