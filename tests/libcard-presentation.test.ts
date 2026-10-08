import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLibcard, libcardSnapshotSchema, type LibcardSnapshot } from '../src/lib/libcard-schema';
import { libcardCatalog, sampleLibcardGoal } from '../src/lib/libcard-catalog';
import { cachedGithubStars, githubRepo, refreshGithubStars } from '../src/lib/libcard-github';
import { openDatabase, setKv } from '../src/lib/db';
import type { Project } from '../src/lib/model';

import { groupForItem, pickGroups } from '../src/lib/pick-groups';

const source = { repo: 'test/card', ref: 'main' };
const text = `profile: {name: Chris}
links:
  - {label: xNet, url: 'https://xnet.fyi', icon: network, github: 'https://github.com/crs48/xNet', stars: build}
  - {label: Cause, url: 'https://github.com/crs48/cause', icon: git-merge, star: true, stars: badge}
socials: [{platform: bluesky, url: 'https://bsky.app/profile/crs.land'}]`;
const snapshot = (): LibcardSnapshot => ({ source, document: parseLibcard(text, source), hash: 'a'.repeat(64), checkedAt: new Date().toISOString() });
afterEach(() => { vi.useRealTimers(); });

describe('LibCard catalog presentation', () => {
  it('keeps supported source statuses for grouping without changing target identity or order', () => {
    const data = snapshot();
    const statuses = ['ready', 'wip', 'writing', 'reading', 'experiment', 'exploration', 'dormant', 'custom'];
    data.document = parseLibcard(`profile: {name: Chris}\nlinks:\n${statuses.map((status, n) => `  - {label: Item ${n}, url: 'https://example.com/${n}', status: ${status}}`).join('\n')}`, source);
    expect(data.document.items.map(groupForItem)).toEqual([...statuses.slice(0, -1), 'other']);
    const catalog = libcardCatalog(data);
    const grouped = pickGroups.flatMap(group => catalog.filter(item => groupForItem(item) === group.id));
    expect(grouped.map(item => item.targetId)).toEqual(catalog.map(item => item.targetId));
    expect(libcardCatalog({ ...data, document: { ...data.document, items: data.document.items.map(item => ({ ...item, status: undefined })) } }).map(item => item.targetId)).toEqual(catalog.map(item => item.targetId));
    for (const catalogVersion of [2, 3]) expect(libcardSnapshotSchema.parse({ ...data, catalogVersion }).document.items).toEqual(data.document.items);
  });
  it('retains source titles, icons, companion repositories and star modes', () => {
    const items = snapshot().document.items;
    expect(items[0]).toMatchObject({ label: 'xNet', icon: 'network', github: 'https://github.com/crs48/xNet', stars: 'build' });
    expect(items[1]).toMatchObject({ icon: 'git-merge', star: true, stars: 'badge' });
    expect(items[2]).toMatchObject({ icon: 'bluesky', kind: 'social' });
    expect(() => parseLibcard(text.replace('icon: network', 'icon: "<svg onload=alert(1)>"'), source)).toThrow();
    expect(() => parseLibcard(text.replace('https://github.com/crs48/xNet', 'https://attacker.test/crs48/xNet'), source)).toThrow();
  });
  it('makes every link selectable by default with stable IDs, while retaining explicit and isolated preview modes', () => {
    const data = snapshot();
    expect(libcardCatalog(data, 'explicit').every(i => !i.targetId)).toBe(true);
    const live = libcardCatalog(data);
    expect(live.every(i => i.targetId?.startsWith('auto-') && !i.demoOnly)).toBe(true);
    const renamed = { ...data, document: { ...data.document, items: [...data.document.items].reverse().map(i => ({ ...i, label: `New ${i.label}` })) } };
    expect(libcardCatalog(renamed).map(i => i.targetId).reverse()).toEqual(live.map(i => i.targetId));
    const projected = libcardCatalog(data, 'preview');
    expect(projected.every(i => i.targetId && i.demoOnly)).toBe(true);
    expect(projected.every(i => !live.some(l => l.targetId === i.targetId))).toBe(true);
    expect(libcardCatalog(renamed, 'preview').map(i => i.targetId).reverse()).toEqual(projected.map(i => i.targetId));
    expect(data.document.items.every(i => !i.feedme)).toBe(true);
    const repeated = libcardCatalog({ ...data, document: { ...data.document, items: [data.document.items[0], data.document.items[0]] } });
    expect(new Set(repeated.map(i => i.targetId)).size).toBe(2);
  });
  it('keeps every link visible while limiting generated allocations to 99 and preserving explicit opt-ins', () => {
    const data = snapshot();
    data.document.items = Array.from({ length: 110 }, (_, n) => ({ label: `Link ${n}`, url: `https://example.test/${n}`, kind: 'link' }));
    data.document.items[109].feedme = { id: 'explicit', blurb: '' };
    const catalog = libcardCatalog(data);
    expect(catalog).toHaveLength(110); expect(catalog.filter(i => i.targetId)).toHaveLength(99);
    expect(catalog[109].targetId).toBe('explicit'); expect(catalog[109].demoOnly).toBeUndefined();
  });
  it('keeps randomized goals stable, honors local overrides, and includes beyond-goal examples', () => {
    const p = { id: 'presence', target: 0, libcard: { aspirationOverride: undefined } } as Project;
    expect(sampleLibcardGoal(p)).toEqual(sampleLibcardGoal(p));
    expect(sampleLibcardGoal({ ...p, target: 170000 })?.goal).toBe(170000);
    expect(sampleLibcardGoal({ ...p, libcard: { ...p.libcard!, aspirationOverride: 0 } })).toBeUndefined();
    expect(Array.from({ length: 30 }, (_, n) => sampleLibcardGoal({ ...p, id: `demo-${n}` })!).some(g => g.amount > g.goal)).toBe(true);
  });
});

