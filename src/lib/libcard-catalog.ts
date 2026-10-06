import { createHash } from 'node:crypto';
import type { LibcardItem, LibcardSnapshot } from './libcard-schema';
import type { Project } from './model';

const seed = (value: string) => createHash('sha256').update(value).digest('hex');
export type CatalogItem = LibcardItem & { targetId?: string; demoOnly?: boolean };
// Demo-only IDs never imply creator consent in a real payment deployment.
// Source records remain intact, including links without an explicit opt-in.
export const libcardCatalog = (snapshot: LibcardSnapshot, previewAll = false): CatalogItem[] => {
  const used = new Set(['creator', 'amount', ...snapshot.document.items.flatMap(i => i.feedme ? [i.feedme.id] : [])]);
  let remaining = 99 - snapshot.document.items.filter(i => i.feedme).length;
  return snapshot.document.items.map(item => {
    if (item.feedme) return { ...item, targetId: item.feedme.id };
    if (!previewAll || remaining <= 0) return item;
    const base = `preview-${seed(`${item.kind}:${item.url}`).slice(0, 16)}`;
    let id = base, suffix = 1;
    while (used.has(id)) id = `${base}-${++suffix}`;
    used.add(id); remaining--;
    return { ...item, targetId: id, demoOnly: true };
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
