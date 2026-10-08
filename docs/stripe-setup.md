# Stripe setup for a self-hosted Feedme

Open **Dashboard → Settings → Set up Stripe**, or `/studio/stripe`. The page shows missing configuration, the deployment's webhook address, and payment/payout flags retrieved from Stripe. It does not collect bank details or store new API keys through a web form.

## What you need

Choose the payment mode for this installation:

- **Own account** (`STRIPE_MODE=own-account`): recommended for a personal site such as **crs.tips**. Tips go into your existing Stripe account using its restricted server key. No Connect platform or second merchant account is needed.
- **Connect** (`STRIPE_MODE=connect`, the default): preserve the existing platform + Standard connected account setup. The platform supplies its key; the creator completes hosted onboarding. Feedme does not operate a shared central payment platform.

| Host variable | Value | Where it comes from |
| --- | --- | --- |
| `STRIPE_MODE` | `own-account` or `connect` | Your deployment choice |
| `STRIPE_ACCOUNT_ID` | `acct_…`, required for own-account | Stripe → account settings; must match the key owner |
| `STRIPE_ENVIRONMENT` | `live` for production, `test` for sandbox | Explicit key-mode guard |
| `STRIPE_SECRET_KEY` | Dedicated restricted key (`rk_test_…` / `rk_live_…`) | Stripe → API keys, in the chosen account/environment |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | This deployment's webhook destination signing secret |

These are two different secrets. A publishable `pk_…` key cannot replace the server key. The current Account Links integration does not require a `STRIPE_CLIENT_ID` or browser publishable key. Credentials belong in your hosting provider's secret variables, not Git, a support message, or public JavaScript. Stripe's [key documentation](https://docs.stripe.com/keys) describes the distinction between API keys and webhook signing secrets.

For **crs.tips**, use Railway → `feedme` → production → `crs-tips` → Variables. Add the variables and deploy the changes. No API key value appears on Feedme's setup page. A separate Stripe plugin connection for an AI assistant does not automatically configure these server variables.

## 1. Configure the account and API permissions

**Own-account mode:** activate your existing Stripe account and configure the five variables above. Feedme retrieves the authenticated key owner and checks its ID against `STRIPE_ACCOUNT_ID`.

**Connect mode:** enable Connect in your Stripe account and complete Stripe's platform setup. Use [Stripe Connect](https://dashboard.stripe.com/connect/accounts/overview) and [API keys](https://dashboard.stripe.com/apikeys). Stripe determines account and country eligibility; completing account activation may require information from the account owner.

Prefer a restricted key dedicated to this Feedme instance. In own-account mode, grant **Accounts read**, **Checkout Sessions write**, **Customer Portal write**, and **Payment Intents, Charges, Invoices, Invoice Payments, Subscriptions, and Disputes read** on your own account. Do not grant Account Links or account creation permissions.

For Connect mode, match the operations below, including the **connected-account permissions** for requests made on the creator's account. Stripe's dashboard may group several operations under one resource permission; check the actual request logs in a sandbox before deploying the same permission set live. This is a code-derived API inventory, not a claim that every restricted-key permission combination has been tested against Stripe.

| Scope | Operations Feedme uses | Access |
| --- | --- | --- |
| Platform | Accounts: create the Standard account and retrieve readiness | Write (includes read) |
| Platform | Account Links: start/continue hosted onboarding | Write |
| Connected account | Checkout Sessions: create checkout and list sessions during recovery | Write |
| Connected account | Customer Portal configurations and sessions: configure cancellation and open billing management | Write |
| Connected account | Payment Intents, Invoices, Invoice Payments, Subscriptions, Disputes, and expanded Charge details: reconcile webhooks and restore history | Read |

Feedme does not issue refunds or payouts through its API. Those operations remain in Stripe. See Stripe's [restricted-key guidance](https://docs.stripe.com/keys/restricted-api-keys) for assigning permissions and investigating permission failures.

## 2. Complete creator onboarding

**Own-account mode:** complete any outstanding identity, business, and bank requirements directly in your existing Stripe Dashboard. Refresh Feedme’s setup page to verify payment and payout readiness. Feedme does not create another account.

**Connect mode:** with the server key configured, select **Set up payouts with Stripe**. Feedme creates and remembers one Standard connected account, then redirects to a single-use Stripe-hosted Account Link. Further attempts reuse that account and create a fresh link. Enter business, identity-verification, and banking details directly on Stripe; the account owner completes agreements and verification.

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
  Stripe->>Feedme: Signed payment event in the configured account/mode
  Feedme->>Feedme: Verify and reconcile payment
```

## 3. Configure the webhook

In [Stripe Workbench → Webhooks](https://dashboard.stripe.com/workbench/webhooks), create an event destination:

- **Events from:** **Your account** for own-account mode; **Connected accounts** for Connect mode.
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

Use a separate Feedme deployment, HTTPS origin, persistent `DATA_DIR`, encryption keys, test identity/private Habitat recovery space, Stripe sandbox credentials, and sandbox webhook. Never run two active writers against the same Habitat recovery space.

Before the first checkout, Feedme pins the verified merchant ID, account mode, and test/live environment in private recovery metadata. Later requests reject a different binding. Key rotation within the same account and environment is supported. A legacy Connect database cannot silently become an own-account database. Keep production history intact; changing a key is not a data migration.

Verify a one-time payment, a recurring payment and renewal, cancellation, partial and full refunds, webhook retries, and private recovery using the [payment acceptance checklist](hosting.md#live-acceptance-checklist). Confirm successful webhook delivery and the expected payment state in Feedme. A success redirect never marks a payment paid.

Configure the production deployment separately with live credentials and complete its live onboarding. A green setup flag means the required configuration and account flags are present; it does not replace end-to-end testing or guarantee every payment method is eligible.

## Invoicing and Tax

For coaching sold as a service, start with [Stripe Dashboard invoices](https://docs.stripe.com/invoicing/dashboard). Stripe hosts the invoice and payment page. Standalone coaching invoices are separate from unconditional tips and do not appear in Feedme’s support totals.

Feedme does **not** enable automatic tax in this release. Tax requires confirmed seller registrations, product treatment, and ledger changes to separate tax from support. Do not add `automatic_tax` directly to checkout: the current ledger deliberately requires Stripe's paid amount to equal the stored tip. See the [Payments, Invoicing, and Tax plan](plans/stripe-payments-invoicing-tax/README.md).
