import { z } from 'zod';
import { config } from './config';
import { safeWebUrl } from './markdown';
import { getDb, getKv, putRecord, setKv } from './db';
import { NS } from './model';
import { socialClient, readSocialRecords } from './social-repo';
import { discoverCreator, xrpcUrl, type CreatorProfile } from './public-repo';
import { publicJson } from './public-network';
import { connections, graphPersonSchema, inView, visiblePerson, type Connection, type DiscoveryView, type GraphPerson } from './discovery-model';
import { demoCreators, demoGraphPeople } from './discovery-demo';
import { directoryHints } from './directory-hints';

export const mapConcurrent = async <T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency = 6) => {
  const result: PromiseSettledResult<R>[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const i = next++; try { result[i] = { status: 'fulfilled', value: await fn(items[i]) }; } catch (reason) { result[i] = { status: 'rejected', reason }; } }
  })); return result;
};
type Graph = { people: GraphPerson[]; limited: boolean };
export const readGraph = async (viewer: string, subject: string, kind: 'follows' | 'followers', pages = 10): Promise<Graph> => {
  const key = `${viewer}:${subject}:${kind}:${pages}`;
  const cached = getKv<Graph>(getDb(), 'discovery-graph', key); if (cached) return cached;
  const request = await socialClient(viewer);
  const people: GraphPerson[] = []; const cursors = new Set<string>(); let cursor: string | undefined;
  for (let page = 0; page < pages; page++) {
    const result = z.object({ subject: z.object({ did: z.literal(subject) }), follows: z.array(graphPersonSchema).max(100).optional(), followers: z.array(graphPersonSchema).max(100).optional(), cursor: z.string().max(2048).optional() }).parse(await request(`app.bsky.graph.${kind === 'follows' ? 'getFollows' : 'getFollowers'}`, { actor: subject, limit: 100, ...(cursor ? { cursor } : {}) }, false, true));
    if (!result[kind]) throw new Error('Incomplete social graph response.');
    people.push(...result[kind]); cursor = result.cursor;
    if (!cursor || cursors.has(cursor)) break; cursors.add(cursor);
  }
  const result = { people: [...new Map(people.map((p) => [p.did, p])).values()], limited: Boolean(cursor) };
  setKv(getDb(), 'discovery-graph', key, result, 300_000); return result;
};
export type DiscoveryCard = CreatorProfile & { connection: Connection; recommended?: boolean };
export type DiscoveryResult = { cards: DiscoveryCard[]; warnings: string[]; checked: number; candidates: number; more: boolean; nextCursor?: string; moreCircles?: boolean; demo: boolean };
const resultBase = (): DiscoveryResult => ({ cards: [], warnings: [], checked: 0, candidates: 0, more: false, demo: config().demo });

