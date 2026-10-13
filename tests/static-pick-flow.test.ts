import { describe, expect, it } from 'vitest';
import { changeDemoGiftVisibility, demoPickGift } from '../site/demo/pick-flow';

const form = (overrides: Record<string, string> = {}) => {
  const data = new FormData();
  Object.entries({ amount: '22.01', frequency: 'monthly', visibility: 'private', note: 'Keep making things.',
    'pick:creator': '1', 'pick:presence': '3', 'pick:x': '1', ...overrides }).forEach(([key, value]) => data.set(key, value));
  return data;
};
describe('static demo pick review', () => {
  it('changes visibility without losing reviewed details or carrying public timeline consent', () => {
    const original = demoPickGift(form({ visibility: 'anonymous', announceAnonymously: 'yes' }), ['creator', 'presence', 'x']);
    const named = changeDemoGiftVisibility(original, 'public');
    const privateGift = changeDemoGiftVisibility(named, 'private');
    const anonymous = changeDemoGiftVisibility(privateGift, 'anonymous');
    expect(named).toEqual({ ...original, visibility: 'public', announceAnonymously: false });
    expect(privateGift).toEqual({ ...original, visibility: 'private', announceAnonymously: false });
    expect(anonymous).toEqual({ ...original, announceAnonymously: false });
    expect(original.announceAnonymously).toBe(true);
    expect(changeDemoGiftVisibility(original, 'anonymous')).toEqual(original);
    expect(() => changeDemoGiftVisibility(original, 'friends')).toThrow('valid privacy');
  });
  it('freezes the original picks and exact cents with the frequency, visibility, and note', () => {
    const gift = demoPickGift(form(), ['creator', 'presence', 'x']);
    expect(gift).toMatchObject({ amount: 2201, frequency: 'monthly', visibility: 'private', note: 'Keep making things.',
      picks: [{ projectId: 'presence', count: 3 }, { projectId: 'x', count: 1 }],
      allocations: [{ projectId: 'presence', amount: 1651 }, { projectId: 'x', amount: 550 }] });
    expect(demoPickGift(form({ amount: '44' }), ['creator', 'presence', 'x']).picks).toEqual(gift.picks);
  });
  it('defaults to the creator when no specific work is picked', () => {
    const gift = demoPickGift(form({ 'pick:creator': '0', 'pick:presence': '0', 'pick:x': '0' }), ['creator', 'presence', 'x']);
    expect(gift.picks).toEqual([{ projectId: 'creator', count: 1 }]);
    expect(gift.allocations).toEqual([{ projectId: 'creator', amount: 2201 }]);
  });
  it('rejects invalid, repeated, and unavailable selections before showing a review', () => {
    const invalid: Record<string, string>[] = [{ 'pick:presence': '10' }, { 'pick:presence': '1.5' }, { amount: '0' }, { visibility: 'invalid' }];
    for (const overrides of invalid) {
      expect(() => demoPickGift(form(overrides), ['creator', 'presence', 'x'])).toThrow();
    }
    const repeated = form(); repeated.append('pick:presence', '2');
    expect(() => demoPickGift(repeated, ['creator', 'presence', 'x'])).toThrow();
    expect(() => demoPickGift(form(), ['creator'])).toThrow();
  });
});
