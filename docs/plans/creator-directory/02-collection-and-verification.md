# 02 · Collection and verification

## Objective and dependencies

Build a small TypeScript collector that turns public candidate DIDs into a validated directory snapshot. It depends on [step 01](01-publication-and-identity.md), but not on any creator's SQLite database or login session.

Reuse [public network transport](../../../src/lib/public-network.ts), [profile parsing and PDS resolution](../../../src/lib/public-repo.ts), [bounded concurrency](../../../src/lib/discovery.ts), and [existing provider tests](../../../tests/discovery-provider.test.ts). Current readers call `getDb()` and `config()`; do not import them wholesale into a public build. Extract pure validation plus injected network/cache interfaces, retaining the app wrappers.

## Candidate collection

1. Paginate `com.atproto.sync.listReposByCollection` for `fund.feedme.profile` from a configured supporting relay. Store source and scan coverage; deduplicate by DID. Protect against repeated cursors and resource limits.
2. Include previously known candidate DIDs for rechecks. Absence from the latest relay page is not proof of record deletion.
3. Allow an optional small reviewed bootstrap file of DIDs. A submitted handle is resolved to a DID; a submitted URL is only a hint and never trusted over the PDS record. This escape hatch helps with relay coverage and initial testing without becoming mandatory registration.
4. Allow a second independently configured relay later. Do not let candidate records supply new relay URLs or arbitrary fetch instructions.
5. Perform a fresh full enumeration periodically. A pagination cursor is a scan position, not a durable change-stream checkpoint; after exhaustion start a new scan. A resumed scan must still revisit its beginning on completion so inserts before the cursor are eventually found.

The [official enumeration contract](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/sync/listReposByCollection.json) accepts a collection and pagination cursor and returns DIDs. It does not establish opt-in, canonical origin, reachability, moderation status, or complete global coverage.

## Verify each candidate

Resolve current DID → current PDS → exact `fund.feedme.profile/self` record → validated HTTPS origin → matching `/.well-known/feedme`. Require the declaration's `profile` URI as well as DID, protocol, and origin to match. Re-resolve identity on migration/error instead of retaining a stale PDS indefinitely. Verify handle-to-DID and DID-to-handle association before displaying a handle as current, following the [handle specification](https://atproto.com/specs/handle).

Return observations rather than a boolean. Keep these dimensions separate:

| Dimension | Suggested values | Meaning |
| --- | --- | --- |
| Advertisement | listed / withdrawn / unknown | Current public membership preference, or inability to check it |
| Site | reachable / unreachable / unknown / mismatch | Observation of the advertised site's declaration |
| Moderation | allowed / suppressed / unchecked | Index operator's policy decision, not a change to the creator's record |

Proposed policy: list recently verified, opted-in creators by default. Show **last checked** rather than an unconditional “live” badge. A timeout changes site status but does not delete the candidate. An identity mismatch immediately suppresses the outbound site link. A confirmed opt-out or missing profile immediately removes the card from the next export, regardless of cached reachability. Account deactivation/takedown should suppress listing when confirmed by the current authoritative/provider signals; a generic network error is not such confirmation.

Start with these adjustable defaults: recheck known creators nightly; mark verification stale after 48 hours; remove listings from the public export when current discovery preference cannot be confirmed for seven days. Keep unreachable-but-still-opted-in creators in an optional **currently unreachable** view without a stale site link. No “inactive” claim should be inferred merely from a creator not posting. Incomplete scans and provider-wide outages set a directory freshness/coverage warning rather than asserting that hundreds of sites disappeared.

## Output and state boundaries

Implemented public format (validated in `src/lib/directory-model.ts`):

```ts
type DirectorySnapshot = {
  schemaVersion: 1;
  generatedAt: string;
  source: { relays: string[]; completedAt?: string; partial: boolean };
  creators: Array<{
    did: string;
    handle?: string;
    name: string;
    bio: string;
    url?: string; // only when reciprocal identity verification allows it
    profileUri: string;
    profileCid: string;
    advertisementCheckedAt: string;
    siteCheckedAt: string;
    lastVerifiedAt?: string;
    siteStatus: 'reachable' | 'unreachable' | 'unknown';
  }>;
};
```

Use explicit field construction. Do not spread arbitrary PDS records into JSON. Omit raw network errors, IP addresses, private relationships, tips, donor identities, and payment status. Cap strings and output size; render all content as text. A snapshot is an indexer's observation, not signed authority from each creator.

Keep collector state separate from exported cards: last observation, next retry time, candidate sources, and scan cursor. For phase one, store a bounded schema-validated JSON state as a short-retention workflow artifact, containing public-data-derived fields only. Restore only an artifact from a successful trusted default-branch run of this workflow. Do not load an artifact from an arbitrary PR, accept executable caches, or commit generated profiles to Git history. State is disposable; cold start re-enumerates and re-verifies. Minimize withdrawn entries to DID/retry bookkeeping and remove their profile text. Previously distributed public copies remain outside our control.

## Bandwidth and hostile inputs

- Proposed initial limits: concurrency four, one request in flight per host, five-second request deadlines, 64 KiB profile/declaration bodies, larger separately bounded relay pages, 1,000 candidates and a 10-minute wall-clock budget per run. Fairly reserve work for both known-account rechecks and new discovery; publish `partial` and persist remaining work when capped.
- A cold verified candidate usually requires a DID document, profile record, and site declaration, plus display identity/moderation reads. Budget approximately 3–5 small HTTP calls per creator, excluding avatars. At 1,000 creators this is roughly 3,000–5,000 requests per daily scan, not a measured traffic estimate. Reuse per-run DID caches and batch supported profile lookups.
- Retain HTTPS-only public address validation, pinned DNS, blocked private/reserved IPs, redirect rejection, size/time limits, and no forwarded cookies or authorization. Apply these rules at every hop, including identity documents and media. Treat SSRF controls as mandatory on CI runners as well as servers.
- Honor throttling with bounded retry/backoff and jitter. One broken host must not consume the global budget. Do not request creator homepages, projects, videos, or complete repositories just to discover their identity.
- Directory listing must not depend on arbitrary remote HTML, Markdown execution, scripts, or payment readiness probes.
- Reuse public label filtering and add maintainer suppression policy. If visibility checks fail, withhold new suggestions and mark prior observations stale; do not silently bypass checks. Authentication context is required for personal blocks/mutes and is handled only on the user's chosen instance.

## Implementation

The collector and CLI are implemented with public-only module imports. State is capped at 5,000 candidate DIDs and exports at 2 MB. HTTP 429/503 responses cool the origin for the remaining run; retries occur on later runs, with no aggressive immediate retry. Large relays and full candidate capacity report partial coverage. Per-request byte statistics and batched display-profile reads remain future optimizations.

## Validation and checklist

- [x] Add collector tests for pagination, duplicate/repeated cursors, partial budgets, resumed/cold scans, and no starvation.
- [x] Cover withdrawal, PDS migration, URL replacement, domain takeover/mismatch, transient outages, and stale consent expiry.
- [x] Reuse and extend SSRF tests for every new request path; verify a relay candidate cannot trigger internal-network access.
- [x] Validate explicit public JSON allowlists, untrusted strings, size ceilings, and separation from live database modules.
- [ ] Demonstrate successful collection with real opt-in test creators; confirm the empty-directory case remains honest.
- [ ] Measure requests, bytes, scan duration, throttling, and retry counts before increasing limits.
