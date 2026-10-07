import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
let db: DatabaseSync;
const mock = vi.hoisted(() => ({ create: vi.fn(), link: vi.fn() }));
vi.mock('stripe', () => ({ default: class { accounts = { create: mock.create }; accountLinks = { create: mock.link }; } }));
vi.mock('../src/lib/config', () => ({ config: () => ({ stripeKey: 'rk_test_fixture', origin: 'https://feedme.example', ownerDid: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' }) }));
vi.mock('../src/lib/db', async original => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => db }));
import { openDatabase, getKv, setKv } from '../src/lib/db';
import { connectStripe } from '../src/lib/payments';

describe('Stripe-hosted onboarding', () => {
  beforeEach(() => { db = openDatabase(':memory:'); mock.create.mockReset().mockResolvedValue({ id: 'acct_creator' }); mock.link.mockReset().mockResolvedValue({ url: 'https://connect.stripe.com/setup/example' }); });
  afterEach(() => db.close());
  it('creates a connected account once, then reuses it for fresh onboarding links', async () => {
    await connectStripe(); await connectStripe();
    expect(mock.create).toHaveBeenCalledExactlyOnceWith({ type: 'standard' }, { idempotencyKey: 'feedme-account-did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(mock.link).toHaveBeenCalledTimes(2);
    expect(mock.link.mock.calls[0][0]).toMatchObject({ account: 'acct_creator', type: 'account_onboarding' });
    expect(new URL(mock.link.mock.calls[0][0].return_url).pathname).toBe('/studio/stripe');
    expect(new URL(mock.link.mock.calls[0][0].refresh_url).pathname).toBe('/studio/stripe');
    expect(getKv(db, 'app', 'stripe-account')).toBe('acct_creator');
  });
  it('preserves a saved account when Stripe cannot issue a new link', async () => {
    setKv(db, 'app', 'stripe-account', 'acct_existing');
    mock.link.mockRejectedValue(new Error('Stripe temporarily unavailable'));
    await expect(connectStripe()).rejects.toThrow();
    expect(mock.create).not.toHaveBeenCalled();
    expect(getKv(db, 'app', 'stripe-account')).toBe('acct_existing');
  });
});
