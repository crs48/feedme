import type { DirectoryCreator as Card } from '../../src/lib/directory-model';
const data = document.querySelector('#directory-search-data')?.textContent;
const form = document.querySelector<HTMLFormElement>('[data-directory-search]');
const grid = document.querySelector<HTMLElement>('[data-directory-grid]');
const input = document.querySelector<HTMLInputElement>('#creator-search');
const DAY = 86_400_000;
const freshness = document.querySelector<HTMLElement>('[data-directory-generated]');
if (freshness && Date.now() - Date.parse(freshness.dataset.directoryGenerated || '') > 2 * DAY) {
  const warning = document.querySelector<HTMLElement>('[data-directory-stale]'); if (warning) warning.hidden = false;
}
if (data && form && grid && input) {
  const cards: Card[] = JSON.parse(data);
  const count = document.querySelector('[data-search-count]');
  const empty = document.querySelector<HTMLElement>('[data-empty-search]');
  const pagination = document.querySelector<HTMLElement>('[data-directory-pagination]');
  const element = (tag: string, className: string, text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
  const link = (text: string, href: string, className: string) => { const node = document.createElement('a'); node.textContent = text; node.href = href; node.className = className; node.rel = 'noopener noreferrer'; return node; };
  const render = (c: Card) => {
    const card = element('article', 'directory-card'); card.dataset.creatorDid = c.did;
    const top = element('div', 'directory-card-top');
    const age = c.lastVerifiedAt ? Date.now() - Date.parse(c.lastVerifiedAt) : Infinity;
    const recent = age >= -300_000 && age <= 2 * DAY;
    const available = c.siteStatus === 'reachable' && recent;
    const avatar = element('span', 'directory-avatar', Array.from(c.name.trim())[0]?.toUpperCase() || ''); avatar.setAttribute('aria-hidden', 'true');
    if (c.avatar) {
      const image = element('span', 'directory-avatar-image');
      image.style.backgroundImage = `url(${JSON.stringify(c.avatar)})`;
      avatar.append(image);
    }
    top.append(avatar, element('span', `directory-status${available ? '' : ' unavailable'}`, available ? 'Website checked' : c.siteStatus === 'unreachable' ? 'Currently unreachable' : 'Needs a fresh check'));
    // DIDs are validated when the snapshot is built; Bluesky expects literal colons.
    card.append(top, element('h3', '', c.name), link(c.handle ? `@${c.handle}` : 'View AT Protocol account ↗', `https://bsky.app/profile/${c.did}`, 'directory-handle'), element('p', 'directory-bio', c.bio));
    const bottom = element('div', 'directory-card-bottom');
    bottom.append(c.url && available ? link('Visit Feedme ↗', c.url, 'button secondary') : element('span', 'directory-no-link', 'Website link withheld until rechecked.'));
    if (c.lastVerifiedAt) bottom.append(element('small', '', `Last verified ${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(c.lastVerifiedAt))} UTC`));
    card.append(bottom); return card;
  };
  // Re-evaluate old static pages in the visitor's clock, including before search.
  const byDid = new Map(cards.map(c => [c.did, c]));
  const initial = [...grid.querySelectorAll<HTMLElement>('[data-creator-did]')].flatMap(node => {
    const card = byDid.get(node.dataset.creatorDid || ''); return card ? [render(card)] : [];
  });
  grid.replaceChildren(...initial.map(node => node.cloneNode(true)));
  const search = () => {
    const term = input.value.trim().toLocaleLowerCase();
    if (!term) { grid.replaceChildren(...initial.map(node => node.cloneNode(true))); if (count) count.textContent = ''; if (empty) empty.hidden = true; if (pagination) pagination.hidden = false; return; }
    const matching = cards.filter(c => `${c.name} ${c.handle || ''} ${c.url || ''}`.toLocaleLowerCase().includes(term));
    grid.replaceChildren(...matching.slice(0, 100).map(render));
    if (count) count.textContent = `${matching.length} ${matching.length === 1 ? 'creator' : 'creators'} found${matching.length > 100 ? ' · Showing the first 100. Refine your search to see more.' : ''}`;
    if (empty) empty.hidden = matching.length > 0; if (pagination) pagination.hidden = true;
  };
  form.hidden = false; input.addEventListener('input', search);
  form.addEventListener('submit', event => { event.preventDefault(); search(); });
  form.addEventListener('reset', () => { input.value = ''; search(); });
}