describe('public GitHub star metadata', () => {
  it('accepts only repository roots on GitHub and honors counts-off', () => {
    const item = snapshot().document.items[0];
    expect(githubRepo(item)).toEqual({ repo: 'crs48/xNet', url: 'https://github.com/crs48/xNet', showCount: true });
    expect(githubRepo({ ...item, stars: 'off' })?.showCount).toBe(false);
    for (const github of ['https://github.com/crs48', 'https://github.com/orgs/foo', 'https://github.com/a/b/issues', 'https://github.com@evil.test/a/b', 'http://127.0.0.1/a/b', 'https://github.com/a/..']) expect(githubRepo({ ...item, github })).toBeUndefined();
  });
  it('deduplicates requests, caches real zero counts, and preserves last-good values on errors', async () => {
    const db = openDatabase(':memory:');
    try {
      const item = snapshot().document.items[0];
      const fetcher = vi.fn<typeof fetch>(async () => Response.json({ stargazers_count: 0 }));
      await refreshGithubStars(db, [item, item], fetcher);
      await refreshGithubStars(db, [item], fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toBe('https://api.github.com/repos/crs48/xnet');
      expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
      expect(cachedGithubStars(db, 'crs48/xNet')?.count).toBe(0);
      setKv(db, 'libcard-github', 'crs48/xnet', { count: 31, checkedAt: '2020-01-01T00:00:00.000Z', attemptedAt: '2020-01-01T00:00:00.000Z' });
      await refreshGithubStars(db, [item], async () => new Response('rate limit', { status: 403 }));
      expect(cachedGithubStars(db, 'crs48/xNet')?.count).toBe(31);
      const retry = vi.fn(); await refreshGithubStars(db, [item], retry); expect(retry).not.toHaveBeenCalled();
    } finally { db.close(); }
  });
  it('never invents a count when GitHub is unavailable, invalid, or oversized', async () => {
    for (const response of [new Response('offline', { status: 503 }), Response.json({ stargazers_count: -2 }), Response.json({ stargazers_count: '42' }), new Response('x'.repeat(65537))]) {
      const db = openDatabase(':memory:');
      try { await refreshGithubStars(db, [snapshot().document.items[0]], async () => response); expect(cachedGithubStars(db, 'crs48/xnet')?.count).toBeUndefined(); }
      finally { db.close(); }
    }
  });
});
