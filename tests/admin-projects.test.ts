import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { APIContext } from 'astro';
const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined, user: undefined as { did: string } | undefined }));
const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const helper = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: false, ownerDid: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', adminDids: ['did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'], origin: 'https://feedme.example' }) }));
vi.mock('../src/lib/db', async (original) => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => state.db! }));
vi.mock('../src/lib/auth', async (original) => ({ ...await original<typeof import('../src/lib/auth')>(), currentUser: () => state.user,
  requireAdmin: () => { if (!state.user || !['did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'].includes(state.user.did)) throw new Error('Administrator access is required.'); return state.user; } }));
vi.mock('../src/lib/habitat', () => ({ createPrivateSpace: vi.fn(), drainOutbox: async () => ({ sent: 0, failed: 0 }) }));
vi.mock('../src/lib/social-repo', () => ({ publishPost: vi.fn() }));
import { openDatabase, pendingWrites, putRecord, listRecords } from '../src/lib/db';
import { projects, project, saveProject, saveUpdate } from '../src/lib/repository';
import { POST } from '../src/pages/api/studio';
import { GET as exportPayments } from '../src/pages/api/admin/export';
import { adminReturnPath } from '../src/lib/admin';
import { demoProfile } from '../src/lib/seed';
import type { Project } from '../src/lib/model';
const draft: Project = { id: 'private-draft', title: 'Private draft title', summary: 'A private introduction', description: 'Secret draft body that must not be public.', category: 'Making', kind: 'project', status: 'draft', color: 'blue', target: 10000, image: '', link: '', createdAt: '2026-09-26T00:00:00Z' };
const context = (form: Record<string,string> = {}, path = '/api/studio') => ({ request: new Request(`https://feedme.example${path}`, { method: 'POST', body: new URLSearchParams(form) }), url: new URL(`https://feedme.example${path}`), cookies: {} }) as APIContext;
beforeEach(() => { state.db = openDatabase(':memory:'); putRecord(state.db, 'profile', 'self', demoProfile); state.user = { did: helper }; });
afterEach(() => { state.db!.close(); });

describe('admin project lifecycle and private reports', () => {
  it('keeps drafts out of public listings and the public outbox, and rejects public updates to drafts', () => {
    saveProject({ ...draft, ignoredSecret: 'extra' });
    expect(projects()).toEqual([]); expect(projects(true)).toHaveLength(1);
    expect(pendingWrites(state.db!)).toEqual([]);
    expect(project(draft.id)).not.toHaveProperty('ignoredSecret');
    expect(() => saveUpdate({ id: '98d3c0e0-87f3-4d8e-82a2-91cf8b668a31', projectId: draft.id, text: 'private update', createdAt: draft.createdAt })).toThrow('published');
    expect(() => saveProject({ ...draft, status: 'archived' })).toThrow('Publish');
    expect(pendingWrites(state.db!)).toEqual([]);
  });
  it('lets another configured administrator publish and archive, recording the acting DID', async () => {
    saveProject(draft);
    const published = await POST(context({ action: 'project-status', id: draft.id, status: 'active', returnTo: '/studio/projects' }));
    expect(published.status).toBe(303); expect(projects()).toHaveLength(1);
    expect(pendingWrites(state.db!)[0].value).toMatchObject({ status: 'active', title: draft.title });
    expect(listRecords(state.db!, 'admin-event')).toEqual([expect.objectContaining({ actor: helper, action: 'project.active' })]);
    expect(() => saveProject(draft)).toThrow('cannot become private');
    await POST(context({ action: 'project-status', id: draft.id, status: 'archived' }));
    expect(projects()).toEqual([]); expect(project(draft.id)?.status).toBe('archived');
    expect(pendingWrites(state.db!)[0].value).toMatchObject({ status: 'archived' });
  });
  it('duplicates an existing project into a separate private draft without copying payments', async () => {
    saveProject({ ...draft, status: 'active' });
    await POST(context({ action: 'project-duplicate', id: draft.id }));
    const copies = projects(true);
    expect(copies).toHaveLength(2); expect(copies.find((p) => p.id !== draft.id)).toMatchObject({ status: 'draft', title: `${draft.title} (copy)` });
    expect(pendingWrites(state.db!).filter((r) => r.collection === 'fund.feedme.project')).toHaveLength(1); expect(listRecords(state.db!, 'support')).toEqual([]);
  });
  it('rejects unauthenticated and non-admin mutations and exports even when called without middleware', async () => {
    for (const user of [undefined, { did: 'did:plc:cccccccccccccccccccccccc' }]) {
      state.user = user;
      expect((await POST(context({ action: 'project', ...draft, target: '100' }))).status).toBe(403);
      expect((await exportPayments(context({}, '/api/admin/export'))).status).toBe(403);
    }
    expect(projects(true)).toEqual([]); expect(pendingWrites(state.db!)).toEqual([]);
  });
  it('exports only authorized filtered amounts and hides anonymous identities, notes and provider IDs', async () => {
    state.user = { did: owner };
    putRecord(state.db!, 'support', 'one', { id: 'one', projectId: 'private-draft', amount: 2200, currency: 'usd', status: 'paid', refundedAmount: 0, disputed: false, note: 'SUPER PRIVATE', visibility: 'anonymous', supporterDid: helper, accountId: 'acct_secret', createdAt: new Date().toISOString() });
    const response = await exportPayments(context({}, '/api/admin/export?range=all'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    const csv = await response.text(); expect(csv).toContain('22.00'); expect(csv).not.toMatch(/SUPER PRIVATE|acct_secret|bbbbbbbb/);
  });
  it('keeps admin return paths local', () => {
    expect(adminReturnPath('/studio/projects/private-draft')).toBe('/studio/projects/private-draft');
    for (const path of ['https://evil.test','//evil.test','/studio/../../','/support/private-draft']) expect(adminReturnPath(path)).toBe('/studio');
  });
});
