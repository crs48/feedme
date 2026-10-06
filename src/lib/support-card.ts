import { picksSchema } from './picks';
import { aspirationProgress, type AspirationProgress } from './aspiration';
import { didSchema, netSupport, supportParts, type Profile, type Project, type Support } from './model';

export type SupportCardProject = { id: string; title: string; category: string; archived: boolean; target: number; percentage: number; progress?: AspirationProgress };
export type SupportCard = {
  creator: { name: string; handle: string };
  projects: SupportCardProject[];
  other: { count: number; percentage: number };
  projectCount: number;
  pickMode?: boolean;
};
export const eligibleForSupportCard = (support: Support | undefined): support is Support =>
  Boolean(support && support.visibility === 'public' && didSchema.safeParse(support.supporterDid).success && netSupport(support) > 0);

// This is the sole public projection. Never spread a receipt or a profile into
// it: notes, payment identifiers, exact tip amounts and private totals stay out.
export const publicSupportCard = (
  support: Support | undefined, creator: Profile, projects: Project[], publicAmounts: ReadonlyMap<string, number>,
): SupportCard | undefined => {
  if (!eligibleForSupportCard(support)) return;
  if (support.picks && !picksSchema.safeParse(support.picks).success) return;
  const parts = support.picks ? support.picks.map(p => ({ projectId: p.projectId, amount: p.count })) : supportParts(support).map((part) => ({ projectId: part.projectId, amount: netSupport(part) })).filter((part) => part.amount > 0);
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  if (!Number.isSafeInteger(total) || (!support.picks && total !== netSupport(support)) || new Set(parts.map((part) => part.projectId)).size !== parts.length) return;
  const shares = parts.map((part, index) => ({ ...part, index, units: Math.floor(part.amount * 1000 / total), remainder: part.amount * 1000 % total }));
  const extras = new Set([...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .slice(0, 1000 - shares.reduce((sum, part) => sum + part.units, 0)).map((part) => part.index));
  const ranked = [...shares].sort((a, b) => b.amount - a.amount || a.index - b.index);
  const publicProjects = new Map(projects.filter((project) => ['active', 'complete', 'archived'].includes(project.status)).map((project) => [project.id, project]));
  const visible = ranked.flatMap((part): SupportCardProject[] => {
    const project = publicProjects.get(part.projectId);
    return project ? [{ id: project.id, title: project.title, category: project.category, archived: project.status === 'archived', target: project.target,
      percentage: (part.units + Number(extras.has(part.index))) / 10,
      progress: support.picks ? undefined : aspirationProgress(publicAmounts.get(project.id) || 0, project.target) }] : [];
  }).slice(0, 6);
  if (!visible.length) return;
  return { ...(support.picks ? { pickMode: true } : {}), creator: { name: creator.name, handle: creator.handle }, projects: visible, projectCount: parts.length,
    other: { count: parts.length - visible.length, percentage: Math.round(1000 - visible.reduce((sum, part) => sum + part.percentage * 10, 0)) / 10 } };
};
