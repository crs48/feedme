import { randomBytes } from 'node:crypto';
import { getDb, getKv, setKv, transaction } from './db';
import { profile, projects, support, supports } from './repository';
import { netSupport } from './model';
import { eligibleForSupportCard, publicSupportCard } from './support-card';

// Only the receipt owner invokes creation (thanks/social handlers). The opaque
// link is public; possession of a billing ID never grants access to a receipt.
export const ensureSupportShare = (supportId: string): string | undefined => transaction(getDb(), () => {
  if (!eligibleForSupportCard(support(supportId))) return;
  const existing = getKv<string>(getDb(), 'support-share-id', supportId);
  if (existing) return existing;
  const id = randomBytes(18).toString('base64url');
  setKv(getDb(), 'support-share-id', supportId, id);
  setKv(getDb(), 'support-share-payment', id, supportId);
  return id;
});

export const supportShare = (id: string | undefined) => {
  if (!id || !/^[A-Za-z0-9_-]{24}$/.test(id)) return;
  const paymentId = getKv<string>(getDb(), 'support-share-payment', id);
  if (!paymentId) return;
  const payment = support(paymentId);
  if (!eligibleForSupportCard(payment)) return;
  const publicAmounts = new Map<string, number>();
  for (const part of supports()) if (part.visibility === 'public')
    publicAmounts.set(part.projectId, (publicAmounts.get(part.projectId) || 0) + netSupport(part));
  return publicSupportCard(payment, profile(), projects(true), publicAmounts);
};
