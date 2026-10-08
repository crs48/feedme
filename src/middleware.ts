import { defineMiddleware } from 'astro:middleware';
import { getDb, getKv } from './lib/db';
import { config } from './lib/config';
import { currentUser, isAdmin } from './lib/auth';
import { prepareIdentity } from './lib/admin-identity';

export const onRequest = defineMiddleware(async (context, next) => {
  try { await prepareIdentity(); }
  catch { return new Response('Feedme could not verify its configured creator. Check BLUESKY_HANDLE, Habitat connectivity, and the data directory owner configuration.', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
  const cfg = config();
  if (context.request.method === 'POST' && !['/api/stripe/webhook', '/api/sync'].includes(context.url.pathname)) {
    const origin = context.request.headers.get('origin');
    if (origin !== cfg.origin) return new Response('This form must be submitted from this site.', { status: 403 });
  }
  if (getKv(getDb(), 'recovery', 'paused') && context.request.method !== 'GET' && context.request.method !== 'HEAD' && !['/api/admin/data', '/api/sync'].includes(context.url.pathname) && !context.url.pathname.startsWith('/auth/')) return new Response('Recovery is paused. The creator must review and resume in Dashboard → Data & backups.', { status: 503, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
  context.locals.user = currentUser(context);
  if ((context.url.pathname === '/api/studio' || context.url.pathname === '/studio' || context.url.pathname.startsWith('/studio/') || context.url.pathname.startsWith('/api/admin/')) && !isAdmin(context.locals.user)) {
    if (!context.locals.user && !context.url.pathname.startsWith('/api/'))
      return context.redirect(`/login?returnTo=${encodeURIComponent(context.url.pathname + context.url.search)}`, 303);
    return new Response('Administrator access is required.', { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const response = await next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  if (cfg.sandbox) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  // All pages include session-aware navigation; avoid leaking authenticated HTML through a CDN.
  const publicLibcard = context.url.pathname === '/api/public/libcard' && ['GET', 'HEAD'].includes(context.request.method) && response.status === 200;
  response.headers.set('Cache-Control', publicLibcard ? 'public, max-age=60' : 'private, no-store');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (cfg.origin.startsWith('https://')) response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  response.headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; media-src 'self' https: blob:; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https:");
  return response;
});
