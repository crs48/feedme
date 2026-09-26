import { resolve } from 'node:path';
import { centsFromInput, didSchema } from './model';

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
  const demo = process.env.FEEDME_MODE !== 'live';
  const origin = publicOrigin();
  const ownerDid = demo ? 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' : (process.env.OWNER_DID || '');
  if (!demo) {
    didSchema.parse(ownerDid);
    if (!origin.startsWith('https://')) throw new Error('Live mode requires an HTTPS PUBLIC_URL.');
    if (!/^[a-f0-9]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY || ''))
      throw new Error('Live mode requires a 32-byte DATA_ENCRYPTION_KEY encoded as hex.');
  }
  return {
    demo, origin, ownerDid, tipAmounts, defaultTipAmount: tipAmounts[1],
    dataDir: resolve(process.env.DATA_DIR || '.data'),
    habitatUrl: process.env.HABITAT_URL || 'https://pear.habitat.network',
    stripeKey: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  };
};
