import { defineMiddleware } from 'astro:middleware';
import { config } from './lib/config';
import { currentUser } from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
  const cfg = config();
  if (context.request.method === 'POST' && !['/api/stripe/webhook', '/api/sync'].includes(context.url.pathname)) {
    const origin = context.request.headers.get('origin');
    if (origin !== cfg.origin) return new Response('This form must be submitted from this site.', { status: 403 });
  }
  context.locals.user = currentUser(context);
  const response = await next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  // All pages include session-aware navigation; avoid leaking authenticated HTML through a CDN.
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (cfg.origin.startsWith('https://')) response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  response.headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; media-src 'self' https: blob:; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https:");
  return response;
});
