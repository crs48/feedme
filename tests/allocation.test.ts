import { describe, expect, it } from 'vitest';
import { allocateAmount, weightsFromForm } from '../src/lib/allocation';
import { netSupport, supportParts, type Support } from '../src/lib/model';

const weights = (values: number[]) => values.map((weight, i) => ({ projectId: `project-${i}`, weight }));
describe('relative project allocations', () => {
  it('splits equal sliders evenly regardless of their absolute positions', () => {
    expect(allocateAmount(3000, weights([100, 100, 100])).map((p) => p.amount)).toEqual([1000, 1000, 1000]);
    expect(allocateAmount(3000, weights([20, 20, 20]))).toEqual(allocateAmount(3000, weights([100, 100, 100])));
  });
  it('gives a lone selected project the entire amount and excludes zero sliders', () => {
    expect(allocateAmount(1500, weights([0, 1, 0]))).toEqual([{ projectId: 'project-1', amount: 1500 }]);
    expect(allocateAmount(3000, weights([100, 50, 0])).map((p) => p.amount)).toEqual([2000, 1000]);
  });
  it('assigns leftover cents deterministically without zero-cent checkout lines', () => {
    expect(allocateAmount(100, weights([100, 100, 100])).map((p) => p.amount)).toEqual([34, 33, 33]);
    expect(allocateAmount(1, weights([100, 100]))).toEqual([{ projectId: 'project-0', amount: 1 }]);
    for (let amount = 100; amount < 1200; amount += 7) {
      const parts = allocateAmount(amount, weights([7, 51, 100, 0, 33]));
      expect(parts.reduce((sum, p) => sum + p.amount, 0)).toBe(amount);
      expect(parts.every((p) => Number.isInteger(p.amount) && p.amount > 0)).toBe(true);
    }
  });
  it('rejects invalid weights, all-zero selection, duplicate projects, and excessive line items', () => {
    for (const values of [[0, 0], [-1, 100], [101], [0.5], [NaN], Array(101).fill(1)]) expect(() => allocateAmount(1000, weights(values))).toThrow();
    expect(() => allocateAmount(1000, [{ projectId: 'one', weight: 1 }, { projectId: 'one', weight: 2 }])).toThrow();
    for (const amount of [-1, 0, 2.5, NaN, 100001]) expect(() => allocateAmount(amount, weights([1]))).toThrow();
  });
  it('accepts only the project set bound to the checkout form', () => {
    expect(weightsFromForm({ 'weight:one': '100', amount: '30' }, ['one'])).toEqual([{ projectId: 'one', weight: 100 }]);
    for (const value of ['', '-1', '101', '1.5', '1e2', 'Infinity', ' 5', 100]) expect(() => weightsFromForm({ 'weight:one': value }, ['one'])).toThrow();
    expect(() => weightsFromForm({}, ['one'])).toThrow();
    expect(() => weightsFromForm({ 'weight:one': '50', 'weight:foreign': '50' }, ['one'])).toThrow();
  });
  it('projects one payment into stable per-project support and monotonic refunds', () => {
    const s: Support = { id: 'tip', projectId: 'one', amount: 100, currency: 'usd', visibility: 'anonymous', note: 'private', status: 'paid', refundedAmount: 0, disputed: false, createdAt: '2026-09-25T12:00:00Z', allocations: [{ projectId: 'one', amount: 34, activityId: 'a' }, { projectId: 'two', amount: 33, activityId: 'b' }, { projectId: 'three', amount: 33, activityId: 'c' }] };
    let previous = supportParts(s).map(netSupport);
    for (let refundedAmount = 0; refundedAmount <= 100; refundedAmount++) {
      const parts = supportParts({ ...s, refundedAmount });
      expect(parts.reduce((sum, p) => sum + netSupport(p), 0)).toBe(100 - refundedAmount);
      expect(parts.every((p, i) => netSupport(p) <= previous[i])).toBe(true);
      expect(parts.map((p) => p.id)).toEqual(['tip-0', 'tip-1', 'tip-2']);
      previous = parts.map(netSupport);
    }
    expect(s.refundedAmount).toBe(0);
  });
});
