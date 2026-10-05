import { didSchema, netSupport, type Project, type Support } from './model';
import { picksSchema, splitUnits } from './picks';

export const publicLibcard = (creatorName: string, origin: string, defaultAmountCents: number, targets: Project[], payments: Support[]) => {
  const weights = new Map(targets.map(p => [p.id, 0]));
  const counts = new Map(targets.map(p => [p.id, 0]));
  const seen = new Set<string>();
  for (const payment of payments) {
    if (seen.has(payment.id) || payment.visibility !== 'public' || !didSchema.safeParse(payment.supporterDid).success || netSupport(payment) <= 0) continue;
    const parsed = picksSchema.safeParse(payment.picks); if (!parsed.success) continue;
    seen.add(payment.id);
    for (const pick of parsed.data) if (weights.has(pick.projectId)) {
      weights.set(pick.projectId, weights.get(pick.projectId)! + pick.count);
      counts.set(pick.projectId, counts.get(pick.projectId)! + 1);
    }
  }
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  const shares = new Map(total ? splitUnits(1000, [...weights].map(([projectId, count]) => ({ projectId, count }))).map(p => [p.projectId, p.amount]) : []);
  // A public allowlist. Never serialize a Project, Support, or cached source document.
  return { creatorName, origin, defaultAmountCents, targets: targets.map(p => ({
    id: p.id, label: p.title, url: p.libcard!.url, kind: p.libcard!.kind,
    publicCount: counts.get(p.id) || 0, publicShareMillis: shares.get(p.id) || 0,
  })) };
};
