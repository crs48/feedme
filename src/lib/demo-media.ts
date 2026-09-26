// Bundled stock photography for fictional demo identities only. See public/demo/CREDITS.md.
const people: Record<string, { name: string; avatar: string }> = {
  'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa': { name: 'Alex Rivers', avatar: '/demo/avatars/12.jpg' },
  'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb': { name: 'Sam Taylor', avatar: '/demo/avatars/13.jpg' },
  'did:plc:cccccccccccccccccccccccc': { name: 'Jordan Lee', avatar: '/demo/avatars/5.jpg' },
  'did:plc:dddddddddddddddddddddddd': { name: 'Maya Chen', avatar: '/demo/avatars/47.jpg' },
  'did:plc:eeeeeeeeeeeeeeeeeeeeeeee': { name: 'Jamie Morgan', avatar: '/demo/avatars/44.jpg' },
  'did:plc:ffffffffffffffffffffffff': { name: 'Devon Brooks', avatar: '/demo/avatars/49.jpg' },
};
export const demoPerson = (did: string) => people[did];
export const demoSupporters = Object.keys(people).slice(1);

const covers: Record<string, { url: string; alt: string }> = {
  'backyard-sauna': { url: '/demo/projects/sauna.webp', alt: 'A small wooden sauna in a snowy forest clearing' },
  'open-source': { url: '/demo/projects/coding.webp', alt: 'An open laptop showing code on a wooden desk' },
  'field-notes': { url: '/demo/projects/writing.webp', alt: 'An open notebook and pencils, ready for a new idea' },
};
export const demoCover = (projectId: string) => covers[projectId];
export const demoImageSources = (url: string) => /^\/demo\/projects\/(sauna|coding|writing)\.webp$/.test(url)
  ? `${url.replace('.webp', '-small.webp')} 480w, ${url} 960w` : undefined;
// Only the original illustrative notes receive sample media; authored posts stay untouched.
const noteProjects: Record<string, string> = {
  '98d3c0e0-87f3-4d8e-82a2-91cf8b668a31': 'backyard-sauna',
  '98d3c0e0-87f3-4d8e-82a2-91cf8b668a32': 'open-source',
};
export const demoNoteImages = (id: string) => {
  const image = demoCover(noteProjects[id]);
  return image ? [image] : [];
};
