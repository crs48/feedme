# Appearance

Feedme uses a restrained payment-oriented interface: white surfaces, slate text, thin neutral borders, system typography, and purple primary actions. The creator and their projects remain the focus. No external font requests or new browser JavaScript are required.

| Token | Value | Purpose |
| --- | --- | --- |
| `--color-paper` | `#ffffff` | Page and form backgrounds |
| `--color-ink` | `#1a1f36` | Headings and primary text |
| `--color-muted` | `#596579` | Descriptions and supporting text |
| `--color-primary` | `#635bff` | Buttons, progress, selected controls |
| `--color-border` | `#e3e8ee` | Dividers and card boundaries |
| `--color-surface` | `#f6f8fa` | Subtle secondary surfaces |

Shared tokens and components live in [`global.css`](../src/styles/global.css). Controls use a 6px radius; cards use 8–10px. Body copy uses the platform system sans-serif stack. Captions are at least 12px; text inputs are at least 16px to avoid focus zoom on iOS. Primary controls and navigation have at least 44px touch targets, with a visible keyboard focus ring and reduced-motion support.

## Mobile layout

Project grids move from three to two to one column. The project page places its summary and section links first, then the support form, then the full Markdown story, updates, and supporter timeline. The full story never pushes the payment form down the page. Decorative fallback artwork is omitted on the mobile project page; creator-provided images remain visible. Optional private notes use native `details`, and visibility selection uses ordinary radios with CSS state styling.

## Hosted Checkout

[`payments.ts`](../src/lib/payments.ts) sends per-session `branding_settings` with a white background, `#635bff` buttons, rounded controls, and Stripe’s `default` font. Keep these settings aligned with the shared CSS if you customize the theme.

Stripe supports these appearance settings for hosted Checkout and allows them to override connected-account defaults for a particular session. See [Stripe’s hosted Checkout appearance documentation](https://docs.stripe.com/payments/checkout/customization/appearance?payment-ui=stripe-hosted). Feedme leaves the connected merchant’s business name and logo untouched and does not change their account-wide branding.

The app continues to use Stripe’s hosted payment flow. Local screenshots verify Feedme’s UI; the final hosted page still needs to be checked using a real Stripe test account and the intended merchant branding.
