import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('astro:middleware', () => ({ defineMiddleware: <T>(handler: T) => handler }));
vi.mock('../src/lib/config', () => ({ config: () => ({ origin: 'https://feedme.example' }) }));
vi.mock('../src/lib/auth', () => ({ currentUser: () => undefined }));
vi.mock('../src/lib/habitat', () => ({ drainOutbox: async () => ({ sent: 0, failed: 0 }) }));
vi.mock('../src/lib/db', () => ({ getDb: () => ({ prepare: () => ({ run: () => undefined }) }) }));
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
  url: new URL(`https://feedme.example${path}`), locals: {},
}) as APIContext;
describe('form and service request boundaries', () => {
  afterEach(() => { delete process.env.SYNC_SECRET; });
  it('rejects cross-origin or missing-origin form submissions', async () => {
    for (const headers of [{ origin: 'https://evil.example' }, {}] as Record<string, string>[]) {
      const response = await runMiddleware(context('/api/studio', headers), async () => new Response('unexpected'));
      expect(response.status).toBe(403);
    }
  });
  it('accepts same-origin forms and sets private caching and framing headers', async () => {
    const response = await runMiddleware(context('/api/studio', { origin: 'https://feedme.example' }), async () => new Response('ok'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });
  it('allows an out-of-browser sync request only with the exact bearer token', async () => {
    process.env.SYNC_SECRET = 'test-sync-token-with-at-least-32-characters';
    const request = context('/api/sync', { authorization: `Bearer ${process.env.SYNC_SECRET}` });
    const response = await runMiddleware(request, async () => await sync(request));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 0, failed: 0 });
    expect((await sync(context('/api/sync'))).status).toBe(401);
  });
  it('passes external webhooks to their signature-verification handler', async () => {
    const response = await runMiddleware(context('/api/stripe/webhook'), async () => new Response('Invalid signature', { status: 400 }));
    expect(response.status).toBe(400);
  });
});
