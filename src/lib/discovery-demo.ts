import { demoPerson } from './demo-media';
import type { CreatorProfile } from './public-repo';
import type { GraphPerson } from './discovery-model';

export const demoCreators: CreatorProfile[] = [
  ['d', 'maya.example.com', 'Community gardens, shared meals, and places to gather.'],
  ['e', 'jamie.example.com', 'Small books and independent stories with room to breathe.'],
  ['c', 'jordan.example.com', 'Open tools for a kinder, more useful internet.'],
  ['b', 'sam.example.com', 'Field recordings and songs made a little closer to home.'],
  ['f', 'devon.example.com', 'Making useful things from wood, clay, and curiosity.'],
].map(([letter, handle, bio]) => { const did = `did:plc:${letter.repeat(24)}`; const person = demoPerson(did)!; return { did, name: person.name, handle, bio, avatar: person.avatar, url: `https://${handle}` }; });
export const demoGraphPeople: GraphPerson[] = demoCreators.map((p) => ({ did: p.did, handle: p.handle, displayName: p.name, avatar: p.avatar }));
