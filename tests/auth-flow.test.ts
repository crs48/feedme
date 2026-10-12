import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import type { DatabaseSync } from 'node:sqlite';
import { NodeOAuthClient, type NodeSavedState } from '@atproto/oauth-client-node';

const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined, authorize: vi.fn(), callback: vi.fn(), createSession: vi.fn() }));
vi.mock('../src/lib/config', () => ({ config: () => ({ origin: 'https://feedme.example', adminDids: [] }) }));
vi.mock('../src/lib/db', async original => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => state.db! }));
vi.mock('../src/lib/auth', async original => ({ ...await original<typeof import('../src/lib/auth')>(),
  oauthClient: async () => ({ authorize: state.authorize, callback: state.callback }), createSession: state.createSession,
}));
vi.mock('../src/lib/auth-errors', () => ({ reportAuthError: vi.fn() }));
import { digest } from '../src/lib/auth';
import { deleteKv, getKv, openDatabase, setKv } from '../src/lib/db';
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
  setKv(state.db!, 'oauth-state', 'provider-state', { appState: 'application-state' }, 600_000);
  setKv(state.db!, 'login-binding', 'application-state', { nonce: digest('browser-secret'), returnTo }, 600_000);
};
beforeEach(() => {
  state.db = openDatabase(':memory:'); jar = new Map(); vi.clearAllMocks();
  state.authorize.mockReset().mockResolvedValue(new URL('https://provider.example/authorize'));
  state.callback.mockReset().mockResolvedValue({ session: { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' }, state: 'application-state' });
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
  it.each(['wrong-browser', 'unknown-state', 'expired', 'expired-sdk-state', 'app-state-in-query'])('does not trust return paths or contact OAuth with %s', async failure => {
    binding();
    if (failure === 'wrong-browser') jar.set('feedme_oauth', 'someone-else');
    if (failure === 'expired') state.db!.prepare("UPDATE kv SET expires=1 WHERE namespace='login-binding'").run();
    if (failure === 'expired-sdk-state') state.db!.prepare("UPDATE kv SET expires=1 WHERE namespace='oauth-state'").run();
    const url = `/auth/callback?state=${failure === 'unknown-state' ? 'unknown' : failure === 'app-state-in-query' ? 'application-state' : 'provider-state'}&code=untrusted`;
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
    expect(getKv(state.db!, 'login-binding', 'application-state')).toBeUndefined(); expect(jar.has('feedme_oauth')).toBe(false);
    expect(destination(await GET(context('/auth/callback?state=provider-state&code=verified'))).pathname).toBe('/login');
    expect(state.callback).toHaveBeenCalledTimes(1);
  });
  it('accepts the provider state generated by the real SDK, which differs from Feedme app state', async () => {
    const client = new NodeOAuthClient({
      clientMetadata: { client_id: 'https://feedme.example/oauth-client-metadata.json', redirect_uris: ['https://feedme.example/auth/callback'],
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: 'atproto',
        application_type: 'web', token_endpoint_auth_method: 'none', dpop_bound_access_tokens: true },
      stateStore: {
        async set(key, value) { setKv(state.db!, 'oauth-state', key, value, 600_000); },
        async get(key) { return getKv<NodeSavedState>(state.db!, 'oauth-state', key); },
        async del(key) { deleteKv(state.db!, 'oauth-state', key); },
      },
      sessionStore: { async set() {}, async get() { return undefined; }, async del() {} },
    });
    // Stub discovery only: the SDK generates and stores the real state and DPoP key.
    vi.spyOn(client.oauthResolver, 'resolve').mockResolvedValue({ metadata: {
      issuer: 'https://provider.example', authorization_endpoint: 'https://provider.example/authorize',
      token_endpoint: 'https://provider.example/token', response_types_supported: ['code'],
      token_endpoint_auth_methods_supported: ['none'],
    } } as Awaited<ReturnType<typeof client.oauthResolver.resolve>>);
    state.authorize.mockImplementation((handle, options) => client.authorize(handle, options));
    const login = await POST(context('/auth/login', { handle: 'name.tngl.sh', returnTo: reviewPath }));
    const providerState = destination(login).searchParams.get('state')!;
    const stored = getKv<NodeSavedState>(state.db!, 'oauth-state', providerState)!;
    expect(stored.appState).toBe(state.authorize.mock.calls[0][1].state);
    expect(providerState).not.toBe(stored.appState);
    state.callback.mockResolvedValueOnce({ session: { did: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' }, state: stored.appState });
    const callback = context(`/auth/callback?state=${providerState}&code=verified`);
    expect((await GET(callback)).headers.get('location')).toBe(reviewPath);
    expect(state.callback).toHaveBeenCalledWith(callback.url.searchParams);
    expect(state.createSession).toHaveBeenCalledOnce();
    expect(getKv(state.db!, 'login-binding', stored.appState!)).toBeUndefined();
  });
});
