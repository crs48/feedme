import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
const transport = vi.hoisted(() => vi.fn());
let db: DatabaseSync;
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: false, ownerDid: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' }) }));
vi.mock('../src/lib/auth', () => ({ oauthClient: async () => ({ restore: async () => ({ fetchHandler: transport }) }) }));
vi.mock('../src/lib/db', async (original) => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => db }));
import { enqueue, openDatabase, pendingWrites, setKv } from '../src/lib/db';
import { createPrivateSpace, drainOutbox } from '../src/lib/habitat';

describe('Habitat wire adapter', () => {
  beforeEach(() => { db = openDatabase(':memory:'); transport.mockReset(); });
  afterEach(() => db.close());
  it('creates an explicitly member-only space and uses the returned authority URI', async () => {
    transport.mockResolvedValue(Response.json({ uri: 'at://did:web:pear.example/space/fund.feedme.receipts/123' }));
    const uri = await createPrivateSpace();
    const [path, request] = transport.mock.calls[0];
    expect(path).toBe('/xrpc/network.habitat.simplespace.createSpace');
    expect(JSON.parse(request.body).config.policy).toBe('member-list');
    expect(uri).toContain('did:web:pear.example');
    expect(await createPrivateSpace()).toBe(uri);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('never falls back to public storage when the private space is missing', async () => {
    enqueue(db, 'private', 'fund.feedme.support', 'tip', { note: 'secret' });
    expect(await drainOutbox()).toEqual({ sent: 0, failed: 1 });
    expect(transport).not.toHaveBeenCalled();
    expect(pendingWrites(db)).toHaveLength(1);
  });
  it('uses the implemented private endpoint, preserving failed writes for retry', async () => {
    setKv(db, 'app', 'private-space', 'at://did:web:pear.example/space/fund.feedme.receipts/123');
    enqueue(db, 'private', 'fund.feedme.support', 'tip', { note: 'secret' });
    transport.mockResolvedValueOnce(new Response('offline', { status: 503 })).mockResolvedValueOnce(Response.json({ uri: 'at://record', cid: 'cid' }));
    expect(await drainOutbox()).toEqual({ sent: 0, failed: 1 });
    expect(pendingWrites(db)[0].attempts).toBe(1);
    expect(await drainOutbox()).toEqual({ sent: 1, failed: 0 });
    const [path, request] = transport.mock.calls[1];
    expect(path).toBe('/xrpc/network.habitat.space.putRecord');
    const body = JSON.parse(request.body);
    expect(body.space).toContain('pear.example');
    expect(body).not.toHaveProperty('validate');
    expect(body.record.note).toBe('secret');
    expect(pendingWrites(db)).toHaveLength(0);
  });
  it('writes public records to the normal public repo without a space parameter', async () => {
    enqueue(db, 'public', 'fund.feedme.project', 'sauna', { title: 'Sauna' });
    transport.mockResolvedValue(Response.json({ uri: 'at://record', cid: 'cid' }));
    await drainOutbox();
    expect(transport.mock.calls[0][0]).toBe('/xrpc/com.atproto.repo.putRecord');
    expect(JSON.parse(transport.mock.calls[0][1].body)).not.toHaveProperty('space');
  });
  it('treats deleting an already-absent public acknowledgment as success', async () => {
    enqueue(db, 'public', 'fund.feedme.acknowledgment', 'tip', null);
    transport.mockResolvedValue(Response.json({ error: 'RecordNotFound' }, { status: 400 }));
    expect(await drainOutbox()).toEqual({ sent: 1, failed: 0 });
    expect(pendingWrites(db)).toHaveLength(0);
  });
});
