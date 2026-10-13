import { describe, expect, it } from 'vitest';
import { receiptState } from '../src/lib/receipt';
import type { Support } from '../src/lib/model';

const support: Support = { id: 'tip', projectId: 'project', amount: 2000, currency: 'usd', visibility: 'anonymous', note: 'PRIVATE', status: 'paid', refundedAmount: 0, disputed: false, createdAt: '2026-10-12T12:00:00Z' };

describe('receipt payment states', () => {
  it('does not treat missing receipt authority as pending payment', () => {
    expect(receiptState().kind).toBe('unavailable');
    expect(receiptState().message).not.toContain('confirmed');
  });
  it.each([
    [{ status: 'pending' }, 'pending'],
    [{ status: 'failed' }, 'failed'],
    [{ status: 'paid' }, 'confirmed'],
    [{ status: 'refunded' }, 'refunded'],
    [{ refundedAmount: 2000 }, 'refunded'],
    [{ refundedAmount: 500 }, 'partially-refunded'],
    [{ status: 'disputed' }, 'disputed'],
    [{ disputed: true }, 'disputed'],
  ] satisfies [Partial<Support>, string][])('distinguishes %j from a newly confirmed tip', (patch, expected) => {
    const result = receiptState({ ...support, ...patch });
    expect(result.kind).toBe(expected);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('shows the refunded amount and remaining support separately', () => {
    expect(receiptState({ ...support, refundedAmount: 500 }).message).toBe('$5 of your $20 tip was refunded. Your remaining support is $15.');
  });
});
