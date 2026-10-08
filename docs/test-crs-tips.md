# test.crs.tips

This is the isolated payment-testing counterpart to [crs.tips](crs-tips.md), using Christopher's public LibCard source and the dedicated **crs.tips sandbox** Stripe account. It must never share production's database, encryption keys, Stripe credentials, or private Habitat space.

[Open the Railway sandbox service](https://railway.com/project/20a3c02a-2960-458b-9e67-187bef03bd43/service/e9d92295-949b-435a-ad66-face315d74a8?environmentId=5015c91d-d145-4a56-a4a9-eda3d77ec569).

| Resource | Value |
| --- | --- |
| Railway environment | `sandbox` · `5015c91d-d145-4a56-a4a9-eda3d77ec569` |
| Service | `crs-tips-test` · `e9d92295-949b-435a-ad66-face315d74a8` |
| Volume | `c7a67919-d3a8-48db-b17a-f905575d7815`, mounted at `/data` |
| Canonical URL | `https://test.crs.tips` |
| Site name | `Tip Chris` (`SITE_NAME`) |
| Stripe sandbox | `acct_1UO4KUE9iIaZDKhG` |
| Creator | `crs.land` (sign in separately on the test domain) |
| LibCard source | `crs48/LIBCard`, `main` |
| Suggested amounts | `$11`, `$44`, `$111`, `$222` |
| Health | `/api/health`, expected `mode: "sandbox"` |

## Deployment status

DNS, HTTPS, creator sign-in, private Habitat storage, and Stripe sandbox payments were activated and verified on **2026-10-08**. The service tracks `main` with **Wait for CI** enabled. The activation deployment was `4f8177cd-2fec-40cf-9c92-2b8f0a2b3ed1` (`acc46c4`); subsequent main deployments retain the same volume and configuration.

Use [test.crs.tips](https://test.crs.tips/) for sign-in and testing. Health reports sandbox mode, the real LibCard catalog contains 28 selectable targets, and the default amount is $44. The discovery declaration returns 404 and responses carry noindex headers.

The key saved in Railway is a standard **sandbox** server key, verified against the dedicated sandbox account above. The webhook is enabled at `https://test.crs.tips/api/stripe/webhook`, with all twelve events from [Stripe setup](stripe-setup.md), API version `2026-08-26.dahlia`, and its own signing secret. Production credentials were not copied.

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
- [x] Add DNS records and verify HTTPS at `test.crs.tips`.
- [x] Save the dedicated sandbox server API key in this service's `STRIPE_SECRET_KEY` variable.
- [x] Configure the sandbox webhook and save its signing secret.
- [x] Sign in as `crs.land`, create sandbox private storage, and verify recovery.
- [ ] Complete payment, renewal, refund, and cancellation acceptance tests.

The webhook URL is `https://test.crs.tips/api/stripe/webhook`. Follow [Stripe setup](stripe-setup.md) for permissions and event selection, and [the sandbox guide](sandbox.md) for safeguards and test-card instructions. Keep all secrets in Railway or your password manager, never in this document.

## Verified payment behavior

Tests on 2026-10-08 used Stripe's synthetic `4242` card and an example.com email address. No real money moved and no public Bluesky writes were made.

- [x] Complete a $1 one-time anonymous gift through hosted Checkout; verify the signed `checkout.session.completed` event and Feedme's paid receipt.
- [x] Refund 50¢, verify 50¢ net in Feedme, then refund the remaining 50¢ and verify `refunded` with $0 net.
- [x] Complete a $1 monthly anonymous gift; verify `invoice.paid`, one ledger contribution, and an active subscription.
- [x] Open the supporter billing portal and schedule cancellation; Stripe confirms no renewal after the current period.
- [x] Verify private Habitat recovery and an encrypted local backup after creator sign-in.
- [ ] Verify a later paid renewal and replay its webhook without double counting.
- [ ] Exercise yearly, failed/asynchronous payments, disputes, and the other [acceptance cases](hosting.md#live-acceptance-checklist).

A billing-cycle reset and short trial adjustment did **not** produce a second paid renewal under Stripe's flexible billing mode. Its $0 adjustment invoice is not a contribution. Renewal acceptance remains unchecked; use a compatible test-clock fixture for that scenario. The test subscription is scheduled to stop on November 8, 2026.

The sandbox's private Habitat checkpoint is separate from production. Encrypted file backups currently live on its Railway volume; independent object-storage backups and a full replacement-server restore remain separate acceptance work.
