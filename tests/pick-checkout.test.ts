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
import { createPickForm, pickFormState, pickFormValues, identifyPickReview, readPickReview } from '../src/lib/pick-checkout';
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
  it.each(['anonymous', 'private', 'public'] as const)('can change a %s review to every visibility without changing the gift or charging', async from => {
    state.user = { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' };
    const id = await review({ visibility: from, amount: '20.01', frequency: 'monthly', 'pick:presence': '3', 'pick:x': '2', announceAnonymously: 'yes' });
    const original = readPickReview(ctx(), id);
    for (const visibility of ['anonymous', 'private', 'public'] as const) {
      const response = await reviewPost(ctx({ intent: 'visibility', editReview: id, visibility, amount: '999', frequency: 'yearly', note: 'tampered', 'pick:x': '9', announceAnonymously: 'yes' }));
      const destination = new URL(response.headers.get('location')!, 'https://feedme.example');
      expect(destination.pathname).toBe('/checkout/review');
      const nextId = destination.searchParams.get('token')!;
      expect(nextId === id).toBe(visibility === from);
      expect(readPickReview(ctx(), nextId)).toEqual({ ...original, visibility,
        supporterDid: visibility === 'anonymous' ? undefined : state.user.did,
        announceAnonymously: visibility === from ? original.announceAnonymously : false });
      expect(readPickReview(ctx(), id)).toEqual(original);
    }
    expect(listRecords(state.db!, 'support')).toEqual([]); expect(state.checkout).not.toHaveBeenCalled();
  });
  it.each(['private', 'public'] as const)('lets a guest review %s but requires sign-in before payment and permits switching back', async visibility => {
    const id = await review({ 'pick:presence': '3' });
    const changed = await reviewPost(ctx({ intent: 'visibility', editReview: id, visibility }));
    const nextId = new URL(changed.headers.get('location')!, 'https://feedme.example').searchParams.get('token')!;
    expect(readPickReview(ctx(), nextId).supporterDid).toBeUndefined();
    expect((await checkoutPost(ctx({ reviewId: nextId }))).headers.get('location')).toContain('Sign%20in');
    expect(state.checkout).not.toHaveBeenCalled();
    const anonymous = await reviewPost(ctx({ intent: 'visibility', editReview: nextId, visibility: 'anonymous' }));
    const anonymousId = new URL(anonymous.headers.get('location')!, 'https://feedme.example').searchParams.get('token')!;
    await checkoutPost(ctx({ reviewId: anonymousId }));
    expect(readRecord<Support>(state.db!, 'support', anonymousId)).toMatchObject({ visibility: 'anonymous', picks: [{ projectId: 'presence', count: 3 }] });
    expect(readRecord<Support>(state.db!, 'support', anonymousId)?.supporterDid).toBeUndefined();
  });
  it('keeps an already-started checkout frozen when visibility changes on a new review', async () => {
    const id = await review({ amount: '20', frequency: 'monthly', 'pick:x': '3' });
    await checkoutPost(ctx({ reviewId: id }));
    const original = readRecord<Support>(state.db!, 'support', id);
    state.user = { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' };
    const changed = await reviewPost(ctx({ intent: 'visibility', editReview: id, visibility: 'public' }));
    const nextId = new URL(changed.headers.get('location')!, 'https://feedme.example').searchParams.get('token')!;
    expect(nextId).not.toBe(id);
    expect(readPickReview(ctx(), nextId)).toMatchObject({ amount: 2000, frequency: 'monthly', visibility: 'public', picks: [{ projectId: 'x', count: 3 }] });
    expect(readRecord<Support>(state.db!, 'support', id)).toEqual(original);
    expect(readRecord<Support>(state.db!, 'support', nextId)).toBeUndefined();
    expect(state.checkout).toHaveBeenCalledTimes(1);
  });
  it.each(['wrong-browser', 'expired', 'unavailable'])('rejects changing visibility of a %s review', async failure => {
    const id = await review({ 'pick:presence': '3' });
    if (failure === 'wrong-browser') jar.set('feedme_checkout', 'different');
    if (failure === 'expired') state.db!.prepare("UPDATE kv SET expires=1 WHERE namespace='pick-review'").run();
    if (failure === 'unavailable') overrideLibcard(state.db!, 'presence', true);
    const response = await reviewPost(ctx({ intent: 'visibility', editReview: id, visibility: 'public' }));
    expect(response.headers.get('location')).toMatch(/^\/checkout\?error=/);
    expect(state.db!.prepare("SELECT count(*) AS count FROM kv WHERE namespace='pick-review' AND key!=?").get(id)).toEqual({ count: 0 });
    expect(state.checkout).not.toHaveBeenCalled();
  });
  it('rejects invalid and duplicate visibility choices', async () => {
    const id = await review();
    for (const visibility of ['', 'friends', 'PUBLIC']) expect((await reviewPost(ctx({ intent: 'visibility', editReview: id, visibility }))).headers.get('location')).toContain('valid%20privacy');
    for (const field of ['intent', 'editReview', 'visibility']) {
      const form = new URLSearchParams({ intent: 'visibility', editReview: id, visibility: 'public' }); form.append(field, 'anonymous');
      const context = ctx(); context.request = new Request('https://feedme.example/api/checkout/review', { method: 'POST', body: form });
      expect((await reviewPost(context)).headers.get('location')).toContain('each%20form%20field%20once');
    }
    expect(readPickReview(ctx(), id).visibility).toBe('anonymous'); expect(state.checkout).not.toHaveBeenCalled();
  });
  it('restores exact picks after no preference, keeping current amount, schedule and note', async () => {
    const cleared = pickFormState(ctx(), await ctx(fields({ intent: 'creator', 'pick:presence': '3', 'pick:x': '2' })).request.formData());
    expect(cleared.values.picks).toEqual([{ projectId: 'creator', count: 1 }]);
    expect(cleared.previousPicks).toEqual([{ projectId: 'presence', count: 3 }, { projectId: 'x', count: 2 }]);
    const requestId = createPickForm(ctx(), libcardTargets().map(p => p.id), cleared.previousPicks);
    const changed = pickFormState(ctx(), await ctx(fields({ requestId, intent: 'amount-8800' })).request.formData());
    expect(changed.previousPicks).toEqual(cleared.previousPicks);
    const repeated = pickFormState(ctx(), await ctx(fields({ requestId, intent: 'creator' })).request.formData());
    expect(repeated.previousPicks).toEqual(cleared.previousPicks);
    const restored = pickFormState(ctx(), await ctx(fields({ requestId, intent: 'undo', amount: '88', frequency: 'monthly' })).request.formData());
    expect(restored).toEqual({ previousPicks: undefined, values: { amount: 8800, frequency: 'monthly', visibility: 'anonymous', note: 'Private encouragement', announceAnonymously: false, picks: cleared.previousPicks } });
    const replacements: Record<string, string>[] = [{ intent: 'all' }, { 'pick:x': '1' }];
    for (const extra of replacements) {
      expect(pickFormState(ctx(), await ctx(fields({ requestId, ...extra })).request.formData()).previousPicks).toBeUndefined();
    }
    expect(state.checkout).not.toHaveBeenCalled();
  });
  it('binds undo to the same browser and rejects unavailable or missing pick history', async () => {
    const ids = libcardTargets().map(p => p.id);
    const requestId = createPickForm(ctx(), ids, [{ projectId: 'presence', count: 3 }]);
    const undo = await ctx(fields({ requestId, intent: 'undo' })).request.formData();
    jar.set('feedme_checkout', 'different-browser');
    expect(() => pickFormState(ctx(), undo)).toThrow('expired');
    jar.set('feedme_checkout', 'browser-secret');
    overrideLibcard(state.db!, 'presence', true);
    expect(() => pickFormState(ctx(), undo)).toThrow('target list changed');
    const missing = await ctx(fields({ intent: 'undo' })).request.formData();
    expect(() => pickFormState(ctx(), missing)).toThrow('no previous picks');
  });
  it('reviews a custom $20 amount without selecting anything and sends that exact amount to checkout', async () => {
    const id = await review({ amount: '20', 'pick:creator': '0', note: '' });
    expect(readPickReview(ctx(), id)).toMatchObject({ amount: 2000, picks: [{ projectId: 'creator', count: 1 }], visibility: 'anonymous' });
    await checkoutPost(ctx({ reviewId: id }));
    expect(state.checkout.mock.calls[0][1]).toEqual([{ title: 'A tip for Alex Rivers', amount: 2000 }]);
    expect(readRecord<Support>(state.db!, 'support', id)).toMatchObject({ amount: 2000, status: 'pending' });
  });
  it('reviews and charges an automatic target through the same frozen intent as explicit targets', async () => {
    const target = libcardTargets().find(p => p.title === 'Résumé')!;
    const id = await review({ 'pick:creator': '0', [`pick:${target.id}`]: '3' });
    await checkoutPost(ctx({ reviewId: id }));
    expect(readRecord<Support>(state.db!, 'support', id)).toMatchObject({ amount: 2200, picks: [{ projectId: target.id, count: 3 }], status: 'pending' });
    expect(state.checkout.mock.calls[0][1]).toEqual([{ title: 'A tip for Alex Rivers', amount: 2200 }]);
    const next = await review({ 'pick:creator': '0', [`pick:${target.id}`]: '1' });
    overrideLibcard(state.db!, target.id, true);
    expect((await checkoutPost(ctx({ reviewId: next }))).headers.get('location')).toContain('no%20longer');
    expect(state.checkout).toHaveBeenCalledTimes(1);
  });
  it('uses ordinary form fields and server-side shortcuts without resetting amount or note', async () => {
    const all = pickFormValues(ctx(), await ctx(fields({ amount: '44', intent: 'all' })).request.formData());
    expect(all.picks).toHaveLength(8); expect(all.picks.every(p => p.count === 1 && p.projectId !== 'creator')).toBe(true); expect(all.amount).toBe(4400); expect(all.note).toBe('Private encouragement');
    const creator = pickFormValues(ctx(), await ctx(fields({ intent: 'creator', 'pick:x': '9' })).request.formData());
    expect(creator.picks).toEqual([{ projectId: 'creator', count: 1 }]);
    const amount = pickFormValues(ctx(), await ctx(fields({ intent: 'amount-8800', 'pick:x': '3' })).request.formData());
    expect(amount.amount).toBe(8800); expect(amount.picks.find(p => p.projectId === 'x')?.count).toBe(3);
    const fallback = await review({ 'pick:creator': '0' });
    expect(readPickReview(ctx(), fallback).picks).toEqual([{ projectId: 'creator', count: 1 }]);
    const preferred = await review({ 'pick:presence': '3' });
    expect(readPickReview(ctx(), preferred).picks).toEqual([{ projectId: 'presence', count: 3 }]);
    expect(state.checkout).not.toHaveBeenCalled();
  });
  it('freezes reviewed cents, notes, privacy, frequency and picks before contacting Stripe', async () => {
    const id = await review({ 'pick:presence': '3', 'pick:x': '1', frequency: 'monthly' });
    expect(listRecords(state.db!, 'support')).toEqual([]); expect(state.checkout).not.toHaveBeenCalled();
    const response = await checkoutPost(ctx({ reviewId: id, amount: '999', visibility: 'public', note: 'tampered', 'pick:creator': '9' }));
    expect(response.headers.get('location')).toContain('checkout.stripe.com');
    const payment = readRecord<Support>(state.db!, 'support', id)!;
    expect(payment).toMatchObject({ amount: 2200, frequency: 'monthly', visibility: 'anonymous', status: 'pending', note: 'Private encouragement', picks: [{ projectId: 'presence', count: 3 }, { projectId: 'x', count: 1 }] });
    expect(payment.allocations?.map(p => p.amount)).toEqual([1650,550]);
    expect(state.checkout.mock.calls[0][1]).toEqual([{ title: 'A tip for Alex Rivers', amount: 2200 }]);
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
  it('creates a fresh anonymous review from a named gift without retaining identity or changing the original', async () => {
    state.user = { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' };
    const id = await review({ visibility: 'public', frequency: 'yearly', 'pick:presence': '3' });
    const original = readPickReview(ctx(), id);
    const response = await reviewPost(ctx({ intent: 'anonymous', editReview: id, amount: '999', note: 'tampered', announceAnonymously: 'yes' }));
    const location = new URL(response.headers.get('location')!, 'https://feedme.example');
    const nextId = location.searchParams.get('token')!;
    expect(location.pathname).toBe('/checkout/review'); expect(nextId).not.toBe(id);
    expect(location.href).not.toContain(original.note); expect(location.href).not.toContain(state.user.did);
    expect(readPickReview(ctx(), nextId)).toEqual({ ...original, supporterDid: undefined, visibility: 'anonymous', announceAnonymously: false });
    expect(readPickReview(ctx(), id)).toEqual(original);
    expect(state.checkout).not.toHaveBeenCalled(); expect(listRecords(state.db!, 'support')).toEqual([]);
    // Anonymous checkout works without a session and is still idempotent.
    state.user = undefined;
    await checkoutPost(ctx({ reviewId: nextId })); await checkoutPost(ctx({ reviewId: nextId }));
    expect(state.checkout).toHaveBeenCalledTimes(1);
    expect(readRecord<Support>(state.db!, 'support', nextId)).toMatchObject({ visibility: 'anonymous', frequency: 'yearly', amount: 2200, picks: original.picks });
    expect(readRecord<Support>(state.db!, 'support', nextId)?.supporterDid).toBeUndefined();
  });
  it.each([false, true])('adds an optional private profile to a fresh review (signed in: %s)', async signedIn => {
    const id = await review({ amount: '20.01', frequency: 'monthly', 'pick:presence': '3', announceAnonymously: 'yes' });
    const original = readPickReview(ctx(), id);
    if (signedIn) state.user = { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' };
    const response = await reviewPost(ctx({ intent: 'attach-profile', editReview: id, amount: '999', visibility: 'public', note: 'tampered' }));
    const destination = new URL(response.headers.get('location')!, 'https://feedme.example');
    expect(destination.pathname).toBe(signedIn ? '/checkout/review' : '/login');
    const reviewUrl = new URL(signedIn ? destination.href : destination.searchParams.get('returnTo')!, destination.origin);
    const nextId = reviewUrl.searchParams.get('token')!;
    expect(nextId).not.toBe(id);
    expect(readPickReview(ctx(), nextId)).toEqual({ ...original, visibility: 'private', announceAnonymously: false, ...(signedIn ? { supporterDid: state.user!.did } : {}) });
    expect(readPickReview(ctx(), id)).toEqual(original);
    expect(destination.href).not.toContain(original.note);
    expect(state.checkout).not.toHaveBeenCalled(); expect(listRecords(state.db!, 'support')).toEqual([]);
    // Only successful sign-in identifies the new review; the anonymous original stays anonymous.
    state.user = { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' };
    expect(identifyPickReview(ctx(), nextId).supporterDid).toBe(state.user.did);
    expect(identifyPickReview(ctx(), id).supporterDid).toBeUndefined();
    await checkoutPost(ctx({ reviewId: nextId }));
    expect(readRecord<Support>(state.db!, 'support', nextId)).toMatchObject({ amount: 2001, frequency: 'monthly', visibility: 'private', supporterDid: state.user.did, note: original.note, picks: original.picks, status: 'pending' });
  });
  it.each(['wrong-browser', 'expired', 'unavailable'])('rejects attaching a profile to a %s review', async failure => {
    const id = await review({ 'pick:presence': '3' });
    if (failure === 'wrong-browser') jar.set('feedme_checkout', 'different');
    if (failure === 'expired') state.db!.prepare("UPDATE kv SET expires=1 WHERE namespace='pick-review'").run();
    if (failure === 'unavailable') overrideLibcard(state.db!, 'presence', true);
    const response = await reviewPost(ctx({ intent: 'attach-profile', editReview: id }));
    expect(response.headers.get('location')).toMatch(/^\/checkout\?error=/);
    expect(state.db!.prepare("SELECT count(*) AS count FROM kv WHERE namespace='pick-review' AND key!=?").get(id)).toEqual({ count: 0 });
    expect(state.checkout).not.toHaveBeenCalled();
  });
  it.each(['wrong-browser', 'expired', 'unavailable'])('rejects anonymous conversion of a %s review', async failure => {
    const id = await review({ visibility: 'private', 'pick:presence': '3' });
    if (failure === 'wrong-browser') jar.set('feedme_checkout', 'different');
    if (failure === 'expired') state.db!.prepare("UPDATE kv SET expires=1 WHERE namespace='pick-review'").run();
    if (failure === 'unavailable') overrideLibcard(state.db!, 'presence', true);
    const response = await reviewPost(ctx({ intent: 'anonymous', editReview: id }));
    expect(response.headers.get('location')).toMatch(/^\/checkout\?error=/);
    expect(state.db!.prepare("SELECT count(*) AS count FROM kv WHERE namespace='pick-review' AND key!=?").get(id)).toEqual({ count: 0 });
    expect(state.checkout).not.toHaveBeenCalled();
  });
  it('rejects repeated anonymous-action fields instead of choosing one', async () => {
    const id = await review({ visibility: 'public' });
    for (const field of ['intent', 'editReview']) {
      const form = new URLSearchParams({ intent: 'anonymous', editReview: id }); form.append(field, 'tampered');
      const context = ctx(); context.request = new Request('https://feedme.example/api/checkout/review', { method: 'POST', body: form });
      expect((await reviewPost(context)).headers.get('location')).toContain('each%20form%20field%20once');
    }
    expect(state.checkout).not.toHaveBeenCalled();
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
    const id = await review({ frequency: 'monthly', visibility: 'public', 'pick:presence': '3', 'pick:x': '1' }); await checkoutPost(ctx({ reviewId: id }));
    const root = readRecord<Support>(state.db!, 'support', id)!; putRecord(state.db!, 'support', id, { ...root, accountId: 'acct_one' });
    for (const [n, billing_reason] of ['subscription_create','subscription_cycle'].entries()) {
      const invoice = { id: `in_${n}`, billing_reason, parent: { subscription_details: { metadata: { feedme_support_id: id }, subscription: 'sub_one' } }, customer: 'cus_one', total: 2200, amount_due: 2200, amount_paid: 2200, currency: 'usd', status: 'paid', created: 1_800_000_000 + n, status_transitions: { paid_at: 1_800_000_000 + n } };
      const event = { id: `evt_${n}`, type: 'invoice.paid', account: 'acct_one', data: { object: invoice } } as unknown as Stripe.Event;
      const provider = { payment: { invoiceId: invoice.id, paymentIntentId: `pi_${n}`, amount: 2200, currency: 'usd', customerId: 'cus_one' } };
      applyBillingEvent(state.db!, event, 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', provider); applyBillingEvent(state.db!, event, 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', provider);
    }
    const payments = listRecords<Support>(state.db!, 'support'); expect(payments).toHaveLength(2); expect(payments.every(p => JSON.stringify(p.picks) === JSON.stringify(root.picks))).toBe(true);
    const signal = publicLibcard('Alex','https://feedme.example',2200,libcardTargets(),payments);
    expect(signal.targets[0]).toMatchObject({ publicCount: 0, publicShareMillis: 0 }); expect(signal.targets[1]).toMatchObject({ publicCount: 2, publicShareMillis: 750 });
  });
});
