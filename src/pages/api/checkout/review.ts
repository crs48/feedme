import type { APIRoute } from 'astro';
import { createPickReview, pickFormValues } from '../../../lib/pick-checkout';
import { redirectNotice, errorMessage } from '../../../lib/http';
export const POST: APIRoute = async context => {
  try {
    const values = pickFormValues(context, await context.request.formData());
    return context.redirect(`/checkout/review?token=${createPickReview(context, values)}`, 303);
  } catch (error) { return redirectNotice('/checkout', errorMessage(error), true); }
};
