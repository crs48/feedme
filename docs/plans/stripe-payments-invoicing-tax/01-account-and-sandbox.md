# 01 · Account ownership and sandbox

## Objective

Make the payment account explicit before adding another billing flow. Reuse the connected Stripe plugin for planning/account inspection. No fallback skill installation is needed while it works. Plugin access and application server credentials are separate.

## Proposed design

Retain the current Connect deployment path. Offer an optional own-account mode for an individually hosted creator, subject to the operator's choice. For the reusable self-hosted product, evaluate Stripe Apps with restricted-key authentication as the eventual installation experience; Stripe's [self-hosting guidance](https://docs.stripe.com/stripe-apps/plugins/decide-migration) specifically addresses per-user backends and webhook endpoints.

Introduce one server-side adapter rather than scattering account-header conditionals:

```ts
type StripeBinding = {
  accountId: string;
  livemode: boolean;
  mode: 'connect' | 'own-account';
};
```

- Resolve and verify the authenticated seller context using the supported Stripe account APIs. Pin the account and mode in private recovery metadata.
- Connect requests keep the connected-account context. Own-account requests use the merchant's restricted key without impersonating another account.
- Connect webhook destinations receive connected-account events; own-account destinations receive account events. Verify raw signatures, pinned environment, and expected account semantics. An absent `event.account` is never sufficient authorization by itself.
- Bind checkout intents, subscriptions, customers, portal configuration, idempotency, and recovery requests to the same context. Reject a silent key/mode/account switch.
- Preserve existing Connect records. Initially require a clean installation for changing account mode unless an explicit migration handles all outstanding payments and subscriptions.
- For new Connect account creation, evaluate Accounts v2 configuration and compatibility independently. Existing v1 accounts must keep working; no automatic deletion or recreation.
- Keep hosted onboarding for the current flow. New embedded onboarding is a separate UI decision, not necessary for reviewing the existing app.

## Credentials and environments

Use a dedicated restricted API key with only the operations documented in [Stripe setup](../../stripe-setup.md), adjusted for the chosen mode. Add invoice write permissions only if Feedme actually creates invoices. Add Tax read permissions for readiness; do not grant registration-write access just to display status.

Use separate sandbox and production origins, persistent data directories, secrets, webhook destinations, and test identities/private storage. Do not point two active Feedme writers at the same creator recovery space. Keep `crs.tips` production data intact; do not install test credentials there merely because the plugin exposes a test account.

The operator stores `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in host secrets. Never commit keys or ask for them in a chat message. Prefer a restricted key over a broad secret key. Stripe-hosted business verification and banking remain owner actions.

## Touchpoints and acceptance

[config.ts](../../../src/lib/config.ts), [payments.ts](../../../src/lib/payments.ts), [billing.ts](../../../src/lib/billing.ts), [recurring.ts](../../../src/lib/recurring.ts), [webhook.ts](../../../src/pages/api/stripe/webhook.ts), [stripe-setup.ts](../../../src/lib/stripe-setup.ts), and [recovery-stripe.ts](../../../src/lib/recovery-stripe.ts).

- [ ] Confirm the chosen mode before changing server behavior.
- [ ] Verify restricted-key operations against the intended account in a sandbox.
- [ ] Test wrong account, wrong mode, absent account, rotated credentials, and malformed signatures.
- [ ] Confirm pending checkouts/renewals cannot be moved to a different account by changing configuration.
- [ ] Update onboarding instructions and private recovery schema for the chosen mode.
