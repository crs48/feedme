# Verification — 2026-09-25

| Check | Result |
| --- | --- |
| `pnpm check` | No errors, warnings, or hints |
| `pnpm test` | 56 tests across nine suites |
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

Additional coverage includes actor-scoped OAuth writes, complete follow-list pagination, stable TID retries, receipt access before public posting, UTF-8 facets, safe Markdown/media rendering, native post ownership and deletion behavior, anonymous consent, and supporter timeline ordering/pagination.

The anonymous browser test created a permitted timeline entry, and the public HTML contained neither its private note nor its amount. The separate public message started empty and was posted only after explicit confirmation. The mobile project layout places the support form before the growing log and supporter history.

Browser screenshots are generated locally under ignored `output/playwright/`. These are preview artifacts, not application assets or test fixtures.

## Mobile and Checkout appearance

- [x] `pnpm check`, all 56 tests, and `pnpm build` pass after the redesign.
- [x] Production profile, project, circle, updates, Following, login, and studio pages return HTTP 200 at 320, 390, 768, and 1440px widths (28 checks).
- [x] Those pages have no horizontal document overflow, primary buttons below 44px, or visible text inputs below 16px.
- [x] Desktop and mobile screenshots visually reviewed. At 390px, the project support form starts at 429px; the full Markdown story follows the form. Decorative placeholders are hidden on mobile project headers.
- [x] Visibility selection shows anonymous timeline consent only when anonymous support is selected; named support remains disabled for signed-out visitors.
- [x] With JavaScript disabled and touch emulation enabled, a signed-out visitor can expand the native note field, submit an anonymous demo tip, and reach its confirmation. Neither the private note nor anonymous amount appears in the public profile HTML.
- [x] Keyboard focus reaches the skip link with a visible outline. The production homepage still contains zero script tags; no extra browser JavaScript or web fonts were added.
- [x] Hosted Checkout uses typed per-session branding settings matching the app's white background, purple action color, default font, and rounded controls.
- [ ] Visually compare a real connected-account Stripe test Checkout session with the local support page, including the merchant's existing logo and business name.

See the [appearance guide](appearance.md) for the tokens, responsive behavior, and Stripe source documentation. Screenshots for this pass use the `stripe-` filename prefix in `output/playwright/`.

## Not verified

- Real Habitat OAuth and live PDS/private-space interoperability using creator and supporter accounts, including the Bluesky AppView proxy.
- Live photo/video import and playback from an authenticated creator account. Native media contracts and sanitization are fixture-tested.
- Real Stripe test-account onboarding and hosted payment/webhook delivery.
- Docker image build/runtime locally: the Docker daemon was unavailable. The build is configured in CI.
- A deployed Railway/VPS instance, live load testing, remote re-indexing, recurring support, or organization administration.

Use the [operator acceptance checklist](hosting.md#live-acceptance-checklist) before taking real payments. Mocked provider contracts and local demo flows do not replace that checklist.
