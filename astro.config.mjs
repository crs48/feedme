import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone', bodySizeLimit: 1_048_576 }),
  vite: { plugins: [tailwindcss()], ssr: { external: ['node:sqlite'] } },
  devToolbar: { enabled: false },
});
