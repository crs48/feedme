import { TID } from '@atproto/common-web';
import { z } from 'zod';
import { oauthClient } from './auth';
import { config } from './config';
import { deleteKv, getDb, getKv, listRecords, putRecord, setKv } from './db';
import { didSchema } from './model';
import { collectionFor, followSchema, POST, projectSubject, type Follow, type FollowKind, type SocialRecord } from './social-model';

const recordsSchema = z.object({ records: z.array(z.object({ uri: z.string(), cid: z.string(), value: z.record(z.string(), z.unknown()) })), cursor: z.string().optional() });
const demoNamespace = (actor: string, collection: string) => `demo-social:${actor}:${collection}`;

// All requests use the acting account's grant. This adapter is intentionally
// separate from the owner's Habitat receipt/project outbox.
export const socialClient = async (actor: string) => {
  didSchema.parse(actor);
  const session = await (await oauthClient()).restore(actor);
  if (session.did !== actor) throw new Error('Reconnect your AT Protocol account.');
  const signal = AbortSignal.timeout(10_000);
  return async (method: string, params: Record<string, unknown>, write = false, appview = false): Promise<unknown> => {
    const query = write ? '' : `?${new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]))}`;
    const response = await session.fetchHandler(`/xrpc/${method}${query}`, {
      method: write ? 'POST' : 'GET', signal,
      headers: { ...(write ? { 'content-type': 'application/json' } : {}), ...(appview ? { 'atproto-proxy': 'did:web:api.bsky.app#bsky_appview' } : {}) },
      ...(write ? { body: JSON.stringify(params) } : {}),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      if (method.endsWith('.deleteRecord') && body.error === 'RecordNotFound') return {};
      throw new Error('Your social provider could not complete this request. Reconnect your account or retry.');
    }
    return body;
  };
};

export const readSocialRecords = async (actor: string, collection: string, fresh = false): Promise<SocialRecord[]> => {
  if (config().demo) return listRecords<SocialRecord>(getDb(), demoNamespace(actor, collection));
  const cacheKey = `${actor}:${collection}`;
  const cached = !fresh && getKv<SocialRecord[]>(getDb(), 'social-read', cacheKey);
  if (cached) return cached;
  const request = await socialClient(actor);
  const records: SocialRecord[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = recordsSchema.parse(await request('com.atproto.repo.listRecords', { repo: actor, collection, limit: 100, ...(cursor ? { cursor } : {}) }));
    if (result.records.some((record) => !record.uri.startsWith(`at://${actor}/${collection}/`))) throw new Error('Your provider returned records from another account.');
    records.push(...result.records);
    if (!result.cursor) { setKv(getDb(), 'social-read', cacheKey, records, 30_000); return records; }
    if (cursors.has(result.cursor)) break;
    cursors.add(result.cursor);
    cursor = result.cursor;
  }
  // Never interpret an incomplete list as "not followed" and create duplicates.
  throw new Error('The follow list could not be read completely. Please try again.');
};
export const readFollows = async (actor: string, kind: FollowKind, fresh = false): Promise<Follow[]> =>
  (await readSocialRecords(actor, collectionFor(kind), fresh)).flatMap((record) => {
    const parsed = followSchema.safeParse(record.value);
    const subject = kind === 'creator' ? didSchema : projectSubject;
    return parsed.success && parsed.data.$type === collectionFor(kind) && subject.safeParse(parsed.data.subject).success ? [{ ...record, value: parsed.data }] : [];
  });

const actorLocks = new Map<string, Promise<unknown>>();
export const withSocialLock = async <T>(actor: string, action: () => Promise<T>): Promise<T> => {
  const previous = actorLocks.get(actor) || Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  actorLocks.set(actor, current);
  try { return await current; }
  finally { if (actorLocks.get(actor) === current) actorLocks.delete(actor); }
};
const putSocialRecord = async (actor: string, collection: string, rkey: string, value: Record<string, unknown>) => {
  const uri = `at://${actor}/${collection}/${rkey}`;
  if (config().demo) putRecord(getDb(), demoNamespace(actor, collection), rkey, { uri, cid: 'demo', value });
  else await (await socialClient(actor))('com.atproto.repo.putRecord', { repo: actor, collection, rkey, record: value }, true);
  deleteKv(getDb(), 'social-read', `${actor}:${collection}`);
  return uri;
};
export const changeFollow = (actor: string, kind: FollowKind, subject: string, enabled: boolean, title?: string) => withSocialLock(actor, async () => {
  (kind === 'creator' ? didSchema : projectSubject).parse(subject);
  if (kind === 'creator' && subject === actor) throw new Error('You cannot follow your own account.');
  const collection = collectionFor(kind);
  const existing = (await readFollows(actor, kind, true)).filter((record) => record.value.subject === subject);
  const operation = `${actor}:${collection}:${subject}`;
  if (enabled) {
    if (existing.length) { deleteKv(getDb(), 'follow-pending', operation); return; }
    const pending = getKv<{ rkey: string; value: Record<string, unknown> }>(getDb(), 'follow-pending', operation) || {
      rkey: TID.nextStr(), value: { $type: collection, subject, createdAt: new Date().toISOString(), ...(kind === 'project' && title ? { title: title.slice(0, 100) } : {}) },
    };
    setKv(getDb(), 'follow-pending', operation, pending);
    await putSocialRecord(actor, collection, pending.rkey, pending.value);
    deleteKv(getDb(), 'follow-pending', operation);
  } else {
    for (const record of existing) {
      const rkey = record.uri.slice(`at://${actor}/${collection}/`.length);
      if (!/^[a-zA-Z0-9._~:-]+$/.test(rkey)) throw new Error('Invalid follow record key.');
      if (config().demo) getDb().prepare('DELETE FROM records WHERE kind=? AND id=?').run(demoNamespace(actor, collection), rkey);
      else await (await socialClient(actor))('com.atproto.repo.deleteRecord', { repo: actor, collection, rkey, swapRecord: record.cid }, true);
    }
    deleteKv(getDb(), 'follow-pending', operation);
    deleteKv(getDb(), 'social-read', `${actor}:${collection}`);
  }
});

type SavedPost = { rkey: string; record: Record<string, unknown>; uri?: string };
export const publishedPost = (actor: string, operation: string) => getKv<SavedPost>(getDb(), 'social-post', `${actor}:${operation}`);
export const publishPost = (actor: string, operation: string, record: Record<string, unknown>) => withSocialLock(actor, async () => {
  const key = `${actor}:${operation}`;
  const previous = publishedPost(actor, operation);
  if (previous && previous.record.text !== record.text) throw new Error('This post already started with different text. Retry the saved message.');
  if (previous?.uri) return previous.uri;
  const pending = previous || { rkey: TID.nextStr(), record };
  setKv(getDb(), 'social-post', key, pending);
  const uri = await putSocialRecord(actor, POST, pending.rkey, pending.record);
  setKv(getDb(), 'social-post', key, { ...pending, uri });
  return uri;
});
