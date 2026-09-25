import type { APIRoute } from 'astro';
import { config } from '../../lib/config';
import { currentUser, digest } from '../../lib/auth';
import { getDb, getKv, putRecord, setKv } from '../../lib/db';
import { project, support } from '../../lib/repository';
import { centsFromInput, type Support, type Visibility } from '../../lib/model';
import { errorMessage, formObject, redirectNotice } from '../../lib/http';
import { checkout } from '../../lib/payments';

export const POST: APIRoute = async (context) => {
  const form = await formObject(context.request);
  const id = String(form.projectId || '');
  const p = project(id);
  if (!p || p.status !== 'active') return redirectNotice('/', 'This project is not accepting support.', true);
  try {
    const requestId = String(form.requestId || '');
    const token = getKv<{ projectId: string; binding: string }>(getDb(), 'checkout-form', requestId);
    const browser = context.cookies.get('feedme_checkout')?.value;
    if (!token || token.projectId !== id || !browser || token.binding !== digest(browser)) throw new Error('This form expired. Please try again.');
    const amount = centsFromInput(form.amount);
    const visibility = String(form.visibility || 'anonymous') as Visibility;
    if (!['anonymous', 'private', 'public'].includes(visibility)) throw new Error('Choose a valid privacy setting.');
    const user = currentUser(context);
    if (visibility !== 'anonymous' && !user) throw new Error('Sign in to attach your AT Protocol identity.');
    const note = String(form.note || '').trim();
    if (note.length > 500) throw new Error('Keep your note to 500 characters.');
    const previous = support(requestId);
    if (previous && (previous.amount !== amount || previous.visibility !== visibility || previous.note !== note || previous.supporterDid !== (visibility !== 'anonymous' ? user?.did : undefined))) throw new Error('This checkout has already started with different details. Reload to start a new one.');
    const intent: Support = previous || {
      id: requestId, projectId: id, amount, currency: 'usd', visibility, note,
      ...(visibility !== 'anonymous' ? { supporterDid: user!.did } : {}),
      status: 'pending', refundedAmount: 0, disputed: false, createdAt: new Date().toISOString(),
    };
    if (config().demo) {
      putRecord(getDb(), 'support', intent.id, { ...intent, status: 'paid' });
      return context.redirect(`/thanks?id=${intent.id}`, 303);
    }
    const cachedUrl = getKv<string>(getDb(), 'checkout-url', requestId);
    const url = cachedUrl || await checkout(intent, p.title);
    setKv(getDb(), 'checkout-url', requestId, url, 23 * 3600_000);
    return context.redirect(url, 303);
  } catch (error) { return redirectNotice(`/support/${id}`, errorMessage(error), true); }
};
