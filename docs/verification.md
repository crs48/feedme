# Initial verification — 2026-09-25

| Check | Result |
| --- | --- |
| `pnpm check` | No errors, warnings, or hints |
| `pnpm test` | 32 tests across five suites |
| `pnpm build` | Production Node build passes |
| Production health endpoint | HTTP 200 |
| Cross-origin studio POST | HTTP 403 |
| Anonymous studio POST | Rejected; no mutation |
| Anonymous studio page | Redirects to sign-in |
| Sync without bearer token | HTTP 401 |
| Sync with correct bearer token, without browser Origin | HTTP 200 |
| Production homepage | 27,362 bytes of uncompressed HTML; zero script tags |
| Browser assets | One stylesheet, 4,400 bytes gzipped; zero application JavaScript files |
| Desktop browser | Creator page and support → demo confirmation → recommendations verified |
| Mobile browser, JavaScript disabled | Layout, demo sign-in, persisted studio session, and profile form submission verified |
| Restart | Demo records and browser session survived server restart |

The test suites cover integer amount parsing, private/public field projections, anonymous identity stripping, refund/dispute totals, owner authorization, redirect validation, encryption, expiry, transaction rollback, outbox revision races, duplicate and out-of-order Stripe events, actual Stripe signature verification, Habitat endpoint payloads, private write failure without public fallback, lexicon validation, and form/service authentication boundaries.

Browser screenshots are generated locally under ignored `output/playwright/`. These are preview artifacts, not application assets or test fixtures.

## Not verified

- Real Habitat OAuth and live PDS/private-space interoperability using an operator account.
- Real Stripe test-account onboarding and hosted payment/webhook delivery.
- Docker image build/runtime locally: the Docker daemon was unavailable. The build is configured in CI.
- A deployed Railway/VPS instance, live load testing, remote re-indexing, recurring support, or organization administration.

Use the [operator acceptance checklist](hosting.md#live-acceptance-checklist) before taking real payments. Mocked provider contracts and local demo flows do not replace that checklist.
