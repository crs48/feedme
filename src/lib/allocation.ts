export type Allocation = { projectId: string; amount: number };
export type ProjectPercentage = { projectId: string; percentage: number };

const validatePercentages = (percentages: ProjectPercentage[]) => {
  if (new Set(percentages.map(({ projectId }) => projectId)).size !== percentages.length ||
    percentages.some(({ percentage }) => !Number.isInteger(percentage) || percentage < 0 || percentage > 100))
    throw new Error('Choose a whole percentage from 0% to 100% for each project.');
};

// Each position is an absolute percentage of the entered total, including partial selections.
// Round the allocated subtotal once, then distribute its leftover cents deterministically.
export const previewAllocation = (amount: number, percentages: ProjectPercentage[]) => {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000) throw new Error('Choose a total between $1 and $1,000.');
  validatePercentages(percentages);
  const allocatedPercentage = percentages.reduce((sum, { percentage }) => sum + percentage, 0);
  if (allocatedPercentage > 100) throw new Error('Project percentages cannot add up to more than 100%.');
  const selected = percentages.filter(({ percentage }) => percentage > 0);
  const allocatedAmount = Math.round(amount * allocatedPercentage / 100);
  const parts = selected.map(({ projectId, percentage }, index) => ({ projectId, index,
    amount: Math.floor(amount * percentage / 100), remainder: amount * percentage % 100,
  }));
  const remainingCents = allocatedAmount - parts.reduce((sum, part) => sum + part.amount, 0);
  const extra = new Set([...parts].sort((a, b) => b.remainder - a.remainder || a.index - b.index).slice(0, remainingCents).map(({ index }) => index));
  return {
    allocatedPercentage,
    unallocatedAmount: amount - allocatedAmount,
    allocations: parts.map(({ projectId, amount, index }) => ({ projectId, amount: amount + Number(extra.has(index)) })).filter(({ amount }) => amount > 0),
  };
};

export const allocateAmount = (amount: number, percentages: ProjectPercentage[]): Allocation[] => {
  const preview = previewAllocation(amount, percentages);
  if (preview.allocatedPercentage !== 100) throw new Error(`Allocate 100% of your tip before continuing (${100 - preview.allocatedPercentage}% left).`);
  return preview.allocations;
};

// Keep other choices fixed and stop the changed slider at the remaining capacity.
// The native range keeps max=100 so every track uses the same percentage scale.
export const changePercentage = (percentages: ProjectPercentage[], projectId: string, requested: number): ProjectPercentage[] => {
  validatePercentages(percentages);
  if (!Number.isInteger(requested) || requested < 0 || requested > 100 || !percentages.some((part) => part.projectId === projectId))
    throw new Error('Choose a valid project percentage.');
  const otherTotal = percentages.filter((part) => part.projectId !== projectId).reduce((sum, part) => sum + part.percentage, 0);
  if (otherTotal > 100) throw new Error('Project percentages cannot add up to more than 100%.');
  return percentages.map((part) => part.projectId === projectId ? { ...part, percentage: Math.min(requested, 100 - otherTotal) } : part);
};

export const evenPercentages = (projectIds: string[], limit = 100): ProjectPercentage[] => {
  const count = Math.min(projectIds.length, limit, 100);
  return projectIds.map((projectId, index) => ({ projectId,
    percentage: index < count ? Math.floor(100 / count) + Number(index < 100 % count) : 0,
  }));
};

export const percentagesFromForm = (form: Record<string, unknown>, projectIds: string[]): ProjectPercentage[] => {
  const allowed = new Set(projectIds.map((id) => `percentage:${id}`));
  if (Object.keys(form).some((key) => key.startsWith('percentage:') && !allowed.has(key))) throw new Error('The project list changed. Reload before supporting.');
  return projectIds.map((projectId) => {
    const value = form[`percentage:${projectId}`];
    if (typeof value !== 'string' || !/^(?:100|[1-9]?\d)$/.test(value)) throw new Error('Choose a whole percentage from 0% to 100% for each project.');
    return { projectId, percentage: Number(value) };
  });
};
