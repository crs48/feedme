import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages is a separate static product site. The self-hosted Node build
// continues to use astro.config.mjs and never serves the demo exporter.
export default defineConfig({
  site: 'https://feedme.fund',
  srcDir: './site',
  outDir: './site-dist',
  cacheDir: './.astro-site',
  output: 'static',
  trailingSlash: 'always',
  vite: { plugins: [tailwindcss()], build: { assetsInlineLimit: 0 } },
  devToolbar: { enabled: false },
});
