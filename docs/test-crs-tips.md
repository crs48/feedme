# test.crs.tips

This is the isolated payment-testing counterpart to [crs.tips](crs-tips.md), using Christopher's public LibCard source and the dedicated **crs.tips sandbox** Stripe account. It must never share production's database, encryption keys, Stripe credentials, or private Habitat space.

[Open the Railway sandbox service](https://railway.com/project/20a3c02a-2960-458b-9e67-187bef03bd43/service/e9d92295-949b-435a-ad66-face315d74a8?environmentId=5015c91d-d145-4a56-a4a9-eda3d77ec569).

| Resource | Value |
| --- | --- |
| Railway environment | `sandbox` · `5015c91d-d145-4a56-a4a9-eda3d77ec569` |
| Service | `crs-tips-test` · `e9d92295-949b-435a-ad66-face315d74a8` |
| Volume | `c7a67919-d3a8-48db-b17a-f905575d7815`, mounted at `/data` |
| Canonical URL | `https://test.crs.tips` |
| Stripe sandbox | `acct_1UO4KUE9iIaZDKhG` |
| Creator | `crs.land` (sign in separately on the test domain) |
| LibCard source | `crs48/LIBCard`, `main` |
| Suggested amounts | `$11`, `$44`, `$111`, `$222` |
| Health | `/api/health`, expected `mode: "sandbox"` |

## Deployment status

The sandbox-capable application deployed successfully on 2026-10-07 (Railway deployment `49133f92-a93d-4b3d-af04-ddb7f6391e60`, commit `7a32ae8`, subsequently merged into `main` in PR #10). The service now tracks `main` with **Wait for CI** enabled.

A [read-only preview](https://crs-tips-test-sandbox.up.railway.app/) is available while DNS is pending. Its health check reports sandbox mode; the real LibCard import contains 28 selectable targets, a $44 default, and zero public payment signal. The discovery declaration returns 404 and responses carry noindex headers. Forms and OAuth use the canonical `test.crs.tips` origin, so use that address for sign-in and payment testing after DNS activation.

DNS ownership, the sandbox API key/webhook, creator sign-in, and payment acceptance are still pending. The public preview does not prove payment readiness.

## DNS

In Vercel → Domains → crs.tips → DNS Records, add these records. Leave production's apex ALIAS and other records unchanged.

| Type | Name | Value |
| --- | --- | --- |
| CNAME | `test` | `xglx893t.up.railway.app` |
| TXT | `_railway-verify.test` | `railway-verify=6b202453dc1f48474a517bbf9fad219a990d7e6f7a24e628a41d36e8d0a430a9` |

Railway must verify the records and issue a valid certificate before sign-in or Stripe webhooks can work at the canonical address.

## Activation

- [x] Create an empty Railway environment and service, without copying production.
- [x] Attach a separate persistent volume and generate independent encryption keys.
- [x] Configure `FEEDME_MODE=sandbox`, `STRIPE_MODE=own-account`, `STRIPE_ENVIRONMENT=test`, the sandbox account ID, public URL, and LibCard source.
- [x] Deploy the sandbox-capable application and verify its health/banner.
- [ ] Add DNS records and verify HTTPS at `test.crs.tips`.
- [ ] Save the dedicated sandbox restricted key in this service's `STRIPE_SECRET_KEY` variable.
- [ ] Configure the sandbox webhook and save its signing secret.
- [ ] Sign in as `crs.land`, create sandbox private storage, and verify recovery.
- [ ] Complete payment, renewal, refund, and cancellation acceptance tests.

The webhook URL is `https://test.crs.tips/api/stripe/webhook`. Follow [Stripe setup](stripe-setup.md) for permissions and event selection, and [the sandbox guide](sandbox.md) for safeguards and test-card instructions. Keep all secrets in Railway or your password manager, never in this document.
