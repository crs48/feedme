# Contributing

Use Node 24 and the pnpm version in `package.json`. Start with the demo; no provider account is needed for most work.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm test
pnpm build
```

Prefer small pure functions for domain decisions and explicit I/O adapters. Keep forms usable without JavaScript. Validate on the server even when the HTML form includes constraints.

When changing payment handling, test duplicate and out-of-order events. When changing records, validate wire examples against `lexicons/` and verify that public projections do not contain private fields. Keep Habitat integration changes pinned to a reviewed upstream contract and record the revision in `docs/data-model.md`.

Use conventional commits with a short purpose and bulleted implementation/validation details. Update checklists in `docs/plans/foundation/` as work is actually verified. New provider integrations should use fixture tests locally and a documented real-account acceptance test before being described as production-tested.

Do not commit `.env`, database files, OAuth credentials, screenshots of private receipts, or payment payloads. Security issues should be disclosed privately to the repository maintainer rather than including secrets or personal records in a public issue.
