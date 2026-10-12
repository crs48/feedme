import type { APIRoute } from 'astro';
import { anonymousPickReview, createPickReview, oneField, pickFormValues } from '../../../lib/pick-checkout';
import { redirectNotice, errorMessage } from '../../../lib/http';
export const POST: APIRoute = async context => {
  try {
    const form = await context.request.formData();
    if (oneField(form, 'intent') === 'anonymous') return context.redirect(`/checkout/review?token=${anonymousPickReview(context, oneField(form, 'editReview'))}`, 303);
    const values = pickFormValues(context, form);
    return context.redirect(`/checkout/review?token=${createPickReview(context, values)}`, 303);
  } catch (error) { return redirectNotice('/checkout', errorMessage(error), true); }
};
