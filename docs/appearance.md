# Appearance

Feedme combines Bluesky’s social layout with Stripe’s restrained payment interface: bright blue actions, circular portraits, compact feed rows, white surfaces, slate text, thin neutral borders, and system typography. The creator and their projects remain the focus. No external font requests are required. The homepage allocation calculator uses a small, same-origin JavaScript module; the underlying range inputs and checkout form still work without it.

| Token | Value | Purpose |
| --- | --- | --- |
| `--color-paper` | `#ffffff` | Page and form backgrounds |
| `--color-ink` | `#1a1f36` | Headings and primary text |
| `--color-muted` | `#596579` | Descriptions and supporting text |
| `--color-primary` | `#0866ff` | Buttons, progress, selected controls |
| `--color-border` | `#e3e8ee` | Dividers and card boundaries |
| `--color-surface` | `#f6f8fa` | Subtle secondary surfaces |

Shared tokens and components live in [`global.css`](../src/styles/global.css). Payment controls use a 6px radius; social buttons use a pill shape, and cards use 12–16px radii. The primary blue has a 4.82:1 contrast ratio against white. Body copy uses the platform system sans-serif stack. Captions are at least 12px; text inputs are at least 16px to avoid focus zoom on iOS. Primary controls and navigation have at least 44px touch targets, with a visible keyboard focus ring and reduced-motion support.

## Social layout

Creator headers use a soft blue cover, an overlapping portrait, and section tabs with a blue underline. Updates, project logs, and Following share a continuous bordered feed: an avatar column, author name and available handle, timestamp, rich media, and a link to the original conversation. Public supporter activity follows the same portrait-and-divider rhythm. Feedme keeps its own branding and shows no invented engagement counts.

The visual reference is [Bluesky’s public profile interface](https://bsky.app/profile/bsky.app). Native follow forms and links to Bluesky retain their existing behavior.

## Mobile layout

The homepage lists projects without cover images, alongside a sticky support panel on desktop. On mobile, the total amount appears first, followed by project sliders and the checkout breakdown. A fixed review bar keeps the chosen total in view. Project pages retain their images. The project page places its summary and section links first, then the support form, then the full Markdown story, updates, and supporter timeline. The full story never pushes the payment form down the page. Decorative fallback artwork is omitted on the mobile project page; creator-provided images remain visible. Optional private notes use native `details`, and visibility selection uses ordinary radios with CSS state styling.

## Allocating one tip

Each slider is a relative weight from 0 to 100. Equal weights split the total equally; one nonzero slider receives the whole total. Zero-weight projects are excluded. Dollar amounts and percentages update immediately, and clearing all sliders disables checkout with an explanation. “Split evenly” and amount presets are conveniences; native sliders and the total field remain usable without JavaScript.

The browser and server share the same integer-cent allocation function. Leftover cents go to the largest fractional shares, with ties resolved in the displayed project order. The server recomputes the amounts rather than trusting the displayed values. See [split support](split-support.md) for the payment and refund behavior.

## Portraits and photography

[`Avatar.astro`](../src/components/Avatar.astro) provides fixed-size circular portraits with initials underneath. The photo is a decorative CSS background beside the person's visible name, so missing or failed images expose the initials without JavaScript, broken-image icons, or layout movement. Anonymous supporters always use the same generic person icon.

Post avatars come from the Bluesky AppView's `author.avatar`, including project logs and the Following feed. Only credential-free HTTPS avatar URLs pass normalization; labeled profile images use the fallback. This uses the author data already fetched with each post, with no additional profile lookups. Creator/recommendation cards and supporter activity use sample portraits in demo mode and initials in live mode until profile metadata is available to those views.

Demo mode includes six locally served 160px portraits, three project photos in 480px and 960px WebP variants, and photographs in the original sample updates. Authored posts and creator-provided covers are preserved. Below-the-fold project/post photos load lazily, and `srcset` lets the browser choose an appropriate size. Demo assets are illustrative, are never published to a real PDS, and have [source credits and licenses](../public/demo/CREDITS.md).

## Hosted Checkout

[`payments.ts`](../src/lib/payments.ts) sends per-session `branding_settings` with a white background, `#0866ff` buttons, rounded controls, and Stripe’s `default` font. Keep these settings aligned with the shared CSS if you customize the theme.

Stripe supports these appearance settings for hosted Checkout and allows them to override connected-account defaults for a particular session. See [Stripe’s hosted Checkout appearance documentation](https://docs.stripe.com/payments/checkout/customization/appearance?payment-ui=stripe-hosted). Feedme leaves the connected merchant’s business name and logo untouched and does not change their account-wide branding.

The app continues to use Stripe’s hosted payment flow. Local screenshots verify Feedme’s UI; the final hosted page still needs to be checked using a real Stripe test account and the intended merchant branding.

## Tip frequency

The homepage and project forms share a three-way native radio control for one-time, monthly, and yearly support. The selected option uses the same blue accent and white surface as the amount controls, with 44px touch targets and keyboard focus. CSS changes the explanatory text without JavaScript. The homepage calculator adds the selected interval to each allocation, summary total, and persistent mobile review bar.
