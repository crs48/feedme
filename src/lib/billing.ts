import type Stripe from 'stripe';
import { stripeRequestOptions } from './stripe-context';
import { config } from './config';
import { getDb, getKv, setKv } from './db';

export type BillingPortal = { id: string; loginUrl?: string };
const portalKey = (account: string) => `billing-portal:${account}:${config().origin}`;
export const savedBillingPortal = (account: string) => getKv<BillingPortal>(getDb(), 'app', portalKey(account));
export const ensureBillingPortal = async (stripe: Stripe, account: string): Promise<BillingPortal> => {
  const saved = savedBillingPortal(account);
  if (saved) return saved;
  const portal = await stripe.billingPortal.configurations.create({
    business_profile: { privacy_policy_url: `${config().origin}/privacy` },
    default_return_url: `${config().origin}/billing`, login_page: { enabled: true },
    features: { invoice_history: { enabled: true }, payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
      subscription_update: { enabled: false },
    },
  }, { ...stripeRequestOptions(account), idempotencyKey: `feedme-portal-v1-${config().origin}` });
  const value = { id: portal.id, ...(portal.login_page?.url ? { loginUrl: portal.login_page.url } : {}) };
  setKv(getDb(), 'app', portalKey(account), value);
  return value;
};
