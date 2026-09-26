import { publicTipActivity, type Support } from './model';

export const supporterTimeline = (records: Support[], creatorDid: string, projectId?: string, page = 0, size = 12) => {
  const visible = records.filter((support) => !projectId || support.projectId === projectId)
    .flatMap((support) => { const activity = publicTipActivity(support, creatorDid); return activity ? [{ activity, key: support.activityId || support.id }] : []; })
    .sort((a, b) => b.activity.createdAt.localeCompare(a.activity.createdAt) || b.key.localeCompare(a.key));
  const currentPage = Math.max(0, Math.min(Math.max(0, Math.ceil(visible.length / size) - 1), Math.floor(page) || 0));
  return { entries: visible.slice(currentPage * size, (currentPage + 1) * size).map(({ activity }) => activity), page: currentPage, hasOlder: (currentPage + 1) * size < visible.length, hasNewer: currentPage > 0 };
};
