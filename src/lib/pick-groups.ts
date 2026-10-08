import type { LibcardItem } from './libcard-schema';

export const pickGroups = [
  { id: 'ready', title: 'Ready to use', description: 'Finished and maintained' },
  { id: 'wip', title: 'In progress', description: 'Actively being built' },
  { id: 'writing', title: 'Writing', description: 'Essays and ideas' },
  { id: 'reading', title: 'Reading', description: 'Following a little curiosity' },
  { id: 'experiment', title: 'Experiments', description: 'Small, playful possibilities', quiet: true },
  { id: 'exploration', title: 'Explorations', description: 'Notes on how we could live', quiet: true },
  { id: 'dormant', title: 'Dormant', description: 'Resting, not forgotten', quiet: true },
  { id: 'other', title: 'More to explore', description: '' },
] as const;
export const groupForItem = (item?: LibcardItem) => item?.status || 'other';
const socialLabels: Record<string, string> = { github: 'GitHub', linkedin: 'LinkedIn', x: 'X', bluesky: 'Bluesky', youtube: 'YouTube', instagram: 'Instagram', substack: 'Substack' };
export const socialLabel = (label: string) => socialLabels[label] || label;
