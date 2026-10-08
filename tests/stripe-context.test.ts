import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { DatabaseSync } from 'node:sqlite';
const cfg = vi.hoisted(() => ({ stripeMode: 'own-account', stripeAccountId: 'acct_creator', stripeKey: 'rk_test_fixture', stripeEnvironment: 'test' }));
vi.mock('../src/lib/config', () => ({ config: () => cfg }));
import { openDatabase, getKv, setKv, putRecord } from '../src/lib/db';
import { assertStripeBinding, merchantEvent, paymentAccount, stripeLiveMode, stripeRequestOptions, verifyStripeAccount } from '../src/lib/stripe-context';
import { parsePortableValue } from '../src/lib/recovery-model';
import { validateRecoveryRelations } from '../src/lib/recovery-import';
let db: DatabaseSync;
const event = (changes = {}) => ({ id: 'evt_one', type: 'checkout.session.completed', livemode: false, data: { object: {} }, ...changes }) as Stripe.Event;
const binding = { accountId: 'acct_creator', mode: 'own-account', livemode: false };
describe('Stripe merchant and environment isolation', () => {
  beforeEach(() => { db = openDatabase(':memory:'); Object.assign(cfg, { stripeMode: 'own-account', stripeAccountId: 'acct_creator', stripeKey: 'rk_test_fixture', stripeEnvironment: 'test' }); });
  afterEach(() => db.close());
  it('retrieves the authenticated key owner and pins a recoverable binding before checkout', async () => {
    const retrieve = vi.fn(async () => ({ id: 'acct_creator' }));
    await verifyStripeAccount({ accounts: { retrieve } } as unknown as Stripe, paymentAccount(db)!, db, true);
    expect(retrieve).toHaveBeenCalledWith(null, {}, { timeout: 5000, maxNetworkRetries: 0 });
    expect(getKv(db, 'app', 'stripe-binding')).toEqual(binding);
    expect(getKv(db, 'app', 'stripe-account')).toBe('acct_creator');
    expect(stripeRequestOptions('acct_creator')).toEqual({});
    expect(parsePortableValue({ table: 'kv', kind: 'app', key: 'stripe-binding' }, { ...binding, key: 'must-not-be-exported' })).toEqual(binding);
    expect(db.prepare("SELECT key FROM recovery_dirty WHERE key='stripe-binding'").all()).toHaveLength(1);
  });
  it('does not bind a key for a different account, even with a ready provider response', async () => {
    const retrieve = vi.fn(async () => ({ id: 'acct_other', charges_enabled: true, payouts_enabled: true }));
    await expect(verifyStripeAccount({ accounts: { retrieve } } as unknown as Stripe, 'acct_creator', db, true)).rejects.toThrow('different account');
    expect(getKv(db, 'app', 'stripe-binding')).toBeUndefined();
    expect(() => stripeRequestOptions('acct_other')).toThrow('does not match');
  });
  it('allows key rotation within a binding and rejects changes of environment, account or mode', () => {
    setKv(db, 'app', 'stripe-binding', binding);
    cfg.stripeKey = 'sk_test_rotated'; expect(assertStripeBinding(db, 'acct_creator')).toEqual(binding);
    cfg.stripeKey = 'rk_live_rotated'; expect(() => stripeLiveMode()).toThrow('environment');
    cfg.stripeEnvironment = 'live'; expect(() => assertStripeBinding(db, 'acct_creator')).toThrow('different Stripe');
    cfg.stripeKey = 'rk_test_fixture'; cfg.stripeEnvironment = 'test';
    expect(() => assertStripeBinding(db, 'acct_other')).toThrow('different Stripe');
    cfg.stripeMode = 'connect'; expect(() => assertStripeBinding(db, 'acct_creator')).toThrow('different Stripe');
  });
  it('does not silently convert a legacy Connect database into an own-account installation', () => {
    setKv(db, 'app', 'stripe-account', 'acct_creator');
    expect(() => assertStripeBinding(db, 'acct_creator')).toThrow('different Stripe');
    cfg.stripeMode = 'connect';
    expect(assertStripeBinding(db, 'acct_creator').mode).toBe('connect');
    expect(stripeRequestOptions('acct_creator')).toEqual({ stripeAccount: 'acct_creator' });
  });
  it('requires a pinned own-account binding and ignores Connect or wrong-environment events', () => {
    expect(merchantEvent(event(), db, 'acct_creator')).toBeUndefined();
    setKv(db, 'app', 'stripe-binding', binding);
    expect(merchantEvent(event(), db, 'acct_creator')?.account).toBe('acct_creator');
    expect(merchantEvent(event({ livemode: true }), db, 'acct_creator')).toBeUndefined();
    expect(merchantEvent(event({ account: 'acct_creator' }), db, 'acct_creator')).toBeUndefined();
  });
  it('requires the expected account header for signed Connect events', () => {
    cfg.stripeMode = 'connect';
    expect(merchantEvent(event(), db, 'acct_creator')).toBeUndefined();
    expect(merchantEvent(event({ account: 'acct_other' }), db, 'acct_creator')).toBeUndefined();
    expect(merchantEvent(event({ account: 'acct_creator' }), db, 'acct_creator')?.id).toBe('evt_one');
    expect(merchantEvent(event({ account: 'acct_creator', livemode: true }), db, 'acct_creator')).toBeUndefined();
  });
  it('rejects an inconsistent restored account binding', () => {
    putRecord(db, 'profile', 'self', { id: 'self' });
    setKv(db, 'app', 'stripe-binding', binding); setKv(db, 'app', 'stripe-account', 'acct_other');
    expect(() => validateRecoveryRelations(db)).toThrow('Recovered Stripe binding');
  });
});
