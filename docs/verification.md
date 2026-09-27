# Verification — 2026-09-26

| Check | Result |
| --- | --- |
| `pnpm check` | No errors, warnings, or hints |
| `pnpm test` | 109 tests across sixteen suites |
| `pnpm build` | Production Node build passes |
| Production health endpoint | HTTP 200 |
| Cross-origin studio POST | HTTP 403 |
| Anonymous studio POST | Rejected; no mutation |
| Anonymous studio page | Redirects to sign-in |
| Sync without bearer token | HTTP 401 |
| Sync with correct bearer token, without browser Origin | HTTP 200 |
| Production homepage | Server-rendered project list and supporter timeline; one same-origin allocation script (2,040 bytes gzipped) |
| Browser assets | Static CSS; a small video initializer on post pages, with a 1,093-byte gzipped initializer and a 113,161-byte gzipped HLS light bundle loaded only on demand |
| Desktop browser | Creator follow, project follow, Following feed, native demo post, and Markdown editing verified |
| Mobile browser, JavaScript disabled | Anonymous tip with timeline consent, sign-in return, and explicit public post verified |
| Restart | Demo records and browser session survived server restart |

The test suites cover integer amount parsing, private/public field projections, anonymous identity stripping, refund/dispute totals, owner authorization, redirect validation, encryption, expiry, transaction rollback, outbox revision races, duplicate and out-of-order Stripe events, actual Stripe signature verification, Habitat endpoint payloads, private write failure without public fallback, lexicon validation, and form/service authentication boundaries.

Additional coverage includes actor-scoped OAuth writes, complete follow-list pagination, stable TID retries, receipt access before public posting, UTF-8 facets, safe Markdown/media rendering, native post ownership and deletion behavior, anonymous consent, supporter timeline ordering/pagination, and preservation of safe avatar metadata and profile moderation labels through feed normalization.

The anonymous browser test created a permitted timeline entry, and the public HTML contained neither its private note nor its amount. The separate public message started empty and was posted only after explicit confirmation. The mobile project layout places the support form before the growing log and supporter history.

Browser screenshots are generated locally under ignored `output/playwright/`. These are preview artifacts, not application assets or test fixtures.

## Mobile and Checkout appearance

- [x] `pnpm check`, all 56 tests, and `pnpm build` pass after the redesign.
- [x] Production profile, project, circle, updates, Following, login, and studio pages return HTTP 200 at 320, 390, 768, and 1440px widths (28 checks).
- [x] Those pages have no horizontal document overflow, primary buttons below 44px, or visible text inputs below 16px.
- [x] Desktop and mobile screenshots visually reviewed. In the placeholder-only layout at 390px, the project support form starts at 429px; the full Markdown story follows the form. Decorative placeholders are hidden on mobile project headers; actual cover photos remain visible.
- [x] Visibility selection shows anonymous timeline consent only when anonymous support is selected; named support remains disabled for signed-out visitors.
- [x] With JavaScript disabled and touch emulation enabled, a signed-out visitor can expand the native note field, submit an anonymous demo tip, and reach its confirmation. Neither the private note nor anonymous amount appears in the public profile HTML.
- [x] Keyboard focus reaches the skip link with a visible outline. The production homepage still contains zero script tags; no extra browser JavaScript or web fonts were added.
- [x] Hosted Checkout uses typed per-session branding settings matching the app's white background, purple action color, default font, and rounded controls.
- [ ] Visually compare a real connected-account Stripe test Checkout session with the local support page, including the merchant's existing logo and business name.

See the [appearance guide](appearance.md) for the tokens, responsive behavior, and Stripe source documentation. Screenshots for this pass use the `stripe-` filename prefix in `output/playwright/`.

## Avatars and sample photography

- [x] All 58 tests, Astro checks, and the production build pass.
- [x] Profile, updates, project, Following, and circle pages verified at 320, 390, 768, and 1440px (20 checks), with no horizontal overflow. Every displayed demo post has its author's portrait.
- [x] Six stock portraits and three responsive project photos load from the local server; the demo makes no image-service requests. A fresh 390px browser selects the 480px project renditions.
- [x] Public demo support uses consistent fictional identities and portraits; anonymous entries have no portrait and retain a generic icon. The original public support totals remain unchanged.
- [x] Simulated a failed creator portrait request with JavaScript disabled. Initials render at the same 64px size, without a broken-image icon or added scripts. The homepage still has zero script tags.
- [x] Desktop profile, mobile post, supporter timeline, and failure-fallback screenshots visually reviewed under `output/playwright/avatars-*` and `avatar-fallback-mobile.png`.

