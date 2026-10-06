import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import type { DatabaseSync } from 'node:sqlite';
import type Stripe from 'stripe';
const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined, demo: false, user: undefined as { did: string } | undefined, checkout: vi.fn() }));
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: state.demo, libcard: { repo: 'test/card', ref: 'main' }, tipAmounts: [1100,2200,4400,8800], defaultTipAmount: 2200, origin: 'https://feedme.example' }) }));
vi.mock('../src/lib/db', async original => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => state.db! }));
vi.mock('../src/lib/auth', async original => ({ ...await original<typeof import('../src/lib/auth')>(), currentUser: () => state.user, cookieOptions: () => ({ path: '/' }), randomToken: () => 'browser-secret' }));
vi.mock('../src/lib/payments', () => ({ checkout: state.checkout }));
import { openDatabase, putRecord, readRecord, setKv, listRecords } from '../src/lib/db';
import { demoProfile } from '../src/lib/seed';
import { libcardFixture } from '../src/lib/libcard-fixture';
import { parseLibcard } from '../src/lib/libcard-schema';
import { importLibcard, libcardTargets, overrideLibcard } from '../src/lib/libcard';
import { createPickForm, pickFormValues, identifyPickReview, readPickReview } from '../src/lib/pick-checkout';
import { POST as reviewPost } from '../src/pages/api/checkout/review';
import { POST as checkoutPost } from '../src/pages/api/checkout';
import { safeReturnPath } from '../src/lib/http';
import { publicLibcard } from '../src/lib/libcard-public';
import { applyBillingEvent } from '../src/lib/recurring';
import type { Support } from '../src/lib/model';
let jar: Map<string, string>;
const ctx = (data: Record<string,string> = {}): APIContext => ({
  request: new Request('https://feedme.example/api/checkout', { method: 'POST', body: new URLSearchParams(data) }),
  cookies: { get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined, set: (name: string, value: string) => jar.set(name,value) },
  redirect: (url: string, status: number) => new Response(null, { status, headers: { location: url } }),
}) as unknown as APIContext;
const fields = (extra: Record<string,string> = {}) => ({
  requestId: createPickForm(ctx(), libcardTargets().map(p => p.id)),
  amount: '22', frequency: 'once', visibility: 'anonymous', intent: 'review', note: 'Private encouragement',
  ...Object.fromEntries(libcardTargets().map(p => [`pick:${p.id}`, p.id === 'creator' ? '1' : '0'])), ...extra,
});
const review = async (extra: Record<string,string> = {}) => {
  const response = await reviewPost(ctx(fields(extra)));
  const url = new URL(response.headers.get('location')!, 'https://feedme.example');
  expect(url.pathname).toBe('/checkout/review');
  return url.searchParams.get('token')!;
};
beforeEach(() => {
  state.db = openDatabase(':memory:'); state.demo = false; state.user = undefined; state.checkout.mockReset().mockResolvedValue('https://checkout.stripe.com/example'); jar = new Map();
  putRecord(state.db!, 'profile', 'self', demoProfile);
  const source = { repo: 'test/card', ref: 'main' };
  importLibcard(state.db!, { source, document: parseLibcard(libcardFixture, source), hash: 'a'.repeat(64), checkedAt: new Date().toISOString() });
});
afterEach(() => state.db!.close());

