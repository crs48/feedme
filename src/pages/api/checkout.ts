import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { config } from '../../lib/config';
import { currentUser, digest } from '../../lib/auth';
import { getDb, getKv, putRecord, setKv } from '../../lib/db';
import { project, support } from '../../lib/repository';
import { centsFromInput, type Support, type Visibility } from '../../lib/model';
import { allocateAmount, percentagesFromForm } from '../../lib/allocation';
import { errorMessage, redirectNotice } from '../../lib/http';
import { checkout } from '../../lib/payments';
import { readPickReview, validatePickReview, oneField } from '../../lib/pick-checkout';
import { billingFrequency, billingInterval } from '../../lib/billing-frequency';
import type { Subscription } from '../../lib/recurring';

export const POST: APIRoute = async (context) => {
  const data = await context.request.formData();
  const form = Object.fromEntries(data);
  let returnTo = '/';
  try {
    const reviewId = oneField(data, 'reviewId');
    if (reviewId) returnTo = `/checkout/review?token=${encodeURIComponent(reviewId)}`;
    const review = reviewId ? readPickReview(context, reviewId) : undefined;
    const requestId = reviewId || String(form.requestId || '');
    const token = getKv<{ projectId?: string; projectIds?: string[]; allocationMode?: string; binding: string }>(getDb(), 'checkout-form', requestId);
    const browser = context.cookies.get('feedme_checkout')?.value;
    if (!review && (!token || !browser || token.binding !== digest(browser))) throw new Error('This form expired. Please try again.');
    if (token?.projectIds && token.allocationMode !== 'percentages') throw new Error('The allocation form changed. Reload to choose project percentages.');
    if (token?.projectId) returnTo = `/support/${token.projectId}`;
    const amount = review?.amount ?? centsFromInput(form.amount);
    const frequency = review?.frequency ?? billingFrequency(form.frequency);
    const parts = review ? validatePickReview(context, review) : token?.projectIds ? allocateAmount(amount, percentagesFromForm(form, token.projectIds))
      : token?.projectId && token.projectId === form.projectId ? [{ projectId: token.projectId, amount }] : undefined;
    if (!parts) throw new Error('This form expired. Please try again.');
    if (!review && billingInterval(frequency) && parts.length > 20) throw new Error('Recurring support can include up to 20 projects.');
    const items = review ? [{ title: `A tip for ${review.creatorName}`, amount }] : parts.map((part) => {
      const p = project(part.projectId);
      if (!p || p.libcard || p.status !== 'active') throw new Error('A selected project is no longer accepting support. Reload to update your split.');
      return { title: p.title, amount: part.amount };
    });
    const visibility = (review?.visibility ?? String(form.visibility || 'anonymous')) as Visibility;
    if (!['anonymous', 'private', 'public'].includes(visibility)) throw new Error('Choose a valid privacy setting.');
    const user = currentUser(context);
    if (visibility !== 'anonymous' && !user) throw new Error('Sign in to attach your AT Protocol identity.');
    const note = review?.note ?? String(form.note || '').trim();
    const announceAnonymously = review?.announceAnonymously ?? (visibility === 'anonymous' && form.announceAnonymously === 'yes');
    if (note.length > 500) throw new Error('Keep your note to 500 characters.');
    const previous = support(requestId);
    const previousParts = previous?.allocations?.map(({ projectId, amount }) => ({ projectId, amount }));
    if (previous && ((previous.frequency || 'once') !== frequency || previous.amount !== amount || previous.visibility !== visibility || previous.note !== note || Boolean(previous.announceAnonymously) !== announceAnonymously || previous.supporterDid !== (visibility !== 'anonymous' ? user?.did : undefined) ||
      (review || token?.projectIds ? JSON.stringify(previousParts) !== JSON.stringify(parts) : previous.projectId !== token?.projectId) || JSON.stringify(previous.picks) !== JSON.stringify(review?.picks)))
      throw new Error('This checkout has already started with different details. Reload to start a new one.');
    const intent: Support = previous || {
      id: requestId, projectId: parts[0].projectId, amount, frequency, currency: 'usd', visibility, note,
      ...(review || token?.projectIds ? { allocations: parts.map((part) => ({ ...part, activityId: randomUUID() })) } : {}),
      ...(visibility !== 'anonymous' ? { supporterDid: user!.did } : {}),
      ...(review ? { picks: review.picks } : {}),
      status: 'pending', refundedAmount: 0, disputed: false, createdAt: new Date().toISOString(),
      announceAnonymously, activityId: randomUUID(),
    };
    // Bind and freeze the request before any asynchronous provider call.
    setKv(getDb(), 'checkout-owner', intent.id, digest(browser!), (frequency === 'once' ? 7 : 365) * 86400_000);
    if (!previous) putRecord(getDb(), 'support', intent.id, intent);
    if (config().demo) {
      if (intent.status === 'pending') {
        putRecord(getDb(), 'support', intent.id, { ...intent, status: 'paid' });
        if (frequency !== 'once') putRecord(getDb(), 'subscription', intent.id, {
          id: intent.id, accountId: 'demo', subscriptionId: `demo_${intent.id}`, customerId: `demo_${intent.id}`,
          status: 'active', cancelAtPeriodEnd: false, eventCreated: 0,
        } satisfies Subscription);
      }
      return context.redirect(`/thanks?id=${intent.id}`, 303);
    }
    const cachedUrl = getKv<string>(getDb(), 'checkout-url', requestId);
    const url = cachedUrl || await checkout(intent, items);
    setKv(getDb(), 'checkout-url', requestId, url, 23 * 3600_000);
    return context.redirect(url, 303);
  } catch (error) { return redirectNotice(returnTo, errorMessage(error), true); }
};
