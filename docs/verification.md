# Verification — 2026-09-26

| Check | Result |
| --- | --- |
| `pnpm check` | No errors, warnings, or hints |
| `pnpm test` | 101 tests across fifteen suites |
| `pnpm build` | Production Node build passes |
| Production health endpoint | HTTP 200 |
| Cross-origin studio POST | HTTP 403 |
| Anonymous studio POST | Rejected; no mutation |
| Anonymous studio page | Redirects to sign-in |
| Sync without bearer token | HTTP 401 |
| Sync with correct bearer token, without browser Origin | HTTP 200 |
| Production homepage | Server-rendered project list and supporter timeline; one same-origin allocation script (1,460 bytes gzipped) |
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

## Not verified

- Real Habitat OAuth and live PDS/private-space interoperability using creator and supporter accounts, including the Bluesky AppView proxy.
- Live photo/video import and playback from an authenticated creator account. Native media contracts and sanitization are fixture-tested.
- Real Stripe test-account onboarding, hosted payment/webhook delivery, recurring renewals, and Customer Portal/email recovery.
- Docker image build/runtime locally: the Docker daemon was unavailable. The build is configured in CI.
- A deployed Railway/VPS instance, live load testing, remote re-indexing, or organization administration.

Use the [operator acceptance checklist](hosting.md#live-acceptance-checklist) before taking real payments. Mocked provider contracts and local demo flows do not replace that checklist.
