import type { APIRoute } from 'astro';
import { createSession, digest, oauthClient } from '../../lib/auth';
import { deleteKv, getDb, getKv } from '../../lib/db';
import { redirectNotice } from '../../lib/http';
export const GET: APIRoute = async (context) => {
  try {
    const { session, state } = await (await oauthClient()).callback(context.url.searchParams);
    const binding = state ? getKv<{ nonce: string; returnTo: string }>(getDb(), 'login-binding', state) : undefined;
    const cookie = context.cookies.get('feedme_oauth')?.value;
    if (!binding || !cookie || binding.nonce !== digest(cookie)) throw new Error('Invalid browser binding.');
    deleteKv(getDb(), 'login-binding', state!);
    context.cookies.delete('feedme_oauth', { path: '/' });
    createSession(context, session.did);
    return context.redirect(binding.returnTo, 303);
  } catch { return redirectNotice('/login', 'Sign-in could not be verified. Please start again in this browser.', true); }
};
