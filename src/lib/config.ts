import { libcardSourceSchema } from './libcard-schema';
import { resolve } from 'node:path';
import { centsFromInput } from './model';
import { identitySettings, resolvedDid } from './identity-settings';

// Trust deployment settings, never request Host or forwarded headers.
// An explicit public URL always wins, including when using a custom domain.
export const publicOrigin = (env: NodeJS.ProcessEnv = process.env) => new URL(
  env.PUBLIC_URL || env.RENDER_EXTERNAL_URL ||
  (env.RAILWAY_PUBLIC_DOMAIN && `https://${env.RAILWAY_PUBLIC_DOMAIN}`) ||
  (env.KOYEB_PUBLIC_DOMAIN && `https://${env.KOYEB_PUBLIC_DOMAIN}`) ||
  (env.FLY_APP_NAME && `https://${env.FLY_APP_NAME}.fly.dev`) ||
  'http://127.0.0.1:4321',
).origin;

const tipAmountsFromEnv = () => {
  try {
    const amounts = (process.env.TIP_AMOUNTS || '11,22,44,88').split(',').map(centsFromInput);
    if (amounts.length !== 4 || new Set(amounts).size !== 4) throw new Error('Invalid presets');
    return amounts;
  } catch {
    throw new Error('TIP_AMOUNTS must contain four different USD amounts between $1 and $1,000, with at most two decimal places (for example: 11,22,44,88).');
  }
};

export const config = () => {
  const tipAmounts = tipAmountsFromEnv();
  const stripeMode = process.env.STRIPE_MODE || 'connect';
  if (!['connect', 'own-account'].includes(stripeMode)) throw new Error('STRIPE_MODE must be connect or own-account.');
  const stripeAccountId = process.env.STRIPE_ACCOUNT_ID || '';
  if (stripeMode === 'own-account' && !/^acct_[A-Za-z0-9]+$/.test(stripeAccountId)) throw new Error('Own-account mode requires STRIPE_ACCOUNT_ID.');
  const stripeEnvironment = process.env.STRIPE_ENVIRONMENT || '';
  if (stripeEnvironment && !['test', 'live'].includes(stripeEnvironment)) throw new Error('STRIPE_ENVIRONMENT must be test or live.');
  const demo = process.env.FEEDME_MODE !== 'live';
  const libcardDemoSource = process.env.LIBCARD_DEMO_SOURCE || 'fixture';
  if (!['fixture', 'github'].includes(libcardDemoSource)) throw new Error('LIBCARD_DEMO_SOURCE must be fixture or github.');
  const libcardDefaultSupport = process.env.LIBCARD_DEFAULT_SUPPORT || 'all';
  if (!['all', 'explicit'].includes(libcardDefaultSupport)) throw new Error('LIBCARD_DEFAULT_SUPPORT must be all or explicit.');
  const origin = publicOrigin();
  const identities = identitySettings();
  const dataDir = resolve(process.env.DATA_DIR || '.data');
  const ownerDid = demo ? 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' : (resolvedDid(dataDir, identities.owner) || '');
  const adminDids = demo ? [ownerDid] : identities.accounts.flatMap((account) => resolvedDid(dataDir, account) || []);
  if (!demo) {
    if (!origin.startsWith('https://')) throw new Error('Live mode requires an HTTPS PUBLIC_URL.');
    if (!/^[a-f0-9]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY || ''))
      throw new Error('Live mode requires a 32-byte DATA_ENCRYPTION_KEY encoded as hex.');
  }
  return {
    demo, origin, ownerDid, adminDids, identities, tipAmounts,
    libcardDefaultSupport: libcardDefaultSupport as 'all' | 'explicit',
    libcardRemoteDemo: demo && Boolean(process.env.LIBCARD_REPO) && libcardDemoSource === 'github',
    libcard: process.env.LIBCARD_REPO ? libcardSourceSchema.parse({ repo: process.env.LIBCARD_REPO, ref: process.env.LIBCARD_REF || 'main' }) : undefined, defaultTipAmount: tipAmounts[1], dataDir,
    discoveryRelay: process.env.DISCOVERY_RELAY_URL || 'https://relay1.us-east.bsky.network',
    directoryUrl: process.env.DIRECTORY_URL === 'off' ? '' : process.env.DIRECTORY_URL || 'https://feedme.fund/directory/v1.json',
    habitatUrl: process.env.HABITAT_URL || 'https://pear.habitat.network',
    stripeKey: process.env.STRIPE_SECRET_KEY || '',
    stripeMode: stripeMode as 'connect' | 'own-account', stripeAccountId, stripeEnvironment,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  };
};
