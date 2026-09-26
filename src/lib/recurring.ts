import { createHash, randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import type { DatabaseSync } from 'node:sqlite';
import { putRecord, readRecord } from './db';
import type { Support } from './model';
import { queueSupport } from './support-ledger';
import { billingInterval } from './billing-frequency';

// Operational billing identifiers stay local; public projections never copy these fields.
export type Subscription = {
  id: string; accountId: string; subscriptionId: string; customerId: string;
  status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd?: number; eventCreated: number;
};
export type InvoicePayment = { invoiceId: string; paymentIntentId: string; amount: number; currency: string; customerId: string };
export type BillingEventContext = { payment?: InvoicePayment; subscription?: Stripe.Subscription };
export const stripeId = (value: string | { id: string } | null | undefined) => typeof value === 'string' ? value : value?.id;
export const invoiceRootId = (invoice: Stripe.Invoice) => invoice.parent?.subscription_details?.metadata?.feedme_support_id;
export const invoiceSupportId = (rootId: string, invoice: Pick<Stripe.Invoice, 'id' | 'billing_reason'>) => invoice.billing_reason === 'subscription_create'
  ? rootId : `invoice-${createHash('sha256').update(`${rootId}:${invoice.id}`).digest('hex').slice(0, 32)}`;

const bindSubscription = (db: DatabaseSync, root: Support, subscriptionId: string | undefined, customerId: string | undefined) => {
  if (!billingInterval(root.frequency) || !root.accountId || !subscriptionId || !customerId) throw new Error('Missing recurring support binding.');
  const current = readRecord<Subscription>(db, 'subscription', root.id);
  if ((root.subscriptionId && root.subscriptionId !== subscriptionId) || (current && (current.accountId !== root.accountId || current.subscriptionId !== subscriptionId || current.customerId !== customerId)))
    throw new Error('Subscription does not match the stored support.');
  const bound: Subscription = current || { id: root.id, accountId: root.accountId, subscriptionId, customerId, status: 'incomplete', cancelAtPeriodEnd: false, eventCreated: 0 };
  putRecord(db, 'subscription', root.id, bound);
  putRecord(db, 'support', root.id, { ...root, subscriptionId });
  return bound;
};
export const bindSubscriptionCheckout = (db: DatabaseSync, root: Support, session: Stripe.Checkout.Session, failed = false) => {
  // Expired Checkout can lack a subscription. It must never imply a payment.
  if (session.subscription) bindSubscription(db, root, stripeId(session.subscription), stripeId(session.customer));
  const latest = readRecord<Support>(db, 'support', root.id)!;
  putRecord(db, 'support', root.id, { ...latest, checkoutId: session.id, status: failed && latest.status === 'pending' ? 'failed' : latest.status });
};

export const applyBillingEvent = (db: DatabaseSync, event: Stripe.Event, ownerDid: string, context: BillingEventContext) => {
  if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
    const signed = event.data.object as Stripe.Subscription;
    const subscription = context.subscription || signed;
    if (subscription.id !== signed.id) throw new Error('Subscription snapshot mismatch.');
    const id = subscription.metadata.feedme_support_id;
    const root = id ? readRecord<Support>(db, 'support', id) : undefined;
    if (!root) return;
    if (root.accountId !== event.account) throw new Error('Subscription account mismatch.');
    const previous = bindSubscription(db, root, subscription.id, stripeId(subscription.customer));
    // A canceled Stripe subscription cannot be resumed; delayed events cannot revive it.
    if (previous.status === 'canceled' || event.created < previous.eventCreated) return;
    putRecord(db, 'subscription', root.id, { ...previous, status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd: subscription.items.data[0]?.current_period_end, eventCreated: event.created,
    } satisfies Subscription);
    return;
  }
  if (!['invoice.paid', 'invoice.payment_failed'].includes(event.type)) return;
  const invoice = event.data.object as Stripe.Invoice;
  const rootId = invoiceRootId(invoice);
  const root = rootId ? readRecord<Support>(db, 'support', rootId) : undefined;
  if (!root) return;
  // No prorations, manual invoices, coupons, credits, or changed amounts may silently alter the saved split.
  if (root.accountId !== event.account || !['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason || '') ||
    invoice.total !== root.amount || invoice.currency !== root.currency || invoice.amount_due !== root.amount)
    throw new Error('Invoice does not match the saved recurring support.');
  const subscription = bindSubscription(db, root, stripeId(invoice.parent?.subscription_details?.subscription), stripeId(invoice.customer));
  const paid = event.type === 'invoice.paid';
  const payment = context.payment;
  if (paid && (invoice.status !== 'paid' || invoice.amount_paid !== root.amount || !payment || payment.invoiceId !== invoice.id ||
    payment.amount !== root.amount || payment.currency !== root.currency || payment.customerId !== subscription.customerId))
    throw new Error('Invoice requires a matching successful Stripe payment.');
  const id = invoiceSupportId(root.id, invoice);
  const existing = readRecord<Support>(db, 'support', id);
  if (existing && ((existing.invoiceId && existing.invoiceId !== invoice.id) || (paid && existing.paymentIntentId && existing.paymentIntentId !== payment!.paymentIntentId)))
    throw new Error('Invoice payment binding changed.');
  const base: Support = existing || {
    ...root, id, recurringRootId: root.id, checkoutId: undefined, paymentIntentId: undefined, invoiceId: undefined, paidAt: undefined,
    status: 'pending', refundedAmount: 0, disputed: false, activityId: randomUUID(),
    allocations: root.allocations?.map((part) => ({ ...part, activityId: randomUUID() })),
    createdAt: new Date(invoice.created * 1000).toISOString(),
  };
  queueSupport(db, { ...base, subscriptionId: subscription.subscriptionId, invoiceId: invoice.id,
    ...(paid ? { paymentIntentId: payment!.paymentIntentId } : {}),
    createdAt: paid && invoice.status_transitions.paid_at ? new Date(invoice.status_transitions.paid_at * 1000).toISOString() : base.createdAt,
    ...(paid && invoice.status_transitions.paid_at ? { paidAt: new Date(invoice.status_transitions.paid_at * 1000).toISOString() } : {}),
    // Failures and duplicate success events never undo refunds or already-settled payments.
    status: ['pending', 'failed'].includes(base.status) ? paid ? 'paid' : 'failed' : base.status,
  }, ownerDid);
};

// Stripe's current API exposes invoice payments separately from the Invoice object.
export const verifiedInvoicePayment = async (stripe: Stripe, invoice: Stripe.Invoice, account: string): Promise<InvoicePayment> => {
  const options = { stripeAccount: account };
  const payments = await stripe.invoicePayments.list({ invoice: invoice.id, status: 'paid', limit: 100 }, options);
  const payment = payments.data[0];
  if (payments.has_more || payments.data.length !== 1 || payment.payment.type !== 'payment_intent' || stripeId(payment.invoice) !== invoice.id)
    throw new Error('Expected a single Stripe payment for the recurring invoice.');
  const paymentIntentId = stripeId(payment.payment.payment_intent);
  if (!paymentIntentId) throw new Error('Invoice has no payment intent.');
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {}, options);
  if (intent.status !== 'succeeded' || intent.amount_received !== invoice.amount_paid || payment.amount_paid !== invoice.amount_paid ||
    intent.currency !== invoice.currency || payment.currency !== invoice.currency || stripeId(intent.customer) !== stripeId(invoice.customer))
    throw new Error('Invoice payment has not settled for the expected amount.');
  return { invoiceId: invoice.id, paymentIntentId, amount: intent.amount_received, currency: intent.currency, customerId: stripeId(intent.customer)! };
};

export const recurringRefundSupportId = async (stripe: Stripe, paymentIntentId: string, account: string) => {
  const options = { stripeAccount: account };
  const payments = await stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: paymentIntentId }, status: 'paid', limit: 100 }, options);
  if (!payments.data.length) return undefined;
  if (payments.has_more || payments.data.length !== 1) throw new Error('Ambiguous recurring payment.');
  const invoice = await stripe.invoices.retrieve(stripeId(payments.data[0].invoice)!, {}, options);
  const rootId = invoiceRootId(invoice);
  return rootId ? invoiceSupportId(rootId, invoice) : undefined;
};
