import type { APIRoute } from 'astro';
import { createSession, digest, oauthClient, isAdmin } from '../../lib/auth';
import { deleteKv, getDb, getKv } from '../../lib/db';
import { loginPath, redirectNotice, safeReturnPath } from '../../lib/http';
import { reportAuthError } from '../../lib/auth-errors';
export const GET: APIRoute = async (context) => {
  let returnTo = '/';
  try {
    const requestedState = context.url.searchParams.get('state');
    const binding = requestedState ? getKv<{ nonce: string; returnTo: string }>(getDb(), 'login-binding', requestedState) : undefined;
    const cookie = context.cookies.get('feedme_oauth')?.value;
    if (!binding || !cookie || binding.nonce !== digest(cookie)) throw new Error('Invalid browser binding.');
    returnTo = safeReturnPath(binding.returnTo);
    const { session, state } = await (await oauthClient()).callback(context.url.searchParams);
    if (state !== requestedState) throw new Error('Invalid OAuth state.');
    deleteKv(getDb(), 'login-binding', state!);
    context.cookies.delete('feedme_oauth', { path: '/' });
    createSession(context, session.did);
    return context.redirect(returnTo === '/' && isAdmin({ did: session.did }) ? '/studio' : returnTo, 303);
  } catch (error) {
    reportAuthError('callback', error);
    return redirectNotice(loginPath(returnTo), 'Bluesky sign-in was not completed. Try again in this browser, or return to your gift to tip anonymously.', true);
  }
};
