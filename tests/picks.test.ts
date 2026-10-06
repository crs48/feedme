import { describe, expect, it } from 'vitest';
import { allocatePicks, picksFromForm, prefillPicks, splitUnits } from '../src/lib/picks';
import { centsFromInput } from '../src/lib/model';

describe('integer pick allocation', () => {
  it('accepts LibCard two-decimal dollar prefills throughout the supported cent range', () => {
    for (let cents = 100; cents <= 100_000; cents++) expect(centsFromInput((cents / 100).toFixed(2))).toBe(cents);
    for (const [input, amount] of [['22.00', 2200], ['5.05', 505], ['1000.00', 100000]] as const) {
      expect(prefillPicks(new URLSearchParams(`amount=${input}&presence=1`), ['creator', 'presence'], 4400)).toEqual({ amount, picks: [{ projectId: 'presence', count: 1 }], removed: false });
    }
    expect(prefillPicks(new URLSearchParams('presence=1'), ['creator', 'presence'], 505)).toEqual({ amount: 505, picks: [{ projectId: 'presence', count: 1 }], removed: false });
    expect(prefillPicks(new URLSearchParams(), ['creator', 'presence'], 505)).toEqual({ amount: 505, picks: [], removed: false });
  });
  it('starts empty and gives a single selected target the whole amount', () => {
    expect(() => allocatePicks(2200, [])).toThrow();
    expect(allocatePicks(2200, [{ projectId: 'creator', count: 1 }])).toEqual([{ projectId: 'creator', amount: 2200 }]);
    expect(allocatePicks(2200, [{ projectId: 'creator', count: 9 }])).toEqual([{ projectId: 'creator', amount: 2200 }]);
  });
  it('uses raw weights, exact cents, and stable ID tie-breaking', () => {
    expect(allocatePicks(2200, [{ projectId: 'a', count: 1 }, { projectId: 'b', count: 3 }])).toEqual([{ projectId: 'a', amount: 550 }, { projectId: 'b', amount: 1650 }]);
    const picks = ['c', 'b', 'a'].map(projectId => ({ projectId, count: 1 }));
    expect(allocatePicks(100, picks)).toEqual([{ projectId: 'a', amount: 34 }, { projectId: 'b', amount: 33 }, { projectId: 'c', amount: 33 }]);
    expect(allocatePicks(100, picks.toReversed())).toEqual(allocatePicks(100, picks));
    for (let amount = 100; amount < 1200; amount++) expect(allocatePicks(amount, picks).reduce((sum, p) => sum + p.amount, 0)).toBe(amount);
  });
  it('retains selected targets that round to zero cents and rejects malformed weights', () => {
    const picks = Array.from({ length: 100 }, (_, i) => ({ projectId: `p-${i}`, count: i < 50 ? 1 : 9 }));
    expect(allocatePicks(100, picks).find(p => p.projectId === 'p-0')?.amount).toBe(0);
    for (const count of [-1, 0, 1.1, 10, NaN]) expect(() => allocatePicks(100, [{ projectId: 'a', count }])).toThrow();
    expect(() => allocatePicks(100, [{ projectId: 'a', count: 1 }, { projectId: 'a', count: 1 }])).toThrow();
    expect(() => allocatePicks(99, [{ projectId: 'a', count: 1 }])).toThrow();
    expect(splitUnits(1000, [{ projectId: 'a', count: 1 }, { projectId: 'b', count: 1 }, { projectId: 'c', count: 1 }]).map(p => p.amount)).toEqual([334,333,333]);
  });
  it('tolerates invalid prefills without selecting the creator implicitly', () => {
    const ids = ['creator', 'presence', 'x'];
    expect(prefillPicks(new URLSearchParams('amount=22&presence=1&x=3&creator=1'), ids, 4400)).toMatchObject({ amount: 2200, picks: [{ projectId: 'presence', count: 1 }, { projectId: 'x', count: 3 }, { projectId: 'creator', count: 1 }] });
    for (const query of ['gone=1', 'x=10', 'x=1.0', 'x=-1', 'x=1&x=2', 'x=0']) expect(prefillPicks(new URLSearchParams(query), ids, 2200).picks).toEqual([]);
    expect(prefillPicks(new URLSearchParams('amount=bad&creator=1'), ids, 4400).amount).toBe(4400);
    expect(prefillPicks(new URLSearchParams('amount=22&amount=44'), ids, 8800).amount).toBe(8800);
  });
  it('accepts plain integer HTML fields and rejects repeated, missing, or unknown fields', () => {
    const form = new FormData(); form.set('pick:a', '1'); form.set('pick:b', '0');
    expect(picksFromForm(form, ['a','b'])).toEqual([{ projectId: 'a', count: 1 }]);
    form.append('pick:a', '2'); expect(() => picksFromForm(form, ['a','b'])).toThrow();
    form.set('pick:a', '1'); form.set('pick:other', '1'); expect(() => picksFromForm(form, ['a','b'])).toThrow();
    form.delete('pick:other'); form.delete('pick:b'); expect(() => picksFromForm(form, ['a','b'])).toThrow();
  });
});
