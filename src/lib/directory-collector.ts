import { z } from 'zod';
import { didSchema, NS } from './model';
import { graphPersonSchema, visiblePerson } from './discovery-model';
import { creatorFromRecord, profileUri, resolvePublicIdentity, siteDeclaration, xrpcUrl, type PublicReader } from './public-identity';
import { publicJson, PublicHttpError } from './public-network';
import { DIRECTORY_RELAY, candidateSchema, directoryCreatorSchema, directoryPolicySchema, directorySnapshotSchema, directoryStateSchema, publicDirectoryCreators, type DirectoryCandidate, type DirectoryState } from './directory-model';

const appview = 'https://public.api.bsky.app';
const missing = (error: unknown) => error instanceof PublicHttpError && error.code === 'RecordNotFound';
const inactive = (error: unknown) => error instanceof PublicHttpError && ['RepoDeactivated', 'RepoTakendown', 'AccountDeactivated', 'AccountTakedown'].includes(error.code || '');

export const observeCreator = async (did: string, read: PublicReader, now: string, previous?: DirectoryCandidate): Promise<DirectoryCandidate> => {
  const base = { did: didSchema.parse(did), attemptedAt: now };
  try {
    const identity = await resolvePublicIdentity(did, read);
    let input: unknown;
    try { input = await read(xrpcUrl(identity.pds, 'com.atproto.repo.getRecord', { repo: did, collection: `${NS}.profile`, rkey: 'self' }), { maxBytes: 65_536 }); }
    catch (error) { if (missing(error)) return { ...base, outcome: 'withdrawn' }; throw error; }
    const creator = creatorFromRecord(did, input);
    if (!creator) return { ...base, outcome: 'withdrawn' };
    const { cid } = z.object({ cid: z.string().min(1).max(256) }).parse(input);
    // Public moderation precedes listing. A provider outage is never approval.
    const person = graphPersonSchema.extend({ did: z.literal(did) }).parse(await read(xrpcUrl(appview, 'app.bsky.actor.getProfile', { actor: did }), { maxBytes: 65_536 }));
    if (!visiblePerson(person)) return { ...base, outcome: 'suppressed' };
    let handle: string | undefined;
    if (identity.handles.includes(person.handle)) {
      try {
        const resolved = z.object({ did: didSchema }).parse(await read(xrpcUrl(appview, 'com.atproto.identity.resolveHandle', { handle: person.handle }), { maxBytes: 65_536 }));
        if (resolved.did === did && directoryCreatorSchema.shape.handle.safeParse(person.handle).success) handle = person.handle;
      } catch { /* A missing display handle does not erase a verified DID. */ }
    }
    const common = { did, handle, name: creator.name, bio: creator.bio, profileUri: profileUri(did), profileCid: cid, advertisementCheckedAt: now, siteCheckedAt: now };
    let declaration: unknown;
    try { declaration = await read(new URL('/.well-known/feedme', creator.url).href, { maxBytes: 65_536 }); }
    catch {
      // Do not retain verification across a domain change, even for the same DID.
      return { ...base, advertisedUrl: creator.url, outcome: 'listed', creator: { ...common, siteStatus: 'unreachable', lastVerifiedAt: previous?.advertisedUrl === creator.url ? previous.creator?.lastVerifiedAt : undefined } };
    }
    try {
      if (siteDeclaration(did, creator.url, declaration).mode === 'demo') return { ...base, outcome: 'suppressed' };
    } catch { return { ...base, outcome: 'mismatch' }; }
    return { ...base, advertisedUrl: creator.url, outcome: 'listed', creator: { ...common, url: creator.url, siteStatus: 'reachable', lastVerifiedAt: now } };
  } catch (error) {
    if (inactive(error)) return { ...base, outcome: 'suppressed' };
    // Keep the last observation's timestamps; no stale URL becomes an active link.
    return { ...base, advertisedUrl: previous?.advertisedUrl, outcome: 'error', ...(previous?.creator ? { creator: { ...previous.creator, url: undefined, siteStatus: 'unknown' as const } } : {}) };
  }
};

// Serialize requests to each origin. Every call still uses the DNS-pinned public transport.
export const boundedDirectoryReader = (read: PublicReader, deadline: number): PublicReader => {
  const active = new Map<string, Promise<unknown>>();
  const cooled = new Set<string>();
  return async (url, options) => {
    const host = new URL(url).origin;
    const previous = active.get(host);
    const next = (async () => {
      await previous?.catch(() => undefined);
      if (Date.now() >= deadline || cooled.has(host)) throw new Error('Collection budget exhausted or provider throttled.');
      try { return await read(url, options); }
      catch (error) { if (error instanceof PublicHttpError && [429, 503].includes(error.status)) cooled.add(host); throw error; }
    })();
    active.set(host, next);
    try { return await next; } finally { if (active.get(host) === next) active.delete(host); }
  };
};