const demoConnections = async (actor: string, extended: boolean) => {
  const db = getDb();
  if (!getKv(db, 'discovery-demo', actor)) {
    for (const p of demoGraphPeople.slice(0, 2)) putRecord(db, `demo-social:${actor}:app.bsky.graph.follow`, p.did.slice(-4), { uri: `at://${actor}/app.bsky.graph.follow/${p.did.slice(-4)}`, cid: 'demo', value: { $type: 'app.bsky.graph.follow', subject: p.did, createdAt: new Date().toISOString() } });
    setKv(db, 'discovery-demo', actor, true);
  }
  const followed = new Set((await readSocialRecords(actor, 'app.bsky.graph.follow')).map((r) => r.value.subject));
  return connections(actor, demoGraphPeople.filter((p) => followed.has(p.did)), [demoGraphPeople[0], demoGraphPeople[2]], extended ? [
    { person: demoGraphPeople[0], follows: [demoGraphPeople[3], demoGraphPeople[4]] },
    { person: demoGraphPeople[1], follows: [demoGraphPeople[3]] },
  ] : []);
};
export const discover = async (actor: string | undefined, view: DiscoveryView, page = 0, circle = 0, cursor?: string): Promise<DiscoveryResult> => {
  const result = resultBase(); let candidates: Connection[] = [];
  const directory = !config().demo ? await directoryHints() : undefined;
  if (config().demo) {
    const connected = actor ? await demoConnections(actor, view === 'extended') : [];
    candidates = view === 'explore' || !actor ? demoCreators.filter((p) => p.did !== actor).map((p) => connected.find((c) => c.did === p.did) || { did: p.did, following: false, follower: false, via: [] }) : connected;
  } else if (view === 'explore') {
    const offset = cursor?.startsWith('directory:') ? Number(cursor.slice(10)) : 0;
    if (directory?.dids.length && (!cursor || cursor.startsWith('directory:')) && Number.isSafeInteger(offset) && offset >= 0 && offset < directory.dids.length) {
      candidates = directory.dids.slice(offset, offset + 24).filter(did => did !== actor).map(did => ({ did, following: false, follower: false, via: [] }));
      result.nextCursor = offset + 24 < directory.dids.length ? `directory:${offset + 24}` : 'relay:';
      if (directory.partial) result.warnings.push('The public directory has partial coverage. Continue to the relay or look up an account directly.');
    } else {
    try {
      const relayCursor = cursor?.startsWith('relay:') ? cursor.slice(6) : cursor?.startsWith('directory:') ? undefined : cursor;
      const data = z.object({ repos: z.array(z.object({ did: graphPersonSchema.shape.did })).max(2000), cursor: z.string().max(2048).optional() }).parse(await publicJson(xrpcUrl(config().discoveryRelay, 'com.atproto.sync.listReposByCollection', { collection: `${NS}.profile`, limit: '24', ...(relayCursor ? { cursor: relayCursor } : {}) })));
      candidates = [...new Set(data.repos.map((r) => r.did))].filter((did) => did !== actor).map((did) => ({ did, following: false, follower: false, via: [] }));
      result.nextCursor = data.cursor && data.cursor !== relayCursor ? `relay:${data.cursor}` : undefined;
    } catch { result.warnings.push('The public directory is unavailable. Your Bluesky network and direct handle search are independent of this directory.'); return result; }
    }
  } else if (actor) {
    const graphs = await Promise.allSettled([readGraph(actor, actor, 'follows'), readGraph(actor, actor, 'followers')]);
    if (graphs.some((g) => g.status === 'rejected')) { result.warnings.push('Part of your Bluesky network could not be loaded. Reconnect your account or retry; missing results do not mean someone has no Feedme.'); }
    const follows = graphs[0].status === 'fulfilled' ? graphs[0].value.people : [];
    const followers = graphs[1].status === 'fulfilled' ? graphs[1].value.people : [];
    if (graphs.some((g) => g.status === 'fulfilled' && g.value.limited)) result.warnings.push('This search covers up to 1,000 follows and 1,000 followers. Larger networks are only partially searched.');
    let branches: { person: GraphPerson; follows: GraphPerson[] }[] = [];
    if (view === 'extended') {
      const mutuals = new Set(followers.filter(visiblePerson).map((p) => p.did));
      const seeds = follows.filter(visiblePerson).sort((a,b) => Number(mutuals.has(b.did)) - Number(mutuals.has(a.did)) || a.did.localeCompare(b.did));
      const batch = seeds.slice(circle * 6, (circle + 1) * 6); result.moreCircles = seeds.length > (circle + 1) * 6;
      const graphs = await mapConcurrent(batch, async (person) => ({ person, graph: await readGraph(actor, person.did, 'follows', 1) }));
      branches = graphs.flatMap((g) => g.status === 'fulfilled' ? [{ person: g.value.person, follows: g.value.graph.people }] : []);
      result.warnings.push(`Searching the first 100 follows of ${batch.length} people you follow. Mutual connections are checked first; try the next circle to expand your search.`);
      if (graphs.some((g) => g.status === 'rejected')) result.warnings.push('Some connections could not be searched this time.');
    }
    candidates = connections(actor, follows, followers, branches);
  }
  candidates = candidates.filter((c) => inView(c, view)); result.candidates = candidates.length;
  if (directory && view !== 'explore') {
    const known = new Set(directory.dids);
    const rank = (c: Connection) => (c.following && c.follower ? 10000 : c.following ? 5000 : c.follower ? 3000 : 0) + (known.has(c.did) ? 500 : 0) + c.via.length;
    candidates.sort((a,b) => rank(b) - rank(a) || a.did.localeCompare(b.did));
  }
  const batch = config().demo ? candidates : candidates.slice(view === 'explore' ? 0 : page * 24, view === 'explore' ? 24 : (page + 1) * 24);
  result.checked = batch.length; result.more = view !== 'explore' && candidates.length > (page + 1) * 24;
  const profiles = await mapConcurrent(batch, async (connection) => {
    const creator = await discoverCreator(connection.did); return creator ? { ...creator, connection } : null;
  });
  result.cards = profiles.flatMap((p) => p.status === 'fulfilled' && p.value ? [p.value] : []);
  if (profiles.some((p) => p.status === 'rejected')) result.warnings.push('Some public profiles could not be checked. Try again later.');
  if (!config().demo && result.cards.length) {
    // Rehydrate in the viewer's context, including second-degree and directory results.
    // If moderation cannot be checked, do not display unfiltered suggestions.
    try {
      const request = actor ? await socialClient(actor) : undefined;
      const ids = result.cards.map((c) => c.did);
      const data = z.object({ profiles: z.array(graphPersonSchema) }).parse(request
        ? await request('app.bsky.actor.getProfiles', { actors: ids }, false, true)
        : await publicJson(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?${new URLSearchParams(ids.map((did) => ['actors', did]))}`));
      const visible = new Map(data.profiles.filter(visiblePerson).map((p) => [p.did, p]));
      result.cards = result.cards.filter((c) => visible.has(c.did)).map((c) => { const p = visible.get(c.did)!; return { ...c, connection: { ...c.connection, following: c.connection.following || Boolean(p.viewer?.following), follower: c.connection.follower || Boolean(p.viewer?.followedBy) }, name: p.displayName || p.handle, handle: p.handle, avatar: p.labels?.some((label) => !label.neg) ? undefined : safeWebUrl(p.avatar || '') || undefined }; });
    } catch { result.cards = []; result.warnings.push('Bluesky visibility checks are unavailable. Suggestions will return when the connection recovers.'); }
  }
  return result;
};

export const searchCreator = async (input: string, actor?: string): Promise<DiscoveryResult> => {
  const result = resultBase(); const handle = input.trim().replace(/^@/, '');
  if (config().demo) {
    const c = demoCreators.find((c) => c.handle === handle || c.did === handle);
    if (c) result.cards = [{ ...c, connection: { did: c.did, following: false, follower: false, via: [] } }];
    return result;
  }
  let did = handle;
  if (!handle.startsWith('did:')) {
    if (!/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(handle)) { result.warnings.push('Enter a full Bluesky handle, such as you.bsky.social.'); return result; }
    try { did = z.object({ did: graphPersonSchema.shape.did }).parse(await publicJson(xrpcUrl('https://public.api.bsky.app', 'com.atproto.identity.resolveHandle', { handle: handle.toLowerCase() }))).did; }
    catch { result.warnings.push('That Bluesky handle could not be resolved. Check its spelling or try again.'); return result; }
  }
  try {
    const creator = await discoverCreator(did);
    if (!creator) return result;
    const request = actor ? await socialClient(actor) : undefined;
    const person = graphPersonSchema.parse(request ? await request('app.bsky.actor.getProfile', { actor: did }, false, true) : await publicJson(xrpcUrl('https://public.api.bsky.app', 'app.bsky.actor.getProfile', { actor: did })));
    if (person.did === did && visiblePerson(person)) result.cards = [{ ...creator, handle: person.handle, name: person.displayName || person.handle, avatar: person.labels?.some((label) => !label.neg) ? undefined : safeWebUrl(person.avatar || '') || undefined, connection: { did, following: Boolean(person.viewer?.following), follower: Boolean(person.viewer?.followedBy), via: [] } }];
  } catch { result.warnings.push('This account’s Feedme profile could not be verified right now. Please retry later.'); }
  return result;
};
