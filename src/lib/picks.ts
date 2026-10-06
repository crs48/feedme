import { z } from 'zod';
import { targetId } from './libcard-schema';
import { centsFromInput } from './model';
export const picksSchema = z.array(z.object({ projectId: targetId, count: z.number().int().min(1).max(9) })).min(1).max(100)
  .refine(picks => new Set(picks.map(p => p.projectId)).size === picks.length, 'Pick each target only once.');
export type Pick = z.infer<typeof picksSchema>[number];
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
// Also used for public thousandths; ties do not depend on source order.
export const splitUnits = (units: number, weights: { projectId: string; count: number }[]) => {
  const total = weights.reduce((n, p) => n + p.count, 0);
  if (!Number.isSafeInteger(units) || units < 0 || !Number.isSafeInteger(total) || total <= 0 || weights.some(p => !Number.isSafeInteger(p.count) || p.count < 0 || !Number.isSafeInteger(units * p.count)) || new Set(weights.map(p => p.projectId)).size !== weights.length) throw new Error('Invalid allocation.');
  const parts = weights.map(p => ({ projectId: p.projectId, amount: Math.floor(units * p.count / total), remainder: units * p.count % total }));
  const extra = new Set([...parts].sort((a, b) => b.remainder - a.remainder || compareId(a.projectId, b.projectId)).slice(0, units - parts.reduce((n, p) => n + p.amount, 0)).map(p => p.projectId));
  return parts.map(p => ({ projectId: p.projectId, amount: p.amount + Number(extra.has(p.projectId)) }));
};
export const allocatePicks = (amount: number, value: unknown) => {
  if (!Number.isInteger(amount) || amount < 100 || amount > 100_000) throw new Error('Choose an amount between $1 and $1,000.');
  return splitUnits(amount, picksSchema.parse(value).toSorted((a, b) => compareId(a.projectId, b.projectId)));
};
export const picksFromForm = (form: FormData, ids: string[]): Pick[] => {
  for (const [key] of form) if (key.startsWith('pick:') && !ids.includes(key.slice(5))) throw new Error('The target list changed. Review your picks.');
  return ids.flatMap(projectId => {
    const values = form.getAll(`pick:${projectId}`);
    if (values.length !== 1 || typeof values[0] !== 'string' || !/^[0-9]$/.test(values[0])) throw new Error('Enter one whole pick count from 0 to 9 for each target.');
    return Number(values[0]) ? [{ projectId, count: Number(values[0]) }] : [];
  });
};
export const prefillPicks = (params: URLSearchParams, ids: string[], defaultAmount: number) => {
  let amount = defaultAmount;
  if (params.getAll('amount').length === 1) { try { amount = centsFromInput(params.get('amount')); } catch { /* A URL is a suggestion, not a payment intent. */ } }
  let removed = false;
  const picks: Pick[] = [];
  for (const id of new Set(params.keys())) {
    if (id === 'amount') continue;
    const values = params.getAll(id);
    if (!ids.includes(id) || values.length !== 1 || !/^[0-9]$/.test(values[0])) { removed = true; continue; }
    if (Number(values[0])) picks.push({ projectId: id, count: Number(values[0]) });
  }
  return { amount, picks, removed };
};
