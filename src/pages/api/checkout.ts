import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { config } from '../../lib/config';
import { currentUser, digest } from '../../lib/auth';
import { getDb, getKv, putRecord, setKv } from '../../lib/db';
import { project, support } from '../../lib/repository';
import { centsFromInput, type Support, type Visibility } from '../../lib/model';
import { allocateAmount, weightsFromForm } from '../../lib/allocation';
import { errorMessage, formObject, redirectNotice } from '../../lib/http';
import { checkout } from '../../lib/payments';

export const POST: APIRoute = async (context) => {
  const form = await formObject(context.request);
  let returnTo = '/';
  try {
    const requestId = String(form.requestId || '');
    const token = getKv<{ projectId?: string; projectIds?: string[]; binding: string }>(getDb(), 'checkout-form', requestId);
    const browser = context.cookies.get('feedme_checkout')?.value;
    if (!token || !browser || token.binding !== digest(browser)) throw new Error('This form expired. Please try again.');
    if (token.projectId) returnTo = `/support/${token.projectId}`;
    const amount = centsFromInput(form.amount);
    const parts = token.projectIds ? allocateAmount(amount, weightsFromForm(form, token.projectIds))
      : token.projectId && token.projectId === form.projectId ? [{ projectId: token.projectId, amount }] : undefined;
    if (!parts) throw new Error('This form expired. Please try again.');
    const items = parts.map((part) => {
      const p = project(part.projectId);
      if (!p || p.status !== 'active') throw new Error('A selected project is no longer accepting support. Reload to update your split.');
      return { title: p.title, amount: part.amount };
    });
    const visibility = String(form.visibility || 'anonymous') as Visibility;
    if (!['anonymous', 'private', 'public'].includes(visibility)) throw new Error('Choose a valid privacy setting.');
    const user = currentUser(context);
    if (visibility !== 'anonymous' && !user) throw new Error('Sign in to attach your AT Protocol identity.');
    const note = String(form.note || '').trim();
    const announceAnonymously = visibility === 'anonymous' && form.announceAnonymously === 'yes';
    if (note.length > 500) throw new Error('Keep your note to 500 characters.');
    const previous = support(requestId);
    const previousParts = previous?.allocations?.map(({ projectId, amount }) => ({ projectId, amount }));
    if (previous && (previous.amount !== amount || previous.visibility !== visibility || previous.note !== note || Boolean(previous.announceAnonymously) !== announceAnonymously || previous.supporterDid !== (visibility !== 'anonymous' ? user?.did : undefined) ||
      (token.projectIds ? JSON.stringify(previousParts) !== JSON.stringify(parts) : previous.projectId !== token.projectId)))
      throw new Error('This checkout has already started with different details. Reload to start a new one.');
    const intent: Support = previous || {
      id: requestId, projectId: parts[0].projectId, amount, currency: 'usd', visibility, note,
      ...(token.projectIds ? { allocations: parts.map((part) => ({ ...part, activityId: randomUUID() })) } : {}),
      ...(visibility !== 'anonymous' ? { supporterDid: user!.did } : {}),
      status: 'pending', refundedAmount: 0, disputed: false, createdAt: new Date().toISOString(),
      announceAnonymously, activityId: randomUUID(),
    };
    // Bind and freeze the request before any asynchronous provider call.
    setKv(getDb(), 'checkout-owner', intent.id, digest(browser), 7 * 86400_000);
    if (!previous) putRecord(getDb(), 'support', intent.id, intent);
    if (config().demo) {
      if (intent.status === 'pending') putRecord(getDb(), 'support', intent.id, { ...intent, status: 'paid' });
      return context.redirect(`/thanks?id=${intent.id}`, 303);
    }
    const cachedUrl = getKv<string>(getDb(), 'checkout-url', requestId);
    const url = cachedUrl || await checkout(intent, items);
    setKv(getDb(), 'checkout-url', requestId, url, 23 * 3600_000);
    return context.redirect(url, 303);
  } catch (error) { return redirectNotice(returnTo, errorMessage(error), true); }
};
