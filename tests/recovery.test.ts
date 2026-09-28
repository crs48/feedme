import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
const transport = vi.hoisted(() => vi.fn());
const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const space = 'at://did:web:pear.example/network.habitat.space/receipts';
let db: DatabaseSync;
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: false, ownerDid: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' }) }));
vi.mock('../src/lib/auth', () => ({ oauthClient: async () => ({ restore: async () => ({ fetchHandler: transport }) }) }));
vi.mock('../src/lib/db', async original => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => db }));
import { openDatabase, putRecord, setKv, getKv, enqueue, readRecord, transaction } from '../src/lib/db';
import { prepareRecovery, localCheckpoint } from '../src/lib/recovery-tracking';
import { CHECKPOINT, RECOVERY, recoveryKey, hashValue } from '../src/lib/recovery-model';
import { downloadRecovery, importRecovery } from '../src/lib/recovery-import';
import { createPrivateSpace, drainOutbox, protectCheckoutIntent } from '../src/lib/habitat';
import { demoProfile, demoProjects } from '../src/lib/seed';
import type { Support } from '../src/lib/model';

const remote = new Map<string, unknown>();
const mockServer = () => transport.mockImplementation(async (path: string, init: RequestInit) => {
  const url = new URL(path, 'https://pear.example'); const query = Object.fromEntries(url.searchParams); const body = init.body ? JSON.parse(String(init.body)) : {};
  if (url.pathname.endsWith('.listSpaces')) return Response.json({ spaces: [{ uri: space, isOwner: true }] });
  const key = `${query.collection || body.collection}/${query.rkey || body.rkey}`;
  if (url.pathname.endsWith('.getRecord')) return remote.has(key) ? Response.json({ value: remote.get(key), cid: `cid-${key}` }) : Response.json({ error: 'RecordNotFound' }, { status: 400 });
  if (url.pathname.endsWith('.putRecord')) { remote.set(key, body.record); return Response.json({ cid: `cid-${key}` }); }
  if (url.pathname.endsWith('.deleteRecord')) { remote.delete(key); return Response.json({}); }
  throw new Error(`Unexpected test request: ${path}`);
});
const seed = () => { putRecord(db, 'profile', 'self', { ...demoProfile, avatar: undefined }); putRecord(db, 'project', demoProjects[0].id, demoProjects[0]); setKv(db, 'app', 'private-space', space); };

