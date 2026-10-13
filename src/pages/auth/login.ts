import type { APIRoute } from 'astro';
import { cookieOptions, oauthClient, randomToken, digest } from '../../lib/auth';
import { getDb, setKv } from '../../lib/db';
import { formObject, loginPath, redirectNotice, safeReturnPath, signInRecovery } from '../../lib/http';
import { reportAuthError } from '../../lib/auth-errors';
export const POST: APIRoute = async (context) => {
  const form = await formObject(context.request);
  const handle = String(form.handle || '').trim().replace(/^@/, '');
  const returnTo = safeReturnPath(form.returnTo);
  if (!/^(did:(plc|web):[a-zA-Z0-9.:%_-]+|[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)$/.test(handle)) return redirectNotice(loginPath(returnTo), 'Enter your full Bluesky handle, such as yourname.bsky.social. Other AT Protocol handles or DIDs work too.', true);
  try {
    const nonce = randomToken();
    const state = randomToken();
    setKv(getDb(), 'login-binding', state, { nonce: digest(nonce), returnTo }, 10 * 60_000);
    context.cookies.set('feedme_oauth', nonce, { ...cookieOptions(), maxAge: 600 });
    const url = await (await oauthClient()).authorize(handle, { state, scope: 'atproto transition:generic' });
    return context.redirect(url.toString(), 303);
  } catch (error) {
    reportAuthError('authorize', error);
    return redirectNotice(loginPath(returnTo), `Could not connect to your account provider. Check your full handle and try again. ${signInRecovery(returnTo)}`, true);
  }
};
