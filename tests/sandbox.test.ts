import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/lib/config';
import { assertDatabaseMode, getKv, openDatabase, setKv } from '../src/lib/db';
import { GET as declaration } from '../src/pages/.well-known/feedme';

describe('sandbox configuration and storage boundary', () => {
  beforeEach(() => {
    vi.stubEnv('FEEDME_MODE', 'sandbox'); vi.stubEnv('PUBLIC_URL', 'https://test.creator.example');
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'a'.repeat(64)); vi.stubEnv('STRIPE_ENVIRONMENT', '');
    vi.stubEnv('STRIPE_SECRET_KEY', ''); vi.stubEnv('STRIPE_MODE', 'connect');
  });
  afterEach(() => vi.unstubAllEnvs());
  it('uses real identity/payment paths and defaults to the test environment', () => {
    expect(config()).toMatchObject({ demo: false, sandbox: true, stripeEnvironment: 'test' });
    for (const key of ['rk_test_fixture', 'sk_test_fixture']) {
      vi.stubEnv('STRIPE_SECRET_KEY', key); expect(config().stripeKey).toBe(key);
    }
  });
  it('rejects live or unrecognized keys and live environment overrides before requests', () => {
    for (const key of ['rk_live_fixture', 'sk_live_fixture', 'pk_test_fixture', 'invalid']) {
      vi.stubEnv('STRIPE_SECRET_KEY', key); expect(() => config()).toThrow('Stripe test key');
    }
    vi.stubEnv('STRIPE_SECRET_KEY', 'rk_test_fixture'); vi.stubEnv('STRIPE_ENVIRONMENT', 'live');
    expect(() => config()).toThrow('STRIPE_ENVIRONMENT=test');
  });
  it('requires HTTPS and encryption, and excludes sandbox instances from discovery', async () => {
    const response = await declaration({} as Parameters<typeof declaration>[0]);
    expect(response.status).toBe(404);
    vi.stubEnv('PUBLIC_URL', 'http://test.creator.example'); expect(() => config()).toThrow('HTTPS');
    vi.stubEnv('PUBLIC_URL', 'https://test.creator.example'); vi.stubEnv('DATA_ENCRYPTION_KEY', '');
    expect(() => config()).toThrow('DATA_ENCRYPTION_KEY');
  });
  it('pins a fresh database and rejects either direction of mode switching', () => {
    for (const sandbox of [true, false]) {
      const db = openDatabase(':memory:');
      try {
        assertDatabaseMode(db, { demo: false, sandbox });
        expect(getKv(db, 'app', 'deployment-mode')).toBe(sandbox ? 'sandbox' : 'live');
        assertDatabaseMode(db, { demo: false, sandbox });
        expect(() => assertDatabaseMode(db, { demo: false, sandbox: !sandbox })).toThrow('different deployment mode');
      } finally { db.close(); }
    }
  });
  it('treats preexisting, unmarked databases as live even without payment history', () => {
    const db = openDatabase(':memory:');
    try {
      setKv(db, 'app', 'initialized', true);
      expect(() => assertDatabaseMode(db, { demo: false, sandbox: true })).toThrow('different deployment mode');
      assertDatabaseMode(db, { demo: false, sandbox: false });
      expect(getKv(db, 'app', 'deployment-mode')).toBe('live');
    } finally { db.close(); }
  });
});
