import { createHash } from 'node:crypto';
import { didSchema, NS, LEGACY_NS, friendSchema, type Friend } from './model';
import { readSocialRecords, putSocialRecord, socialClient, withSocialLock } from './social-repo';
import { discoverCreator } from './public-repo';
import { config } from './config';
import { deleteKv, getDb, putRecord, listRecords, enqueue } from './db';

export const recommendations = async (actor: string, fresh = false) => {
  const remote = (await Promise.all([NS, LEGACY_NS].map((ns) => readSocialRecords(actor, `${ns}.recommendation`, fresh)))).flat();
  const local = actor === config().ownerDid ? listRecords<Friend>(getDb(), 'friend').map((value) => ({ uri: `at://${actor}/${NS}.recommendation/${value.id}`, cid: 'local', value: { $type: `${NS}.recommendation`, ...value } })) : [];
  return [...new Map([...local, ...remote].map((r) => [r.uri, r])).values()].flatMap((r) => {
    const value = friendSchema.safeParse(r.value);
    return value.success && didSchema.safeParse(value.data.did).success && [NS, LEGACY_NS].some((ns) => r.value.$type === `${ns}.recommendation`) ? [{ ...r, value: value.data }] : [];
  });
};
const recommendationKey = (subject: string) => {
  const hex = createHash('sha256').update(subject).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
};
export const recommend = (actor: string, subject: string, note: string, enabled = true) => withSocialLock(actor, async () => {
  didSchema.parse(subject);
  if (subject === actor) throw new Error('Choose another creator to recommend.');
  const existing = (await recommendations(actor, true)).filter((r) => r.value.did === subject);
  if (!enabled) {
    for (const r of existing) {
      const parts = r.uri.slice(5).split('/');
      if (parts.length !== 3 || parts[0] !== actor || ![`${NS}.recommendation`, `${LEGACY_NS}.recommendation`].includes(parts[1])) throw new Error('Invalid recommendation.');
      if (config().demo) getDb().prepare('DELETE FROM records WHERE kind=? AND id=?').run(`demo-social:${actor}:${parts[1]}`, parts[2]);
      else await (await socialClient(actor))('com.atproto.repo.deleteRecord', { repo: actor, collection: parts[1], rkey: parts[2], ...(r.cid !== 'local' ? { swapRecord: r.cid } : {}) }, true);
      deleteKv(getDb(), 'social-read', `${actor}:${parts[1]}`);
      if (actor === config().ownerDid) {
        getDb().prepare('DELETE FROM records WHERE kind=? AND id=?').run('friend', r.value.id);
        deleteKv(getDb(), 'public-circle', actor);
        if (!config().demo) enqueue(getDb(), 'public', parts[1], parts[2], null);
      }
    }
    return;
  }
  const creator = await discoverCreator(subject, true);
  if (!creator) throw new Error('This creator has not published a discoverable Feedme profile.');
  const prior = existing.find((r) => r.uri.includes(`/${NS}.recommendation/`));
  const value: Friend = friendSchema.parse({ id: prior?.value.id || recommendationKey(subject), name: creator.name, did: subject, url: creator.url, description: note.trim(), createdAt: prior?.value.createdAt || new Date().toISOString() });
  const rkey = prior?.uri.split('/').at(-1) || value.id;
  await putSocialRecord(actor, `${NS}.recommendation`, rkey, { $type: `${NS}.recommendation`, ...value });
  if (actor === config().ownerDid) {
    putRecord(getDb(), 'friend', value.id, value);
    deleteKv(getDb(), 'public-circle', actor);
    // Supersede a manual recommendation still waiting in the owner's outbox.
    if (!config().demo) enqueue(getDb(), 'public', `${NS}.recommendation`, rkey, { $type: `${NS}.recommendation`, ...value });
  }
});
