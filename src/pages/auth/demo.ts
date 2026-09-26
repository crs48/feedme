import type { APIRoute } from 'astro';
import { createSession } from '../../lib/auth';
import { config } from '../../lib/config';
import { formObject, safeReturnPath } from '../../lib/http';
export const POST: APIRoute = async (context) => {
  if (!config().demo) return new Response('Not found', { status: 404 });
  const form = await formObject(context.request);
  const supporter = form.role === 'supporter';
  createSession(context, supporter ? 'did:plc:cccccccccccccccccccccccc' : config().ownerDid);
  return context.redirect(supporter ? safeReturnPath(form.returnTo) : '/studio', 303);
};
