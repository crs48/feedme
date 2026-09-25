# 03 · Payments and hosting

Use Stripe Connect direct charges with hosted onboarding and Checkout. Let Stripe choose eligible payment methods, including wallets. No checkout JavaScript is required. Start with USD one-time support; recurring billing requires a separate invoice and subscription lifecycle.

```mermaid
sequenceDiagram
  participant Supporter
  participant Feedme
  participant Stripe
  participant Habitat
  Supporter->>Feedme: Amount, project, visibility
  Feedme->>Feedme: Persist pending intent
  Feedme->>Stripe: Create connected-account Checkout
  Stripe-->>Supporter: Hosted payment page
  Stripe->>Feedme: Signed webhook
  Feedme->>Feedme: Verify account, amount, currency; deduplicate
  Feedme->>Habitat: Queue private receipt and consented public acknowledgment
  Stripe-->>Supporter: Redirect to friends and payment status
```

- [x] Owner-only Connect onboarding and account readiness checks.
- [x] Validate amounts, privacy choices, identity, and project state server-side.
- [x] Create checkout with a stable idempotency key.
- [x] Verify webhook signatures from raw bytes and validate connected-account ownership.
- [x] Handle asynchronous success/failure, duplicates, refunds, and disputes.
- [x] Display confirmation only after a verified event; redirects alone never mark tips paid.
- [x] Ship Docker, Compose, Railway settings, CI, and setup documentation.
- [x] Run type checks, unit/integration tests, production build, and browser checks.
- [ ] Complete real provider smoke tests with operator credentials before production use.

Deploy one replica with a persistent volume. Use HTTPS for OAuth. A second replica requires distributed session locks and a shared database, so do not suggest horizontal scaling with SQLite. Container startup must not run schema-destructive commands or require provider credentials just to preview the demo.
