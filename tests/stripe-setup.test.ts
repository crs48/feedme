import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ demo: false, key: '', webhook: '', account: undefined as string | undefined, space: undefined as string | undefined, retrieve: vi.fn() }));
vi.mock('../src/lib/config', () => ({ config: () => ({ demo: mock.demo, stripeKey: mock.key, stripeWebhookSecret: mock.webhook, origin: 'https://feedme.example' }) }));
vi.mock('../src/lib/habitat', () => ({ privateSpace: () => mock.space }));
vi.mock('../src/lib/payments', () => ({ connectedAccount: () => mock.account, stripeClient: () => ({ accounts: { retrieve: mock.retrieve } }) }));
import { stripeSetup, stripeKeyMode } from '../src/lib/stripe-setup';

describe('Stripe onboarding readiness', () => {
  beforeEach(() => { mock.demo = false; mock.key = ''; mock.webhook = ''; mock.account = undefined; mock.space = undefined; mock.retrieve.mockReset(); });
  it('shows missing setup without making a provider request', async () => {
    expect(await stripeSetup()).toMatchObject({ keyConfigured: false, webhookConfigured: false, accountCheck: 'not-checked', accountConnected: false, storageConnected: false, webhookUrl: 'https://feedme.example/api/stripe/webhook' });
    expect(mock.retrieve).not.toHaveBeenCalled();
  });
  it.each(['sk_test_example', 'rk_test_example'])('recognizes test credentials: %s', key => expect(stripeKeyMode(key)).toBe('test'));
  it.each(['sk_live_example', 'rk_live_example'])('recognizes live credentials: %s', key => expect(stripeKeyMode(key)).toBe('live'));
  it('does not treat a publishable key as a server key mode', () => expect(stripeKeyMode('pk_live_example')).toBe('unknown'));
  it('checks Stripe flags instead of equating an account link or return with readiness', async () => {
    mock.key = 'rk_test_secret'; mock.webhook = 'whsec_secret'; mock.account = 'acct_creator'; mock.space = 'at://private';
    mock.retrieve.mockResolvedValue({ id: mock.account, details_submitted: true, charges_enabled: false, payouts_enabled: false, business_profile: { name: 'Private business name' }, external_accounts: { data: ['bank-secret'] } });
    const result = await stripeSetup();
    expect(result).toMatchObject({ accountCheck: 'verified', detailsSubmitted: true, chargesEnabled: false, payoutsEnabled: false });
    expect(mock.retrieve).toHaveBeenCalledWith(mock.account, {}, { timeout: 5000, maxNetworkRetries: 0 });
    expect(JSON.stringify(result)).not.toMatch(/rk_test_secret|whsec_secret|bank-secret|Private business name/);
    mock.retrieve.mockResolvedValue({ id: mock.account, details_submitted: true, charges_enabled: true, payouts_enabled: true });
    expect(await stripeSetup()).toMatchObject({ chargesEnabled: true, payoutsEnabled: true });
  });
  it('keeps provider failures private and never declares a failed check ready', async () => {
    mock.key = 'sk_live_secret'; mock.account = 'acct_creator';
    mock.retrieve.mockRejectedValue(new Error('Provider details sk_live_secret'));
    expect(await stripeSetup()).toMatchObject({ accountCheck: 'unavailable', chargesEnabled: false, payoutsEnabled: false });
    expect(JSON.stringify(await stripeSetup())).not.toContain('secret');
  });
  it('rejects a mismatched account and keeps demo rendering offline', async () => {
    mock.key = 'sk_live_secret'; mock.account = 'acct_creator';
    mock.retrieve.mockResolvedValue({ id: 'acct_other', charges_enabled: true, payouts_enabled: true });
    expect(await stripeSetup()).toMatchObject({ accountCheck: 'unavailable', chargesEnabled: false });
    mock.retrieve.mockClear(); mock.demo = true;
    expect(await stripeSetup()).toMatchObject({ demo: true, accountCheck: 'not-checked' });
    expect(mock.retrieve).not.toHaveBeenCalled();
  });
});
