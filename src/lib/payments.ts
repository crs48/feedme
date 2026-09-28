import Stripe from 'stripe';
import type { DatabaseSync } from 'node:sqlite';
import { config } from './config';
import { getDb, getKv, listRecords, putRecord, readRecord, setKv, transaction } from './db';
import type { Support } from './model';
import { queueSupport } from './support-ledger';
import { privateSpace, protectCheckoutIntent } from './habitat';
import { billingInterval } from './billing-frequency';
import { ensureBillingPortal } from './billing';
import { applyBillingEvent, bindSubscriptionCheckout, type BillingEventContext, type Subscription } from './recurring';

export const stripeClient = () => {
  const key = config().stripeKey;
  if (!key) throw new Error('Stripe is not configured yet.');
  return new Stripe(key, { maxNetworkRetries: 2, timeout: 15_000 });
};
export const connectedAccount = () => getKv<string>(getDb(), 'app', 'stripe-account');
export const connectStripe = async () => {
  const stripe = stripeClient();
  let account = connectedAccount();
  if (!account) {
    const created = await stripe.accounts.create({ type: 'standard' }, { idempotencyKey: `feedme-account-${config().ownerDid}` });
    account = created.id;
    setKv(getDb(), 'app', 'stripe-account', account);
  }
  return stripe.accountLinks.create({ account, type: 'account_onboarding',
    refresh_url: `${config().origin}/studio?notice=Restart%20Stripe%20onboarding%20to%20get%20a%20fresh%20link.`,
    return_url: `${config().origin}/studio?notice=Stripe%20details%20saved.%20Checkout%20will%20verify%20payment%20readiness.`,
  });
};
export const checkout = async (intent: Support, items: { title: string; amount: number }[]) => {
  if (!items.length || items.length > 100 || items.some((item) => !Number.isSafeInteger(item.amount) || item.amount < 1) || items.reduce((sum, item) => sum + item.amount, 0) !== intent.amount)
    throw new Error('The project allocations must match the total support.');
  const interval = billingInterval(intent.frequency);
  if (interval && items.length > 20) throw new Error('Recurring support can include up to 20 projects.');
  if (!privateSpace()) throw new Error('The creator needs to connect private storage before receiving support.');
  const stripe = stripeClient();
  const account = connectedAccount();
  if (!account) throw new Error('The creator hasn’t connected Stripe yet.');
  const readiness = await stripe.accounts.retrieve(account);
  if (!readiness.charges_enabled || !readiness.payouts_enabled) throw new Error('The creator’s Stripe account is still being set up.');
  if (interval) await ensureBillingPortal(stripe, account);
  const stored = readRecord<Support>(getDb(), 'support', intent.id);
  if (stored?.accountId && stored.accountId !== account) throw new Error('This checkout belongs to a different connected account. Start a new one.');
  const current = { ...intent, ...stored, accountId: account };
  putRecord(getDb(), 'support', intent.id, current);
  // Do not issue a charge-capable URL until allocations and consent are remotely recoverable.
  await protectCheckoutIntent();
  // Reuse the customer only when the server can prove the same supporter or browser.
  const binding = getKv<string>(getDb(), 'checkout-owner', intent.id);
  const previousRoot = interval ? listRecords<Support>(getDb(), 'support').find((s) => s.id !== intent.id && !s.recurringRootId && s.accountId === account && s.subscriptionId &&
    ((intent.supporterDid && intent.visibility !== 'anonymous' && s.visibility !== 'anonymous' && s.supporterDid === intent.supporterDid) ||
      (binding && getKv<string>(getDb(), 'checkout-owner', s.id) === binding))) : undefined;
  const customer = previousRoot ? readRecord<Subscription>(getDb(), 'subscription', previousRoot.id)?.customerId : undefined;
  const result = await stripe.checkout.sessions.create({
    ...(customer ? { customer } : {}),
    mode: interval ? 'subscription' : 'payment', client_reference_id: intent.id,
    // Match the shared UI theme without replacing the connected merchant's name or logo.
    branding_settings: { background_color: '#ffffff', button_color: '#0866ff', border_style: 'rounded', font_family: 'default' },
    metadata: { feedme_support_id: intent.id },
    ...(interval ? { subscription_data: { metadata: { feedme_support_id: intent.id } } } : { payment_intent_data: { metadata: { feedme_support_id: intent.id } } }),
    line_items: items.map(({ title, amount }) => ({ quantity: 1, price_data: { currency: 'usd', unit_amount: amount, ...(interval ? { recurring: { interval } } : {}), product_data: { name: `Support: ${title}` } } })),
    success_url: `${config().origin}/thanks?id=${intent.id}`,
    cancel_url: `${config().origin}${intent.allocations ? '/' : `/support/${intent.projectId}`}?notice=Checkout%20canceled.%20You%20have%20not%20been%20charged.`,
  }, { stripeAccount: account, idempotencyKey: `feedme-checkout-${intent.id}` });
  // A webhook may arrive before this API call returns. Preserve its newer status.
  const latest = readRecord<Support>(getDb(), 'support', intent.id) || current;
  putRecord(getDb(), 'support', intent.id, { ...latest, checkoutId: result.id });
  if (!result.url) throw new Error('Stripe did not return a checkout URL.');
  return result.url;
};

