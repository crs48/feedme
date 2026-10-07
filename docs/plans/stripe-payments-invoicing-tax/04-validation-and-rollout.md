# 04 · Acceptance and release

## Objective

Prove the selected account mode, invoicing flow, and any tax changes against a real isolated Stripe sandbox before deploying them with live credentials. Automated fixtures complement provider tests; they do not prove account activation or webhook delivery.

## Ordered checks

1. Establish sandbox credentials in server secret storage. Verify account/environment binding, webhook scope/signature, provider API version, and least-privilege access. Keep the production data directory and creator recovery space isolated.
2. Exercise one-time support, decline, authentication challenge, cancellation, and delayed payment success/failure. A redirect alone must not mark anything paid.
3. Retry identical requests and webhook deliveries. Reorder completion, renewal, refund, and dispute events; preserve idempotency and settled states.
4. Exercise monthly and yearly support, subsequent invoices, failed renewal, portal cancellation, and a payment-method update.
5. Create a sandbox coaching invoice with synthetic customer details. Verify hosted payment, invoice status, partial settlement, credit note, refund, void, and out-of-band settlement classification. Do not send an invoice to a real recipient as a test.
6. If tax is implemented, test no registration, active test registration, valid/invalid customer location, inclusive/exclusive pricing, exemptions, renewal tax changes, refunds, and credits. Check every integer-cent invariant and the tax reporting record.
7. Restore a fresh isolated database from encrypted backups and Habitat checkpoints. Reconcile provider records using the restored account/environment binding. Restore must not duplicate charges, send invoices, or republish private information.
8. Verify visitor/admin pages, support receipts, analytics, and static demo isolation. Add invoice UI and Tax states to offline fixtures only when they exist.
9. Run `pnpm check`, `pnpm test`, and `pnpm build`; run `pnpm build:site` and container/contract checks when affected. Update plan checkboxes only for completed evidence.

## Production rollout

After the implementation and sandbox evidence are reviewed, configure the live seller and webhook separately. The owner completes business verification, banking, and applicable agreements. Confirm live tax setup independently; test-mode results do not establish live readiness.

Back up the database and encryption keys before schema migration. Keep previous account bindings and payment IDs; disabling new checkout must not disable incoming reconciliation for outstanding payments. Define rollback around compatible schema reads and paused checkout, never database deletion or account replacement.

Use conventional commits with detailed validation notes. State separately which automated checks passed, which sandbox scenarios were actually exercised, and which live prerequisites remain. Do not mark the system production-validated merely because the build or readiness page is green.

## Checklist

- [ ] Account mode and webhook isolation validated against Stripe.
- [ ] Payment, subscription, invoice, tax, and refund scenarios verified as applicable.
- [ ] Private recovery and public-data boundaries verified.
- [ ] Required repository checks pass on the implementation revision.
- [ ] Migration backup and rollback path reviewed.
- [ ] Live account activation, credentials, and optional Tax readiness confirmed.

See the existing [live acceptance checklist](../../hosting.md#live-acceptance-checklist) and [backup/restore guide](../../backups-and-recovery.md).