## Bluesky and Stripe appearance

- [x] `pnpm check`, all 58 tests, and `pnpm build` pass.
- [x] Profile, updates, project, Following, circle, login, and studio pages return HTTP 200 at 320, 390, 768, and 1440px (28 checks), with no horizontal overflow, primary controls below 44px, or visible text inputs below 16px.
- [x] Desktop and mobile screenshots reviewed for the cover/portrait profile, underlined tabs, compact feed, public supporter rows, and payment form. Artifacts use the `bluesky-stripe-` prefix in `output/playwright/`.
- [x] With JavaScript disabled and touch emulation at 390px, followed a demo project, verified its two posts and avatars in Following, then unfollowed to restore the original state.
- [x] Signed-out mobile profile renders the blue pill-shaped follow action, and the homepage still has zero script tags. Anonymous support keeps the generic portrait and hidden identity/amount.
- [x] The shared primary blue (`#0866ff`) provides 4.82:1 white-text contrast and matches the typed per-session hosted Checkout branding. Social buttons use pills; payment controls keep their 6px radius.

The real Stripe test-account visual comparison remains pending below; the hosted branding parameters were verified locally, not through a live payment session.

## Homepage split support

This section records the earlier relative-weight interface. The current percentage behavior is documented below.

- [x] `pnpm check`, all 75 tests across twelve suites, and `pnpm build` pass.
- [x] Replaced homepage project cover cards with a text-first project list and relative sliders; images remain on project detail pages.
- [x] Production browser verifies $30 split equally with all sliders at maximum, $30 to one selected project, a 2:1 split of $20/$10, and a $1 split of $0.34/$0.33/$0.33. All-zero selection disables checkout and explains why.
- [x] Desktop support panel remains sticky at 24px while scrolling the list. At 320, 390, 768, and 1440px, no horizontal overflow or primary buttons under 44px. Mobile amount selection, sliders, persistent review bar, and checkout summary visually reviewed.
- [x] Browser-submitted anonymous demo splits confirm $30.01 as $20.01/$10 with JavaScript and $24.01 as $16.01/$8 without JavaScript. Public totals remain unchanged. Screenshots use `allocation-*` in `output/playwright/`.
- [x] The calculator is one external 3,105-byte module (1,281 bytes gzipped); production CSP permits it without allowing inline scripts. Earlier zero-script homepage checks above describe the previous interface.
- [x] Unit/provider tests verify exact connected-account Checkout line items, parent idempotency, mismatched allocation rejection, repeat submissions, receipt privacy, per-project public projections, webhook races, partial/full refunds, and disputes. Original single-project checkout remains supported.

See [split support](split-support.md) for the deterministic cent-rounding and cumulative refund rules. Live Stripe Checkout remains an operator acceptance item.

## Recurring support

