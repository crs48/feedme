# 05 · Verification, documentation, and rollout

## Objective and dependencies

Ship only the capabilities proven by [steps 01–04](README.md#execution-sequence). This document describes future implementation acceptance; writing the plan does not complete these checks.

## Test matrix

| Area | Required cases |
| --- | --- |
| Legacy compatibility | LibCard unset, all/explicit modes, skip exclusivity, auto-ID preservation, native collisions, old snapshot versions, existing consumer fixture |
| Providers | Visible links/socials, groups, custom domains, empty catalog, hidden/scheduled/gated entries, tracked URLs, duplicate destinations, pagination, HTML challenges, layout changes |
| Manifest/manual | Schema version, duplicate IDs, unsupported fields/types/schemes, zero goals, source skip, relative URLs, upload size, manual-versus-auto capability |
| Identity | Title/order changes preserve IDs; ambiguous URL changes need review; no fuzzy source-switch merges; creator cannot be skipped |
| Capacity | More than 99 candidates, selected subset, new items at capacity, skipped entries using no slot, no reorder-driven eviction |
| Refresh | ETag/304, Last-Modified, unchanged hash, parser upgrade, retry/backoff, restore pause, concurrent refresh/overrides, partial page, suspicious mass removal |
| Network | DNS rebinding, redirect to private host, mixed DNS, credentials, ports, oversized/decompression responses, deadlines, rate limiting, robots denial/unavailability |
| UI | Full ordinary-form setup, readable source statuses, short/long labels, small screens, focus, popovers, external links preserving selections |
| Checkout | Review preservation, stale source generation, changed selected target, original picks including zero-cent allocations, duplicate submits, anonymous/identified visibility |
| Ledger | Verified paid events only, webhook retries, recurring invoices, partial/full refunds, disputes, no imported revenue or inferred picks |
| Public boundaries | Hidden/skipped/removed omissions, exact shares, public allowlist, no session-dependent caching, no public managed-target AT Protocol publication |
| Recovery | Old LibCard backup, new source restore offline, historical inactive-source payments, mapping conflicts, dirty tracking, envelope bounds |
| Demo | Offline Pages build, fixed source fixtures, sample goals clearly labeled, no crawling or live provider dependency |

Extend existing [LibCard tests](../../../tests/libcard.test.ts), [contract tests](../../../tests/libcard-contract.test.ts), [pick checkout tests](../../../tests/pick-checkout.test.ts), [public-network tests](../../../tests/public-network.test.ts), and [recovery tests](../../../tests/recovery.test.ts). Add focused adapter/refresh suites with injected transport and a fixed clock. CI must not need third-party accounts, cookies, live payments, or current provider HTML.

Provide an optional maintainer-invoked smoke check against consenting public test profiles. Record adapter version, counts, response sizes, completeness, and safe diagnostic codes; never commit raw personal page bodies or secrets from that check. Real-provider smoke checks supplement deterministic fixtures and are required before advertising that provider as automatic.

## Rollout sequence

1. Ship the shared model and LibCard compatibility path under tests, preserving existing environment setup and IDs.
2. Enable manifest/manual source setup and generic API; validate the whole flow using a self-hosted fixture site and sandbox payments.
3. Release one verified hosted-provider adapter as a labeled beta. Keep other investigated providers honestly marked unsupported/reviewed-only until they pass the same gates.
4. Expand to the remaining providers with fixtures and measured fetch budgets. Revisit automatic generic HTML only after its extraction rules prove stable.
5. Consider multiple sources, signed provider webhooks, remote thumbnails, OAuth APIs, or richer original-site widgets separately when a documented capability and concrete user need exist.

A connection preview is required for first activation or provider/source replacement. Routine application upgrades preserve the active catalog and all overrides. Adapter upgrades that cannot safely interpret the saved source keep last-good state and request a review rather than migrating silently.

## Documentation and demo

Update these existing guides when implementation actually ships:

- [README](../../../README.md), [environment example](../../../.env.example), and a new `docs/website-sources.md`: exact supported providers, configuration precedence, capability labels, refresh intervals, limits, and troubleshooting.
- [LibCard guide](../../libcard.md): compatibility, unchanged skip contract/API, and where its capabilities exceed a generic platform link.
- [Recovery guide](../../backups-and-recovery.md): source settings, mappings, retained history, offline restore, and minimum compatible version.
- [Agent setup runbook](../../agent-setup.md) and [setup prompt](../../agent-setup-prompt.md): determine the creator's source, preview and confirm it, then verify fetching separately from Stripe/Habitat readiness. Never ask users for provider passwords in chat.
- [Setup website page](../../../site/pages/get-started.astro) and [LibCard integration page](../../../site/pages/libcard/index.astro): distinguish shipped providers, beta readers, and manual fallbacks. Add offline source examples to the demo using the production pick components.

Do not market “works with any website automatically.” Say “Connect supported link pages, publish a Feedme catalog from your own site, or import a list.” Show a timestamp and capability for every connection.

## Acceptance checks

Before shipping application changes, run:

```sh
pnpm check
pnpm test
pnpm build
pnpm check:libcard
pnpm build:site
```

Then perform browser acceptance on desktop/mobile: create a source, preview, select/hide targets, set an aspiration, update the upstream fixture, confirm the reflected change, follow an external link without losing picks, review a gift, and restore while the fixture server is down. Use the sandbox for a verified payment and recurring-event test; do not charge a live card to validate an importer.

## Completion checklist

- [ ] Record passing command results and browser acceptance evidence.
- [ ] Confirm all regression scenarios above and source-specific fixture coverage.
- [ ] Capture a pre-upgrade backup and demonstrate upgrade plus offline restore.
- [ ] Verify no private state is exposed through the generic API or new publishing paths.
- [ ] Document measured request/byte budgets and provider-specific access restrictions.
- [ ] Publish accurate setup/support documentation and an offline demo.
- [ ] Use conventional commits with detailed bullet descriptions and a reviewable PR for implementation.

No implementation item in this plan is complete yet. The next authorized implementation phase should begin with provider feasibility and the shared contract, not deployment or broad scraping.
