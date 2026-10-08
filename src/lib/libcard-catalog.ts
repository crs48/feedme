import { createHash } from 'node:crypto';
import type { LibcardItem, LibcardSnapshot, LibcardTargetMode } from './libcard-schema';
import type { Project } from './model';

const seed = (value: string) => createHash('sha256').update(value).digest('hex');
export type CatalogItem = LibcardItem & { targetId?: string; demoOnly?: boolean };
// Keep automatic live IDs separate from simulated payments. Explicit source IDs
// always win; generated IDs survive title changes and source reordering.
export const libcardCatalog = (snapshot: LibcardSnapshot, mode: LibcardTargetMode = 'all'): CatalogItem[] => {
  // Source skips are absent even from the visit's ordinary-link list. Exclude
  // them before reserving IDs or consuming a slot, in every target mode.
  const items = snapshot.document.items.filter(item => !item.feedme?.skip);
  const explicitIds = items.flatMap(item => item.feedme?.id ? [item.feedme.id] : []);
  const used = new Set(['creator', 'amount', ...explicitIds]);
  let remaining = 99 - explicitIds.length;
  return items.map(item => {
    if (item.feedme?.id) return { ...item, targetId: item.feedme.id };
    if (mode === 'explicit' || remaining <= 0) return item;
    const base = `${mode === 'preview' ? 'preview' : 'auto'}-${seed(`${item.kind}:${item.url}`).slice(0, 16)}`;
    let id = base, suffix = 1;
    while (used.has(id)) id = `${base}-${++suffix}`;
    used.add(id); remaining--;
    return { ...item, targetId: id, demoOnly: mode === 'preview' };
  });
};

// Stable pseudo-random examples: revisiting or changing picks never moves the goal.
// These values are presentation only, never Support records or public pick signal.
export const sampleLibcardGoal = (project: Project) => {
  if (project.libcard?.aspirationOverride === 0) return;
  const value = Number.parseInt(seed(project.id).slice(0, 8), 16);
  const goal = project.target || [50000, 100000, 150000, 220000, 300000, 500000][value % 6];
  const percent = 12 + (value >>> 8) % 134;
  return { goal, amount: Math.round(goal * percent / 100), sample: true };
};
