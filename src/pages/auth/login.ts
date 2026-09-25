import type { APIRoute } from 'astro';
import { cookieOptions, oauthClient, randomToken, digest } from '../../lib/auth';
import { getDb, setKv } from '../../lib/db';
import { formObject, redirectNotice, safeReturnPath } from '../../lib/http';
export const POST: APIRoute = async (context) => {
  const form = await formObject(context.request);
  const handle = String(form.handle || '').trim().replace(/^@/, '');
  if (!/^(did:(plc|web):[a-zA-Z0-9.:%_-]+|[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)$/.test(handle)) return redirectNotice('/login', 'Enter your full AT Protocol handle or DID.', true);
  try {
    const nonce = randomToken();
    const state = randomToken();
    setKv(getDb(), 'login-binding', state, { nonce: digest(nonce), returnTo: safeReturnPath(form.returnTo) }, 10 * 60_000);
    context.cookies.set('feedme_oauth', nonce, { ...cookieOptions(), maxAge: 600 });
    const url = await (await oauthClient()).authorize(handle, { state, scope: 'atproto transition:generic' });
    return context.redirect(url.toString(), 303);
  } catch {
    return redirectNotice('/login', 'Could not start sign-in. Check your handle, PUBLIC_URL, and Habitat connection.', true);
  }
};