- [x] One-time, monthly, and yearly choices on the homepage and individual project forms use native radio controls; one-time remains the default.
- [x] Automated tests cover Stripe subscription line items and metadata, interval immutability, 20-project limits, customer reuse, billing authorization, duplicate invoice IDs, out-of-order events, failure recovery, cancellation, and refund isolation. Public projections exclude billing identifiers and private notes.
- [x] Homepage browser checks at 320, 390, 768, and 1440px cover all three frequencies with a $999.99 total. No horizontal overflow or frequency controls below 44px; live totals and project shares carry the correct interval.
- [x] Project and billing pages also pass layout checks at 320, 390, 768, and 1440px, with no horizontal overflow or primary controls below 44px.
- [x] A monthly anonymous demo submission records $30.01 split $20.01/$10. Stopping renewals changes its management status to Stopped and keeps the paid contribution.
- [x] With JavaScript disabled at 390px, an anonymous yearly $21.50 tip submits, displays the correct yearly receipt, and can be stopped through the native billing form. Its amount does not appear on the public homepage.
- [x] Desktop allocation, mobile frequency controls, yearly project form, and billing screenshots visually reviewed under `output/playwright/recurring-*`.
- [ ] Live connected-account monthly/yearly Checkout, test-clock renewals, failure/recovery, portal cancellation, and email login; use the [hosting checklist](hosting.md#live-acceptance-checklist).

## Empty slider reminder

- [x] The hint appears only while every slider is zero; selecting any project hides it and returning to zero shows it again.
- [x] Escape dismisses the tooltip. It bobs twice and disables animation under reduced-motion preferences.
- [x] Slider positions stay unchanged when the hint disappears. No horizontal overflow at 320, 390, and 1440px; screenshots reviewed under `output/playwright/slider-hint-*`.
- [x] `pnpm check`, all 101 tests, and `pnpm build` pass.

## Linked percentage sliders

- [x] Shared percentage math previews 1% of $22 as $0.22 and 30% as $6.60 without expanding either selection to the whole tip.
- [x] The changed slider stops at the remaining percentage; other selections stay fixed. Native maxima remain 100, and the only route to a lone 100% allocation is moving that slider to the end.
- [x] Pointer and keyboard controls enforce the combined 100% cap. Clearing, splitting evenly (34/33/33), amount presets, and billing-interval changes preserve the stated percentage rules.
- [x] The page shows remaining percentage and money; incomplete allocations keep checkout disabled. Server tests reject incomplete or excessive splits before creating a payment, and old relative-weight forms must reload.
- [x] No horizontal overflow at 320, 390, 768, and 1440px, including a partial monthly $999.99 tip. Desktop and mobile screenshots visually reviewed under `output/playwright/percentage-partial-*`.
- [x] With JavaScript disabled, the server rejects a 1% allocation and accepts a complete 50/50 split of $22.01; the demo receipt records $11.01 and $11, conserving the entered total.
- [x] `pnpm check`, all 104 tests, and `pnpm build` pass.

## Deployment setup

- [x] Render Blueprint validates against Render's official JSON Schema; Fly TOML parses with matching port and persistent-data mount settings.
- [x] Generated provider domains and explicit custom-domain overrides are covered by five tests; request Host headers are not trusted for origin discovery.
- [x] `pnpm check`, all 109 tests, and `pnpm build` pass.
- [x] GitHub repository is private and enabled as a template repository.
- [x] [GitHub Actions](https://github.com/crs48/feedme/actions/runs/36270196045) builds the Docker image and passes the container smoke check: a fresh root-owned volume becomes writable, the server runs as UID 1000, OAuth metadata uses the generated origin, and SQLite data survives container replacement. Local Docker daemon remains unavailable.
- [x] All 34 linked documentation/badge URLs resolve; relative file links and heading anchors in the hosting docs and README exist. Local production health endpoint returns HTTP 200 after rebuilding.
- [ ] Provider-side deployment and redeployment on Render, Railway, Fly.io, Coolify, Dokploy, or Koyeb. The configurations and setup guides are prepared; no paid services were provisioned for this verification.

## Not verified

- Real Habitat OAuth and live PDS/private-space interoperability using creator and supporter accounts, including the Bluesky AppView proxy.
- Live photo/video import and playback from an authenticated creator account. Native media contracts and sanitization are fixture-tested.
- Real Stripe test-account onboarding, hosted payment/webhook delivery, recurring renewals, and Customer Portal/email recovery.
- Docker image build/runtime locally: the Docker daemon was unavailable. Container build and runtime checks are configured in CI.
- A deployed Railway/VPS instance, live load testing, remote re-indexing, or organization administration.

Use the [operator acceptance checklist](hosting.md#live-acceptance-checklist) before taking real payments. Mocked provider contracts and local demo flows do not replace that checklist.

## Configurable administration dashboard · 2026-09-26

- [x] `pnpm check`: no errors, warnings, or hints.
- [x] `pnpm test`: 129 passing tests across 19 suites. Added coverage for handle/DID authorization, permanent identity pins, admin removal, protected pages/exports, draft publication boundaries, additional-admin project operations, CSV privacy/formula protection, split accounting, date ranges, payment timestamps, and recurring run rates.
- [x] `pnpm build`: production Node bundle generated successfully.
- [x] All eight admin routes render without page overflow at 320, 390, 768, and 1440px widths (32 browser checks).
- [x] Demo browser workflow: sign in as admin, create a private draft, inspect rendered Markdown, publish, and archive. The temporary project and its test-only activity records were removed afterward.
- [x] Public HTTP requests cannot see the draft on the homepage or its detail route. Signed-out admin pages redirect to login; exports return HTTP 403. Published test project returned HTTP 200 with rendered Markdown.
- [x] Mobile editor text fields render at 16px. Dashboard forms and reporting use server-rendered HTML; charts include exact-value tables.
- [x] A fresh, isolated live-mode instance resolved `crs.land` through the actual Habitat SDK, stored encrypted DID/owner pins, served health HTTP 200, redirected unsigned dashboard requests, and rejected unsigned exports. The live identity is `did:plc:fvfdugmhgbbvxjppo2kkveq2`.

The live bootstrap check used a temporary data directory and no Stripe credentials. It did not perform an interactive OAuth login, a PDS/Habitat write, or a payment. Real creator OAuth, delegated publication through the creator’s stored grant, Habitat membership, and Stripe payment acceptance still require the live acceptance checklist in [hosting](hosting.md#live-acceptance-checklist).

## Network discovery and fund.feedme namespace · 2026-09-27

- [x] `pnpm check`: 124 files, no errors, warnings, or hints.
- [x] `pnpm test`: 154 tests across 24 suites. New coverage includes relationship ranking/deduplication, partial graph reads, viewer blocks/mutes, canonical site identity, unsafe endpoint rejection, lost-write retries, recommendation ownership/removal, local circle rendering, and namespace migration privacy.
- [x] `pnpm build`: production Node bundle, public schema endpoints, and discovery pages build successfully.
- [x] Running production demo: HTTP form sign-in, recommendation publish, creator-circle display, update, removal, explicit-consent rejection, cross-origin rejection, and sign-out. Temporary recommendation data was removed.
- [x] Live read-only requests through the new pinned-DNS transport: @feedme.fund resolves to `did:plc:vbaugrge5ekw4tlghov4ydhi`, its DID document includes `at://feedme.fund`, and the configured relay accepts `listReposByCollection`. It returned zero Feedme profiles before initial publication.
- [x] Public `/.well-known/feedme` and `/lexicons/fund.feedme.profile.json` return the expected identity/schema JSON in the production preview.
- [ ] Official `_lexicon.feedme.fund` TXT record and nine schema records published to @feedme.fund's PDS. Vercel browser/CLI are signed out; the local preview is demo mode without a live authority OAuth grant. The `/protocol` workflow and exact DNS instructions are prepared.
- [ ] Live authenticated discovery across actual creator accounts/PDSs, including friends of friends and cross-instance recommendation handoff. Adapter contracts are fixture-tested; the demo does not substitute for live account acceptance.

See [discovery operations and migration](discovery.md). Native browser clicks could not be verified while the desktop was locked; form mutations were checked over HTTP and page layouts inspected in the browser.
- [x] Browser layout inspection at 320, 390, 768, and 1440px: discovery, friends of friends, recommendation editor, and recommendation list. A 2px overflow at 320px was fixed and rechecked. Screenshots are saved in ignored `.data/` files.

## Public support cards · 2026-09-27

- [x] `pnpm check`: 136 files, no errors, warnings, or hints.
- [x] `pnpm test`: 177 tests across 26 suites, including public-only projections, private-total exclusion, deterministic rounding, top-six remainders, refunds, opaque IDs, real PNG rendering, and Bluesky upload/retry behavior.
- [x] `pnpm build`: production Node bundle and bundled OFL fonts generated successfully.
- [x] Production demo HTTP checkout for public, private, and anonymous support. Only the public receipt exposes a share link; the signed-out page contains no receipt ID, private note, or tip amount and has absolute PNG social metadata.
- [x] Public PNG responds with `image/png` at 1200 × 630. Six-project sample visually inspected, including 125% and 250% goal progress, plus a project without an aspiration.
- [x] After rendering/caching a PNG, full refund, dispute, and visibility-change fixtures each return HTTP 404 for both the share page and image. Temporary six-project fixtures and private/anonymous test receipts were removed.
- [x] Browser inspection at 320, 390, and 1440px: no horizontal overflow, stacked mobile project details, readable desktop grid. The receipt's Copy link button produces its success message. Screenshots are retained in ignored `.data/` files.
- [x] Demo public-post publish and retry succeed locally without sending a network post.
- [x] [GitHub Actions run 36339100557](https://github.com/crs48/feedme/actions/runs/36339100557) passes on implementation commit `2519152`: checks, tests, build, Linux Docker build, and the new container checkout/PNG/font smoke test.
- [ ] Live image upload through supporter OAuth and previews fetched by actual social crawlers on a public HTTPS deployment. These require authenticated live acceptance; local demos and adapter fixtures do not substitute for that check.

See [support-card behavior and hosting](support-cards.md). The container smoke check also exercises a public checkout, share metadata, and PNG rendering with the production native renderer and bundled fonts.