describe('browser-bound pick checkout', () => {
  it('uses ordinary form fields and server-side shortcuts without resetting amount or note', async () => {
    const all = pickFormValues(ctx(), await ctx(fields({ amount: '44', intent: 'all' })).request.formData());
    expect(all.picks).toHaveLength(6); expect(all.picks.every(p => p.count === 1)).toBe(true); expect(all.amount).toBe(4400); expect(all.note).toBe('Private encouragement');
    const creator = pickFormValues(ctx(), await ctx(fields({ intent: 'creator', 'pick:x': '9' })).request.formData());
    expect(creator.picks).toEqual([{ projectId: 'creator', count: 1 }]);
    const amount = pickFormValues(ctx(), await ctx(fields({ intent: 'amount-8800', 'pick:x': '3' })).request.formData());
    expect(amount.amount).toBe(8800); expect(amount.picks.find(p => p.projectId === 'x')?.count).toBe(3);
    const empty = await reviewPost(ctx(fields({ 'pick:creator': '0' }))); expect(empty.headers.get('location')).toContain('Pick%20at%20least'); expect(state.checkout).not.toHaveBeenCalled();
  });
  it('freezes reviewed cents, notes, privacy, frequency and picks before contacting Stripe', async () => {
    const id = await review({ 'pick:presence': '3', frequency: 'monthly' });
    expect(listRecords(state.db!, 'support')).toEqual([]); expect(state.checkout).not.toHaveBeenCalled();
    const response = await checkoutPost(ctx({ reviewId: id, amount: '999', visibility: 'public', note: 'tampered', 'pick:creator': '9' }));
    expect(response.headers.get('location')).toContain('checkout.stripe.com');
    const payment = readRecord<Support>(state.db!, 'support', id)!;
    expect(payment).toMatchObject({ amount: 2200, frequency: 'monthly', visibility: 'anonymous', status: 'pending', note: 'Private encouragement', picks: [{ projectId: 'creator', count: 1 }, { projectId: 'presence', count: 3 }] });
    expect(payment.allocations?.map(p => p.amount)).toEqual([550,1650]);
    expect(state.checkout.mock.calls[0][1]).toEqual([{ title: 'A tip for Alex Morgan', amount: 2200 }]);
    await checkoutPost(ctx({ reviewId: id })); expect(state.checkout).toHaveBeenCalledTimes(1);
  });
  it('binds sign-in to the original browser and review, with private data absent from return URLs', async () => {
    const id = await review({ visibility: 'public' });
    expect(safeReturnPath(`/checkout/review?token=${id}`)).toBe(`/checkout/review?token=${id}`);
    expect(safeReturnPath(`/checkout/review?token=${id}&note=secret`)).toBe('/');
    expect((await checkoutPost(ctx({ reviewId: id }))).headers.get('location')).toContain('Sign%20in');
    state.user = { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' };
    expect(identifyPickReview(ctx(), id).supporterDid).toBe(state.user.did);
    const edited = readPickReview(ctx(), id); expect(edited.picks).toEqual([{ projectId: 'creator', count: 1 }]); expect(edited.note).toBe('Private encouragement');
    await checkoutPost(ctx({ reviewId: id })); expect(readRecord<Support>(state.db!, 'support', id)?.supporterDid).toBe(state.user.did);
    state.user = { did: 'did:plc:cccccccccccccccccccccccc' };
    expect((await checkoutPost(ctx({ reviewId: id }))).headers.get('location')).toContain('Sign%20in');
  });
  it('rejects expired/wrong-browser reviews and targets archived after review without charging', async () => {
    const id = await review({ 'pick:presence': '1' });
    jar.set('feedme_checkout','different'); expect((await checkoutPost(ctx({ reviewId: id }))).headers.get('location')).toContain('expired');
    jar.set('feedme_checkout','browser-secret'); overrideLibcard(state.db!, 'presence', true);
    expect((await checkoutPost(ctx({ reviewId: id }))).headers.get('location')).toContain('no%20longer');
    state.db!.prepare("UPDATE kv SET expires=1 WHERE namespace='pick-review'").run();
    expect(() => readPickReview(ctx(), id)).toThrow('expired'); expect(state.checkout).not.toHaveBeenCalled();
  });
  it('compares original picks even when changed emphasis would allocate identical dollars', async () => {
    const id = await review(); await checkoutPost(ctx({ reviewId: id }));
    const draft = readPickReview(ctx(), id); setKv(state.db!, 'pick-review', id, { ...draft, picks: [{ projectId: 'creator', count: 9 }] }, 3600_000);
    expect((await checkoutPost(ctx({ reviewId: id }))).headers.get('location')).toContain('different%20details'); expect(state.checkout).toHaveBeenCalledTimes(1);
  });
  it('copies picks into each verified recurring payment and does not count duplicate events', async () => {
    state.user = { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' };
    const id = await review({ frequency: 'monthly', visibility: 'public', 'pick:presence': '3' }); await checkoutPost(ctx({ reviewId: id }));
    const root = readRecord<Support>(state.db!, 'support', id)!; putRecord(state.db!, 'support', id, { ...root, accountId: 'acct_one' });
    for (const [n, billing_reason] of ['subscription_create','subscription_cycle'].entries()) {
      const invoice = { id: `in_${n}`, billing_reason, parent: { subscription_details: { metadata: { feedme_support_id: id }, subscription: 'sub_one' } }, customer: 'cus_one', total: 2200, amount_due: 2200, amount_paid: 2200, currency: 'usd', status: 'paid', created: 1_800_000_000 + n, status_transitions: { paid_at: 1_800_000_000 + n } };
      const event = { id: `evt_${n}`, type: 'invoice.paid', account: 'acct_one', data: { object: invoice } } as unknown as Stripe.Event;
      const provider = { payment: { invoiceId: invoice.id, paymentIntentId: `pi_${n}`, amount: 2200, currency: 'usd', customerId: 'cus_one' } };
      applyBillingEvent(state.db!, event, 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', provider); applyBillingEvent(state.db!, event, 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', provider);
    }
    const payments = listRecords<Support>(state.db!, 'support'); expect(payments).toHaveLength(2); expect(payments.every(p => JSON.stringify(p.picks) === JSON.stringify(root.picks))).toBe(true);
    const signal = publicLibcard('Alex','https://feedme.example',2200,libcardTargets(),payments);
    expect(signal.targets[0]).toMatchObject({ publicCount: 2, publicShareMillis: 250 }); expect(signal.targets[1]).toMatchObject({ publicCount: 2, publicShareMillis: 750 });
  });
});
