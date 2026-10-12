import type { APIRoute } from 'astro';
import { changePickReviewVisibility, createPickReview, oneField, pickFormValues } from '../../../lib/pick-checkout';
import { currentUser } from '../../../lib/auth';
import { redirectNotice, errorMessage, loginPath } from '../../../lib/http';
export const POST: APIRoute = async context => {
  try {
    const form = await context.request.formData();
    const intent = oneField(form, 'intent');
    if (intent === 'anonymous' || intent === 'attach-profile') {
      const id = changePickReviewVisibility(context, oneField(form, 'editReview'), intent === 'anonymous' ? 'anonymous' : 'private');
      const reviewPath = `/checkout/review?token=${id}`;
      return context.redirect(intent === 'attach-profile' && !currentUser(context) ? loginPath(reviewPath) : reviewPath, 303);
    }
    const values = pickFormValues(context, form);
    return context.redirect(`/checkout/review?token=${createPickReview(context, values)}`, 303);
  } catch (error) { return redirectNotice('/checkout', errorMessage(error), true); }
};
