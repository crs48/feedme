import type { User } from './auth';
import { digest } from './auth';
import { getDb, getKv } from './db';
import { netSupport, type Support } from './model';

// A payment ID in a URL is never sufficient authority to publish on its behalf.
export const canAccessTip = (support: Support | undefined, user: User | undefined, browser: string | undefined) => {
  if (!support) return false;
  if (user && support.visibility !== 'anonymous' && support.supporterDid === user.did) return true;
  const binding = getKv<string>(getDb(), 'checkout-owner', support.id);
  return Boolean(binding && browser && binding === digest(browser));
};
export const canShareTip = (support: Support | undefined, user: User | undefined, browser: string | undefined) =>
  Boolean(user && support && netSupport(support) > 0 && canAccessTip(support, user, browser));
