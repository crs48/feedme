# 01 · Source contracts and provider feasibility

## Objective and dependencies

Establish what Feedme imports and which providers can supply it reliably. This step precedes implementation promises. Use [the current schema](../../../src/lib/libcard-schema.ts), [catalog](../../../src/lib/libcard-catalog.ts), and [LibCard contract fixtures](../../../tests/fixtures/libcard/README.md) as compatibility references.

New module names below are proposed, not existing APIs: `src/lib/catalog/schema.ts`, `src/lib/catalog/adapters/`, and `tests/fixtures/catalog/`.

## Provider investigation

For Linktree, Bio Sites, and Beacons, record the following in a future `docs/website-sources.md` support table:

1. Official read API/export availability, required plan, scopes, rate limits, and whether independent self-hosters can obtain access. Do not mistake an analytics export or inbound integration SDK for an outbound link catalog.
2. Whether an approved public-page reader can get visible links and socials without executing JavaScript, logging in, private endpoints, or tracking redirects. Treat embedded JSON as untrusted data; do not expose hidden items merely because the payload contains them.
3. Stable provider item IDs, pagination/multiple pages, grouping/order, icons, and visibility/scheduling semantics.
4. Applicable access restrictions and robots rules. A blocked route stays unsupported; do not add cookies, anti-bot bypasses, or unofficial paid scraping proxies as an invisible fallback.
5. Sanitized fixtures from creator-authorized representative pages: links/socials, custom domain, groups, duplicate destinations, scheduled/hidden entries, gated links, challenge response, and genuine empty page.

Release automatic support only when the adapter can distinguish a complete current catalog from an error or partial page. A single successful example is insufficient. The research table in the [overview](README.md#provider-research-and-support-levels) is the starting evidence; no endpoint or scope is assumed to exist.

## Common document

Use pure adapters with injected transport. Each returns a versioned, validated document and observations. Adapters must not write SQLite or create payment records.

```ts
// Proposed domain shape; Zod schemas enforce the limits described below.
type CatalogDocument = {
  schemaVersion: 1;
  sourceTitle?: string; // source attribution, not the creator's profile
  completeness: 'complete' | 'partial' | 'unknown';
  items: Array<{
    sourceItemKey: string;
    kind: 'link' | 'social';
    label: string;
    url: string;
    blurb?: string;
    icon?: string; // allowlisted local icon name
    group?: string;
    sourceAspirationCents?: number;
    visibility: 'visible' | 'hidden' | 'skipped';
  }>;
};
```

Provenance belongs in the snapshot envelope: source ID, provider/adapter version, requested and accepted URL, source identity, content hash, validators, fetched/checked timestamps, and safe diagnostic code. It is not part of the public response. Preserve ordering from the source; put the synthesized `creator` target first. The adapter never imports a creator target or recipient address from a website.

Retain current bounds where possible: at most 500 normalized source items, 128 KiB normalized content, labels up to 100 characters, blurbs up to 240, and destinations up to 2,048. At most 99 source targets plus the creator can accept new picks. Excess entries are visible in the Studio preview as unselected, not silently evicted targets. Preserve existing LibCard cap behavior for its legacy configuration.

Source URLs are public HTTPS fetch destinations. Item destinations are a different contract: preserve supported HTTP(S), `mailto:`, `tel:`, and `sms:` links after validation, but never fetch contact schemes. Reject credentials and executable schemes. Render source strings as text, with the existing sanitized Markdown path only where explicitly allowed. Invalid optional icons fall back to a local link/platform icon; do not accept source SVG/HTML, CSS, or script.

Only import authored link/social entries. Embedded feeds, mailing-list forms, sign-in controls, provider promotions, and locked destinations are not catalog entries. Commerce blocks and external tip/checkout buttons require explicit selection or remain excluded; their prices/balances are never aspirations or Feedme revenue. Do not crawl destination pages to enrich a link.

## Portable manifest for owned websites

Propose a small **Feedme-specific** JSON format, not an existing web standard. Accept a direct HTTPS manifest URL. Optionally discover a same-origin manifest through a documented HTML `<link>` relation such as `rel="feedme-catalog"`; do not overload the existing `/.well-known/feedme` identity declaration.

Example `feedme-catalog.json`:

```json
{
  "version": 1,
  "items": [
    {
      "id": "coaching",
      "kind": "link",
      "label": "Coaching",
      "url": "https://example.com/coaching",
      "blurb": "More time working with people.",
      "aspirationCents": 300000
    },
    {
      "id": "resume",
      "kind": "link",
      "label": "Résumé",
      "url": "https://example.com/resume.pdf",
      "skip": true
    }
  ]
}
```

Publish a JSON Schema with the future implementation. All manifest items have stable, unique lowercase slug `id` values; reserve `creator` and `amount`. Here `id` is the **source item key**, not a promise about the checkout's internal project ID. Use Feedme's returned public target IDs to generate per-item checkout links. All unskipped manifest entries are eligible by default after source approval. `aspirationCents` is an optional nonnegative USD integer; missing/zero means none, with the existing maximum enforced.

This top-level manifest `skip` is separate from LibCard's existing nested `feedme` contract. Preserve LibCard's exact `{ skip: true }` exclusivity, `skip: false`/ID requirements, explicit/all modes, and skip behavior. Do not ask LibCard users to migrate their YAML.

One-off pasted title/URL rows or an uploaded manifest use the same normalization path and are labeled **manual list**. Do not advertise an export importer for a provider until an actual compatible export format is verified. Generic website extraction initially produces a reviewable candidate list; it does not automatically promote every anchor to a project.

## Validation and checklist

- [ ] Record documented access paths and support levels for all three providers, including blocked/unknown outcomes.
- [ ] Validate representative fixtures and explicitly identify incomplete, gated, or scheduled content.
- [ ] Define/version the normalized schema and manifest JSON Schema with examples and limits.
- [ ] Test malformed input, duplicate keys/IDs, unsafe URLs, unsupported icons, relative destinations, oversize documents, and source skips.
- [ ] Specify relative URL resolution against the accepted source URL; reject invalid/credential-bearing results and ignore hostile HTML `base` elements.
- [ ] Confirm that no new schema changes the existing LibCard consumer contract or stored IDs.

Complete this step with either a documented supported reader or an honest fallback per provider. Provider access failure must not block the manifest/manual foundation.
