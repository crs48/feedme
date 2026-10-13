import type { APIRoute } from 'astro';
import type { NodeSavedState } from '@atproto/oauth-client-node';
import { createSession, digest, oauthClient, isAdmin } from '../../lib/auth';
import { deleteKv, getDb, getKv } from '../../lib/db';
import { loginPath, redirectNotice, safeReturnPath, signInRecovery } from '../../lib/http';
import { reportAuthError } from '../../lib/auth-errors';
export const GET: APIRoute = async (context) => {
  let returnTo = '/';
  try {
    const requestedState = context.url.searchParams.get('state');
    // The SDK sends its own state to the provider and preserves ours as appState.
    // Check the browser before exchanging the code or consuming the SDK state.
    const appState = requestedState ? getKv<NodeSavedState>(getDb(), 'oauth-state', requestedState)?.appState : undefined;
    const binding = appState ? getKv<{ nonce: string; returnTo: string }>(getDb(), 'login-binding', appState) : undefined;
    const cookie = context.cookies.get('feedme_oauth')?.value;
    if (!binding || !cookie || binding.nonce !== digest(cookie)) throw new Error('Invalid browser binding.');
    returnTo = safeReturnPath(binding.returnTo);
    const { session, state } = await (await oauthClient()).callback(context.url.searchParams);
    if (state !== appState) throw new Error('Invalid OAuth state.');
    deleteKv(getDb(), 'login-binding', state!);
    context.cookies.delete('feedme_oauth', { path: '/' });
    createSession(context, session.did);
    return context.redirect(returnTo === '/' && isAdmin({ did: session.did }) ? '/studio' : returnTo, 303);
  } catch (error) {
    reportAuthError('callback', error);
    return redirectNotice(loginPath(returnTo), `Bluesky sign-in was not completed. ${signInRecovery(returnTo)}`, true);
  }
};
