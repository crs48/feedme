# Following the work 🌱

Feedme uses the supporter's own AT Protocol repository for social actions. Creator and friend follows are normal Bluesky follows. Projects need a small additional record because a native follow targets an account DID, not a project.

```mermaid
flowchart LR
  Supporter[Signed-in supporter] --> Follow[Explicit follow / unfollow]
  Follow --> Native[app.bsky.graph.follow: creator DID]
  Follow --> Project[fund.feedme.follow: project AT URI]
  Native --> PDS[Supporter's public PDS through Habitat OAuth]
  Project --> PDS
  Creator[Creator project post] --> OptIn[Explicit publish with stable project tag]
  OptIn --> Feed[Following: creator timeline and project updates]
  PDS --> Feed
  Tip[Confirmed tip] --> Compose[Separate, optional public composer]
  Compose --> Post[app.bsky.feed.post in supporter's PDS]
  Tip --> Private[Private note remains in Habitat]
```

## Implementation checklist

- [x] Native creator/friend follows, including existing follows and unfollow.
- [x] Portable project subscriptions and deterministic project tags.
- [x] Following page with creator timeline and project updates.
- [x] Keep-me-updated controls alongside tipping and after payment.
- [x] Explicit public tip posts, with separate text and verified receipt access.
- [x] Actor-scoped writes, idempotent retries, pagination, and privacy tests.
- [x] Accessible HTML forms, demo supporter, desktop/mobile browser verification.

## Supporter onboarding

The `/bluesky` guide explains who does what: Feedme is the creator’s independently hosted tipping site, Bluesky provides a familiar social account on AT Protocol, Stripe handles payment, and Habitat provides private storage. The same guide is exported at `/demo/bluesky/`; the public demo uses fictional profiles and never authorizes a real account.

Every guest-facing sign-in action names Bluesky. Other compatible AT Protocol handles and DIDs still work. Anonymous gifts need no account; “anonymous” leaves the social profile unattached, but does not hide billing information from Stripe or the creator. A named gift needs control of the chosen account, not legal-identity verification.

```mermaid
flowchart TD
  Choose[Choose amount, picks, and visibility] --> Review[Browser-bound review]
  Review --> Anonymous[Anonymous: no account required]
  Review --> Named[Private or public: attach a profile]
  Named --> Existing[Sign in with Bluesky or compatible provider]
  Named --> Signup[Create a Bluesky account in a new tab]
  Signup --> Existing
  Existing --> ReviewAgain[Return to the saved review]
  Named --> Switch[Make a new anonymous review with the same gift]
  Switch --> Anonymous
  Anonymous --> Stripe[Continue to Stripe]
  ReviewAgain --> Stripe
  Stripe --> Verified[Verified payment event]
  Verified --> Receipt[Receipt and optional social actions]
  Receipt --> Consent[Explicit consent to publish a Bluesky post]
```

LibCard reviews last one hour and are bound to the original browser. URLs carry only an opaque review token, never notes or identities. Sign-in validation and provider errors retain that safe return path. OAuth callbacks validate browser binding before restoring it, and still require successful provider verification before creating a session.

The review page keeps Anonymous, Private, and Public visible as ordinary form buttons. Changing visibility creates a new review with the original amount, picks, schedule, and note, rechecks target eligibility, and never mutates an existing checkout or makes a payment. Anonymous clears identity and public timeline consent; private and public require sign-in before payment. The sign-in page links back to review and change visibility. The native percentage and single-project forms require sign-in before choosing a named gift; their unsubmitted fields are not saved across sign-in.

The receipt distinguishes confirmed, pending, failed, refunded, partially refunded, disputed, and inaccessible payments. Only a confirmed, unadjusted receipt offers the collapsed “Stay connected — optional” section. A guest who chooses it returns from sign-in to that section with the connected profile shown; following and posting still require a separate action. Review gives payment the primary button, with visibility explained before continuing.

After payment, signing in does not retroactively attach a profile to an anonymous receipt. Following and publishing are separate explicit actions; posting can identify a supporter even if their gift was private or anonymous. Anonymous recurring supporters can use the original browser or Stripe’s checkout-email recovery to manage billing. Billing explains missing portal configuration and duplicate Stripe customer records. A receipt URL alone never grants access; inaccessible receipts return 404 without their amount, allocation, or recurring details. Signup help retains the receipt or review as the return path, including when signup happens in another tab.

Regression coverage lives in `tests/auth-flow.test.ts`, `tests/pick-checkout.test.ts`, and `scripts/check-libcard.mjs` (ordinary HTML forms without JavaScript).

## Protocol contracts

- `app.bsky.graph.follow` lives in the follower's public repo, targets a DID, and uses a TID record key. Existing records from other apps are honored.
- `fund.feedme.follow` lives in the follower's public repo and targets `at://<creator DID>/fund.feedme.project/<project key>`. This lexicon is intentionally small. Legacy `social.feedme.follow` records remain readable during migration. An optional title is a display hint, not an authority or payment destination.
- Creator shares are ordinary `app.bsky.feed.post` records with an external project card. An additional tag, `feedme-` plus the first 32 hexadecimal characters of SHA-256 of the project's AT URI, associates updates with a project across domains. Only posts authored by that project's DID count as its updates. A tip post is not a creator update.
- Posts use TID keys and the Bluesky limits of 300 graphemes and 3,000 UTF-8 bytes. Private notes, amounts, payment IDs, receipt IDs, and billing data are never copied into a post.
- Public tip posts are deliberately separate from public payment acknowledgments. Publishing identifies the author and project even when the receipt was anonymous. The app requires explicit consent and either the original checkout browser or the named tip's authenticated DID.

## Boundaries

The Following page is server-rendered. Creator follows participate in Bluesky's own timeline. Project follows currently surface updates in Feedme, not project-specific Bluesky push notifications. Native creator activity subscriptions and a Bluesky custom feed generator are possible later additions; they are not simulated here.

Social writes restore the acting supporter's OAuth session, never the instance owner's. They complete synchronously with a persisted, stable record key for safe retry; failures remain visible. The owner's background outbox remains separate. Public subscription records can be read by other compatible instances; this first implementation does not crawl arbitrary instances or operate a network-wide indexer.

Live interoperability with the configured Habitat proxy and Bluesky AppView still needs an operator account. Demo mode exercises the same UI without making external social writes.

## Primary references

- [Native follow record](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/graph/follow.json)
- [Post record, tags, replies, and text limits](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/post.json)
- [Authenticated timeline](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/getTimeline.json)
- [Author feed and cursor pagination](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/getAuthorFeed.json)
- [Official SDK service proxy support](https://github.com/bluesky-social/atproto/blob/main/packages/api/src/agent.ts)
- [Habitat's implemented endpoints](https://github.com/habitat-network/habitat/blob/main/api-docs/docs/space-proxy/endpoints.mdx)
