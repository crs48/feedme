vi.mock('../src/lib/creator-circle', () => ({ refreshCreatorCircle: vi.fn(async () => {}) }));
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('astro:middleware', () => ({ defineMiddleware: <T>(handler: T) => handler }));
vi.mock('../src/lib/config', () => ({ config: () => ({ origin: 'https://feedme.example' }) }));
const auth = vi.hoisted(() => ({ did: undefined as string | undefined, paused: false }));
vi.mock('../src/lib/backups', () => ({ runBackup: vi.fn(async () => {}) }));
vi.mock('../src/lib/recovery-control', () => ({ verifyRecovery: vi.fn(async () => {}) }));
vi.mock('../src/lib/auth', () => ({ currentUser: () => auth.did ? { did: auth.did } : undefined, isAdmin: (user?: { did: string }) => user?.did === 'admin' }));
vi.mock('../src/lib/admin-identity', () => ({ prepareIdentity: async () => {} }));
vi.mock('../src/lib/habitat', () => ({ drainOutbox: async () => ({ sent: 0, failed: 0 }) }));
vi.mock('../src/lib/db', () => ({ getKv: () => auth.paused, getDb: () => ({ prepare: () => ({ run: () => undefined }) }) }));
import { onRequest } from '../src/middleware';
import { POST as sync } from '../src/pages/api/sync';
import type { APIContext } from 'astro';

const runMiddleware = async (...args: Parameters<typeof onRequest>) => {
  const response = await onRequest(...args);
  if (!response) throw new Error('Middleware did not return a response.');
  return response;
};
const context = (path: string, headers: Record<string, string> = {}) => ({
  request: new Request(`https://feedme.example${path}`, { method: 'POST', headers }),
  url: new URL(`https://feedme.example${path}`), locals: {}, redirect: (url: string, status: number) => new Response(null, { status, headers: { Location: url } }),
}) as APIContext;
describe('form and service request boundaries', () => {
  afterEach(() => { delete process.env.SYNC_SECRET; auth.did = undefined; auth.paused = false; });
  it('rejects cross-origin or missing-origin form submissions', async () => {
    for (const headers of [{ origin: 'https://evil.example' }, {}] as Record<string, string>[]) {
      const response = await runMiddleware(context('/api/studio', headers), async () => new Response('unexpected'));
      expect(response.status).toBe(403);
    }
  });
  it('accepts same-origin forms and sets private caching and framing headers', async () => {
    auth.did = 'admin';
    const response = await runMiddleware(context('/api/studio', { origin: 'https://feedme.example' }), async () => new Response('ok'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });
  it('permits brief caching only for successful public LibCard GET/HEAD responses', async () => {
    for (const method of ['GET', 'HEAD']) {
      const c = context('/api/public/libcard'); c.request = new Request('https://feedme.example/api/public/libcard', { method });
      const response = await runMiddleware(c, async () => Response.json({ targets: [] }));
      expect(response.headers.get('cache-control')).toBe('public, max-age=60');
      const unavailable = await runMiddleware(c, async () => new Response('Unavailable', { status: 503 }));
      expect(unavailable.headers.get('cache-control')).toBe('private, no-store');
    }
    const c = context('/checkout/review'); c.request = new Request('https://feedme.example/checkout/review');
    expect((await runMiddleware(c, async () => new Response('PRIVATE'))).headers.get('cache-control')).toBe('private, no-store');
  });
  it('protects every dashboard, mutation, and export endpoint from non-admin sessions', async () => {
    for (const path of ['/studio', '/studio/projects/new', '/studio/settings', '/api/studio', '/api/admin/export', '/studio/data', '/api/admin/data']) {
      auth.did = 'supporter';
      const response = await runMiddleware(context(path, { origin: 'https://feedme.example' }), async () => new Response('PRIVATE'));
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain('PRIVATE');
    }
    auth.did = undefined;
    expect((await runMiddleware(context('/studio', { origin: 'https://feedme.example' }), async () => new Response('PRIVATE'))).headers.get('location')).toBe('/login?returnTo=%2Fstudio');
  });
  it('allows an out-of-browser sync request only with the exact bearer token', async () => {
    process.env.SYNC_SECRET = 'test-sync-token-with-at-least-32-characters';
    const request = context('/api/sync', { authorization: `Bearer ${process.env.SYNC_SECRET}` });
    const response = await runMiddleware(request, async () => await sync(request));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 0, failed: 0 });
    expect((await sync(context('/api/sync'))).status).toBe(401);
  });
  it('pauses checkout, billing changes and webhooks while leaving authenticated recovery available', async () => {
    auth.paused = true; auth.did = 'admin';
    for (const path of ['/api/checkout', '/api/billing', '/api/studio', '/api/stripe/webhook']) {
      const response = await runMiddleware(context(path, { origin: 'https://feedme.example' }), async () => new Response('UNSAFE'));
      expect(response.status).toBe(503); expect(await response.text()).not.toContain('UNSAFE');
    }
    expect((await runMiddleware(context('/api/admin/data', { origin: 'https://feedme.example' }), async () => new Response('ok'))).status).toBe(200);
  });
  it('passes external webhooks to their signature-verification handler', async () => {
    const response = await runMiddleware(context('/api/stripe/webhook'), async () => new Response('Invalid signature', { status: 400 }));
    expect(response.status).toBe(400);
  });
});
