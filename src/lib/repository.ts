import { config } from './config';
import { enqueue, getDb, listRecords, putRecord, readRecord, transaction } from './db';
import { NS, netSupport, supportParts, projectSchema, profileSchema, updateSchema, friendSchema, type Friend, type Profile, type Project, type Support, type Update } from './model';

export const profile = () => readRecord<Profile>(getDb(), 'profile', 'self')!;
export const projects = (includeArchived = false) => listRecords<Project>(getDb(), 'project').filter((p) => includeArchived || p.status !== 'archived').reverse();
export const project = (id: string) => readRecord<Project>(getDb(), 'project', id);
export const updates = () => listRecords<Update>(getDb(), 'update').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const friends = () => listRecords<Friend>(getDb(), 'friend');
export const supports = () => listRecords<Support>(getDb(), 'support').flatMap(supportParts);
export const support = (id: string) => readRecord<Support>(getDb(), 'support', id);
export const totals = (projectId?: string, publicOnly = true) => {
  const records = supports().filter((s) => (!projectId || s.projectId === projectId) && (!publicOnly || s.visibility === 'public'));
  return { amount: records.reduce((sum, s) => sum + netSupport(s), 0), count: records.filter((s) => netSupport(s) > 0).length };
};
const savePublic = (kind: string, id: string, value: object, collection = kind) => transaction(getDb(), () => {
  putRecord(getDb(), kind, id, value);
  if (!config().demo) enqueue(getDb(), 'public', `${NS}.${collection}`, id, { $type: `${NS}.${collection}`, ...value });
});
export const saveProject = (value: unknown) => { const p = projectSchema.parse(value); savePublic('project', p.id, p); return p; };
export const saveProfile = (value: unknown) => savePublic('profile', 'self', profileSchema.parse(value));
export const saveUpdate = (value: unknown) => {
  const u = updateSchema.parse(value);
  if (!project(u.projectId)) throw new Error('Choose an existing project.');
  savePublic('update', u.id, u);
  return u;
};
export const saveFriend = (value: unknown) => { const f = friendSchema.parse(value); savePublic('friend', f.id, f, 'recommendation'); };
