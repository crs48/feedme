import { netSupport, publicTipActivity, supportParts, type Support } from './model';
import { blueskyPostUrl } from './social-model';

type TimelineTip = { createdAt: string } & (
  | { visibility: 'public'; supporter: string; amount: number; projects: { projectId: string; amount: number }[]; postUri?: string }
  | { visibility: 'anonymous'; projects: { projectId: string }[] }
);

// A timeline item represents a payment, not one of its allocation parts. Keep this
// local projection separate from per-project AT Protocol acknowledgments.
const timelineTip = (support: Support, creatorDid: string): TimelineTip | null => {
  const activity = publicTipActivity(support, creatorDid);
  if (!activity) return null;
  const parts = supportParts(support).filter((part) => netSupport(part) > 0);
  if (!parts.length) return null;
  const createdAt = support.paidAt || support.createdAt;
  return activity.visibility === 'public'
    ? { visibility: 'public', createdAt, supporter: activity.supporter, amount: activity.amount,
      projects: parts.map((part) => ({ projectId: part.projectId, amount: netSupport(part) })) }
    : { visibility: 'anonymous', createdAt, projects: parts.map((part) => ({ projectId: part.projectId })) };
};

export const supporterTimeline = (records: Support[], creatorDid: string, projectId?: string, page = 0, size = 12, sharedPost?: (support: Support) => string | undefined) => {
  const visible = records.flatMap((support) => {
    const activity = timelineTip(support, creatorDid);
    return activity && (!projectId || activity.projects.some((part) => part.projectId === projectId))
      ? [{ activity, key: support.id, support }] : [];
  })
    .sort((a, b) => b.activity.createdAt.localeCompare(a.activity.createdAt) || b.key.localeCompare(a.key));
  const currentPage = Math.max(0, Math.min(Math.max(0, Math.ceil(visible.length / size) - 1), Math.floor(page) || 0));
  const entries = visible.slice(currentPage * size, (currentPage + 1) * size).map(({ activity, support }): TimelineTip => {
    // Never associate a social identity with an anonymous entry. Resolve only
    // this page, and only a confirmed publication by the identified supporter.
    const postUri = activity.visibility === 'public' ? sharedPost?.(support) : undefined;
    return activity.visibility === 'public' && postUri?.startsWith(`at://${activity.supporter}/`) && blueskyPostUrl(postUri)
      ? { ...activity, postUri } : activity;
  });
  return { entries, total: visible.length, page: currentPage, hasOlder: (currentPage + 1) * size < visible.length, hasNewer: currentPage > 0 };
};