export const collectDirectory = async (options: {
  previous?: unknown; policy?: unknown; relay?: string; read?: PublicReader;
  now?: Date; maxChecks?: number; maxPages?: number; budgetMs?: number;
} = {}) => {
  const start = Date.now(); const now = (options.now || new Date()).toISOString();
  const relay = options.relay || DIRECTORY_RELAY;
  const policy = directoryPolicySchema.parse(options.policy || {});
  const previous = options.previous ? directoryStateSchema.parse(options.previous) : undefined;
  const read = boundedDirectoryReader(options.read || publicJson, start + (options.budgetMs ?? 600_000));
  const maxChecks = Math.max(1, Math.min(options.maxChecks ?? 1000, 1000));
  const candidates = new Map<string, DirectoryCandidate>((previous?.candidates || []).map((c) => [c.did, c]));
  for (const did of policy.seeds) if (candidates.size < 5000) candidates.set(did, candidates.get(did) || { did });
  let cursor = previous?.relay === relay ? previous.cursor : undefined;
  let completedAt = previous?.relay === relay ? previous.completedAt : undefined;
  let partial = false, enumerated = false; const cursors = new Set<string>();
  if (cursor) cursors.add(cursor);
  for (let page = 0; page < Math.min(options.maxPages ?? 5, 50); page++) {
    try {
      const data = z.object({ repos: z.array(z.object({ did: didSchema })).max(2000), cursor: z.string().max(2048).optional() }).parse(await read(xrpcUrl(relay, 'com.atproto.sync.listReposByCollection', { collection: `${NS}.profile`, limit: '200', ...(cursor ? { cursor } : {}) })));
      for (const { did } of data.repos) {
        if (!candidates.has(did) && candidates.size >= 5000) { partial = true; break; }
        if (!candidates.has(did)) candidates.set(did, { did });
      }
      if (partial) break; // Retry this page rather than skip unrecorded candidates.
      if (!data.cursor) { cursor = undefined; completedAt = now; enumerated = true; break; }
      if (cursors.has(data.cursor)) { cursor = undefined; partial = true; break; }
      cursor = data.cursor; cursors.add(cursor);
    } catch { partial = true; cursor = undefined; break; }
  }
  partial ||= !enumerated;
  const suppressed = new Set(policy.suppressed);
  for (const did of suppressed) if (candidates.has(did)) candidates.set(did, { did, attemptedAt: now, outcome: 'suppressed' });
  const all = [...candidates.values()].filter((c) => !suppressed.has(c.did));
  const known = all.filter((c) => c.attemptedAt).sort((a,b) => a.attemptedAt!.localeCompare(b.attemptedAt!) || a.did.localeCompare(b.did));
  const fresh = all.filter((c) => !c.attemptedAt);
  // Alternate new candidates with old ones, preventing either group from starving.
  const fair = Array.from({ length: Math.max(known.length, fresh.length) }, (_, i) => [known[i], fresh[i]]).flat().filter((c): c is DirectoryCandidate => Boolean(c));
  const batch = fair.slice(0, maxChecks); partial ||= fair.length > batch.length;
  let next = 0, checked = 0;
  await Promise.all(Array.from({ length: Math.min(4, batch.length) }, async () => {
    for (;;) {
      if (Date.now() - start >= (options.budgetMs ?? 600_000)) { partial = true; return; }
      const candidate = batch[next++]; if (!candidate) return;
      const observed = await observeCreator(candidate.did, read, now, candidate);
      candidates.set(candidate.did, candidateSchema.parse(observed)); checked++;
      if (observed.outcome === 'error') partial = true;
    }
  }));
  const state: DirectoryState = directoryStateSchema.parse({ schemaVersion: 1, relay, cursor, completedAt, candidates: [...candidates.values()] });
  const snapshot = directorySnapshotSchema.parse({ schemaVersion: 1, generatedAt: now, source: { relays: [relay], completedAt, partial }, creators: publicDirectoryCreators(state.candidates, Date.parse(now)) });
  // A size cap is part of the public contract; never silently truncate JSON.
  while (Buffer.byteLength(JSON.stringify(snapshot)) > 2_000_000) { snapshot.creators.pop(); snapshot.source.partial = true; }
  return { state, snapshot, stats: { candidates: candidates.size, checked, listed: snapshot.creators.length, partial: snapshot.source.partial, elapsedMs: Date.now() - start } };
};
