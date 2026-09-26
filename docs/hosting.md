# Hosting and first-run setup

The quickest preview is a single Node process. A real instance also needs HTTPS, a persistent data directory, a Habitat-backed identity connection, and a Stripe Connect platform configuration. No external database is required for the first release.

## Local preview

```sh
pnpm install
cp .env.example .env
pnpm dev
```

Use `http://127.0.0.1:4321` consistently, including in `PUBLIC_URL`. The application checks form origins, so switching between `localhost` and `127.0.0.1` without changing configuration will reject submissions. Leave `FEEDME_MODE=demo` to try simulated support and a shared editable studio. Preview state is isolated in `demo.sqlite`.

## Live configuration

| Variable | Value |
| --- | --- |
| `FEEDME_MODE` | `live` |
| `PUBLIC_URL` | Your HTTPS origin, for example `https://support.example.com` |
| `OWNER_DID` | Your permanent AT Protocol DID, not your handle |
| `DATA_ENCRYPTION_KEY` | 64 hex characters, generated once and backed up separately |
| `DATA_DIR` | Persistent writable directory; `/data` in Docker/Railway |
| `HABITAT_URL` | Trusted Habitat host; defaults to `https://pear.habitat.network` |
| `STRIPE_SECRET_KEY` | Connect platform secret key; use a test key first |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for this Connect webhook endpoint |
| `HOST` | `0.0.0.0` in containers; loopback behind a host reverse proxy |
| `PORT` | `4321` or the hosting platform’s assigned port |
| `SYNC_SECRET` | Optional stable random 32+ character bearer token for an external scheduler |

Generate the encryption key locally:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store it in the deployment’s environment or secret manager. The live app refuses to run without HTTPS, a syntactically valid owner DID, and this key. Do not rotate the key by simply replacing the environment value: existing encrypted records would become unreadable. Key migration is not implemented yet.

### Connect identity and private storage

1. Make the HTTPS origin reachable and verify `/api/health`.
2. Verify `/oauth-client-metadata.json` and `/jwks.json` return JSON publicly. These contain public client metadata and public keys, not private secrets.
3. Sign in using your handle. Your authenticated DID must match `OWNER_DID` to use the studio.
4. In the studio, choose **Create private storage**. Feedme creates a new member-list Habitat space and saves the returned URI. Only the creator is an initial member. Feedme never adopts an arbitrary existing space whose permissions it has not established.
5. Create your profile and first project. Choose **Sync records** to verify the first public write. Production `pnpm start` also retries automatically every 30 seconds.

