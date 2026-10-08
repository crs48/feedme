import type Stripe from 'stripe';
import type { DatabaseSync } from 'node:sqlite';
import { stripeBindingSchema, type StripeBinding } from './stripe-binding';
import { config } from './config';
import { getDb, getKv, setKv, transaction } from './db';

export const stripeLiveMode = () => {
  const cfg = config();
  const match = /^(?:sk|rk)_(live|test)_/.exec(cfg.stripeKey || '');
  if (!match) throw new Error('Configure a Stripe server API key.');
  if (cfg.stripeEnvironment && cfg.stripeEnvironment !== match[1]) throw new Error('Stripe key does not match the configured environment.');
  return match[1] === 'live';
};
export const paymentAccount = (db = getDb()) => config().stripeMode === 'own-account'
  ? config().stripeAccountId || undefined : getKv<string>(db, 'app', 'stripe-account');
export const stripeRequestOptions = (account: string): Stripe.RequestOptions => {
  if (config().stripeMode !== 'own-account') return { stripeAccount: account };
  if (!account || account !== config().stripeAccountId) throw new Error('Stripe account does not match deployment configuration.');
  return {};
};
export const assertStripeBinding = (db: DatabaseSync, account: string) => {
  const proposed = stripeBindingSchema.parse({ accountId: account, mode: config().stripeMode || 'connect', livemode: stripeLiveMode() });
  const stored = getKv<StripeBinding>(db, 'app', 'stripe-binding');
  const saved = stored ? stripeBindingSchema.parse(stored) : undefined;
  const legacy = getKv<string>(db, 'app', 'stripe-account');
  if ((saved && (saved.accountId !== proposed.accountId || saved.mode !== proposed.mode || saved.livemode !== proposed.livemode)) ||
    (legacy && (legacy !== account || (!saved && proposed.mode === 'own-account'))))
    throw new Error('This database belongs to a different Stripe account or mode. Use a separate data directory.');
  return proposed;
};
export const verifyStripeAccount = async (stripe: Stripe, account: string, db = getDb(), persist = false) => {
  const binding = assertStripeBinding(db, account);
  // In own-account mode, retrieve the key's owner; never retrieve an arbitrary account ID.
  const actual = binding.mode === 'own-account'
    ? await stripe.accounts.retrieve(null, {}, { timeout: 5000, maxNetworkRetries: 0 })
    : await stripe.accounts.retrieve(account, {}, { timeout: 5000, maxNetworkRetries: 0 });
  if (actual.id !== account) throw new Error('The Stripe key belongs to a different account.');
  if (persist && !getKv(db, 'app', 'stripe-binding')) transaction(db, () => {
    assertStripeBinding(db, account);
    setKv(db, 'app', 'stripe-binding', binding);
    setKv(db, 'app', 'stripe-account', account);
  });
  return actual;
};
// Normalize only after signature verification. Domain events retain a single merchant ID.
export const merchantEvent = (event: Stripe.Event, db: DatabaseSync, account: string): Stripe.Event | undefined => {
  const binding = assertStripeBinding(db, account);
  if (event.livemode !== binding.livemode) return;
  if (binding.mode === 'connect') return event.account === account ? event : undefined;
  if (event.account || !getKv(db, 'app', 'stripe-binding')) return;
  return { ...event, account };
};
