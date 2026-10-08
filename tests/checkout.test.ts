import { createHash } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import type { DatabaseSync } from 'node:sqlite';
let db: DatabaseSync;
const state = vi.hoisted(() => ({ demo: true, user: undefined as { did: string } | undefined, checkout: vi.fn() }));
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: state.demo }) }));
vi.mock('../src/lib/auth', () => ({ currentUser: () => state.user, digest: (value: string) => createHash('sha256').update(value).digest('hex') }));
vi.mock('../src/lib/db', async (original) => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => db }));
vi.mock('../src/lib/payments', () => ({ checkout: state.checkout }));
import { openDatabase, putRecord, setKv, readRecord } from '../src/lib/db';
import { POST } from '../src/pages/api/checkout';
import { support, supports, totals } from '../src/lib/repository';

const run = (extra: Record<string, string> = {}, browser = 'browser') => POST({
  request: new Request('https://feedme.example/api/checkout', { method: 'POST', body: new URLSearchParams({ requestId: 'request', amount: '30', visibility: 'anonymous', 'percentage:one': '60', 'percentage:two': '40', ...extra }) }),
  cookies: { get: () => ({ value: browser }) }, redirect: (url: string, status: number) => new Response(null, { status, headers: { location: url } }),
} as unknown as APIContext);

describe('allocated checkout requests', () => {
  beforeEach(() => {
    db = openDatabase(':memory:'); state.demo = true; state.user = undefined; state.checkout.mockReset().mockResolvedValue('https://checkout.stripe.com/test');
    for (const id of ['one', 'two']) putRecord(db, 'project', id, { id, title: id, status: 'active' });
    setKv(db, 'checkout-form', 'request', { projectIds: ['one', 'two'], allocationMode: 'percentages', binding: createHash('sha256').update('browser').digest('hex') });
  });
  afterEach(() => db.close());
  it('records one payment, two shares, and private totals without publishing anonymous money', async () => {
    expect((await run()).headers.get('location')).toBe('/thanks?id=request');
    expect(support('request')?.amount).toBe(3000);
    expect(supports().map((s) => s.amount)).toEqual([1800, 1200]);
    expect(totals('one', false)).toEqual({ amount: 1800, count: 1 });
    expect(totals('two', false)).toEqual({ amount: 1200, count: 1 });
    expect(totals(undefined, false)).toEqual({ amount: 3000, count: 1 });
    expect(totals().amount).toBe(0);
  });
  it('reuses a repeated submission but rejects changes to an existing split', async () => {
    await run(); const saved = support('request');
    await run(); expect(support('request')).toEqual(saved);
    expect((await run({ 'percentage:one': '40', 'percentage:two': '60' })).headers.get('location')).toContain('different%20details');
    expect(support('request')).toEqual(saved);
  });
  it('rejects an all-zero split, unknown or closed project, and mismatched browser', async () => {
    expect((await run({ 'percentage:one': '0', 'percentage:two': '0' })).headers.get('location')).toContain('100%25');
    expect((await run({ 'percentage:other': '100' })).headers.get('location')).toContain('project%20list%20changed');
    expect((await run({}, 'other')).headers.get('location')).toContain('expired');
    putRecord(db, 'project', 'two', { id: 'two', title: 'two', status: 'complete' });
    expect((await run()).headers.get('location')).toContain('no%20longer%20accepting');
    expect(support('request')).toBeUndefined();
  });
  it('rejects partial and overallocated submissions without creating or charging a tip', async () => {
    state.demo = false;
    for (const percentages of [{ 'percentage:one': '30', 'percentage:two': '0' }, { 'percentage:one': '70', 'percentage:two': '40' }]) {
      expect((await run(percentages)).headers.get('location')).toContain('100%25');
      expect(support('request')).toBeUndefined();
    }
    expect(state.checkout).not.toHaveBeenCalled();
  });
  it('asks an older relative-weight form to reload instead of reinterpreting its choices', async () => {
    setKv(db, 'checkout-form', 'request', { projectIds: ['one', 'two'], binding: createHash('sha256').update('browser').digest('hex') });
    expect((await run()).headers.get('location')).toContain('form%20changed');
    expect(support('request')).toBeUndefined();
  });
  it('preserves consent per part and requires a signed-in identity for public support', async () => {
    expect((await run({ visibility: 'public' })).headers.get('location')).toContain('Sign%20in');
    state.user = { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' };
    await run({ visibility: 'public', note: 'Private note' });
    expect(totals()).toEqual({ amount: 3000, count: 1 });
    expect(supports().every((s) => s.supporterDid === state.user?.did && s.note === 'Private note')).toBe(true);
  });
  it('sends exact per-project line items to one live checkout and keeps payment pending', async () => {
    state.demo = false;
    const response = await run();
    expect(response.headers.get('location')).toBe('https://checkout.stripe.com/test');
    expect(state.checkout.mock.calls[0][1]).toEqual([{ title: 'one', amount: 1800 }, { title: 'two', amount: 1200 }]);
    expect(support('request')?.status).toBe('pending');
    await run(); expect(state.checkout).toHaveBeenCalledTimes(1);
    expect(totals(undefined, false).amount).toBe(0);
  });
  it.each(['monthly', 'yearly'])('freezes %s frequency and repeats the saved split only after future payments', async (frequency) => {
    await run({ frequency });
    expect(support('request')).toMatchObject({ frequency, amount: 3000, status: 'paid' });
    expect(readRecord(db, 'subscription', 'request')).toMatchObject({ status: 'active' });
    expect(totals(undefined, false).amount).toBe(3000);
    expect((await run({ frequency: 'once' })).headers.get('location')).toContain('different%20details');
    expect((await run({ frequency })).headers.get('location')).toBe('/thanks?id=request');
    expect(totals(undefined, false).amount).toBe(3000);
  });
  it('rejects invalid billing intervals before storing a payment', async () => {
    expect((await run({ frequency: 'weekly' })).headers.get('location')).toContain('Choose%20one-time');
    expect(support('request')).toBeUndefined();
  });
  it('continues to accept the existing single-project form', async () => {
    setKv(db, 'checkout-form', 'request', { projectId: 'two', binding: createHash('sha256').update('browser').digest('hex') });
    await run({ projectId: 'two' });
    expect(support('request')?.projectId).toBe('two');
    expect(support('request')?.allocations).toBeUndefined();
    expect(supports()).toHaveLength(1);
  });
});
