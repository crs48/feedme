import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ownerDid = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const otherDid = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined, enabled: true, demo: false, remoteDemo: false }));
vi.mock('../src/lib/config', () => ({ config: () => ({
  libcard: state.enabled ? { repo: 'example/card', ref: 'main' } : undefined,
  demo: state.demo, libcardRemoteDemo: state.remoteDemo,
  ownerDid: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', identities: { owner: 'creator.example' },
}) }));
vi.mock('../src/lib/db', async original => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => state.db! }));
import { cachedCreatorBluesky, refreshCreatorBluesky } from '../src/lib/creator-bluesky';
import { getKv, openDatabase, pendingWrites, putRecord, readRecord, setKv } from '../src/lib/db';
import { libcardProfile } from '../src/lib/libcard';
import type { LibcardSnapshot } from '../src/lib/libcard-schema';
import type { PublicReader } from '../src/lib/public-identity';

const base = { name: 'Saved name', handle: 'old.example', bio: 'Saved native bio', location: '', website: '' };
const snapshot: LibcardSnapshot = {
  source: { repo: 'example/card', ref: 'main' }, hash: 'a'.repeat(64), checkedAt: '2026-10-08T00:00:00.000Z',
  document: { profile: { name: 'Card name', tagline: 'Card tagline', avatar: 'https://card.example/avatar.jpg', location: 'Card location' }, about: '', items: [] },
};
const response = (extra = {}) => ({ did: ownerDid, handle: 'creator.example', displayName: 'Bluesky name', description: 'First line\nSecond line', avatar: 'https://cdn.bsky.app/avatar.jpg', followersCount: 123, ...extra });
const nextRefresh = () => vi.advanceTimersByTime(15 * 60_000);

beforeEach(() => {
  state.db = openDatabase(':memory:'); state.enabled = true; state.demo = false; state.remoteDemo = false;
  putRecord(state.db, 'profile', 'self', base);
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T00:00:00Z'));
});
afterEach(() => { state.db!.close(); vi.useRealTimers(); });

describe('Bluesky identity on LibCard visits', () => {
  it('uses Bluesky bio, handle, name and avatar without changing stored identity or queuing public writes', async () => {
    const read = vi.fn<PublicReader>(async () => response());
    await refreshCreatorBluesky(read);
    expect(new URL(read.mock.calls[0][0]).searchParams.get('actor')).toBe(ownerDid);
    expect(read.mock.calls[0][1]).toEqual({ maxBytes: 65_536 });
    expect(libcardProfile(base, snapshot)).toEqual({ ...base, name: 'Bluesky name', handle: 'creator.example', bio: 'First line\nSecond line', avatar: 'https://cdn.bsky.app/avatar.jpg', location: 'Card location' });
    expect(readRecord(state.db!, 'profile', 'self')).toEqual(base);
    expect(pendingWrites(state.db!)).toEqual([]);
    expect(cachedCreatorBluesky()).not.toHaveProperty('followersCount');
  });
  it('coalesces concurrent requests and only refreshes after 15 minutes', async () => {
    let finish!: (value: unknown) => void;
    const read = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const first = refreshCreatorBluesky(read);
    const second = refreshCreatorBluesky(read);
    expect(read).toHaveBeenCalledTimes(1);
    finish(response()); await Promise.all([first, second]);
    await refreshCreatorBluesky(read);
    expect(read).toHaveBeenCalledTimes(1);
    nextRefresh();
    await refreshCreatorBluesky(async () => response({ handle: 'new.example', description: 'Updated bio' }));
    expect(libcardProfile(base, snapshot)).toMatchObject({ handle: 'new.example', bio: 'Updated bio' });
  });
  it('preserves last-good metadata during outages and throttles retries', async () => {
    await refreshCreatorBluesky(async () => response()); nextRefresh();
    const unavailable = vi.fn(async () => { throw new Error('Offline'); });
    await refreshCreatorBluesky(unavailable); await refreshCreatorBluesky(unavailable);
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(libcardProfile(base, snapshot).bio).toBe('First line\nSecond line');
    nextRefresh(); await refreshCreatorBluesky(async () => response({ description: 'Recovered' }));
    expect(libcardProfile(base, snapshot).bio).toBe('Recovered');
  });
  it('clears deleted bios and avatars instead of substituting LibCard content', async () => {
    await refreshCreatorBluesky(async () => response()); nextRefresh();
    await refreshCreatorBluesky(async () => response({ description: undefined, avatar: undefined }));
    expect(libcardProfile(base, snapshot)).toMatchObject({ bio: '', avatar: undefined });
    expect(cachedCreatorBluesky()?.bio).toBe('');
  });
  it('never falls back to the LibCard tagline, even before the first successful request', async () => {
    await refreshCreatorBluesky(async () => { throw new Error('Offline'); });
    expect(libcardProfile(base, snapshot)).toMatchObject({ bio: 'Saved native bio', handle: 'old.example' });
    expect(libcardProfile({ ...base, bio: '', handle: '' }, snapshot)).toMatchObject({ bio: '', handle: 'creator.example' });
  });
  it('rejects another DID and malformed profiles without replacing last-good metadata', async () => {
    await refreshCreatorBluesky(async () => response());
    for (const invalid of [response({ did: otherDid }), response({ handle: 'handle.invalid' }), response({ handle: '<script>' }), response({ description: { text: 'Wrong shape' } })]) {
      nextRefresh(); await refreshCreatorBluesky(async () => invalid);
      expect(cachedCreatorBluesky()?.did).toBe(ownerDid);
      expect(cachedCreatorBluesky()?.bio).toBe('First line\nSecond line');
    }
  });
  it('drops unsafe optional avatars and uses the handle for an empty display name', async () => {
    await refreshCreatorBluesky(async () => response({ displayName: ' ', avatar: 'https://user:password@example.com/avatar.jpg' }));
    expect(cachedCreatorBluesky()?.name).toBe('creator.example');
    expect(cachedCreatorBluesky()?.avatar).toBeUndefined();
  });
  it('leaves offline demos and native profiles unchanged without network requests', async () => {
    const read = vi.fn();
    state.demo = true;
    await refreshCreatorBluesky(read); expect(cachedCreatorBluesky()).toBeUndefined();
    state.demo = false; state.enabled = false;
    await refreshCreatorBluesky(read); expect(cachedCreatorBluesky()).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
  it('shows a real remote-demo profile while retaining the fictional login identity', async () => {
    state.demo = true; state.remoteDemo = true;
    const read = vi.fn<PublicReader>(async () => response({ did: otherDid }));
    await refreshCreatorBluesky(read);
    expect(new URL(read.mock.calls[0][0]).searchParams.get('actor')).toBe('creator.example');
    expect(cachedCreatorBluesky()?.did).toBe(otherDid);
    expect(getKv(state.db!, 'app', 'owner-did')).toBeUndefined();
    expect(readRecord(state.db!, 'profile', 'self')).toEqual(base);
  });
  it('does not mutate the cache while recovery is paused, including a pause during the fetch', async () => {
    const read = vi.fn();
    setKv(state.db!, 'recovery', 'paused', true);
    await refreshCreatorBluesky(read); expect(read).not.toHaveBeenCalled();
    setKv(state.db!, 'recovery', 'paused', false);
    await refreshCreatorBluesky(async () => { setKv(state.db!, 'recovery', 'paused', true); return response(); });
    expect(cachedCreatorBluesky()).toBeUndefined();
  });
});
