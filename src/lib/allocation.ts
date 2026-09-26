export type Allocation = { projectId: string; amount: number };
export type ProjectWeight = { projectId: string; weight: number };

// Shared by the browser preview and the server. Largest remainders assign every cent.
export const allocateAmount = (amount: number, weights: ProjectWeight[]): Allocation[] => {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000) throw new Error('Choose a total between $1 and $1,000.');
  if (new Set(weights.map(({ projectId }) => projectId)).size !== weights.length ||
    weights.some(({ weight }) => !Number.isInteger(weight) || weight < 0 || weight > 100)) throw new Error('Choose a valid slider value for each project.');
  const selected = weights.filter(({ weight }) => weight > 0);
  if (!selected.length) throw new Error('Move at least one project slider above zero.');
  if (selected.length > 100) throw new Error('Choose up to 100 projects in one checkout.');
  const totalWeight = selected.reduce((sum, { weight }) => sum + weight, 0);
  const parts = selected.map(({ projectId, weight }, index) => ({ projectId, index,
    amount: Math.floor(amount * weight / totalWeight), remainder: amount * weight % totalWeight,
  }));
  const remaining = amount - parts.reduce((sum, part) => sum + part.amount, 0);
  const extra = new Set([...parts].sort((a, b) => b.remainder - a.remainder || a.index - b.index).slice(0, remaining).map(({ index }) => index));
  return parts.map(({ projectId, amount, index }) => ({ projectId, amount: amount + Number(extra.has(index)) })).filter(({ amount }) => amount > 0);
};

export const weightsFromForm = (form: Record<string, unknown>, projectIds: string[]): ProjectWeight[] => {
  const allowed = new Set(projectIds.map((id) => `weight:${id}`));
  if (Object.keys(form).some((key) => key.startsWith('weight:') && !allowed.has(key))) throw new Error('The project list changed. Reload before supporting.');
  return projectIds.map((projectId) => {
    const value = form[`weight:${projectId}`];
    if (typeof value !== 'string' || !/^(?:100|[1-9]?\d)$/.test(value)) throw new Error('Choose a valid slider value for each project.');
    return { projectId, weight: Number(value) };
  });
};
