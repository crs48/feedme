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

## Not verified

- Real Habitat OAuth and live PDS/private-space interoperability using creator and supporter accounts, including the Bluesky AppView proxy.
- Live photo/video import and playback from an authenticated creator account. Native media contracts and sanitization are fixture-tested.
- Real Stripe test-account onboarding and hosted payment/webhook delivery.
- Docker image build/runtime locally: the Docker daemon was unavailable. The build is configured in CI.
- A deployed Railway/VPS instance, live load testing, remote re-indexing, recurring support, or organization administration.

Use the [operator acceptance checklist](hosting.md#live-acceptance-checklist) before taking real payments. Mocked provider contracts and local demo flows do not replace that checklist.
