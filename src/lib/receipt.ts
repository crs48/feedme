import { money, netSupport, type Support } from './model';

// Call only with a support record the visitor is authorized to read.
export const receiptState = (support?: Support) => {
  if (!support) return { kind: 'unavailable', title: 'This receipt isn’t available here.', message: 'Open it in the browser you used to tip, or sign in with the profile you attached. A receipt link alone does not give access.' } as const;
  if (support.disputed || support.status === 'disputed') return { kind: 'disputed', title: 'This payment is disputed.', message: 'This tip is not counted as confirmed support while the dispute is open. You can still manage any recurring support in billing.' } as const;
  if (support.status === 'refunded' || (support.status === 'paid' && support.refundedAmount >= support.amount)) return { kind: 'refunded', title: 'Your tip was refunded.', message: `${money(support.amount)} was refunded. A refund does not by itself stop future renewals; manage recurring support in billing.` } as const;
  if (support.status === 'failed') return { kind: 'failed', title: 'Payment was not completed.', message: 'This tip is not confirmed. If you see a charge, check with the creator before trying again.' } as const;
  if (support.status === 'pending') return { kind: 'pending', title: 'Confirming your payment.', message: 'We’re waiting for payment confirmation. You don’t need to pay again. Check the status in a moment.' } as const;
  if (support.refundedAmount > 0) return { kind: 'partially-refunded', title: 'Your tip was partly refunded.', message: `${money(support.refundedAmount)} of your ${money(support.amount)} tip was refunded. Your remaining support is ${money(netSupport(support))}.` } as const;
  return { kind: 'confirmed', title: 'Thank you. You’re all set.', message: `Your ${money(support.amount)} tip is confirmed.` } as const;
};
