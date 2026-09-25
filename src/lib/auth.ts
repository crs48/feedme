import { createHash, randomBytes } from 'node:crypto';
import { NodeOAuthClient, type NodeSavedSession, type NodeSavedState } from '@atproto/oauth-client-node';
import { JoseKey } from '@atproto/jwk-jose';
import { HabitatIdentityResolver } from '@habitat-network/habitat';
import type { APIContext } from 'astro';
import { config } from './config';
import { deleteKv, getDb, getKv, setKv } from './db';

export type User = { did: string };
export const digest = (input: string) => createHash('sha256').update(input).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
let clientPromise: Promise<NodeOAuthClient> | undefined;
const store = <T>(namespace: string, ttl?: number) => ({
  async get(key: string) { return getKv<T>(getDb(), namespace, key); },
  async set(key: string, value: T) { setKv(getDb(), namespace, key, value, ttl); },
  async del(key: string) { deleteKv(getDb(), namespace, key); },
});
export const oauthClient = () => clientPromise ??= (async () => {
  const { origin, habitatUrl } = config();
  if (!origin.startsWith('https://')) throw new Error('Use a public HTTPS URL to test real OAuth.');
  const db = getDb();
  const saved = getKv<Record<string, unknown>>(db, 'credentials', 'oauth-key');
  const key = saved ? await JoseKey.fromJWK(saved) : await JoseKey.generate(['ES256'], 'feedme-1');
  if (!saved) setKv(db, 'credentials', 'oauth-key', key.privateJwk);
  return new NodeOAuthClient({
    identityResolver: new HabitatIdentityResolver(habitatUrl),
    clientMetadata: {
      client_id: `${origin}/oauth-client-metadata.json`, client_name: 'Feedme', client_uri: origin,
      redirect_uris: [`${origin}/auth/callback`], grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], scope: 'atproto transition:generic', application_type: 'web',
      token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_signing_alg: 'ES256',
      dpop_bound_access_tokens: true, jwks_uri: `${origin}/jwks.json`,
    },
    keyset: [key], stateStore: store<NodeSavedState>('oauth-state', 10 * 60_000),
    sessionStore: store<NodeSavedSession>('oauth-session'),
  });
})();
export const cookieOptions = () => ({ path: '/', httpOnly: true, secure: config().origin.startsWith('https://'), sameSite: 'lax' as const });
export const createSession = (context: Pick<APIContext, 'cookies'>, did: string) => {
  const token = randomToken();
  setKv(getDb(), 'session', digest(token), { did }, 7 * 86400_000);
  context.cookies.set('feedme_session', token, { ...cookieOptions(), maxAge: 7 * 86400 });
};
export const currentUser = (context: Pick<APIContext, 'cookies'>): User | undefined => {
  const token = context.cookies.get('feedme_session')?.value;
  return token ? getKv<User>(getDb(), 'session', digest(token)) : undefined;
};
export const isOwner = (user?: User) => Boolean(user && user.did === config().ownerDid);
export const requireOwner = (context: Pick<APIContext, 'cookies'>) => {
  const user = currentUser(context);
  if (!isOwner(user)) throw new Error('Sign in as the instance owner to make changes.');
  return user!;
};
export const logout = (context: Pick<APIContext, 'cookies'>) => {
  const token = context.cookies.get('feedme_session')?.value;
  if (token) deleteKv(getDb(), 'session', digest(token));
  context.cookies.delete('feedme_session', { path: '/' });
};
