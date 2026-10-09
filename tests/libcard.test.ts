import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { assertLibcardResponse } from '../scripts/libcard-contract.mjs';
const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined, demo: false, enabled: true, remoteDemo: false, defaultSupport: 'explicit' as 'all' | 'explicit' }));
const source = { repo: 'test/card', ref: 'main' };
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: state.demo, libcardRemoteDemo: state.remoteDemo, libcardDefaultSupport: state.defaultSupport, identities: { owner: 'crs.land' }, libcard: state.enabled ? { repo: 'test/card', ref: 'main' } : undefined, ownerDid: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', origin: 'https://feedme.example', defaultTipAmount: 4400 }) }));
vi.mock('../src/lib/db', async original => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => state.db! }));
import { openDatabase, getKv, setKv, listRecords, putRecord, readRecord, pendingWrites } from '../src/lib/db';
import { avatarUrl, parseLibcard, sourceKey, type LibcardSnapshot } from '../src/lib/libcard-schema';
import { libcardFixture } from '../src/lib/libcard-fixture';
import { importLibcard, libcardSnapshot, libcardTargets, libcardProfile, loadLibcardSnapshot, overrideLibcard, refreshLibcard } from '../src/lib/libcard';
import { publicLibcard } from '../src/lib/libcard-public';
import { libcardCatalog } from '../src/lib/libcard-catalog';
import { projectSchema, type Project, type Support } from '../src/lib/model';
import { prepareRecovery } from '../src/lib/recovery-tracking';
import { parsePortableValue, recoveryEnvelope, supportRecoverySchema } from '../src/lib/recovery-model';
import { queueSupport } from '../src/lib/support-ledger';
import { picksFromForm, prefillPicks } from '../src/lib/picks';
import { validatePickReview, type PickReview } from '../src/lib/pick-checkout';
import { saveProject, projects } from '../src/lib/repository';
import { GET } from '../src/pages/api/public/libcard';
import type { APIContext } from 'astro';
const snapshot = (): LibcardSnapshot => ({ source, document: parseLibcard(libcardFixture, source), hash: 'a'.repeat(64), checkedAt: new Date().toISOString() });
const consumerYaml = readFileSync(new URL('./fixtures/libcard/enabled.config.yaml', import.meta.url), 'utf8');
const tip = (id: string, extra: Partial<Support> = {}): Support => ({ id, projectId: 'creator', amount: 2200, currency: 'usd', visibility: 'public', supporterDid: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', note: 'PRIVATE NOTE', status: 'paid', refundedAmount: 0, disputed: false, createdAt: new Date().toISOString(), picks: [{ projectId: 'creator', count: 1 }], ...extra });
beforeEach(() => { state.db = openDatabase(':memory:'); state.enabled = true; state.demo = false; state.remoteDemo = false; state.defaultSupport = 'explicit'; });
afterEach(() => { state.db!.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('LibCard parser and managed import', () => {
  it.each(['links', 'socials'])('accepts exact skip shapes and preserves ordinary opt-ins in %s', field => {
    const item = field === 'links' ? { label: 'Card link', url: 'https://example.com/link' } : { platform: 'x', url: 'https://x.com/example' };
    const doc = (feedme: unknown) => parseLibcard(stringify({ profile: { name: 'Alex' }, [field]: [{ ...item, feedme }] }), source);
    expect(doc({ skip: true }).items[0].feedme).toEqual({ skip: true });
    expect(doc({ id: 'one' }).items[0].feedme).toEqual({ id: 'one', blurb: '' });
    expect(doc({ skip: false, id: 'one', blurb: ' More of this. ', aspiration: 1200 }).items[0].feedme)
      .toEqual({ skip: false, id: 'one', blurb: 'More of this.', aspiration: 1200 });
    for (const extra of [{ id: 'one' }, { blurb: '' }, { aspiration: 0 }, { id: 'one', blurb: 'Words', aspiration: 1 }])
      expect(() => doc({ skip: true, ...extra })).toThrow('skip: true');
    for (const invalid of [{ skip: true, extra: true }, { skip: false }, {}, { skip: 'true' }, { skip: 1 }, { skip: null }, { skip: false, id: 'creator' }, { skip: false, id: 'amount' }, { skip: false, id: 'Not a slug' }])
      expect(() => doc(invalid)).toThrow();
  });
  it.each(['all', 'explicit'] as const)('excludes skipped links and socials from import, checkout, and public signal in %s mode', async mode => {
    state.defaultSupport = mode;
    const initial = snapshot(); importLibcard(state.db!, initial);
    const presence = readRecord<Project>(state.db!, 'project', 'presence')!;
    overrideLibcard(state.db!, 'presence', false, 120000);
    const recurring = tip('recurring', { frequency: 'monthly', subscriptionId: 'sub-original', picks: [{ projectId: 'presence', count: 3 }, { projectId: 'x', count: 2 }, { projectId: 'creator', count: 1 }] });
    putRecord(state.db!, 'support', recurring.id, recurring);
    const skipped: LibcardSnapshot = { ...initial, document: { ...initial.document, items: initial.document.items.map(item => ['presence', 'x'].includes(item.feedme?.id || '') ? { ...item, feedme: { skip: true } } : item) } };
    importLibcard(state.db!, skipped);
    expect(libcardCatalog(skipped, mode).some(item => item.feedme?.skip)).toBe(false);
    expect(readRecord<Project>(state.db!, 'project', 'presence')).toMatchObject({ createdAt: presence.createdAt, status: 'archived', target: 120000, libcard: { present: false, hidden: false } });
    expect(readRecord<Project>(state.db!, 'project', 'x')).toMatchObject({ status: 'archived', libcard: { present: false } });
    const ids = libcardTargets().map(p => p.id);
    expect(ids).not.toContain('presence'); expect(ids).not.toContain('x'); expect(ids).toContain('creator');
    expect(prefillPicks(new URLSearchParams('presence=1&x=1'), ids, 4400)).toMatchObject({ picks: [], removed: true });
    const forged = new FormData(); forged.set('pick:presence', '1');
    expect(() => picksFromForm(forged, ids)).toThrow('target list changed');
    expect(() => validatePickReview({} as APIContext, { ...recurring } as unknown as PickReview)).toThrow('no longer accepting picks');
    const body = await (await GET({} as APIContext)).json();
    expect(body.targets.some((t: { id: string }) => ['presence', 'x'].includes(t.id))).toBe(false);
    expect(body.targets[0]).toMatchObject({ id: 'creator', publicCount: 1, publicShareMillis: 1000 });
    expect(readRecord(state.db!, 'support', recurring.id)).toEqual(recurring);
    // Even an old Studio form cannot reactivate a source-skipped project.
    overrideLibcard(state.db!, 'presence', false, 120000);
    expect(readRecord<Project>(state.db!, 'project', 'presence')?.status).toBe('archived');
    importLibcard(state.db!, initial);
    expect(readRecord<Project>(state.db!, 'project', 'presence')).toMatchObject({ createdAt: presence.createdAt, status: 'active', target: 120000 });
    expect(readRecord(state.db!, 'support', recurring.id)).toEqual(recurring);
  });
  it.each(['all', 'explicit'] as const)('imports only the creator when every source item is skipped in %s mode', mode => {
    state.defaultSupport = mode;
    const initial = snapshot();
    importLibcard(state.db!, { ...initial, document: { ...initial.document, items: initial.document.items.map(item => ({ ...item, feedme: { skip: true } })) } });
    expect(libcardTargets().map(p => p.id)).toEqual(['creator']);
    expect(listRecords<Project>(state.db!, 'project').map(p => p.id)).toEqual(['creator']);
    expect(libcardSnapshot()?.document.items).toHaveLength(initial.document.items.length);
  });
  it('restores the same automatic ID after a skip, keeping overrides and local hiding', () => {
    state.defaultSupport = 'all';
    const initial = snapshot(); importLibcard(state.db!, initial);
    const resume = libcardTargets().find(p => p.title === 'Résumé')!;
    const skipped: LibcardSnapshot = { ...initial, document: { ...initial.document, items: initial.document.items.map(item => item.label === 'Résumé' ? { ...item, feedme: { skip: true } } : item) } };
    overrideLibcard(state.db!, resume.id, false, 12300);
    importLibcard(state.db!, skipped);
    expect(readRecord<Project>(state.db!, 'project', resume.id)).toMatchObject({ status: 'archived', libcard: { present: false } });
    const saved = libcardSnapshot()!;
    const envelope = recoveryEnvelope('did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', '98d3c0e0-87f3-4d8e-82a2-91cf8b668a31', { table: 'kv', kind: 'libcard', key: 'snapshot' }, saved);
    expect(parsePortableValue(envelope, JSON.parse(envelope.json))).toEqual(saved);
    importLibcard(state.db!, initial);
    expect(libcardTargets().find(p => p.title === 'Résumé')).toMatchObject({ id: resume.id, createdAt: resume.createdAt, status: 'active', target: 12300 });
    overrideLibcard(state.db!, resume.id, true, 45600);
    importLibcard(state.db!, skipped); importLibcard(state.db!, initial);
    expect(readRecord<Project>(state.db!, 'project', resume.id)).toMatchObject({ status: 'archived', target: 45600, libcard: { present: true, hidden: true } });
  });
  it('imports all links and socials as real managed targets without editing the source', async () => {
    state.defaultSupport = 'all';
    const initial = snapshot(); importLibcard(state.db!, initial);
    expect(libcardTargets().map(p => p.title)).toEqual(['Just Alex', ...initial.document.items.map(i => i.label)]);
    expect(libcardTargets()).toHaveLength(9);
    expect(libcardTargets().every(p => !p.libcard?.demoOnly)).toBe(true);
    expect(libcardSnapshot()?.document).toEqual(initial.document);
    const api = await (await GET({} as APIContext)).json();
    assertLibcardResponse(api, 'https://feedme.example');
    expect(api.targets.map((t: { id: string }) => t.id)).toEqual(libcardTargets().map(p => p.id));
    expect(api.targets.every((t: { publicCount: number }) => t.publicCount === 0)).toBe(true);
    expect(pendingWrites(state.db!)).toEqual([]);
  });
  it('keeps automatic IDs, hidden state, aspirations and payment references through edits and removal', () => {
    state.defaultSupport = 'all';
    const initial = snapshot(); importLibcard(state.db!, initial);
    const target = libcardTargets().find(p => p.title === 'Résumé')!;
    putRecord(state.db!, 'support', 'original', tip('original', { picks: [{ projectId: target.id, count: 3 }] }));
    overrideLibcard(state.db!, target.id, true, 420000);
    const renamed = { ...initial, document: { ...initial.document, items: [...initial.document.items].reverse().map(i => i.label === 'Résumé' ? { ...i, label: 'New résumé' } : i) } };
    importLibcard(state.db!, renamed);
    expect(readRecord<Project>(state.db!, 'project', target.id)).toMatchObject({ title: 'New résumé', createdAt: target.createdAt, target: 420000, libcard: { hidden: true } });
    expect(libcardTargets().some(p => p.id === target.id)).toBe(false);
    importLibcard(state.db!, { ...initial, document: { ...initial.document, items: initial.document.items.filter(i => i.url !== target.libcard!.url) } });
    expect(readRecord<Project>(state.db!, 'project', target.id)?.libcard?.present).toBe(false);
    importLibcard(state.db!, initial);
    expect(readRecord<Project>(state.db!, 'project', target.id)).toMatchObject({ status: 'archived', target: 420000, libcard: { present: true, hidden: true } });
    expect(readRecord<Support>(state.db!, 'support', 'original')?.picks).toEqual([{ projectId: target.id, count: 3 }]);
  });
  it('imports the committed LibCard consumer fixture and ignores presentation-only configuration', async () => {
    const yaml = stringify({ ...parse(consumerYaml), feedme: { enabled: false, origin: 'https://a-different-card.example' },
      theme: 'default', statuses: { ready: 'Ready' }, cardMode: { enabled: true }, analytics: { enabled: false },
      footer: { text: 'Footer' }, seo: { title: 'SEO title' }, meta: { test: true }, contact: { email: 'test@example.com' },
    });
    const doc = parseLibcard(yaml, source);
    importLibcard(state.db!, { ...snapshot(), document: doc });
    expect(libcardTargets().map(p => [p.id, p.libcard?.kind])).toEqual([
      ['creator', 'creator'], ['presence', 'link'], ['open-source', 'link'], ['retired', 'link'], ['x', 'social'],
    ]);
    expect(doc.items[0]).toMatchObject({ icon: 'heart', feedme: { id: 'presence', aspiration: 3000, blurb: 'More hours in the room with people.' } });
    expect(doc.items[0].status).toBe('ready'); expect(doc).not.toHaveProperty('feedme'); expect(doc).not.toHaveProperty('site');
    expect(readRecord<Project>(state.db!, 'project', 'presence')).toMatchObject({ target: 300000, summary: 'More hours in the room with people.', libcard: { sourceAspiration: 300000 } });
    expect(readRecord<Project>(state.db!, 'project', 'x')).toMatchObject({ title: 'My writing on X', summary: 'More of this voice.' });
    expect(readRecord<Project>(state.db!, 'project', 'retired')?.summary).toBe('');
    overrideLibcard(state.db!, 'retired', true);
    const body = await (await GET({} as APIContext)).json();
    assertLibcardResponse(body, 'https://feedme.example');
    expect(body.targets.map((t: { id: string }) => t.id)).toEqual(['creator', 'presence', 'open-source', 'x']);
  });
  it('imports only explicitly opted-in links and socials, with a real creator project', () => {
    const doc = snapshot(); importLibcard(state.db!, doc);
    expect(libcardTargets().map(p => p.id)).toEqual(['creator','presence','nervous-system','pirate-age','xnet','x']);
    expect(doc.document.items.filter(i => !i.feedme).map(i => i.label)).toEqual(['Résumé','Rabbit holes','github']);
    expect(readRecord<Project>(state.db!, 'project', 'creator')).toMatchObject({ id: 'creator', title: 'Just Alex', libcard: { url: null, kind: 'creator' } });
    expect(projects()).toEqual([]); expect(projects(true)).toHaveLength(6); expect(pendingWrites(state.db!)).toEqual([]);
    expect(() => saveProject({ ...libcardTargets()[1], title: 'Changed' })).toThrow('From LibCard');
    expect(projectSchema.safeParse({ ...libcardTargets()[1], libcard: undefined, title: 'x' }).success).toBe(false);
  });
  it('rejects duplicate/reserved IDs, invalid opt-ins, unsafe URLs and YAML aliases', () => {
    for (const text of [libcardFixture.replace('id: xnet', 'id: presence'), libcardFixture.replace('id: xnet', 'id: creator'), libcardFixture.replace('id: xnet', 'id: amount'), libcardFixture.replace('aspiration: 3000', 'aspiration: 1.2'), libcardFixture.replace('https://example.com/xnet', 'javascript:alert(1)'), 'profile: {name: Alex, name: Pat}', 'profile: &p {name: Alex}\nlinks: [*p]']) expect(() => parseLibcard(text, source)).toThrow();
    expect(() => parseLibcard('x'.repeat(256 * 1024 + 1), source)).toThrow('256 KiB');
    const many = { ...snapshot().document, items: Array.from({ length: 100 }, (_, i) => ({ label: 'Link', url: 'https://example.com', kind: 'link', feedme: { id: `link-${i}`, blurb: '' } })) };
    expect(() => importLibcard(state.db!, { ...snapshot(), document: many as LibcardSnapshot['document'] })).toThrow();
  });
  it('rewrites avatars under public and drops unsafe paths', () => {
    expect(avatarUrl('/avatar.jpg', source)).toBe('https://raw.githubusercontent.com/test/card/main/public/avatar.jpg');
    expect(avatarUrl('images/me.png', source)).toContain('/public/images/me.png');
    expect(avatarUrl('https://example.com/me.jpg', source)).toBe('https://example.com/me.jpg');
    for (const value of ['//evil.example/a','../secret','%2e%2e/secret','data:image/png,x','http://example.com','a\\b','https://user:pass@example.com/a']) expect(avatarUrl(value, source)).toBeUndefined();
  });
  it('archives vanished IDs and preserves local overrides and attribution on reappearance', () => {
    const initial = snapshot(); importLibcard(state.db!, initial);
    const createdAt = readRecord<Project>(state.db!, 'project', 'presence')!.createdAt;
    overrideLibcard(state.db!, 'presence', true, 1200);
    importLibcard(state.db!, { ...initial, document: { ...initial.document, items: initial.document.items.filter(i => i.feedme?.id !== 'presence') } });
    expect(readRecord<Project>(state.db!, 'project', 'presence')).toMatchObject({ status: 'archived', libcard: { present: false, hidden: true } });
    importLibcard(state.db!, initial);
    expect(readRecord<Project>(state.db!, 'project', 'presence')).toMatchObject({ createdAt, target: 1200, status: 'archived', libcard: { present: true } });
    overrideLibcard(state.db!, 'presence', false);
    expect(libcardTargets().find(p => p.id === 'presence')?.target).toBe(300000);
    expect(() => overrideLibcard(state.db!, 'creator', true)).toThrow();
  });
  it('rolls back the whole import on a native ID collision', () => {
    putRecord(state.db!, 'project', 'presence', { id: 'presence', title: 'Native' });
    expect(() => importLibcard(state.db!, snapshot())).toThrow('native project');
    expect(readRecord(state.db!, 'project', 'creator')).toBeUndefined();
    expect(getKv(state.db!, 'libcard', 'snapshot')).toBeUndefined();
  });
});

describe('refresh and private recovery', () => {
  it('upgrades a restored legacy snapshot from cached data even if GitHub is unavailable', async () => {
    importLibcard(state.db!, snapshot());
    const saved = getKv<LibcardSnapshot>(state.db!, 'libcard', 'snapshot')!;
    setKv(state.db!, 'libcard', 'snapshot', { ...saved, targetMode: undefined });
    state.defaultSupport = 'all';
    setKv(state.db!, 'recovery', 'paused', true);
    expect(libcardTargets()).toHaveLength(6);
    setKv(state.db!, 'recovery', 'paused', false);
    await refreshLibcard(true, async () => { throw new Error('offline'); });
    expect(libcardTargets()).toHaveLength(9);
    expect(libcardSnapshot()).toMatchObject({ hash: saved.hash, checkedAt: saved.checkedAt, targetMode: 'all', document: saved.document });
    const restored = libcardSnapshot()!;
    const envelope = recoveryEnvelope('did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', '98d3c0e0-87f3-4d8e-82a2-91cf8b668a31', { table: 'kv', kind: 'libcard', key: 'snapshot' }, restored);
    expect(parsePortableValue(envelope, JSON.parse(envelope.json))).toEqual(restored);
  });
  it('applies default changes before a conditional 304 and preserves overrides across explicit mode', async () => {
    await refreshLibcard(true, async () => new Response(libcardFixture, { headers: { etag: '"same"' } }));
    state.defaultSupport = 'all';
    const unchanged = vi.fn<typeof fetch>(async () => new Response(null, { status: 304 }));
    await refreshLibcard(true, unchanged);
    expect(unchanged.mock.calls[0][1]?.headers).toEqual({ 'If-None-Match': '"same"' });
    const id = libcardTargets().find(p => p.title === 'Résumé')!.id;
    overrideLibcard(state.db!, id, true, 12300);
    state.defaultSupport = 'explicit'; expect(libcardTargets()).toHaveLength(6);
    state.defaultSupport = 'all'; expect(libcardTargets()).toHaveLength(8);
    expect(readRecord<Project>(state.db!, 'project', id)).toMatchObject({ target: 12300, libcard: { hidden: true, present: true } });
  });
  it('keeps the last-good catalog on a generated ID collision without starving future source refreshes', async () => {
    const initial = snapshot(); importLibcard(state.db!, initial);
    const id = libcardCatalog(initial).find(i => i.label === 'Résumé')!.targetId!;
    putRecord(state.db!, 'project', id, { id, title: 'Native' });
    state.defaultSupport = 'all';
    expect(libcardTargets()).toHaveLength(6);
    expect(libcardSnapshot()?.targetMode).toBe('explicit');
    expect(getKv<{ error: string }>(state.db!, 'libcard-refresh', sourceKey(source))?.error).toContain('last good catalog is unchanged');
    expect(readRecord(state.db!, 'project', id)).toEqual({ id, title: 'Native' });
    setKv(state.db!, 'libcard-refresh', sourceKey(source), { attemptedAt: '2020-01-01T00:00:00.000Z' });
    const corrected = vi.fn<typeof fetch>(async () => new Response(libcardFixture.replace('label: Résumé', 'label: Résumé\n    feedme: { id: resume }')));
    await refreshLibcard(false, corrected);
    expect(corrected).toHaveBeenCalledTimes(1);
    expect(libcardTargets().some(p => p.id === 'resume')).toBe(true);
  });
  it('surfaces native collisions in Studio status without changing the last-good import', async () => {
    importLibcard(state.db!, snapshot());
    putRecord(state.db!, 'project', 'open-source', { id: 'open-source', title: 'Native private title' });
    const saved = getKv(state.db!, 'libcard', 'snapshot');
    const result = await refreshLibcard(true, async () => new Response(consumerYaml));
    expect(result?.error).toContain('Target ID open-source belongs to a native project. Choose a different LibCard ID.');
    expect(result?.error).toContain('The last good snapshot is unchanged.');
    expect(result?.error).not.toContain('Native private title');
    expect(getKv(state.db!, 'libcard-refresh', sourceKey(source))).toEqual(result);
    expect(getKv(state.db!, 'libcard', 'snapshot')).toEqual(saved);
    expect(readRecord<Project>(state.db!, 'project', 'creator')?.title).toBe('Just Alex');
  });
  it('reports safe import diagnostics without reflecting source or provider error contents', async () => {
    const yamlFailure = await refreshLibcard(true, async () => new Response('secret-source: ['));
    expect(yamlFailure?.error).toContain('Check syntax and duplicate mapping keys.');
    expect(yamlFailure?.error).not.toContain('secret-source');
    const fieldFailure = await refreshLibcard(true, async () => new Response(consumerYaml.replace('aspiration: 3000', 'aspiration: secret-value')));
    expect(fieldFailure?.error).toContain('links.0.feedme.aspiration'); expect(fieldFailure?.error).not.toContain('secret-value');
    const providerFailure = await refreshLibcard(true, async () => { throw new Error('secret-provider-response'); });
    expect(providerFailure?.error).not.toContain('secret-provider-response'); expect(providerFailure?.error).toContain('No catalog has been imported yet.');
  });
  it('refreshes a version-three snapshot without a stale ETag and archives newly skipped targets', async () => {
    state.defaultSupport = 'all';
    const old = { ...snapshot(), catalogVersion: 3 as const, etag: '"old-catalog"' };
    importLibcard(state.db!, old);
    const resume = libcardTargets().find(p => p.title === 'Résumé')!;
    const updated = parse(libcardFixture);
    updated.links.find((item: { label: string }) => item.label === 'Résumé').feedme = { skip: true };
    const fetcher = vi.fn<typeof fetch>(async () => new Response(stringify(updated), { headers: { etag: '"skipped"' } }));
    await refreshLibcard(false, fetcher);
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({});
    expect(libcardSnapshot()?.catalogVersion).toBe(4);
    expect(libcardTargets().some(p => p.id === resume.id)).toBe(false);
    expect(readRecord<Project>(state.db!, 'project', resume.id)?.status).toBe('archived');
    expect((await (await GET({} as APIContext)).json()).targets.some((p: { id: string }) => p.id === resume.id)).toBe(false);
    const unchanged = vi.fn<typeof fetch>(async () => new Response(null, { status: 304 }));
    await refreshLibcard(true, unchanged);
    expect(unchanged.mock.calls[0][1]?.headers).toEqual({ 'If-None-Match': '"skipped"' });
    expect(libcardTargets().some(p => p.id === resume.id)).toBe(false);
  });
  it('rejects conflicting skip fields with a safe, clear diagnostic and retains the last-good catalog', async () => {
    importLibcard(state.db!, snapshot());
    const saved = libcardSnapshot();
    const result = await refreshLibcard(true, async () => new Response(consumerYaml.replace('id: presence', 'id: presence\n      skip: true')));
    expect(result?.error).toContain('feedme: { skip: true } with no other fields');
    expect(result?.error).toContain('last good snapshot is unchanged');
    expect(libcardSnapshot()).toEqual(saved);
  });
  it('previews every real source item without changing source opt-ins or the stored identity', async () => {
    state.demo = true; state.remoteDemo = true;
    expect(libcardSnapshot()).toBeUndefined();
    const yaml = `profile: { name: Christopher Smothers, avatar: /avatar.jpg, tagline: Building xNet }
links: [{label: Presence, url: 'https://crs.coach/'}]
socials: [{platform: bluesky, url: 'https://bsky.app/profile/crs.land'}]`;
    const fetcher = vi.fn<typeof fetch>(async () => new Response(yaml, { headers: { etag: '"real"' } }));
    vi.stubGlobal('fetch', fetcher);
    await loadLibcardSnapshot();
    await loadLibcardSnapshot();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://raw.githubusercontent.com/test/card/main/libcard.config.yaml');
    expect(libcardTargets().map(p => p.title)).toEqual(['Just Christopher', 'Presence', 'bluesky']);
    expect(libcardSnapshot()?.document.items.every(i => !i.feedme)).toBe(true);
    expect(libcardTargets().slice(1).every(p => p.libcard?.demoOnly)).toBe(true);
    const base = { name: 'Native', handle: 'native.example', bio: '', location: '', website: '' };
    expect(libcardProfile(base)).toMatchObject({ name: 'Christopher Smothers', handle: 'crs.land', bio: '', avatar: 'https://raw.githubusercontent.com/test/card/main/public/avatar.jpg' });
    expect(base.name).toBe('Native');
    state.remoteDemo = false;
    expect(libcardProfile(base).handle).toBe('native.example');
    expect(libcardTargets().map(p => p.id)).toEqual(['creator']);
    state.remoteDemo = true;
    await refreshLibcard(true, async () => { throw new Error('offline'); });
    expect(libcardSnapshot()?.document.profile.name).toBe('Christopher Smothers');
    expect(libcardSnapshot()?.document.items).toHaveLength(2);
  });
  it('upgrades version-two snapshots without a stale ETag so status groups can be imported', async () => {
    const old = { ...snapshot(), catalogVersion: 2 as const, etag: '"old"' };
    old.document.items = old.document.items.map(({ icon: _icon, status: _status, ...item }) => item);
    importLibcard(state.db!, old);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(libcardFixture));
    await refreshLibcard(true, fetcher);
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({});
    expect(libcardSnapshot()?.document.items[0]).toMatchObject({ icon: 'heart', status: 'ready' });
    expect(libcardSnapshot()?.catalogVersion).toBe(4);
  });
  it('preserves demo target overrides through removal and stops accepting them outside the preview', () => {
    state.demo = true; state.remoteDemo = true;
    const initial = snapshot(); importLibcard(state.db!, initial, 'preview');
    const id = libcardCatalog(initial, 'preview').find(i => i.label === 'Résumé')!.targetId!;
    overrideLibcard(state.db!, id, true, 770000);
    importLibcard(state.db!, { ...initial, document: { ...initial.document, items: initial.document.items.filter(i => i.label !== 'Résumé') } }, 'preview');
    expect(readRecord<Project>(state.db!, 'project', id)?.libcard?.present).toBe(false);
    importLibcard(state.db!, initial, 'preview');
    expect(readRecord<Project>(state.db!, 'project', id)).toMatchObject({ status: 'archived', target: 770000, libcard: { hidden: true, demoOnly: true, present: true } });
    overrideLibcard(state.db!, id, false, 770000);
    expect(libcardTargets().some(p => p.id === id)).toBe(true);
    state.demo = false; state.remoteDemo = false;
    expect(libcardTargets().some(p => p.id === id)).toBe(false);
    expect(listRecords(state.db!, 'support')).toEqual([]);
  });
  it('never substitutes fictional content when the first real-source demo import fails', async () => {
    state.demo = true; state.remoteDemo = true;
    await refreshLibcard(true, async () => new Response('unavailable', { status: 503 }));
    expect(libcardSnapshot()).toBeUndefined();
    expect(listRecords(state.db!, 'project')).toEqual([]);
    expect((await GET({} as APIContext)).status).toBe(503);
  });
  it('uses offline fixture only when explicitly enabled in demo mode', async () => {
    state.demo = true; state.enabled = false;
    expect(libcardSnapshot()).toBeUndefined(); expect(listRecords(state.db!, 'project')).toEqual([]);
    state.enabled = true; const fetcher = vi.fn(); await refreshLibcard(true, fetcher);
    expect(fetcher).not.toHaveBeenCalled(); expect(libcardTargets()).toHaveLength(6);
  });
  it('uses conditional requests, coalesces refreshes and keeps last-good data on failure', async () => {
    const fetcher = vi.fn(async () => new Response(libcardFixture, { headers: { etag: '"one"' } }));
    await Promise.all([refreshLibcard(true, fetcher), refreshLibcard(true, fetcher)]); expect(fetcher).toHaveBeenCalledTimes(1);
    await refreshLibcard(false, fetcher); expect(fetcher).toHaveBeenCalledTimes(1);
    const unchanged = vi.fn<typeof fetch>(async () => new Response(null, { status: 304 })); await refreshLibcard(true, unchanged);
    expect(unchanged.mock.calls[0][1]).toMatchObject({ headers: { 'If-None-Match': '"one"' }, redirect: 'error' });
    const saved = getKv(state.db!, 'libcard', 'snapshot');
    await refreshLibcard(true, async () => new Response('bad: [', { status: 200 }));
    expect(getKv(state.db!, 'libcard', 'snapshot')).toEqual(saved);
    expect(getKv(state.db!, 'libcard-refresh', sourceKey(source))).toHaveProperty('error');
    await refreshLibcard(true, async () => { throw new Error('offline'); }); expect(libcardTargets()).toHaveLength(6);
  });
  it('bounds bodies and recovers snapshot and overrides through the private allowlist', async () => {
    importLibcard(state.db!, snapshot()); overrideLibcard(state.db!, 'presence', true, 5000);
    await refreshLibcard(true, async () => new Response('x'.repeat(256 * 1024 + 1)));
    expect(libcardTargets()).toHaveLength(5);
    prepareRecovery(state.db!, 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa');
    const writes = pendingWrites(state.db!); expect(writes.length).toBeGreaterThan(0); expect(writes.every(w => w.destination === 'private')).toBe(true);
    const saved = getKv(state.db!, 'libcard', 'snapshot');
    const envelope = recoveryEnvelope('did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', '98d3c0e0-87f3-4d8e-82a2-91cf8b668a31', { table: 'kv', kind: 'libcard', key: 'snapshot' }, saved);
    expect(parsePortableValue(envelope, JSON.parse(envelope.json))).toEqual(saved);
    expect(projectSchema.parse(readRecord(state.db!, 'project', 'presence')).libcard?.aspirationOverride).toBe(5000);
    const payment = tip('paid'); expect(supportRecoverySchema.parse(payment).picks).toEqual(payment.picks);
    queueSupport(state.db!, payment, 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'); expect(pendingWrites(state.db!).every(w => w.destination === 'private')).toBe(true);
  });
});

describe('public LibCard signal', () => {
  it('counts payments separately from raw weights and excludes all private or unpaid signal', () => {
    importLibcard(state.db!, snapshot()); const targets = libcardTargets();
    const payments = [tip('one', { picks: [{ projectId: 'creator', count: 9 }] }), tip('two', { amount: 88000, picks: [{ projectId: 'presence', count: 1 }] })];
    const excluded = ['anonymous', 'private'].map(visibility => tip(visibility, { visibility: visibility as Support['visibility'] }));
    excluded.push(...(['pending','failed','refunded','disputed'] as const).map(status => tip(status, { status })), tip('refund', { refundedAmount: 2200 }), tip('dispute', { disputed: true }), tip('legacy', { picks: undefined }), tip('no-identity', { supporterDid: undefined }));
    const result = publicLibcard('Alex', 'https://feedme.example', 4400, targets, [...payments, ...payments, ...excluded]);
    expect(result.targets[0]).toMatchObject({ publicCount: 1, publicShareMillis: 900 });
    expect(result.targets[1]).toMatchObject({ publicCount: 1, publicShareMillis: 100 });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE NOTE|supporterDid|refundedAmount|88000/);
    const partial = publicLibcard('Alex', 'https://feedme.example', 4400, targets, [tip('partial', { refundedAmount: 1 })]); expect(partial.targets[0].publicCount).toBe(1);
  });
  it('renormalizes live targets and includes zeros in catalog order', async () => {
    importLibcard(state.db!, snapshot()); overrideLibcard(state.db!, 'presence', true);
    putRecord(state.db!, 'support', 'one', tip('one', { picks: [{ projectId: 'presence', count: 9 }, { projectId: 'creator', count: 1 }] }));
    const response = await GET({} as APIContext); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    const body = await response.json(); expect(body.defaultAmountCents).toBe(4400); expect(body.targets).toHaveLength(5); expect(body.targets[0].publicShareMillis).toBe(1000);
    expect(body.targets.slice(1).every((p: { publicCount: number }) => p.publicCount === 0)).toBe(true);
  });
  it('returns disabled and first-import statuses without inventing signal', async () => {
    expect((await GET({} as APIContext)).status).toBe(503);
    state.enabled = false; expect((await GET({} as APIContext)).status).toBe(404);
  });
});
