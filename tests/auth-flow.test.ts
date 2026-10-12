import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import type { DatabaseSync } from 'node:sqlite';

const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined, authorize: vi.fn(), callback: vi.fn(), createSession: vi.fn() }));
vi.mock('../src/lib/config', () => ({ config: () => ({ origin: 'https://feedme.example', adminDids: [] }) }));
vi.mock('../src/lib/db', async original => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => state.db! }));
vi.mock('../src/lib/auth', async original => ({ ...await original<typeof import('../src/lib/auth')>(),
  oauthClient: async () => ({ authorize: state.authorize, callback: state.callback }), createSession: state.createSession,
}));
vi.mock('../src/lib/auth-errors', () => ({ reportAuthError: vi.fn() }));
import { digest } from '../src/lib/auth';
import { getKv, openDatabase, setKv } from '../src/lib/db';
import { POST } from '../src/pages/auth/login';
import { GET } from '../src/pages/auth/callback';

const reviewPath = '/checkout/review?token=4f9f0abf-650d-47d5-8337-82e198bde722';
let jar: Map<string, string>;
const context = (path: string, data?: Record<string, string>) => ({
  url: new URL(path, 'https://feedme.example'),
  request: new Request(new URL(path, 'https://feedme.example'), data ? { method: 'POST', body: new URLSearchParams(data) } : undefined),
  cookies: { get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
    set: (name: string, value: string) => jar.set(name, value), delete: (name: string) => jar.delete(name) },
  redirect: (url: string, status: number) => new Response(null, { status, headers: { location: url } }),
}) as unknown as APIContext;
const destination = (response: Response) => new URL(response.headers.get('location')!, 'https://feedme.example');
const binding = (returnTo = reviewPath) => {
  jar.set('feedme_oauth', 'browser-secret');
  setKv(state.db!, 'login-binding', 'provider-state', { nonce: digest('browser-secret'), returnTo }, 600_000);
};
beforeEach(() => {
  state.db = openDatabase(':memory:'); jar = new Map(); vi.clearAllMocks();
  state.authorize.mockReset().mockResolvedValue(new URL('https://provider.example/authorize'));
  state.callback.mockReset().mockResolvedValue({ session: { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' }, state: 'provider-state' });
});
afterEach(() => state.db!.close());

describe('Bluesky sign-in return flow', () => {
  it('keeps the opaque review on invalid handles and provider failures, without exposing provider errors', async () => {
    const invalid = destination(await POST(context('/auth/login', { handle: 'not-a-handle', returnTo: reviewPath })));
    expect(invalid.pathname).toBe('/login'); expect(invalid.searchParams.get('returnTo')).toBe(reviewPath);
    expect(invalid.searchParams.get('error')).toContain('Bluesky'); expect(state.authorize).not.toHaveBeenCalled();
    state.authorize.mockRejectedValueOnce(new Error('secret-provider-token'));
    const failed = destination(await POST(context('/auth/login', { handle: '@name.bsky.social', returnTo: reviewPath })));
    expect(failed.searchParams.get('returnTo')).toBe(reviewPath); expect(failed.href).not.toContain('secret-provider-token');
    expect(state.authorize.mock.calls[0][0]).toBe('name.bsky.social');
    const saved = getKv<{ returnTo: string }>(state.db!, 'login-binding', state.authorize.mock.calls[0][1].state);
    expect(saved?.returnTo).toBe(reviewPath);
  });
  it.each(['https://evil.example', '//evil.example', `${reviewPath}&note=private`])('rejects unsafe return values: %s', async returnTo => {
    const failed = destination(await POST(context('/auth/login', { handle: 'invalid', returnTo })));
    expect(failed.searchParams.get('returnTo')).toBe('/');
    binding(returnTo);
    expect(destination(await GET(context('/auth/callback?state=provider-state&code=verified'))).pathname).toBe('/');
  });
  it('returns a canceled authorization to the same browser-bound review without creating a session', async () => {
    binding(); state.callback.mockRejectedValueOnce(new Error('access_denied: secret-provider-token'));
    const canceled = destination(await GET(context('/auth/callback?state=provider-state&error=access_denied')));
    expect(canceled.pathname).toBe('/login'); expect(canceled.searchParams.get('returnTo')).toBe(reviewPath);
    expect(canceled.href).not.toContain('secret-provider-token'); expect(state.createSession).not.toHaveBeenCalled();
  });
  it.each(['wrong-browser', 'unknown-state', 'expired'])('does not trust return paths or contact OAuth with %s', async failure => {
    binding();
    if (failure === 'wrong-browser') jar.set('feedme_oauth', 'someone-else');
    if (failure === 'expired') state.db!.prepare("UPDATE kv SET expires=1 WHERE namespace='login-binding'").run();
    const url = `/auth/callback?state=${failure === 'unknown-state' ? 'unknown' : 'provider-state'}&code=untrusted`;
    expect(destination(await GET(context(url))).searchParams.get('returnTo')).toBe('/');
    expect(state.callback).not.toHaveBeenCalled(); expect(state.createSession).not.toHaveBeenCalled();
  });
  it('rejects a provider state mismatch before creating a session', async () => {
    binding(); state.callback.mockResolvedValueOnce({ session: { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' }, state: 'different-state' });
    expect(destination(await GET(context('/auth/callback?state=provider-state&code=verified'))).pathname).toBe('/login');
    expect(state.createSession).not.toHaveBeenCalled();
  });
  it('consumes a valid browser binding and returns to review after successful authorization', async () => {
    binding(); const ctx = context('/auth/callback?state=provider-state&code=verified');
    expect((await GET(ctx)).headers.get('location')).toBe(reviewPath);
    expect(state.createSession).toHaveBeenCalledWith(ctx, 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb');
    expect(getKv(state.db!, 'login-binding', 'provider-state')).toBeUndefined(); expect(jar.has('feedme_oauth')).toBe(false);
  });
});
