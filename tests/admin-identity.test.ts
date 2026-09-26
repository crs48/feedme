import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/lib/db';
import { pinAdminIdentity, verifyIdentity } from '../src/lib/admin-identity';
import { identitySettings, rememberIdentity } from '../src/lib/identity-settings';
import { config } from '../src/lib/config';
import { isAdmin } from '../src/lib/auth';
const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const helper = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const identity = (did = owner) => ({ did, handle: 'crs.land', didDoc: { id: did, alsoKnownAs: ['at://crs.land'] } });
afterEach(() => vi.unstubAllEnvs());

describe('configured administrators', () => {
  it('defaults to crs.land and normalizes/deduplicates additional handles and DIDs', () => {
    expect(identitySettings({})).toEqual({ owner: 'crs.land', accounts: ['crs.land'] });
    expect(identitySettings({ BLUESKY_HANDLE: '@CRS.land', ADMIN_ACCOUNTS: `crs.land, @helper.bsky.social, ${helper}, helper.bsky.social` }).accounts).toEqual(['crs.land', 'helper.bsky.social', helper]);
    expect(identitySettings({ OWNER_DID: owner, BLUESKY_HANDLE: 'crs.land' }).owner).toBe(owner);
    for (const invalid of ['https://bsky.app/profile/crs.land', 'not a handle', '-bad.land', 'crs.land/path']) expect(() => identitySettings({ BLUESKY_HANDLE: invalid })).toThrow();
  });
  it('pins the first verified DID and does not grant a recycled handle admin rights', async () => {
    const db = openDatabase(':memory:');
    const resolve = vi.fn(async () => identity());
    expect(await pinAdminIdentity(db, '@crs.land', resolve)).toBe(owner);
    resolve.mockResolvedValue(identity(helper));
    expect(await pinAdminIdentity(db, 'crs.land', resolve)).toBe(owner);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(await pinAdminIdentity(db, helper, resolve)).toBe(helper);
    db.close();
  });
  it('fails closed on resolver errors and conflicting handle or DID claims', async () => {
    const db = openDatabase(':memory:');
    await expect(pinAdminIdentity(db, 'crs.land', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(() => verifyIdentity('crs.land', { ...identity(), handle: 'attacker.test' })).toThrow();
    expect(() => verifyIdentity('crs.land', { ...identity(), didDoc: { id: helper, alsoKnownAs: ['at://crs.land'] } })).toThrow();
    expect(() => verifyIdentity('crs.land', { ...identity(), didDoc: { id: owner, alsoKnownAs: ['at://attacker.test'] } })).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM kv').get()).toEqual({ n: 0 });
    db.close();
  });
  it('authorizes only verified configured DIDs and immediately removes an omitted additional account', () => {
    vi.stubEnv('FEEDME_MODE', 'live'); vi.stubEnv('PUBLIC_URL', 'https://feedme.example');
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'a'.repeat(64)); vi.stubEnv('OWNER_DID', '');
    vi.stubEnv('BLUESKY_HANDLE', 'crs.land'); vi.stubEnv('ADMIN_ACCOUNTS', 'helper.test');
    const dir = config().dataDir;
    expect(isAdmin({ did: helper })).toBe(false);
    rememberIdentity(dir, 'crs.land', owner); rememberIdentity(dir, 'helper.test', helper);
    expect(isAdmin({ did: owner })).toBe(true); expect(isAdmin({ did: helper })).toBe(true);
    expect(isAdmin({ did: 'crs.land' })).toBe(false); expect(isAdmin()).toBe(false);
    vi.stubEnv('ADMIN_ACCOUNTS', '');
    expect(isAdmin({ did: helper })).toBe(false); expect(isAdmin({ did: owner })).toBe(true);
  });
});
