# Your Feedme installation 🌱

This small deployment bundle runs the official Feedme container. Your configuration and persistent volume belong to you; updates replace the application image. No Node installation or source-code merges are needed on the host.

**Early preview:** Feedme's real Habitat/AT Protocol and Stripe account flows still need operator acceptance. Use test accounts before accepting real money. Published `0.x` releases remain marked as prereleases on GitHub.

## Install

1. Install Docker Engine and Docker Compose v2. Use an Intel/AMD or ARM Linux server.
2. Copy `.env.example` to `.env`, and set `BLUESKY_HANDLE` to your own handle. Leave demo mode enabled for the first preview. Keep credentials out of Git.
3. Run `docker compose up -d --wait`, then open `http://127.0.0.1:4321` on the server (or through an SSH tunnel). The port intentionally binds only to loopback.
4. For a live instance, put HTTPS in front of port 4321 and follow the [live setup guide](https://github.com/crs48/feedme/blob/main/docs/hosting.md#live-configuration). Set the public URL, encryption keys, Habitat connection and Stripe test credentials. Keep exactly one replica.
5. Configure [verified backups](https://github.com/crs48/feedme/blob/main/docs/backups-and-recovery.md) before accepting data you need to keep.

The released `compose.yaml` pins both the version and verified image digest. `release.json` identifies the version shipped in this bundle. The `feedme-data` named volume survives container replacement. Never use `docker compose down -v` unless you intend to erase the database.

You can put these files in your own GitHub repository. Enable the [Renovate GitHub App](https://github.com/apps/renovate) for it to propose image updates using `renovate.json`. Updates require review; auto-merge is disabled. A PR merge changes the configuration, **not a running VPS**: redeploy using the steps below. Hosting providers may deploy automatically if you have explicitly enabled that behavior.

## Upgrade

Read the destination release notes, supported starting versions and any required environment changes first. During the `0.x` preview, minor releases can break compatibility. Do not run floating `latest` tags or deploy every upstream `main` commit.

1. Record the existing image reference and retain your existing Compose file. Download the new release bundle into a **separate directory**. Do not replace `.env`, the active deployment directory, or your volume. You can pull the new image reference ahead of time to reduce downtime.
2. In Studio → Data & backups, sync pending changes and check the latest backup. Then stop the old server and take a final verified backup using the **old Compose file and old image**:

   ```sh
   docker compose stop feedme
   docker compose run --rm --no-deps feedme node --import tsx scripts/data.ts backup
   ```

   This requires the separately configured backup key and destination. If backup fails, do not proceed; restart the old application with `docker compose up -d --wait` and fix backups first. Stripe continues to handle existing subscriptions while Feedme is stopped; webhook delivery resumes after startup.
3. Copy only the new `image:` reference (version **and** digest) into your existing Compose file, or accept Renovate's reviewed change. Apply any documented configuration changes. Keep the same Compose project name, volume, public URL and encryption keys.
4. Start the new image:

   ```sh
   docker compose pull feedme
   docker compose up -d --wait
   docker compose logs --tail=80 feedme
   ```

5. Check `/api/health` for the expected `version` and `databaseSchema`. Sign in to Studio, confirm project/support totals, and review Data & backups for sync errors. Health passing checks local startup, not real provider interoperability.

Database migrations run transactionally at startup. A failed migration rolls back the migration batch; it does not silently continue. Feedme refuses databases with a newer schema than it supports. Backups are **not** automatically forced by `docker compose up`: the verified pre-upgrade backup above is required operational procedure.

### If the upgrade fails

Stop the new container before taking further action. Inspect its logs. Reusing the old image is safe only when its database schema and record formats remain compatible. Do not assume an older image understands the upgraded database, and never edit `PRAGMA user_version` to bypass the check. Builds from before schema versioning cannot enforce this guard.

If rollback requires older data, follow the [restore guide](https://github.com/crs48/feedme/blob/main/docs/backups-and-recovery.md) with the compatible release and verified backup. Recovery checks current Stripe state and starts paused for review. Restoring an old snapshot can lose later local changes; automatic rollback is deliberately not enabled.

## Moving from the source template

Use a published bundle after its image and assets are available. Preserve the original `.env`, keys, connected Stripe account and data volume. Docker Compose names volumes using its project name, which often comes from the directory name. Run `docker compose ls` and inspect your current container's mounts before switching; use `docker compose --project-name YOUR_EXISTING_PROJECT ...` consistently if necessary. A new directory must not silently create an empty replacement volume. For host-based SQLite installations, use the documented backup/restore path rather than copying an active SQLite file without its WAL.

Source-code customizations need a fork and upstream merges. Ordinary configuration belongs in `.env` or Studio and survives image upgrades. `release.json` describes the original bundle; `/api/health` reports the running application after subsequent image updates.
