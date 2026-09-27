// The full percentage remains visible after a goal is reached. The second bar
// measures the first additional lap; the label keeps counting beyond that lap.
export const aspirationProgress = (amount: number, target: number) => {
  if (!Number.isFinite(amount) || !Number.isFinite(target) || target <= 0) return undefined;
  const ratio = Math.max(0, amount) / target;
  const percentage = Math.floor(Math.max(0, amount) * 1000 / target) / 10;
  const surplus = Math.floor(Math.max(0, amount - target) * 1000 / target) / 10;
  return { percentage, fill: Math.min(100, ratio * 100), exceeded: ratio > 1,
    surplus, surplusFill: Math.min(100, Math.max(0, ratio - 1) * 100) };
};
export type AspirationProgress = NonNullable<ReturnType<typeof aspirationProgress>>;
export const percentageLabel = (percentage: number) => percentage === 0 ? '<0.1%' : `${percentage}%`;
export const aspirationLabel = (progress: AspirationProgress) => progress.exceeded
  ? `${percentageLabel(progress.surplus)} beyond aspiration`
  : `${progress.percentage}% of aspiration`;
