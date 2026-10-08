import { config } from './config';
import { enqueue, getDb, deleteKv, listRecords, putRecord, readRecord, setKv, transaction } from './db';
import { NS, netSupport, supportParts, projectSchema, profileSchema, updateSchema, friendSchema, type Friend, type Profile, type Project, type Support, type Update } from './model';

export const profile = () => readRecord<Profile>(getDb(), 'profile', 'self')!;
export const projects = (includePrivate = false) => listRecords<Project>(getDb(), 'project').filter((p) => includePrivate || (!p.libcard && ['active', 'complete'].includes(p.status))).reverse();
export const project = (id: string) => readRecord<Project>(getDb(), 'project', id);
export const updates = () => listRecords<Update>(getDb(), 'update').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const friends = () => listRecords<Friend>(getDb(), 'friend');
export const supports = () => listRecords<Support>(getDb(), 'support').flatMap(supportParts);
export const payments = () => listRecords<Support>(getDb(), 'support');
export const support = (id: string) => readRecord<Support>(getDb(), 'support', id);
export const totals = (projectId?: string, publicOnly = true) => {
  const amounts = payments().filter((s) => !publicOnly || s.visibility === 'public')
    .map((s) => projectId
      ? supportParts(s).filter((part) => part.projectId === projectId).reduce((sum, part) => sum + netSupport(part), 0)
      : netSupport(s));
  return { amount: amounts.reduce((sum, amount) => sum + amount, 0), count: amounts.filter((amount) => amount > 0).length };
};
const queuePublic = (kind: string, id: string, value: object, collection = kind) => {
  putRecord(getDb(), kind, id, value);
  if (!config().demo) enqueue(getDb(), 'public', `${NS}.${collection}`, id, { $type: `${NS}.${collection}`, ...value });
};
const savePublic = (kind: string, id: string, value: object, collection = kind) => transaction(getDb(), () => queuePublic(kind, id, value, collection));
const publicProfile = (value: unknown) => {
  const p = profileSchema.parse(value);
  return profileSchema.parse({ ...p, feedmeUrl: config().demo ? '' : config().origin, discoverable: p.discoverable ?? true });
};
export const saveProject = (value: unknown) => {
  const p = projectSchema.parse(value);
  const previous = project(p.id);
  if (p.libcard || previous?.libcard) throw new Error('Manage this target in From LibCard. Source fields are read-only.');
  if ((!previous || previous.status === 'draft') && !['draft', 'active'].includes(p.status)) throw new Error('Publish a draft before completing or archiving it.');
  if (p.status === 'draft') {
    if (previous && previous.status !== 'draft') throw new Error('Published projects cannot become private drafts. Archive the project instead.');
    putRecord(getDb(), 'project', p.id, p);
  } else {
    // Publishing work must not silently announce a new site or undo a remote opt-out.
    savePublic('project', p.id, p);
  }
  return p;
};
export const saveProfile = (value: unknown, expectedCid: string | null) => transaction(getDb(), () => {
  const p = publicProfile(value);
  if (!config().demo) setKv(getDb(), 'profile-publication', 'expected', { profile: p, cid: expectedCid });
  queuePublic('profile', 'self', p);
  return p;
});
export const saveUpdate = (value: unknown) => {
  const u = updateSchema.parse(value);
  const p = project(u.projectId);
  if (!p || p.libcard || !['active', 'complete'].includes(p.status)) throw new Error('Choose a published project.');
  savePublic('update', u.id, u);
  return u;
};
export const saveFriend = (value: unknown) => { const f = friendSchema.parse(value); savePublic('friend', f.id, f, 'recommendation'); deleteKv(getDb(), 'public-circle', config().ownerDid); };
