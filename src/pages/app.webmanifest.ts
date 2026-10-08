import type { APIRoute } from 'astro';
import { siteName } from '../lib/site-branding';

export const GET: APIRoute = () => {
  const name = siteName();
  return new Response(JSON.stringify({
    id: '/', name, short_name: name, description: 'Independent work, supported.',
    start_url: '/', scope: '/', display: 'standalone',
    background_color: '#ffffff', theme_color: '#ffffff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  }), { headers: { 'Content-Type': 'application/manifest+json' } });
};
