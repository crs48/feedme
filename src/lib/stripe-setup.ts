import Stripe from 'stripe';
import { config } from './config';
import { privateSpace } from './habitat';
import { connectedAccount, stripeClient } from './payments';

export const stripeWebhookEvents = [
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'checkout.session.expired',
  'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed',
  'invoice.paid', 'invoice.payment_failed', 'customer.subscription.created',
  'customer.subscription.updated', 'customer.subscription.deleted',
] as const;
export const stripeApiVersion = Stripe.API_VERSION;
export const stripeKeyMode = (key: string) => /^(sk|rk)_test_/.test(key) ? 'test' : /^(sk|rk)_live_/.test(key) ? 'live' : 'unknown';

// This status is for authenticated administrators only. Never return credentials,
// Stripe's account object, requirements fields, or provider error messages.
export const stripeSetup = async () => {
  const cfg = config();
  const account = connectedAccount();
  const base = {
    demo: cfg.demo, mode: stripeKeyMode(cfg.stripeKey),
    keyConfigured: Boolean(cfg.stripeKey), webhookConfigured: Boolean(cfg.stripeWebhookSecret),
    storageConnected: Boolean(privateSpace()), accountConnected: Boolean(account),
    webhookUrl: `${cfg.origin}/api/stripe/webhook`,
    accountCheck: 'not-checked' as 'not-checked' | 'verified' | 'unavailable',
    detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false,
  };
  if (cfg.demo || !cfg.stripeKey || !account) return base;
  try {
    const result = await stripeClient().accounts.retrieve(account, {}, { timeout: 5000, maxNetworkRetries: 0 });
    if (result.id !== account) return { ...base, accountCheck: 'unavailable' as const };
    return { ...base, accountCheck: 'verified' as const, detailsSubmitted: result.details_submitted === true,
      chargesEnabled: result.charges_enabled === true, payoutsEnabled: result.payouts_enabled === true };
  } catch { return { ...base, accountCheck: 'unavailable' as const }; }
};
