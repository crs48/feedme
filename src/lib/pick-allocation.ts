const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
// Also used for public thousandths; ties do not depend on source order.
export const splitUnits = (units: number, weights: { projectId: string; count: number }[]) => {
  const total = weights.reduce((n, p) => n + p.count, 0);
  if (!Number.isSafeInteger(units) || units < 0 || !Number.isSafeInteger(total) || total <= 0 || weights.some(p => !Number.isSafeInteger(p.count) || p.count < 0 || !Number.isSafeInteger(units * p.count)) || new Set(weights.map(p => p.projectId)).size !== weights.length) throw new Error('Invalid allocation.');
  const parts = weights.map(p => ({ projectId: p.projectId, amount: Math.floor(units * p.count / total), remainder: units * p.count % total }));
  const extra = new Set([...parts].sort((a, b) => b.remainder - a.remainder || compareId(a.projectId, b.projectId)).slice(0, units - parts.reduce((n, p) => n + p.amount, 0)).map(p => p.projectId));
  return parts.map(p => ({ projectId: p.projectId, amount: p.amount + Number(extra.has(p.projectId)) }));
};
