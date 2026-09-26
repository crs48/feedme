import { HabitatIdentityResolver } from '@habitat-network/habitat';
import type { DatabaseSync } from 'node:sqlite';
import { config } from './config';
import { getDb, getKv, setKv } from './db';
import { didSchema } from './model';
import { accountIdentifier, rememberIdentity } from './identity-settings';

type Identity = { did: string; handle: string; didDoc: { id: string; alsoKnownAs?: string[] } };
export type IdentityPin = { account: string; did: string; pinnedAt: string };

export const verifyIdentity = (account: string, identity: Identity) => {
  const did = didSchema.parse(identity.did);
  const claimed = identity.didDoc.alsoKnownAs?.find((value) => value.startsWith('at://'))?.slice(5).toLowerCase();
  if (identity.didDoc.id !== did || identity.handle.toLowerCase() !== account || claimed !== account)
    throw new Error(`The identity provider could not verify @${account}.`);
  return did;
};

// A handle is resolved only when first configured, then pinned to its permanent
// DID. A recycled handle must never silently acquire an existing admin's role.
export const pinAdminIdentity = async (db: DatabaseSync, input: string, resolve: (account: string) => Promise<Identity>) => {
  const account = accountIdentifier(input);
  if (account.startsWith('did:')) return account;
  const pin = getKv<IdentityPin>(db, 'admin-identity', account);
  if (pin) return didSchema.parse(pin.did);
  const did = verifyIdentity(account, await resolve(account));
  setKv(db, 'admin-identity', account, { account, did, pinnedAt: new Date().toISOString() } satisfies IdentityPin);
  return did;
};

let pending: Promise<void> | undefined;
let preparedKey = '';
let retryAt = 0;
let unresolved: string[] = [];
export const unresolvedAdmins = () => unresolved;
export const prepareIdentity = async () => {
  const cfg = config();
  if (cfg.demo) return;
  const key = JSON.stringify([cfg.dataDir, cfg.identities]);
  if (preparedKey === key && Date.now() < retryAt) return;
  if (pending) return pending;
  pending = (async () => {
    const db = getDb();
    const resolver = new HabitatIdentityResolver(cfg.habitatUrl);
    const resolve = (account: string) => resolver.resolve(account, { signal: AbortSignal.timeout(10_000), noCache: true }) as Promise<Identity>;
    const ownerDid = await pinAdminIdentity(db, cfg.identities.owner, resolve);
    const previousOwner = getKv<string>(db, 'app', 'owner-did');
    if (previousOwner && previousOwner !== ownerDid) throw new Error('This data directory belongs to a different creator. Restore its owner configuration or use a new data directory.');
    setKv(db, 'app', 'owner-did', ownerDid);
    rememberIdentity(cfg.dataDir, cfg.identities.owner, ownerDid);
    unresolved = [];
    await Promise.all(cfg.identities.accounts.filter((account) => account !== cfg.identities.owner).map(async (account) => {
      try { rememberIdentity(cfg.dataDir, account, await pinAdminIdentity(db, account, resolve)); }
      catch { unresolved.push(account); }
    }));
    preparedKey = key;
    retryAt = unresolved.length ? Date.now() + 60_000 : Infinity;
  })().finally(() => { pending = undefined; });
  return pending;
};
