import { describe, expect, it } from 'vitest';
import { allocateAmount, previewAllocation, changePercentage, evenPercentages, percentagesFromForm } from '../src/lib/allocation';
import { netSupport, supportParts, type Support } from '../src/lib/model';

const percentages = (values: number[]) => values.map((percentage, i) => ({ projectId: `project-${i}`, percentage }));
describe('percentage project allocations', () => {
  it('previews the actual percentage without normalizing a partial selection', () => {
    expect(previewAllocation(2200, percentages([0, 0, 0]))).toEqual({ allocations: [], allocatedPercentage: 0, unallocatedAmount: 2200 });
    expect(previewAllocation(2200, percentages([1, 0, 0]))).toEqual({ allocations: [{ projectId: 'project-0', amount: 22 }], allocatedPercentage: 1, unallocatedAmount: 2178 });
    expect(previewAllocation(2200, percentages([30, 0, 0]))).toEqual({ allocations: [{ projectId: 'project-0', amount: 660 }], allocatedPercentage: 30, unallocatedAmount: 1540 });
    expect(allocateAmount(2200, percentages([100, 0, 0]))).toEqual([{ projectId: 'project-0', amount: 2200 }]);
  });
  it('caps a changed slider at the unused percentage and preserves other choices', () => {
    const original = percentages([60, 0, 0]);
    expect(changePercentage(original, 'project-1', 80)).toEqual(percentages([60, 40, 0]));
    expect(original).toEqual(percentages([60, 0, 0]));
    expect(changePercentage(percentages([60, 40, 0]), 'project-0', 100)).toEqual(percentages([60, 40, 0]));
    const freed = changePercentage(percentages([60, 40, 0]), 'project-0', 20);
    expect(changePercentage(freed, 'project-2', 50)).toEqual(percentages([20, 40, 40]));
    expect(() => changePercentage(original, 'unknown', 10)).toThrow();
  });
  it('splits evenly in whole percentage points and keeps the sum at 100', () => {
    expect(evenPercentages(['a', 'b', 'c']).map(p => p.percentage)).toEqual([34, 33, 33]);
    expect(evenPercentages([])).toEqual([]);
    for (let count = 1; count <= 110; count++) {
      const split = evenPercentages(Array.from({ length: count }, (_, i) => String(i)));
      expect(split.reduce((sum, part) => sum + part.percentage, 0)).toBe(100);
      expect(split.every(part => part.percentage >= 0 && part.percentage <= 100)).toBe(true);
    }
    const recurring = evenPercentages(Array.from({ length: 25 }, (_, i) => String(i)), 20);
    expect(recurring.filter(p => p.percentage > 0)).toHaveLength(20);
    expect(recurring.reduce((sum, p) => sum + p.percentage, 0)).toBe(100);
  });
  it('conserves cents across partial previews, remaining amounts, and complete splits', () => {
    expect(allocateAmount(101, percentages([50, 50]))).toEqual([{ projectId: 'project-0', amount: 51 }, { projectId: 'project-1', amount: 50 }]);
    expect(allocateAmount(1, percentages([50, 50]))).toEqual([{ projectId: 'project-0', amount: 1 }]);
    for (let amount = 100; amount < 1200; amount += 7) {
      for (const values of [[0, 0], [7, 51], [33, 33, 34], [100, 0]]) {
        const preview = previewAllocation(amount, percentages(values));
        expect(preview.allocations.reduce((sum, p) => sum + p.amount, 0) + preview.unallocatedAmount).toBe(amount);
        expect(preview.allocations.every(p => Number.isInteger(p.amount) && p.amount > 0)).toBe(true);
      }
    }
  });
  it('rejects incomplete or excessive checkout percentages and malformed values', () => {
    for (const values of [[0, 0], [1, 0], [50, 49], [50, 51], [100, 100], [-1, 100], [101], [0.5], [NaN], Array(101).fill(1)])
      expect(() => allocateAmount(1000, percentages(values))).toThrow();
    expect(() => previewAllocation(1000, percentages([70, 50]))).toThrow('more than 100%');
    expect(() => allocateAmount(1000, [{ projectId: 'one', percentage: 50 }, { projectId: 'one', percentage: 50 }])).toThrow();
    for (const amount of [-1, 0, 2.5, NaN, 100001]) expect(() => allocateAmount(amount, percentages([100]))).toThrow();
  });
  it('accepts only valid percentages for the project set bound to the form', () => {
    expect(percentagesFromForm({ 'percentage:one': '100', amount: '30' }, ['one'])).toEqual([{ projectId: 'one', percentage: 100 }]);
    for (const value of ['', '-1', '101', '1.5', '1e2', 'Infinity', ' 5', 100]) expect(() => percentagesFromForm({ 'percentage:one': value }, ['one'])).toThrow();
    expect(() => percentagesFromForm({}, ['one'])).toThrow();
    expect(() => percentagesFromForm({ 'percentage:one': '50', 'percentage:foreign': '50' }, ['one'])).toThrow();
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
