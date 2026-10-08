import { z } from 'zod';

// Dependency-free contract shared by payment routing and private recovery.
export const stripeBindingSchema = z.object({
  accountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  mode: z.enum(['connect', 'own-account']),
  livemode: z.boolean(),
});
export type StripeBinding = z.infer<typeof stripeBindingSchema>;
