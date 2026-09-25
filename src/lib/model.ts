import { z } from 'zod';

// Draft namespace: replace with a domain you control before a public protocol release.
export const NS = 'social.feedme';
export const didSchema = z.string().regex(/^did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.:%_-]+)$/);
export const httpsUrl = z.union([z.literal(''), z.url().refine((v) => new URL(v).protocol === 'https:', 'Use an HTTPS URL')]);
export const projectSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  title: z.string().trim().min(3).max(100),
  summary: z.string().trim().min(10).max(240),
  description: z.string().trim().min(10).max(5000),
  category: z.enum(['Making', 'Writing', 'Open source', 'Community', 'Life']),
  kind: z.enum(['project', 'ongoing']),
  status: z.enum(['active', 'complete', 'archived']),
  color: z.enum(['peach', 'blue', 'green', 'yellow']),
  target: z.number().int().min(0).max(100_000_000),
  image: httpsUrl.default(''),
  link: httpsUrl.default(''),
  createdAt: z.iso.datetime(),
});
export type Project = z.infer<typeof projectSchema>;
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  handle: z.string().max(253),
  bio: z.string().trim().min(3).max(500),
  location: z.string().max(80),
  website: httpsUrl,
});
export type Profile = z.infer<typeof profileSchema>;
export const updateSchema = z.object({
  id: z.uuid(), projectId: z.string().min(1),
  text: z.string().trim().min(3).max(2000), createdAt: z.iso.datetime(),
});
export type Update = z.infer<typeof updateSchema>;
export const friendSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(80),
  did: z.union([z.literal(''), didSchema]), url: httpsUrl.refine(Boolean, 'Enter a URL'),
  description: z.string().trim().min(3).max(180),
});
export type Friend = z.infer<typeof friendSchema>;
export type Visibility = 'anonymous' | 'private' | 'public';
export type Support = {
  id: string; projectId: string; amount: number; currency: 'usd';
  visibility: Visibility; supporterDid?: string; note: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'disputed';
  refundedAmount: number; disputed: boolean; createdAt: string;
  checkoutId?: string; paymentIntentId?: string; accountId?: string;
};

export const centsFromInput = (input: unknown): number => {
  if (typeof input !== 'string' || !/^\d{1,5}(\.\d{1,2})?$/.test(input.trim()))
    throw new Error('Enter a dollar amount with at most two decimal places.');
  const [whole, decimal = ''] = input.trim().split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (cents < 100 || cents > 100_000) throw new Error('Choose an amount between $1 and $1,000.');
  return cents;
};
export const money = (cents: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0,
}).format(cents / 100);
export const netSupport = (s: Support) => s.status === 'paid' && !s.disputed ? Math.max(0, s.amount - s.refundedAmount) : 0;

export const publicAcknowledgment = (support: Support, creatorDid: string) => {
  if (support.visibility !== 'public' || !support.supporterDid || netSupport(support) === 0) return null;
  return {
    $type: `${NS}.acknowledgment`, creator: creatorDid,
    project: `at://${creatorDid}/${NS}.project/${support.projectId}`,
    supporter: support.supporterDid, amount: netSupport(support), currency: 'USD', createdAt: support.createdAt,
  };
};
export const privateReceipt = (support: Support) => ({
  $type: `${NS}.support`, projectId: support.projectId,
  amount: support.amount, currency: 'USD', visibility: support.visibility,
  ...(support.visibility !== 'anonymous' && support.supporterDid ? { supporter: support.supporterDid } : {}),
  note: support.note, status: support.status, refundedAmount: support.refundedAmount,
  disputed: support.disputed, createdAt: support.createdAt,
  ...(support.paymentIntentId ? { paymentIntentId: support.paymentIntentId } : {}),
});
