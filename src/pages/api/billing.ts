import type { APIRoute } from 'astro';
import { currentUser } from '../../lib/auth';
import { config } from '../../lib/config';
import { getDb, putRecord, readRecord } from '../../lib/db';
import { ensureBillingPortal } from '../../lib/billing';
import { connectedAccount, stripeClient } from '../../lib/payments';
import { canAccessTip } from '../../lib/tip-sharing';
import { support } from '../../lib/repository';
import type { Subscription } from '../../lib/recurring';
import { errorMessage, formObject, redirectNotice } from '../../lib/http';

export const POST: APIRoute = async (context) => {
  try {
    const form = await formObject(context.request);
    const root = support(String(form.supportId || ''));
    if (!root || root.recurringRootId || !canAccessTip(root, currentUser(context), context.cookies.get('feedme_checkout')?.value))
      throw new Error('Use the browser you tipped from or sign in with the identity attached to your tip.');
    const subscription = readRecord<Subscription>(getDb(), 'subscription', root.id);
    if (!subscription) throw new Error('Recurring support is still being confirmed. Please check again shortly.');
    if (config().demo) {
      if (form.action !== 'cancel') throw new Error('Choose a valid demo action.');
      putRecord(getDb(), 'subscription', root.id, { ...subscription, status: 'canceled', cancelAtPeriodEnd: false });
      return redirectNotice('/billing', 'Demo recurring support stopped. Your earlier demo tip is still saved.');
    }
    const account = connectedAccount();
    if (!account || subscription.accountId !== account) throw new Error('This subscription belongs to another Stripe account.');
    const stripe = stripeClient();
    const portal = await ensureBillingPortal(stripe, account);
    const session = await stripe.billingPortal.sessions.create({ customer: subscription.customerId, configuration: portal.id,
      return_url: `${config().origin}/billing`,
    }, { stripeAccount: account });
    return context.redirect(session.url, 303);
  } catch (error) { return redirectNotice('/billing', errorMessage(error), true); }
};
