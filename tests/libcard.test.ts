import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined, demo: false, enabled: true, remoteDemo: false }));
const source = { repo: 'test/card', ref: 'main' };
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: state.demo, libcardRemoteDemo: state.remoteDemo, identities: { owner: 'crs.land' }, libcard: state.enabled ? { repo: 'test/card', ref: 'main' } : undefined, ownerDid: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', origin: 'https://feedme.example', defaultTipAmount: 4400 }) }));
vi.mock('../src/lib/db', async original => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => state.db! }));
import { openDatabase, getKv, listRecords, putRecord, readRecord, pendingWrites } from '../src/lib/db';
import { avatarUrl, parseLibcard, sourceKey, type LibcardSnapshot } from '../src/lib/libcard-schema';
import { libcardFixture } from '../src/lib/libcard-fixture';
import { importLibcard, libcardSnapshot, libcardTargets, libcardProfile, loadLibcardSnapshot, overrideLibcard, refreshLibcard } from '../src/lib/libcard';
import { publicLibcard } from '../src/lib/libcard-public';
import { libcardCatalog } from '../src/lib/libcard-catalog';
import { projectSchema, type Project, type Support } from '../src/lib/model';
import { prepareRecovery } from '../src/lib/recovery-tracking';
import { parsePortableValue, recoveryEnvelope, supportRecoverySchema } from '../src/lib/recovery-model';
import { queueSupport } from '../src/lib/support-ledger';
import { saveProject, projects } from '../src/lib/repository';
import { GET } from '../src/pages/api/public/libcard';
import type { APIContext } from 'astro';
const snapshot = (): LibcardSnapshot => ({ source, document: parseLibcard(libcardFixture, source), hash: 'a'.repeat(64), checkedAt: new Date().toISOString() });
const tip = (id: string, extra: Partial<Support> = {}): Support => ({ id, projectId: 'creator', amount: 2200, currency: 'usd', visibility: 'public', supporterDid: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', note: 'PRIVATE NOTE', status: 'paid', refundedAmount: 0, disputed: false, createdAt: new Date().toISOString(), picks: [{ projectId: 'creator', count: 1 }], ...extra });
beforeEach(() => { state.db = openDatabase(':memory:'); state.enabled = true; state.demo = false; state.remoteDemo = false; });
afterEach(() => { state.db!.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('LibCard parser and managed import', () => {
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
    expect(libcardProfile(base)).toMatchObject({ name: 'Christopher Smothers', handle: 'crs.land', bio: 'Building xNet', avatar: 'https://raw.githubusercontent.com/test/card/main/public/avatar.jpg' });
    expect(base.name).toBe('Native');
    state.remoteDemo = false;
    expect(libcardProfile(base).handle).toBe('native.example');
    expect(libcardTargets().map(p => p.id)).toEqual(['creator']);
    state.remoteDemo = true;
    await refreshLibcard(true, async () => { throw new Error('offline'); });
    expect(libcardSnapshot()?.document.profile.name).toBe('Christopher Smothers');
    expect(libcardSnapshot()?.document.items).toHaveLength(2);
  });
  it('upgrades old snapshots without sending a stale ETag that would discard icons', async () => {
    const old = { ...snapshot(), etag: '"old"' }; importLibcard(state.db!, old);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(libcardFixture.replace('label: Presence', 'label: Presence\n    icon: heart')));
    await refreshLibcard(true, fetcher);
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({});
    expect(libcardSnapshot()?.document.items[0].icon).toBe('heart');
    expect(libcardSnapshot()?.catalogVersion).toBe(2);
  });
  it('preserves demo target overrides through removal and stops accepting them outside the preview', () => {
    state.demo = true; state.remoteDemo = true;
    const initial = snapshot(); importLibcard(state.db!, initial, true);
    const id = libcardCatalog(initial, true).find(i => i.label === 'Résumé')!.targetId!;
    overrideLibcard(state.db!, id, true, 770000);
    importLibcard(state.db!, { ...initial, document: { ...initial.document, items: initial.document.items.filter(i => i.label !== 'Résumé') } }, true);
    expect(readRecord<Project>(state.db!, 'project', id)?.libcard?.present).toBe(false);
    importLibcard(state.db!, initial, true);
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
