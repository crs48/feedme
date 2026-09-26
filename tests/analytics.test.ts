import { describe, expect, it } from 'vitest';
import { earningsSeries, paymentsCsv, projectPerformance, recurringSummary, reportQuery, selectedPayments, summarizePayments, supporterPerformance } from '../src/lib/analytics';
import type { Project, Support } from '../src/lib/model';
import type { Subscription } from '../src/lib/recurring';
const did = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const sample: Support = { id: 'payment', projectId: 'sauna', amount: 3000, currency: 'usd', status: 'paid', refundedAmount: 0, disputed: false, createdAt: '2026-08-31T23:59:59Z', paidAt: '2026-09-01T00:00:00Z', note: 'SECRET NOTE', visibility: 'public', supporterDid: did, accountId: 'acct_secret' };
const query = (params = '') => reportQuery(new URLSearchParams(params), new Date('2026-09-26T19:00:00Z'));
const split = { ...sample, allocations: [{ projectId: 'sauna', amount: 2000, activityId: 'a' }, { projectId: 'writing', amount: 1000, activityId: 'b' }] };

describe('admin earnings reports', () => {
  it('counts a split payment once and preserves total cents after partial refunds', () => {
    const records = [{ ...split, refundedAmount: 2200 }];
    expect(summarizePayments(records)).toMatchObject({ net: 800, gross: 3000, refunded: 2200, count: 1 });
    const projects = projectPerformance(records, []);
    expect(projects.map((p) => [p.id, p.net])).toEqual([['writing', 800], ['sauna', 0]]);
    const selected = selectedPayments(records, query('project=writing'));
    expect(selected).toHaveLength(1); expect(selected[0].id).toBe(sample.id);
    expect(summarizePayments(selected)).toMatchObject({ net: 800, gross: 1000, refunded: 200, count: 1 });
  });
  it('separates confirmed gross, refunds, disputes, pending, and failures', () => {
    const records: Support[] = [sample, { ...sample, status: 'refunded', refundedAmount: 3000 }, { ...sample, status: 'disputed', disputed: true, refundedAmount: 500 }, { ...sample, status: 'pending' }, { ...sample, status: 'failed' }];
    const s = summarizePayments(records);
    expect(s).toMatchObject({ gross: 9000, net: 3000, refunded: 3500, disputed: 2500, count: 3, pending: 1, failed: 1 });
    expect(s.gross - s.refunded - s.disputed).toBe(s.net);
  });
  it('uses confirmed payment dates, inclusive UTC ranges, and zero-filled weeks/months', () => {
    const q = query('range=custom&from=2026-09-01&to=2026-09-01');
    const records = selectedPayments([sample, { ...sample, id: 'outside', paidAt: '2026-09-02T00:00:00Z' }], q);
    expect(records).toHaveLength(1);
    expect(earningsSeries(records, q)[0]).toMatchObject({ date: '2026-08-31', net: 3000 });
    const months = earningsSeries([sample], query('range=custom&from=2026-07-01&to=2026-09-26&interval=month'));
    expect(months.map((m) => m.net)).toEqual([0,0,3000]);
    expect(query('range=week').from).toBe('2026-09-21'); expect(query('range=month').from).toBe('2026-09-01');
    for (const bad of ['from=2026-09-20&to=2026-09-01', 'from=2026-02-30&to=2026-09-01', 'from=2026-09-01&to=2099-01-01']) expect(() => query(`range=custom&${bad}`)).toThrow();
  });
  it('groups named supporters by permanent DID and never reveals an anonymous identity in search or exports', () => {
    const anon = { ...sample, id: 'anonymous', visibility: 'anonymous' as const, supporterDid: 'did:plc:cccccccccccccccccccccccc' };
    const newer = { ...sample, id: 'newer', paidAt: '2026-09-20T00:00:00Z' };
    const supporters = supporterPerformance([sample, newer, anon]);
    expect(supporters).toHaveLength(1); expect(supporters[0]).toMatchObject({ did, first: sample.paidAt, last: newer.paidAt, net: 6000 });
    expect(selectedPayments([anon], query(`q=${anon.supporterDid}`))).toEqual([]);
    const csv = paymentsCsv([anon], []);
    expect(csv).not.toContain(anon.supporterDid); expect(csv).not.toMatch(/SECRET NOTE|acct_secret/);
  });
  it('exports split rows with CSV escaping, formula protection, and conserved dollar totals', () => {
    const projects = [{ id: 'sauna', title: '=HYPERLINK("evil")' }, { id: 'writing', title: 'A, "title"' }] as Project[];
    const csv = paymentsCsv([split], projects);
    expect(csv.split('\r\n')).toHaveLength(4);
    expect(csv).toContain('"\'=HYPERLINK(""evil"")"'); expect(csv).toContain('"A, ""title"""');
    expect(csv).toContain('"20.00","20.00"'); expect(csv).toContain('"10.00","10.00"');
  });
  it('normalizes current yearly and monthly subscriptions without counting canceled or past-due commitments', () => {
    const yearly = { ...sample, id: 'yearly', frequency: 'yearly' as const, amount: 12000 };
    const monthly = { ...split, frequency: 'monthly' as const };
    const subscription = (id: string, status: string, ending = false): Subscription => ({ id, accountId: 'acct', subscriptionId: id, customerId: 'cus', status, cancelAtPeriodEnd: ending, eventCreated: 1 });
    const subscriptions = [subscription(sample.id, 'active', true), subscription(yearly.id, 'active'), subscription('late','past_due'),subscription('canceled','canceled')];
    expect(recurringSummary([monthly,yearly], subscriptions)).toEqual({ active: 2, ending: 1, monthly: 4000, pastDue: 1 });
    expect(recurringSummary([monthly,yearly], subscriptions, 'writing')).toMatchObject({ active: 1, monthly: 1000, pastDue: 0 });
  });
  it('applies combined frequency, status, and privacy filters', () => {
    const paid = { ...sample, frequency: 'monthly' as const, visibility: 'private' as const };
    expect(selectedPayments([paid, sample, { ...paid, status: 'pending' }], query('frequency=monthly&status=paid&visibility=private'))).toEqual([paid]);
  });
});
