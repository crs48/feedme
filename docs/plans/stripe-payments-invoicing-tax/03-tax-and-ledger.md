# 03 · Tax-aware accounting and activation

## Objective and prerequisites

Add Stripe Tax without conflating collected tax with creator support or service revenue. Depends on verified seller context and distinct support/invoice flows. No tax collection is enabled by this plan.

Confirm the actual seller, business origin, customer locations, product classification, and active registrations on the account responsible for the transaction. A zero tax amount can mean no registration, exemption, reverse charge, or a non-taxable product; it is not a readiness check. Test registrations are not evidence of live legal registration. Resolve uncertain obligations with the operator and their qualified tax adviser.

## Monetary model

The current `Support.amount`, allocation sum, Stripe total, and refund ceiling are the same value. Preserve historical semantics through a schema version. Introduce a private settlement breakdown that distinguishes:

- Original support/service price and its inclusive/exclusive tax behavior.
- Subtotal before tax, discounts if supported, tax, and total charged.
- Refund/credit components attributable to principal and tax.
- Currency, source account/environment, provider transaction references, and schema version.

Define and test the invariants before changing webhook comparisons:

```text
subtotal - discounts + tax = total charged
refunded principal + refunded tax = cash refunded
project allocations sum to support principal, excluding collected tax
public support totals exclude tax and private/service payments
```

For inclusive pricing, split the quoted amount into principal and tax using Stripe's verified breakdown. For exclusive pricing, preserve the principal and add tax to the charged total. The review/receipt must make the pricing policy clear; tax can finalize at Stripe after the customer supplies location. Never silently treat the extra amount as more support.

For recurring support, freeze the principal and allocation preferences, but capture each invoice's actual tax separately. Customer location and tax rules can change between renewals. Validate the expected base and verified tax breakdown instead of requiring every future gross total to equal the original principal.

Refunds and credit notes need explicit reconciliation rules with cent conservation and no double counting. Historical records upgrade with tax zero and their previous amount as principal/total; do not reinterpret already-published amounts retroactively. Recoverable records, receipts, analytics, public totals, and share cards must agree.

## Stripe configuration and activation gate

1. Retrieve tax settings and active registrations in the verified seller's account context.
2. Confirm correct product tax codes and explicit price `tax_behavior` for each real offering. Do not invent one code for all links or infer an exemption because the interface says “tip.”
3. Collect customer location through hosted Checkout/Invoices; collect tax IDs when appropriate to the service's actual customers. Avoid copying those fields into Feedme unless required.
4. Require an explicit operator activation after sandbox acceptance. For Connect direct charges, inspect the connected merchant's tax settings/registrations rather than assuming the platform's settings apply.
5. Enable `automatic_tax` only in supported, verified flows. If required tax configuration fails, stop that checkout and show an actionable error; do not silently retry with tax disabled.
6. Explain readiness accurately: calculation/collection is separate from registration, filing, and remittance. Do not advertise automated filing merely because automatic tax is enabled.

## Touchpoints and acceptance

[model.ts](../../../src/lib/model.ts), [payments.ts](../../../src/lib/payments.ts), [recurring.ts](../../../src/lib/recurring.ts), [recovery-model.ts](../../../src/lib/recovery-model.ts), [recovery-import.ts](../../../src/lib/recovery-import.ts), [recovery-stripe.ts](../../../src/lib/recovery-stripe.ts), and the existing support projections.

- [ ] Define versioned amounts and migration; extend private checkpoint manifests.
- [ ] Keep public allowlists free of tax/customer identifiers and billing details.
- [ ] Test exclusive/inclusive tax, zero tax with reason, exemptions, missing address, missing registration, tax failure, and invalid product configuration.
- [ ] Test tax changes on renewal, partial principal/tax refunds, credit notes, full refunds, and dispute outcomes.
- [ ] Verify restored records reconcile with Stripe and preserve public consent.
- [ ] Only then enable tax for a confirmed deployment/offering.

Sources: [Tax setup](https://docs.stripe.com/tax/set-up), [Tax on invoices](https://docs.stripe.com/tax/invoicing), [Tax for software platforms](https://docs.stripe.com/tax/tax-for-platforms), [how Stripe Tax works](https://docs.stripe.com/tax/how-tax-works).
