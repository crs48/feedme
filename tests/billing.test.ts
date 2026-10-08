import { createHash } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import type { DatabaseSync } from 'node:sqlite';
import type { Support } from '../src/lib/model';
let db: DatabaseSync;
const state = vi.hoisted(() => ({ demo: true, user: undefined as { did: string } | undefined, portal: vi.fn() }));
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: state.demo, stripeKey: 'rk_test_fixture', origin: 'https://feedme.example' }) }));
vi.mock('../src/lib/auth', () => ({ currentUser: () => state.user, digest: (value: string) => createHash('sha256').update(value).digest('hex') }));
vi.mock('../src/lib/db', async (original) => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => db }));
vi.mock('../src/lib/payments', () => ({ connectedAccount: () => 'acct_creator', stripeClient: () => ({ accounts: { retrieve: async () => ({ id: 'acct_creator' }) }, billingPortal: { sessions: { create: state.portal } } }) }));
vi.mock('../src/lib/billing', () => ({ ensureBillingPortal: () => ({ id: 'bpc_ours' }) }));
import { openDatabase, putRecord, readRecord, setKv } from '../src/lib/db';
import { POST } from '../src/pages/api/billing';
import { canAccessTip } from '../src/lib/tip-sharing';
const support: Support = { id: 'tip', projectId: 'sauna', amount: 1500, frequency: 'monthly', currency: 'usd', visibility: 'anonymous', note: '', status: 'paid', refundedAmount: 0, disputed: false, createdAt: '2026-09-26T01:00:00Z' };
const run = (browser = 'browser', extra = {}) => POST({
  request: new Request('https://feedme.example/api/billing', { method: 'POST', body: new URLSearchParams({ supportId: 'tip', action: 'cancel', ...extra }) }),
  cookies: { get: () => ({ value: browser }) }, redirect: (url: string, status: number) => new Response(null, { status, headers: { location: url } }),
} as unknown as APIContext);
describe('billing management authorization', () => {
  beforeEach(() => {
    db = openDatabase(':memory:'); state.demo = true; state.user = undefined; state.portal.mockReset().mockResolvedValue({ url: 'https://billing.stripe.com/session' });
    putRecord(db, 'support', 'tip', support);
    putRecord(db, 'subscription', 'tip', { id: 'tip', subscriptionId: 'sub_ours', customerId: 'cus_ours', accountId: 'acct_creator', status: 'active', cancelAtPeriodEnd: false, eventCreated: 0 });
    setKv(db, 'checkout-owner', 'tip', createHash('sha256').update('browser').digest('hex'));
  });
  afterEach(() => db.close());
  it('requires the original browser capability or named supporter identity', async () => {
    expect((await run('stranger')).headers.get('location')).toContain('Use%20the%20browser');
    expect(readRecord(db, 'subscription', 'tip')).toHaveProperty('status', 'active');
    expect(state.portal).not.toHaveBeenCalled();
    state.user = { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' };
    putRecord(db, 'support', 'tip', { ...support, visibility: 'private', supporterDid: state.user.did });
    expect((await run('another-browser')).headers.get('location')).toContain('Demo%20recurring%20support%20stopped');
  });
  it('stops demo renewals while preserving all past support', async () => {
    await run(); await run();
    expect(readRecord(db, 'subscription', 'tip')).toHaveProperty('status', 'canceled');
    expect(readRecord(db, 'support', 'tip')).toEqual(support);
  });
  it('uses server-owned customer and connected-account IDs when opening Stripe', async () => {
    state.demo = false;
    expect((await run('browser', { customerId: 'cus_victim', accountId: 'acct_victim' })).headers.get('location')).toBe('https://billing.stripe.com/session');
    expect(state.portal).toHaveBeenCalledWith({ customer: 'cus_ours', configuration: 'bpc_ours', return_url: 'https://feedme.example/billing' }, { stripeAccount: 'acct_creator' });
  });
  it('does not open a subscription belonging to another connected account', async () => {
    state.demo = false;
    putRecord(db, 'subscription', 'tip', { accountId: 'acct_other', customerId: 'cus_other' });
    expect((await run()).headers.get('location')).toContain('another%20Stripe%20account');
    expect(state.portal).not.toHaveBeenCalled();
  });
  it('lets only the original supporter read renewal receipts through their root capability', () => {
    const renewal = { ...support, id: 'renewal', recurringRootId: support.id };
    expect(canAccessTip(renewal, undefined, 'browser')).toBe(true);
    expect(canAccessTip(renewal, undefined, 'stranger')).toBe(false);
  });
});
