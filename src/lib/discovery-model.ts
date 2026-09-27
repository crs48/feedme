import { z } from 'zod';
import { didSchema } from './model';

export const graphPersonSchema = z.object({
  did: didSchema, handle: z.string().max(253), displayName: z.string().max(640).optional(), avatar: z.string().optional(),
  labels: z.array(z.object({ val: z.string(), neg: z.boolean().optional() })).optional(),
  viewer: z.object({ following: z.string().optional(), followedBy: z.string().optional(), muted: z.boolean().optional(), blocking: z.string().optional(), blockingByList: z.unknown().optional(), blockedBy: z.boolean().optional() }).optional(),
});
export type GraphPerson = z.infer<typeof graphPersonSchema>;
export type Connection = { did: string; following: boolean; follower: boolean; via: { did: string; name: string }[] };
export const visiblePerson = (p: GraphPerson) => !p.viewer?.muted && !p.viewer?.blocking && !p.viewer?.blockingByList && !p.viewer?.blockedBy && !p.labels?.some((label) => !label.neg && ['!hide', '!no-unauthenticated', 'porn', 'sexual', 'nudity', 'graphic-media'].includes(label.val));
export const connections = (actor: string, follows: GraphPerson[], followers: GraphPerson[], branches: { person: GraphPerson; follows: GraphPerson[] }[] = []): Connection[] => {
  const following = new Set(follows.filter(visiblePerson).map((p) => p.did));
  const follower = new Set(followers.filter(visiblePerson).map((p) => p.did));
  const excluded = new Set([...follows, ...followers].filter((p) => !visiblePerson(p)).map((p) => p.did));
  const result = new Map<string, Connection>();
  const add = (did: string, via?: GraphPerson) => {
    if (did === actor || excluded.has(did)) return;
    const c = result.get(did) || { did, following: following.has(did), follower: follower.has(did), via: [] };
    if (via && !c.via.some((p) => p.did === via.did)) c.via.push({ did: via.did, name: via.displayName || via.handle });
    result.set(did, c);
  };
  [...following, ...follower].forEach((did) => add(did));
  branches.filter(({ person }) => following.has(person.did) && visiblePerson(person)).forEach(({ person, follows }) => follows.filter(visiblePerson).forEach((p) => add(p.did, person)));
  const score = (c: Connection) => (c.following && c.follower ? 10000 : c.following ? 5000 : c.follower ? 3000 : 0) + c.via.length * 10;
  return [...result.values()].sort((a, b) => score(b) - score(a) || a.did.localeCompare(b.did));
};
export const connectionReason = (c: Connection) => c.following && c.follower ? 'You follow each other' : c.following ? 'You follow on Bluesky' : c.follower ? 'Follows you on Bluesky' : c.via.length ? `Followed by ${c.via[0].name}${c.via.length > 1 ? ` and ${c.via.length - 1} more in this search` : ''}` : 'On the Feedme network';
export type DiscoveryView = 'network' | 'following' | 'mutuals' | 'followers' | 'extended' | 'explore';
export const inView = (c: Connection, view: DiscoveryView) => view === 'following' ? c.following : view === 'followers' ? c.follower : view === 'mutuals' ? c.following && c.follower : view === 'extended' ? !c.following && c.via.length > 0 : true;
