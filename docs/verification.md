# Verification — 2026-09-25

| Check | Result |
| --- | --- |
| `pnpm check` | No errors, warnings, or hints |
| `pnpm test` | 58 tests across nine suites |
| `pnpm build` | Production Node build passes |
| Production health endpoint | HTTP 200 |
| Cross-origin studio POST | HTTP 403 |
| Anonymous studio POST | Rejected; no mutation |
| Anonymous studio page | Redirects to sign-in |
| Sync without bearer token | HTTP 401 |
| Sync with correct bearer token, without browser Origin | HTTP 200 |
| Production homepage | Server-rendered supporter timeline and zero script tags |
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

## Not verified

- Real Habitat OAuth and live PDS/private-space interoperability using creator and supporter accounts, including the Bluesky AppView proxy.
- Live photo/video import and playback from an authenticated creator account. Native media contracts and sanitization are fixture-tested.
- Real Stripe test-account onboarding and hosted payment/webhook delivery.
- Docker image build/runtime locally: the Docker daemon was unavailable. The build is configured in CI.
- A deployed Railway/VPS instance, live load testing, remote re-indexing, recurring support, or organization administration.

Use the [operator acceptance checklist](hosting.md#live-acceptance-checklist) before taking real payments. Mocked provider contracts and local demo flows do not replace that checklist.