// Called only AFTER verifying Stripe's raw-body signature. Exported for deterministic tests.
export const applyStripeEvent = (db: DatabaseSync, event: Stripe.Event, ownerDid: string, accountId: string, supportIdHint?: string, billingContext: BillingEventContext = {}) => {
  if (event.account !== accountId) throw new Error('Unexpected connected account.');
  return transaction(db, () => {
    if (db.prepare('SELECT 1 FROM events WHERE id=?').get(event.id)) return 'duplicate';
    const object = event.data.object;
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type)) {
      const session = object as Stripe.Checkout.Session;
      const id = session.metadata?.feedme_support_id;
      const stored = id ? readRecord<Support>(db, 'support', id) : undefined;
      if (stored) {
        if (stored.accountId !== event.account || session.mode !== (billingInterval(stored.frequency) ? 'subscription' : 'payment') || session.client_reference_id !== stored.id ||
          session.amount_total !== stored.amount || session.currency !== stored.currency || (stored.checkoutId && stored.checkoutId !== session.id))
          throw new Error('Payment does not match the stored support intent.');
        if (billingInterval(stored.frequency)) {
          bindSubscriptionCheckout(db, stored, session, ['checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type));
        } else {
          const paid = session.payment_status === 'paid';
          const failed = ['checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type);
          const next: Support = {
            ...stored, checkoutId: session.id,
            paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
            ...(paid && !stored.paidAt && Number.isFinite(event.created)
              ? { paidAt: new Date(event.created * 1000).toISOString() } : {}),
            // A delayed completion cannot undo refunds, disputes, or an already-paid record.
            status: stored.status === 'pending' || stored.status === 'failed' ? (paid ? 'paid' : failed ? 'failed' : stored.status) : stored.status,
          };
          queueSupport(db, next, ownerDid);
        }
      }
    } else if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
      const charge = object as Stripe.Charge | Stripe.Dispute;
      const paymentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
      const stored = listRecords<Support>(db, 'support').find((s) => (paymentId && s.paymentIntentId === paymentId) || s.id === supportIdHint || (event.type === 'charge.refunded' && s.id === charge.metadata?.feedme_support_id));
      // Return an error to Stripe so an event delivered before Checkout completion is retried.
      if (!stored) throw new Error('Payment intent has not been reconciled yet.');
      if (stored.accountId !== event.account || !paymentId || (stored.paymentIntentId && stored.paymentIntentId !== paymentId)) throw new Error('Payment account or intent mismatch.');
      if (event.type === 'charge.refunded') {
        if (!Number.isSafeInteger((charge as Stripe.Charge).amount_refunded) || (charge as Stripe.Charge).amount_refunded < 0 || (charge as Stripe.Charge).amount_refunded > stored.amount || charge.currency !== stored.currency) throw new Error('Refund does not match the original support.');
        const refundedAmount = Math.max(stored.refundedAmount, (charge as Stripe.Charge).amount_refunded);
        queueSupport(db, { ...stored, refundedAmount, status: refundedAmount >= stored.amount ? 'refunded' : stored.status, paymentIntentId: paymentId }, ownerDid);
      } else {
        const dispute = charge as Stripe.Dispute;
        const key = `dispute:${dispute.id}`;
        const last = getKv<{ created: number; closed: boolean }>(db, 'payment-order', key);
        const closed = event.type === 'charge.dispute.closed';
        if (!last?.closed && (!last || event.created >= last.created)) {
          const disputed = !closed || dispute.status !== 'won';
          queueSupport(db, { ...stored, paymentIntentId: paymentId, disputed, status: stored.refundedAmount >= stored.amount ? 'refunded' : disputed ? 'disputed' : 'paid' }, ownerDid);
          setKv(db, 'payment-order', key, { created: event.created, closed });
        }
      }
    }
    applyBillingEvent(db, event, ownerDid, billingContext);
    db.prepare('INSERT INTO events VALUES (?,?)').run(event.id, event.created);
    return 'processed';
  });
};