Habitat’s own service can be self-hosted separately. Feedme is TypeScript and does not embed Habitat’s Go server. The current SDK delegates identity verification to the configured Habitat instance; use an instance you trust. See the [upstream setup](https://github.com/habitat-network/habitat) and [proxy integration](https://github.com/habitat-network/habitat/blob/85654a07dec6931925763e66c835f65d0cdf1e30/api-docs/docs/space-proxy/getting-started.mdx).

### Connect payments

1. Configure your Stripe platform for Connect and use **test mode** credentials first.
2. In the studio, choose **Connect with Stripe**. Feedme creates a Standard connected account with an idempotency key and redirects to Stripe-hosted onboarding. Banking and identity-verification details stay on Stripe.
3. Register `https://support.example.com/api/stripe/webhook` as a **connected-account** event destination using API version `2026-08-26.dahlia` (matching the installed Stripe SDK) and copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, **`invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`**. Existing installations must add the invoice and subscription events before offering recurring support.
5. Enable eligible payment methods on the connected account. Checkout selects methods dynamically; card wallets such as Apple Pay and Google Pay depend on account, currency, device, and Stripe eligibility. Feedme does not promise every method on every checkout.
6. Follow the acceptance checklist below, then replace test credentials and webhook configuration when ready for real payments.

Checkout verifies both `charges_enabled` and `payouts_enabled`. Feedme makes direct charges to the connected account and sets no application fee. Stripe processing and applicable Billing fees still apply. Refunds and disputes are managed from Stripe’s dashboard; webhooks update Feedme. The current release offers USD one-time, monthly, and yearly support. Before opening the first recurring Checkout, Feedme creates a connected-account Customer Portal configuration with invoice history, payment-method updates, cancellation at the end of the period, and email login enabled. See [recurring support](recurring-support.md) for accounting and recovery details.

Stripe supports [stablecoin payments](https://docs.stripe.com/payments/stablecoin-payments) subject to eligibility. Bitcoin requires a separate future integration. Do not advertise Bitcoin as a Stripe checkout option.

## VPS with Node

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Run under your preferred process supervisor and keep `.env` out of source control. Put Caddy or another HTTPS reverse proxy in front:

```caddy
support.example.com {
    reverse_proxy 127.0.0.1:4321
}
```

Set `PUBLIC_URL=https://support.example.com`, and retain the application’s same-origin checks. Run as an unprivileged user. Persist the complete `DATA_DIR` through upgrades.

## Docker Compose

```sh
cp .env.example .env
docker compose up --build -d
docker compose logs -f feedme
```

The application binds on port 4321 inside its container, is published on host loopback, and stores data in the `feedme-data` named volume. Configure HTTPS on the host for live mode. The image runs as the `node` user. If using a bind mount instead of the named volume, make it writable by UID 1000. Use `docker compose down` without `-v` when upgrading to retain the database.

## Railway

1. Push your fork to GitHub and create a Railway service from that repository. `railway.json` selects the Dockerfile and `/api/health`.
2. Attach a persistent volume at **`/data` before first live sign-in**. Ensure it is writable by the container’s `node` user (UID 1000). Set volume ownership/mount permissions as needed for your Railway environment.
3. Generate a public domain and configure the live variables above. Set `HOST=0.0.0.0`; Railway supplies `PORT`.
4. Keep exactly **one replica**. There is no distributed OAuth lock or shared database in this release.
5. Deploy, verify the health endpoint, and complete the studio setup.

A complete one-click template is not published yet: a real deployment still needs the user’s domain, DID, Stripe setup, and volume. The checked-in configuration makes a GitHub deployment straightforward without claiming those account steps disappear. See [Railway volume documentation](https://docs.railway.com/volumes).

## Backups and operations

- Back up the data volume and `DATA_ENCRYPTION_KEY` separately. Without the key, live record values and OAuth credentials cannot be read.
- Stop the service before a filesystem backup, or use SQLite’s online backup API. Copying only the main database while WAL writes are active is not a safe backup.
- Keep the owner DID, Connect account, client URL, and encryption key stable through deploys. If the public URL changes, sign in again; OAuth grants are tied to client identity.
- The studio shows pending writes and failed attempts. Background retries are active with `pnpm start`/Docker; the development server uses manual sync.
- If using an external scheduler, POST to `/api/sync` with `Authorization: Bearer <SYNC_SECRET>`. No other internal job endpoints are exposed.
- Set appropriate reverse-proxy request limits for a public launch. Review the initial app’s privacy copy and add operator contact, retention, and payment terms.

## Live acceptance checklist

These require your provider accounts and were not executed as part of the local build.

- [ ] Real owner sign-in through Habitat, then repeat after an app restart.
- [ ] A different DID can sign in but cannot mutate studio state.
- [ ] Create a member-list space and verify another identity cannot read its receipts.
- [ ] Publish a project, read it from the actual public PDS, and confirm private notes are absent.
- [ ] Finish Stripe test onboarding and confirm the connected account’s charge/payout readiness.
- [ ] Complete a test Checkout and receive a verified connected-account webhook.
- [ ] Replay the webhook; totals must not increase twice.
- [ ] Complete monthly and yearly test Checkouts with an uneven project split. Use a Stripe test clock to advance a renewal, replay the invoice event, and verify that only successful payments increase totals once.
- [ ] Trigger a failed renewal, then recover payment; confirm no contribution is counted until settlement. Refund one renewal and verify that other periods remain intact.
- [ ] Open Manage support, update a payment method, cancel future renewals, and confirm the verified subscription event updates the local state without removing earlier tips. Test Stripe email recovery from another browser.
- [ ] Test asynchronous success/failure, partial/full refunds, and disputes.
- [ ] Disable Habitat temporarily; payments persist and queued writes succeed after reconnection.
- [ ] Restart/redeploy with the volume retained; data and signing keys survive.
- [ ] Test backup and restore with the same encryption key.

## Validation performed locally

Type checks, production build, deterministic payment/privacy/storage tests, lexicon contract validation, and browser flow checks run locally. Docker build is included in CI; the local Docker daemon was unavailable during initial implementation. Real service interoperability remains the checklist above.
