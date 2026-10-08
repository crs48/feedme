import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { config } from './config';
import { getDb, getKv, listRecords, putRecord, readRecord, setKv, transaction } from './db';
import { projectSchema, type Profile, type Project } from './model';
import { LibcardImportError, libcardSnapshotSchema, parseLibcard, rawRoot, sourceKey, type LibcardSnapshot, type LibcardSource, type LibcardTargetMode } from './libcard-schema';
import { libcardFixture } from './libcard-fixture';
import { libcardCatalog } from './libcard-catalog';
import { refreshGithubStars } from './libcard-github';
import { cachedCreatorBluesky } from './creator-bluesky';

export type RefreshStatus = { attemptedAt: string; error?: string; catalogVersion?: 2 };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const storedLibcard = (db: DatabaseSync, source: LibcardSource) => {
  const snapshot = getKv<LibcardSnapshot>(db, 'libcard', 'snapshot');
  return snapshot && sourceKey(snapshot.source) === sourceKey(source) ? snapshot : undefined;
};
const targetMode = (): LibcardTargetMode => config().libcardRemoteDemo ? 'preview' : config().libcardDefaultSupport || 'all';
export const importLibcard = (db: DatabaseSync, snapshot: LibcardSnapshot, mode = targetMode()) => transaction(db, () => {
  const validated = libcardSnapshotSchema.parse({ ...snapshot, targetMode: mode });
  const { document: doc, source } = validated;
  const targets = [
    { id: 'creator', label: `Just ${doc.profile.name.split(/\s+/)[0]}`, blurb: '', url: null, kind: 'creator' as const, aspiration: 0, demoOnly: false },
    ...libcardCatalog(validated, mode).flatMap(i => i.targetId ? [{ id: i.targetId, label: i.label, blurb: i.feedme?.blurb || '', url: i.url, kind: i.kind, aspiration: (i.feedme?.aspiration || 0) * 100, demoOnly: Boolean(i.demoOnly) }] : []),
  ];
  for (const target of targets) {
    const previous = readRecord<Project>(db, 'project', target.id);
    if (previous && !previous.libcard) throw new LibcardImportError(`Target ID ${target.id} belongs to a native project. Choose a different LibCard ID.`);
    const hidden = target.id !== 'creator' && Boolean(previous?.libcard?.hidden);
    const aspirationOverride = previous?.libcard?.aspirationOverride;
    const p = projectSchema.parse({
      id: target.id, title: target.label, summary: target.blurb, description: target.blurb,
      category: 'Community', kind: 'ongoing', status: hidden ? 'archived' : 'active', color: 'blue',
      target: aspirationOverride ?? target.aspiration, image: '', link: target.url?.startsWith('https://') ? target.url : '',
      createdAt: previous?.createdAt || new Date().toISOString(),
      libcard: { source, kind: target.kind, url: target.url, present: true, hidden, sourceAspiration: target.aspiration, aspirationOverride, demoOnly: target.demoOnly },
    });
    if (JSON.stringify(previous) !== JSON.stringify(p)) putRecord(db, 'project', p.id, p);
  }
  const ids = new Set(targets.map(t => t.id));
  for (const p of listRecords<Project>(db, 'project')) if (p.libcard && !ids.has(p.id) && p.libcard.present)
    putRecord(db, 'project', p.id, { ...p, status: 'archived', libcard: { ...p.libcard, present: false } });
  setKv(db, 'libcard', 'snapshot', validated);
});
export const libcardSnapshot = () => {
  const cfg = config(); if (!cfg.libcard) return;
  const db = getDb();
  let snapshot = storedLibcard(db, cfg.libcard);
  if (cfg.demo && !cfg.libcardRemoteDemo && !snapshot && !getKv(db, 'recovery', 'paused')) {
    snapshot = { source: cfg.libcard, document: parseLibcard(libcardFixture, cfg.libcard), hash: hash(libcardFixture), checkedAt: new Date().toISOString(), catalogVersion: 2 };
    importLibcard(db, snapshot);
    snapshot = storedLibcard(db, cfg.libcard);
  }
  // Reapply a changed default from the last-good source, including after a
  // restore or during a GitHub outage. Never update halfway through recovery.
  if (snapshot && snapshot.targetMode !== targetMode() && !getKv(db, 'recovery', 'paused')) {
    const checkedAt = snapshot.checkedAt;
    try {
      importLibcard(db, snapshot);
      snapshot = storedLibcard(db, cfg.libcard);
    } catch (error) {
      const status = getKv<RefreshStatus>(db, 'libcard-refresh', sourceKey(cfg.libcard));
      setKv(db, 'libcard-refresh', sourceKey(cfg.libcard), {
        ...status, attemptedAt: status?.attemptedAt || checkedAt,
        error: `LibCard settings could not be applied. ${error instanceof LibcardImportError ? error.message : 'Check the catalog and import limits.'} The last good catalog is unchanged.`,
      });
    }
  }
  return snapshot;
};
// Real-source demos also work under pnpm dev, which has no background sync worker.
// The importer coalesces requests and checks GitHub at most every 15 minutes.
export const loadLibcardSnapshot = async () => {
  if (config().libcardRemoteDemo) await refreshLibcard();
  return libcardSnapshot();
};
export const libcardTargets = (snapshot = libcardSnapshot()) => {
  if (!snapshot) return [];
  const ids = ['creator', ...libcardCatalog(snapshot, snapshot.targetMode || (config().libcardRemoteDemo ? 'preview' : 'explicit')).flatMap(i => i.targetId ? [i.targetId] : [])];
  return ids.flatMap(id => {
    const p = readRecord<Project>(getDb(), 'project', id);
    return p?.libcard && (!p.libcard.demoOnly || config().libcardRemoteDemo) && sourceKey(p.libcard.source) === sourceKey(snapshot.source) && p.libcard.present && !p.libcard.hidden && p.status === 'active' ? [p] : [];
  });
};
export const libcardProfile = (base: Profile, snapshot = libcardSnapshot()): Profile => {
  const cfg = config();
  const bluesky = cachedCreatorBluesky();
  const configuredHandle = cfg.identities.owner.startsWith('did:') ? '' : cfg.identities.owner;
  // LibCard describes the catalog. The bio and handle belong to Bluesky, even
  // when its current bio is empty. Never substitute the card's tagline.
  return snapshot ? {
    ...base, handle: bluesky?.handle ?? (cfg.libcardRemoteDemo ? configuredHandle : base.handle || configuredHandle),
    name: bluesky?.name ?? snapshot.document.profile.name, bio: bluesky?.bio ?? base.bio,
    location: snapshot.document.profile.location, avatar: bluesky ? bluesky.avatar : snapshot.document.profile.avatar,
  } : base;
};
export const overrideLibcard = (db: DatabaseSync, id: string, hidden: boolean, aspiration?: number) => {
  const p = readRecord<Project>(db, 'project', id);
  if (!p?.libcard) throw new Error('Choose a LibCard target.');
  if (id === 'creator' && hidden) throw new Error('The creator must remain available.');
  const updated = projectSchema.parse({ ...p, status: !p.libcard.present || hidden ? 'archived' : 'active', target: aspiration ?? p.libcard.sourceAspiration,
    libcard: { ...p.libcard, hidden, aspirationOverride: aspiration } });
  putRecord(db, 'project', id, updated);
};
let refreshing: Promise<RefreshStatus | undefined> | undefined;
export const refreshLibcard = (force = false, fetcher: typeof fetch = fetch): Promise<RefreshStatus | undefined> => refreshing ??= refresh(force, fetcher).finally(() => { refreshing = undefined; });
const refresh = async (force: boolean, fetcher: typeof fetch) => {
  const cfg = config(); if (!cfg.libcard) return;
  const db = getDb(); if (getKv(db, 'recovery', 'paused')) return;
  const key = sourceKey(cfg.libcard);
  const saved = libcardSnapshot();
  const previous = getKv<RefreshStatus>(db, 'libcard-refresh', key);
  if (!force && previous && (!saved || saved.catalogVersion === 2 || previous.catalogVersion === 2) && Date.now() - Date.parse(previous.attemptedAt) < 15 * 60_000) return previous;
  const attemptedAt = new Date().toISOString();
  setKv(db, 'libcard-refresh', key, { attemptedAt, catalogVersion: 2 });
  try {
    if (cfg.demo && !cfg.libcardRemoteDemo) {
      importLibcard(db, { source: cfg.libcard, document: parseLibcard(libcardFixture, cfg.libcard), hash: hash(libcardFixture), checkedAt: attemptedAt, catalogVersion: 2 });
    } else {
      const response = await fetcher(`${rawRoot(cfg.libcard)}libcard.config.yaml`, {
        redirect: 'error', signal: AbortSignal.timeout(5000), headers: saved?.catalogVersion === 2 && saved.etag ? { 'If-None-Match': saved.etag } : {},
      });
      if (getKv(db, 'recovery', 'paused')) return;
      if (response.status === 304 && saved) setKv(db, 'libcard', 'snapshot', { ...saved, checkedAt: attemptedAt });
      else {
        if (!response.ok || !response.body) throw new LibcardImportError(`GitHub returned HTTP ${response.status}. Check the public repository and ref, or retry later.`);
        const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 256 * 1024) throw new LibcardImportError('LibCard config exceeds 256 KiB.'); chunks.push(chunk.value); }
        } finally { await reader.cancel(); }
        const text = Buffer.concat(chunks).toString('utf8');
        const snapshot = libcardSnapshotSchema.parse({ source: cfg.libcard, document: parseLibcard(text, cfg.libcard), hash: hash(text), etag: response.headers.get('etag') || undefined, checkedAt: attemptedAt, catalogVersion: 2 });
        // A restore pause may have happened while GitHub was responding.
        if (getKv(db, 'recovery', 'paused')) return;
        importLibcard(db, snapshot);
      }
      const current = storedLibcard(db, cfg.libcard);
      if (current) await refreshGithubStars(db, current.document.items, fetcher);
    }
    return { attemptedAt };
  } catch (error) {
    const detail = error instanceof LibcardImportError ? error.message : error instanceof ZodError
      ? `Invalid LibCard fields at ${[...new Set(error.issues.slice(0, 4).map(issue => issue.path.join('.') || 'catalog'))].join(', ')}. Check field types, unique target IDs, allowed URLs, and import limits.`
      : 'Check GitHub availability, YAML without aliases, unique target IDs, allowed URLs, and import limits.';
    const status = { attemptedAt, catalogVersion: 2 as const, error: `LibCard refresh failed. ${detail} ${saved ? 'The last good snapshot is unchanged.' : 'No catalog has been imported yet.'}` };
    setKv(db, 'libcard-refresh', key, status); return status;
  }
};
