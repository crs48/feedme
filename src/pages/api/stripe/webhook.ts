import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { config } from '../../../lib/config';
import { getDb, listRecords } from '../../../lib/db';
import type { Support } from '../../../lib/model';
import { invoiceRootId, recurringRefundSupportId, verifiedInvoicePayment, type BillingEventContext } from '../../../lib/recurring';
import { applyStripeEvent, connectedAccount, stripeClient } from '../../../lib/payments';

export const POST: APIRoute = async ({ request }) => {
  const cfg = config();
  if (cfg.demo || !cfg.stripeWebhookSecret || !connectedAccount()) return new Response('Webhook not configured', { status: 503 });
  let event;
  try {
    const body = await request.text();
    event = stripeClient().webhooks.constructEvent(body, request.headers.get('stripe-signature') || '', cfg.stripeWebhookSecret);
  } catch { return new Response('Invalid signature', { status: 400 }); }
  if (event.account !== connectedAccount()) return Response.json({ ignored: true });
  try {
    let supportIdHint: string | undefined;
    const stripe = stripeClient();
    const account = connectedAccount()!;
    const billingContext: BillingEventContext = {};
    if (event.type === 'invoice.paid' && invoiceRootId(event.data.object as Stripe.Invoice)) {
      billingContext.payment = await verifiedInvoicePayment(stripe, event.data.object as Stripe.Invoice, account);
    }
    if (['customer.subscription.created', 'customer.subscription.updated'].includes(event.type) && (event.data.object as Stripe.Subscription).metadata.feedme_support_id) {
      billingContext.subscription = await stripe.subscriptions.retrieve((event.data.object as Stripe.Subscription).id, {}, { stripeAccount: account });
    }
    if (['charge.refunded', 'charge.dispute.created', 'charge.dispute.closed'].includes(event.type)) {
      const object = event.data.object as Stripe.Charge | Stripe.Dispute;
      const paymentIntentId = typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id;
      if (!paymentIntentId) return Response.json({ ignored: true });
      // Identify our payment even when a refund/dispute arrives before Checkout's event.
      // Other charges made directly by the creator are outside this application.
      const intent = await stripeClient().paymentIntents.retrieve(paymentIntentId, {}, { stripeAccount: connectedAccount()! });
      supportIdHint = listRecords<Support>(getDb(), 'support').find((support) => support.accountId === account && support.paymentIntentId === paymentIntentId)?.id
        || intent.metadata.feedme_support_id || await recurringRefundSupportId(stripe, paymentIntentId, account);
      if (!supportIdHint) return Response.json({ ignored: true });
    }
    applyStripeEvent(getDb(), event, cfg.ownerDid, account, supportIdHint, billingContext);
    return Response.json({ received: true });
  } catch {
    // Never log payment objects or raw request bodies. Stripe retries non-2xx responses.
    console.error('Stripe event could not be reconciled:', event.id, event.type);
    return new Response('Reconciliation will be retried', { status: 500 });
  }
};