describe('complete private recovery checkpoints', () => {
  beforeEach(() => { db = openDatabase(':memory:'); remote.clear(); mockServer(); });
  afterEach(() => { db.close(); transport.mockReset(); });
  it('tracks updates and deletes in the same SQLite transaction, excluding secrets', () => {
    seed(); prepareRecovery(db, owner);
    expect(() => transaction(db, () => { putRecord(db, 'project', demoProjects[0].id, { ...demoProjects[0], title: 'Rolled back' }); throw new Error('rollback'); })).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM recovery_dirty').get()?.n).toBe(0);
    setKv(db, 'oauth-session', owner, { accessToken: 'secret' }); setKv(db, 'session', 'browser', { did: owner });
    expect(db.prepare('SELECT COUNT(*) AS n FROM recovery_dirty').get()?.n).toBe(0);
    db.prepare('DELETE FROM records WHERE kind=?').run('project'); prepareRecovery(db, owner);
    expect(localCheckpoint(db, owner, space).checkpoint.count).toBe(1);
    expect(() => enqueue(db, 'public', RECOVERY, 'private', { secret: true })).toThrow('Private');
  });
  it('round trips drafts, exact allocations, anonymous consent, subscriptions and share IDs without credentials', async () => {
    seed(); const project = demoProjects[0];
    putRecord(db, 'project', 'draft', { ...project, id: 'draft', status: 'draft' });
    const tip: Support = { id: 'tip', projectId: project.id, amount: 1100, currency: 'usd', visibility: 'anonymous', note: 'Private note', status: 'paid', refundedAmount: 200, disputed: false, createdAt: '2026-09-25T12:00:00Z', accountId: 'acct_a', checkoutId: 'cs_a', paymentIntentId: 'pi_a', frequency: 'monthly', subscriptionId: 'sub_a', invoiceId: 'in_a', activityId: 'activity', allocations: [{ projectId: project.id, amount: 1100, activityId: 'part-activity' }] };
    putRecord(db, 'support', tip.id, tip); setKv(db, 'app', 'stripe-account', 'acct_a');
    putRecord(db, 'subscription', tip.id, { id: tip.id, accountId: 'acct_a', subscriptionId: 'sub_a', customerId: 'cus_a', status: 'active', cancelAtPeriodEnd: false, eventCreated: 1 });
    setKv(db, 'support-share-id', tip.id, 'abcdefghijklmnopqrstuvwx'); setKv(db, 'support-share-payment', 'abcdefghijklmnopqrstuvwx', tip.id);
    setKv(db, 'oauth-session', owner, { token: 'never-export-this' });
    expect((await drainOutbox()).failed).toBe(0);
    const result = await downloadRecovery(space); const target = openDatabase(':memory:');
    try { importRecovery(target, result.checkpoint, result.entries); expect(readRecord(target, 'support', tip.id)).toEqual(tip); expect(readRecord(target, 'project', 'draft')).toMatchObject({ status: 'draft' }); expect(getKv(target, 'support-share-payment', 'abcdefghijklmnopqrstuvwx')).toBe(tip.id); expect(getKv(target, 'oauth-session', owner)).toBeUndefined(); expect(getKv(target, 'recovery', 'paused')).toBe(true); } finally { target.close(); }
    expect(JSON.stringify([...remote])).not.toContain('never-export-this');
    await expect(protectCheckoutIntent()).resolves.toBeUndefined();
  });
  it('retains the last complete checkpoint while a newer write is interrupted', async () => {
    seed(); await drainOutbox(); const prior = remote.get(`${CHECKPOINT}/self`);
    putRecord(db, 'project', demoProjects[0].id, { ...demoProjects[0], title: 'New title' });
    transport.mockResolvedValueOnce(new Response('', { status: 503 }));
    expect((await drainOutbox()).failed).toBe(1); expect(remote.get(`${CHECKPOINT}/self`)).toEqual(prior);
    const recovered = await downloadRecovery(space); expect(recovered.entries.find(e => e.kind === 'project')?.json).not.toContain('New title');
    await drainOutbox(); expect((await downloadRecovery(space)).entries.find(e => e.kind === 'project')?.json).toContain('New title');
  });
  it('retries a lost checkpoint response with the identical record, rather than conflicting with itself', async () => {
    seed(); const original = transport.getMockImplementation()!; let failed = false;
    transport.mockImplementation(async (path: string, init: RequestInit) => {
      const response = await original(path, init);
      if (path.endsWith('.putRecord') && String(init.body).includes(`"collection":"${CHECKPOINT}"`) && !failed) { failed = true; throw new Error('lost response'); }
      return response;
    });
    expect((await drainOutbox()).failed).toBe(1); const prior = remote.get(`${CHECKPOINT}/self`);
    expect((await drainOutbox()).failed).toBe(0); expect(remote.get(`${CHECKPOINT}/self`)).toEqual(prior);
  });
  it('refuses tampering, missing records, other owners and unexpected checkpoint edits', async () => {
    seed(); await drainOutbox(); const downloaded = await downloadRecovery(space); const first = downloaded.entries[0]; const key = `${RECOVERY}/${hashValue(first)}`;
    remote.set(key, { ...first, json: '{}' }); await expect(downloadRecovery(space)).rejects.toThrow('integrity');
    remote.delete(key); await expect(downloadRecovery(space)).rejects.toThrow(); remote.set(key, first);
    remote.set(`${CHECKPOINT}/self`, { ...downloaded.checkpoint, owner: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' });
    await expect(downloadRecovery(space)).rejects.toThrow('another creator');
    putRecord(db, 'project', demoProjects[0].id, { ...demoProjects[0], title: 'Changed again' });
    expect((await drainOutbox()).failed).toBe(1);
    await expect(protectCheckoutIntent()).rejects.toThrow('No checkout');
  });
  it('does not let a failing public queue block private recovery', async () => {
    seed(); for (let n = 0; n < 60; n++) enqueue(db, 'public', 'fund.feedme.project', `p${n}`, { title: 'Example' });
    const original = transport.getMockImplementation()!;
    transport.mockImplementation((path: string, init: RequestInit) => path.includes('com.atproto.repo') ? Promise.resolve(new Response('', { status: 503 })) : original(path, init));
    expect((await drainOutbox()).failed).toBe(1); expect(remote.has(`${CHECKPOINT}/self`)).toBe(true);
  });
  it('detects an existing saved Feedme before creating replacement storage', async () => {
    seed(); await drainOutbox(); db.prepare("DELETE FROM kv WHERE namespace='app' AND key='private-space'").run();
    await expect(createPrivateSpace()).rejects.toThrow('already exists');
    expect(transport.mock.calls.some(([path]) => path.includes('createSpace'))).toBe(false);
  });
  it('does not import a payment whose project is missing', async () => {
    seed(); await drainOutbox(); const { checkpoint, entries } = await downloadRecovery(space); const target = openDatabase(':memory:');
    try { await expect(downloadRecovery('at://wrong')).rejects.toThrow(); expect(() => importRecovery(target, { ...checkpoint, count: 99 }, entries)).toThrow('incomplete'); expect(target.prepare('SELECT COUNT(*) AS n FROM records').get()?.n).toBe(0); } finally { target.close(); }
    expect(recoveryKey(entries[0])).toHaveLength(64);
  });
});
