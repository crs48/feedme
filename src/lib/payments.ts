import Stripe from 'stripe';
import type { DatabaseSync } from 'node:sqlite';
import { config } from './config';
import { enqueue, getDb, getKv, listRecords, putRecord, readRecord, setKv, transaction } from './db';
import { NS, privateReceipt, publicAcknowledgment, type Support } from './model';
import { privateSpace } from './habitat';

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
export const checkout = async (intent: Support, title: string) => {
  if (!privateSpace()) throw new Error('The creator needs to connect private storage before receiving support.');
  const stripe = stripeClient();
  const account = connectedAccount();
  if (!account) throw new Error('The creator hasn’t connected Stripe yet.');
  const readiness = await stripe.accounts.retrieve(account);
  if (!readiness.charges_enabled || !readiness.payouts_enabled) throw new Error('The creator’s Stripe account is still being set up.');
  const current = { ...intent, accountId: account };
  putRecord(getDb(), 'support', intent.id, current);
  const result = await stripe.checkout.sessions.create({
    mode: 'payment', client_reference_id: intent.id,
    metadata: { feedme_support_id: intent.id },
    payment_intent_data: { metadata: { feedme_support_id: intent.id } },
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: intent.amount, product_data: { name: `Support: ${title}` } } }],
    success_url: `${config().origin}/thanks?id=${intent.id}`,
    cancel_url: `${config().origin}/support/${intent.projectId}?notice=Checkout%20canceled.%20You%20have%20not%20been%20charged.`,
  }, { stripeAccount: account, idempotencyKey: `feedme-checkout-${intent.id}` });
  // A webhook may arrive before this API call returns. Preserve its newer status.
  const latest = readRecord<Support>(getDb(), 'support', intent.id) || current;
  putRecord(getDb(), 'support', intent.id, { ...latest, checkoutId: result.id });
  if (!result.url) throw new Error('Stripe did not return a checkout URL.');
  return result.url;
};

const queueSupport = (db: DatabaseSync, s: Support, ownerDid: string) => {
  putRecord(db, 'support', s.id, s);
  enqueue(db, 'private', `${NS}.support`, s.id, privateReceipt(s));
  if (s.visibility === 'public') enqueue(db, 'public', `${NS}.acknowledgment`, s.id, publicAcknowledgment(s, ownerDid));
};
// Called only AFTER verifying Stripe's raw-body signature. Exported for deterministic tests.
export const applyStripeEvent = (db: DatabaseSync, event: Stripe.Event, ownerDid: string, accountId: string, supportIdHint?: string) => {
  if (event.account !== accountId) throw new Error('Unexpected connected account.');
  return transaction(db, () => {
    if (db.prepare('SELECT 1 FROM events WHERE id=?').get(event.id)) return 'duplicate';
    const object = event.data.object;
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type)) {
      const session = object as Stripe.Checkout.Session;
      const id = session.metadata?.feedme_support_id;
      const stored = id ? readRecord<Support>(db, 'support', id) : undefined;
      if (stored) {
        if (stored.accountId !== event.account || session.mode !== 'payment' || session.client_reference_id !== stored.id ||
          session.amount_total !== stored.amount || session.currency !== stored.currency || (stored.checkoutId && stored.checkoutId !== session.id))
          throw new Error('Payment does not match the stored support intent.');
        const paid = session.payment_status === 'paid';
        const failed = ['checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type);
        const next: Support = {
          ...stored, checkoutId: session.id,
          paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
          // A delayed completion cannot undo refunds, disputes, or an already-paid record.
          status: stored.status === 'pending' || stored.status === 'failed' ? (paid ? 'paid' : failed ? 'failed' : stored.status) : stored.status,
        };
        queueSupport(db, next, ownerDid);
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
    db.prepare('INSERT INTO events VALUES (?,?)').run(event.id, event.created);
    return 'processed';
  });
};
