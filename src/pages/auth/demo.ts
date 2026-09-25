import type { APIRoute } from 'astro';
import { createSession } from '../../lib/auth';
import { config } from '../../lib/config';
export const POST: APIRoute = (context) => {
  if (!config().demo) return new Response('Not found', { status: 404 });
  createSession(context, config().ownerDid);
  return context.redirect('/studio', 303);
};
