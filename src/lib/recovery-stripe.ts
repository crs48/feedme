import type { DatabaseSync } from 'node:sqlite';
import type Stripe from 'stripe';
import { config } from './config';
import { getKv, listRecords, putRecord, readRecord, setKv } from './db';
import { stripeClient } from './payments';
import type { Support } from './model';
import { applyBillingEvent, bindSubscriptionCheckout, stripeId, verifiedInvoicePayment } from './recurring';

const MAX_RESOURCES = 100_000;
// Only resource reads are used. This path must never create sessions, charges, refunds or subscriptions.
export const reconcileStripe = async (db: DatabaseSync, client?: Stripe) => {
  const account = getKv<string>(db, 'app', 'stripe-account');
  const before = listRecords<Support>(db, 'support');
  if (!account) { if (before.length) throw new Error('Payments cannot be reconciled without a connected account.'); setKv(db, 'recovery', 'reconciled-at', new Date().toISOString()); return 'No Stripe account or payments to reconcile.'; }
  const stripe = client || stripeClient(); const options = { stripeAccount: account }; const now = Math.floor(Date.now() / 1000);
  await stripe.accounts.retrieve(account);
  let scanned = 0; const limit = () => { if (++scanned > MAX_RESOURCES) throw new Error('Stripe recovery exceeded the resource limit; no partial recovery may resume.'); };
  for await (const session of stripe.checkout.sessions.list({ limit: 100 }, options)) {
    limit(); const id = session.metadata?.feedme_support_id; if (!id) continue;
    const root = readRecord<Support>(db, 'support', id);
    if (!root) throw new Error('Stripe contains a Feedme checkout whose allocation intent is missing from this recovery. Choose a newer backup or Habitat checkpoint.');
    if (root.accountId !== account || session.client_reference_id !== id || session.amount_total !== root.amount || session.currency !== root.currency || (root.checkoutId && root.checkoutId !== session.id) || session.mode !== (root.frequency && root.frequency !== 'once' ? 'subscription' : 'payment')) throw new Error('Stripe checkout does not match its recovered intent.');
    if (session.mode === 'subscription') bindSubscriptionCheckout(db, root, session, session.status === 'expired');
    else { const paymentIntentId = stripeId(session.payment_intent); if (root.paymentIntentId && root.paymentIntentId !== paymentIntentId) throw new Error('Stripe payment intent binding changed.'); putRecord(db, 'support', id, { ...root, checkoutId: session.id, ...(paymentIntentId ? { paymentIntentId } : {}), status: session.status === 'expired' && root.status === 'pending' ? 'failed' : root.status }); }
  }
  for await (const subscription of stripe.subscriptions.list({ status: 'all', limit: 100 }, options)) {
    limit(); const id = subscription.metadata.feedme_support_id; if (!id) continue;
    if (!readRecord(db, 'support', id)) throw new Error('Stripe contains a subscription whose allocation intent is missing.');
    applyBillingEvent(db, { type: 'customer.subscription.updated', created: now, account, data: { object: subscription } } as Stripe.Event, config().ownerDid, { subscription });
    for await (const invoice of stripe.invoices.list({ subscription: subscription.id, limit: 100 }, options)) {
      limit(); if (invoice.status !== 'paid' && invoice.status !== 'open' && invoice.status !== 'uncollectible') continue;
      const payment = invoice.status === 'paid' ? await verifiedInvoicePayment(stripe, invoice, account) : undefined;
      applyBillingEvent(db, { type: payment ? 'invoice.paid' : 'invoice.payment_failed', created: now, account, data: { object: invoice } } as Stripe.Event, config().ownerDid, { payment });
    }
  }
  for (const support of listRecords<Support>(db, 'support')) {
    if (!support.paymentIntentId) { if (['paid', 'refunded', 'disputed'].includes(support.status)) throw new Error('A settled payment cannot be verified with Stripe.'); continue; }
    limit(); const intent = await stripe.paymentIntents.retrieve(support.paymentIntentId, { expand: ['latest_charge'] }, options);
    if (support.accountId !== account || intent.amount !== support.amount || intent.currency !== support.currency || (!support.invoiceId && intent.metadata.feedme_support_id !== support.id)) throw new Error('Stripe payment amount, currency or identity mismatch.');
    if (intent.status !== 'succeeded') {
      if (['paid', 'refunded', 'disputed'].includes(support.status)) throw new Error('A previously settled payment is no longer confirmed by Stripe.');
      putRecord(db, 'support', support.id, { ...support, status: intent.status === 'canceled' ? 'failed' : 'pending' }); continue;
    }
    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : undefined;
    if (intent.amount_received !== support.amount || !charge || charge.amount !== support.amount || charge.currency !== support.currency || charge.amount_refunded > support.amount || !charge.paid) throw new Error('Stripe charge cannot verify the recovered payment.');
    let disputed = false;
    for await (const dispute of stripe.disputes.list({ payment_intent: intent.id, limit: 100 }, options)) {
      limit(); if (!['won', 'warning_closed'].includes(dispute.status)) disputed = true;
      setKv(db, 'payment-order', `dispute:${dispute.id}`, { created: now, closed: ['won', 'lost', 'warning_closed'].includes(dispute.status) });
    }
    putRecord(db, 'support', support.id, { ...support, refundedAmount: charge.amount_refunded, disputed, status: charge.amount_refunded >= support.amount ? 'refunded' : disputed ? 'disputed' : 'paid', paidAt: support.paidAt || new Date(charge.created * 1000).toISOString() });
  }
  db.exec('DELETE FROM outbox'); // Reconciliation stages facts; resuming explicitly rebuilds projections.
  setKv(db, 'recovery', 'reconciled-at', new Date().toISOString());
  return `${scanned} Stripe resources checked. No payments were created or modified.`;
};
