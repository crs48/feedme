# Stripe setup for a self-hosted Feedme

Open **Dashboard → Settings → Set up Stripe**, or `/studio/stripe`. The page shows missing configuration, the deployment's webhook address, and payment/payout flags retrieved from Stripe. It does not collect bank details or store new API keys through a web form.

## What you need

Feedme currently uses **Stripe Connect with Standard connected accounts and direct charges**. The operator supplies credentials for a Connect-enabled **platform** account; the creator then onboards a connected account. A self-hosted creator configures both sides. Feedme does not operate a shared central payment platform, and this release does not charge directly against an arbitrary standalone account's own API key without Connect.

| Host variable | Value | Where it comes from |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Account-level restricted key (`rk_test_…` / `rk_live_…`), or secret key (`sk_test_…` / `sk_live_…`) | Stripe platform → API keys |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | The signing secret of this deployment's connected-account webhook destination |

These are two different secrets. A publishable `pk_…` key cannot replace the server key. The current Account Links integration does not require a `STRIPE_CLIENT_ID` or browser publishable key. Credentials belong in your hosting provider's secret variables, not Git, a support message, or public JavaScript. Stripe's [key documentation](https://docs.stripe.com/keys) describes the distinction between API keys and webhook signing secrets.

For **crs.tips**, use Railway → `feedme` → production → `crs-tips` → Variables. Add the variables and deploy the changes. No API key value appears on Feedme's setup page. A separate Stripe plugin connection for an AI assistant does not automatically configure these server variables.

## 1. Configure the platform and API permissions

Enable Connect in your Stripe account and complete Stripe's platform setup. Use [Stripe Connect](https://dashboard.stripe.com/connect/accounts/overview) and [API keys](https://dashboard.stripe.com/apikeys). Stripe determines account and country eligibility; completing account activation may require information from the account owner.

Prefer a restricted key dedicated to this Feedme instance. Match permissions to the operations below, including the **connected-account permissions** for requests made on the creator's account. Stripe's dashboard may group several operations under one resource permission; check the actual request logs in a sandbox before deploying the same permission set live. This is a code-derived API inventory, not a claim that every restricted-key permission combination has been tested against Stripe.

| Scope | Operations Feedme uses | Access |
| --- | --- | --- |
| Platform | Accounts: create the Standard account and retrieve readiness | Write (includes read) |
| Platform | Account Links: start/continue hosted onboarding | Write |
| Connected account | Checkout Sessions: create checkout and list sessions during recovery | Write |
| Connected account | Customer Portal configurations and sessions: configure cancellation and open billing management | Write |
| Connected account | Payment Intents, Invoices, Invoice Payments, Subscriptions, Disputes, and expanded Charge details: reconcile webhooks and restore history | Read |

Feedme does not issue refunds or payouts through its API. Those operations remain in Stripe. See Stripe's [restricted-key guidance](https://docs.stripe.com/keys/restricted-api-keys) for assigning permissions and investigating permission failures.

## 2. Complete creator onboarding

With the server key configured, select **Set up payouts with Stripe**. Feedme creates and remembers one Standard connected account, then redirects to a single-use Stripe-hosted Account Link. Further attempts reuse that account and create a fresh link. Enter business, identity-verification, and banking details directly on Stripe; the account owner completes agreements and verification.

On return, Feedme retrieves the saved account and displays `details_submitted`, `charges_enabled`, and `payouts_enabled`. Returning from Stripe alone does not mark onboarding complete. If a link expires, the setup page offers **Continue Stripe onboarding**. A provider failure does not replace the stored account. [Stripe's Standard onboarding guide](https://docs.stripe.com/connect/standard-accounts).

```mermaid
sequenceDiagram
  actor Creator
  participant Feedme
  participant Stripe
  participant Habitat
  Creator->>Feedme: Start or continue onboarding
  Feedme->>Stripe: Create/reuse connected account; request Account Link
  Stripe-->>Creator: Hosted onboarding
  Creator->>Stripe: Complete identity and payout details
  Stripe-->>Feedme: Return to setup page
  Feedme->>Stripe: Retrieve payment and payout flags
  Note over Feedme,Stripe: Return URL is not proof of readiness or payment
  Feedme->>Habitat: Protect checkout intent before opening checkout
  Stripe->>Feedme: Signed connected-account payment event
  Feedme->>Feedme: Verify and reconcile payment
```

## 3. Configure the webhook

In [Stripe Workbench → Webhooks](https://dashboard.stripe.com/workbench/webhooks), create an event destination:

- **Events from:** Connected accounts.
- **Payload:** Snapshot events, used by the current v1 integration.
- **Endpoint:** your setup page's URL, such as `https://crs.tips/api/stripe/webhook`.
- **API version:** `2026-08-26.dahlia`, matching the installed Stripe SDK. The setup page reads the version directly from the SDK.
- **Events:** select all 12 below.

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
charge.refunded
charge.dispute.created
charge.dispute.closed
invoice.paid
invoice.payment_failed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
```

Copy this endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`, then redeploy. A Stripe CLI forwarding secret is not the deployed endpoint's secret. Connect direct-charge events must be received from connected accounts, not just the platform account. [Stripe Connect webhook documentation](https://docs.stripe.com/connect/webhooks).

Feedme refuses to open charge-capable checkout without private storage and a webhook signing secret. A configured value only confirms presence: use Stripe's delivery logs and a sandbox payment to verify that the URL, selected events, and signing secret actually work together.

## 4. Test in an isolated deployment, then configure production

Use a separate Feedme deployment, HTTPS origin, persistent `DATA_DIR`, Stripe sandbox credentials, and sandbox webhook for testing. This release stores one connected account per data directory. Replacing test keys with live keys in an existing directory does not migrate that account or its ledger. Keep production history intact; do not delete the database to change Stripe modes.

Verify a one-time payment, a recurring payment and renewal, cancellation, partial and full refunds, webhook retries, and private recovery using the [payment acceptance checklist](hosting.md#live-acceptance-checklist). Confirm successful webhook delivery and the expected payment state in Feedme. A success redirect never marks a payment paid.

Configure the production deployment separately with live credentials and complete its live onboarding. A green setup flag means the required configuration and account flags are present; it does not replace end-to-end testing or guarantee every payment method is eligible.
