import { describe, expect, it } from 'vitest';
import { demoPickGift } from '../site/demo/pick-flow';

const form = (overrides: Record<string, string> = {}) => {
  const data = new FormData();
  Object.entries({ amount: '22.01', frequency: 'monthly', visibility: 'private', note: 'Keep making things.',
    'pick:creator': '1', 'pick:presence': '3', ...overrides }).forEach(([key, value]) => data.set(key, value));
  return data;
};
describe('static demo pick review', () => {
  it('freezes the original picks and exact cents with the frequency, visibility, and note', () => {
    const gift = demoPickGift(form(), ['creator', 'presence']);
    expect(gift).toMatchObject({ amount: 2201, frequency: 'monthly', visibility: 'private', note: 'Keep making things.',
      picks: [{ projectId: 'creator', count: 1 }, { projectId: 'presence', count: 3 }],
      allocations: [{ projectId: 'creator', amount: 550 }, { projectId: 'presence', amount: 1651 }] });
    expect(demoPickGift(form({ amount: '44' }), ['creator', 'presence']).picks).toEqual(gift.picks);
  });
  it('rejects empty, invalid, repeated, and unavailable selections before showing a review', () => {
    const invalid: Record<string, string>[] = [{ 'pick:creator': '0', 'pick:presence': '0' }, { 'pick:presence': '10' }, { 'pick:presence': '1.5' }, { amount: '0' }, { visibility: 'invalid' }];
    for (const overrides of invalid) {
      expect(() => demoPickGift(form(overrides), ['creator', 'presence'])).toThrow();
    }
    const repeated = form(); repeated.append('pick:presence', '2');
    expect(() => demoPickGift(repeated, ['creator', 'presence'])).toThrow();
    expect(() => demoPickGift(form(), ['creator'])).toThrow();
  });
});
