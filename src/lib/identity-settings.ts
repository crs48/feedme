import { didSchema } from './model';

const resolved = new Map<string, string>();
export const accountIdentifier = (input: string) => {
  const value = input.trim().replace(/^@/, '');
  if (value.startsWith('did:')) return didSchema.parse(value);
  const handle = value.toLowerCase();
  if (handle.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(handle))
    throw new Error('Use a complete Bluesky handle (for example crs.land) or an AT Protocol DID.');
  return handle;
};
export const identitySettings = (env: NodeJS.ProcessEnv = process.env) => {
  const owner = accountIdentifier(env.OWNER_DID || env.BLUESKY_HANDLE || 'crs.land');
  const extras = (env.ADMIN_ACCOUNTS || '').split(',').filter((value) => value.trim()).map(accountIdentifier);
  if (extras.length > 20) throw new Error('Configure at most 20 additional admin accounts.');
  return { owner, accounts: [...new Set([owner, ...extras])] };
};
export const resolvedDid = (dataDir: string, account: string) => account.startsWith('did:') ? account : resolved.get(`${dataDir}:${account}`);
export const rememberIdentity = (dataDir: string, account: string, did: string) => { resolved.set(`${dataDir}:${account}`, didSchema.parse(did)); };
