import type { Pick } from './picks';

// No preference is the fallback, so it never takes a share from specific picks.
export const withDefaultPick = (picks: Pick[]): Pick[] => {
  const selected = picks.filter(pick => pick.projectId !== 'creator' && pick.count > 0);
  return selected.length ? selected : [{ projectId: 'creator', count: 1 }];
};
