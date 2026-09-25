import type { APIRoute } from 'astro';
import { config } from '../../../lib/config';
import { getDb } from '../../../lib/db';
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
    applyStripeEvent(getDb(), event, cfg.ownerDid, connectedAccount()!);
    return Response.json({ received: true });
  } catch {
    // Never log payment objects or raw request bodies. Stripe retries non-2xx responses.
    console.error('Stripe event could not be reconciled:', event.id, event.type);
    return new Response('Reconciliation will be retried', { status: 500 });
  }
};
