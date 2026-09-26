import type { Friend, Profile, Project, Support, Update } from './model';

const createdAt = '2026-09-20T12:00:00.000Z';
export const demoProfile: Profile = {
  name: 'Alex Rivers', handle: 'alex.example.com',
  bio: 'Making things for a slower, more connected world. A little code, a little sawdust, and a lot of curiosity. Help me make room for what comes next.',
  location: 'Portland, Oregon', website: '',
};
export const demoProjects: Project[] = [
  { id: 'backyard-sauna', title: 'A little sauna, a lot of community', summary: 'Turning a corner of the backyard into a place to unplug, warm up, and reconnect.', description: 'I’m building a small wood-fired sauna with reclaimed cedar and a few very generous friends. The dream is simple: a warm place to gather, leave our phones at the door, and spend a little more time together.\n\nYour support helps with reclaimed timber, insulation, and the stove. Every bit helps me spend another afternoon making this real. There’s no all-or-nothing finish line — just one good piece of work at a time.', category: 'Making', kind: 'project', status: 'active', color: 'peach', target: 250000, image: '', link: '', createdAt },
  { id: 'open-source', title: 'Small tools. Open to everyone.', summary: 'Useful little software projects that belong to the people who use them.', description: 'More time for open source, less time chasing the next contract. I’m building small, thoughtful tools for everyday life and sharing everything I learn along the way.\n\nSupport here buys me time to write documentation, fix the unglamorous bugs, and make the internet feel a little more human.', category: 'Open source', kind: 'ongoing', status: 'active', color: 'blue', target: 100000, image: '', link: '', createdAt },
  { id: 'field-notes', title: 'Notes from the in-between', summary: 'Essays about making a life, not just a living. Delivered with a little dirt under the fingernails.', description: 'A practice of noticing. I’m writing about creativity, community, and the things we discover when we slow down. Your encouragement helps me protect time each week to sit, think, and put something honest on the page.', category: 'Writing', kind: 'ongoing', status: 'active', color: 'green', target: 50000, image: '', link: '', createdAt },
];
export const demoUpdates: Update[] = [
  { id: '98d3c0e0-87f3-4d8e-82a2-91cf8b668a31', projectId: 'backyard-sauna', text: 'The first wall is up! We spent Sunday sorting reclaimed cedar, drinking too much coffee, and remembering how to use a spirit level. It’s starting to feel like a real place.', createdAt: '2026-09-24T15:00:00.000Z' },
  { id: '98d3c0e0-87f3-4d8e-82a2-91cf8b668a32', projectId: 'open-source', text: 'A small milestone: the new offline mode is ready. Thanks to everyone who made a little more time for this work possible.', createdAt: '2026-09-22T15:00:00.000Z' },
];
export const demoFriends: Friend[] = [
  { id: '68d3c0e0-87f3-4d8e-82a2-91cf8b668a31', name: 'The neighborhood garden', did: 'did:plc:dddddddddddddddddddddddd', url: 'https://example.com/garden', description: 'Growing good food and better friendships, one Saturday at a time.' },
  { id: '68d3c0e0-87f3-4d8e-82a2-91cf8b668a32', name: 'An independent press', did: 'did:plc:eeeeeeeeeeeeeeeeeeeeeeee', url: 'https://example.com/press', description: 'Small books with big feelings. Stories that deserve a little more room.' },
];
export const demoSupports: Support[] = [
  ...Array.from({ length: 12 }, (_, i) => ({ projectId: 'backyard-sauna', amount: i === 0 ? 25000 : 7500 })),
  ...Array.from({ length: 8 }, () => ({ projectId: 'open-source', amount: 5000 })),
  ...Array.from({ length: 6 }, () => ({ projectId: 'field-notes', amount: 2500 })),
].map((s, i) => ({ ...s, id: `demo-${i}`, currency: 'usd', visibility: 'public', supporterDid: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', note: '', status: 'paid', refundedAmount: 0, disputed: false, createdAt }));
