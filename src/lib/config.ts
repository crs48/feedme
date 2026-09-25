import { resolve } from 'node:path';
import { didSchema } from './model';

export const config = () => {
  const demo = process.env.FEEDME_MODE !== 'live';
  const origin = new URL(process.env.PUBLIC_URL || 'http://127.0.0.1:4321').origin;
  const ownerDid = demo ? 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' : (process.env.OWNER_DID || '');
  if (!demo) {
    didSchema.parse(ownerDid);
    if (!origin.startsWith('https://')) throw new Error('Live mode requires an HTTPS PUBLIC_URL.');
    if (!/^[a-f0-9]{64}$/i.test(process.env.DATA_ENCRYPTION_KEY || ''))
      throw new Error('Live mode requires a 32-byte DATA_ENCRYPTION_KEY encoded as hex.');
  }
  return {
    demo, origin, ownerDid,
    dataDir: resolve(process.env.DATA_DIR || '.data'),
    habitatUrl: process.env.HABITAT_URL || 'https://pear.habitat.network',
    stripeKey: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  };
};
