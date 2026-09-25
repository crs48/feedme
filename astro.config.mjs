import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone', bodySizeLimit: 1_048_576 }),
  // Middleware enforces exact origins for forms while allowing signed Stripe
  // webhooks and bearer-authenticated background sync from outside the browser.
  security: { checkOrigin: false },
  vite: { plugins: [tailwindcss()], ssr: { external: ['node:sqlite'] } },
  devToolbar: { enabled: false },
});
