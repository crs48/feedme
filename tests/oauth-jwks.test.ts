import { describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import { JoseKey } from '@atproto/jwk-jose';
const mock = vi.hoisted(() => ({ oauthClient: vi.fn() }));
vi.mock('../src/lib/auth', () => ({ oauthClient: mock.oauthClient }));
import { GET } from '../src/pages/jwks.json';

describe('OAuth signing-key discovery', () => {
  it('publishes a signing key Habitat can select and verify without changing key material', async () => {
    const key = await JoseKey.generate(['ES256'], 'feedme-1');
    const originalPublic = key.publicJwk!;
    if (originalPublic.kty !== 'EC') throw new Error('Expected EC test key');
    // Reimport the same persisted private key, as an existing deployment does.
    const restored = await JoseKey.fromJWK(key.privateJwk!);
    mock.oauthClient.mockResolvedValue({ jwks: { keys: [restored.publicJwk] } });
    const response = await GET({} as APIContext);
    expect(response.status).toBe(200);
    const { keys } = await response.json();
    const published = keys.find((entry: { kid: string; use: string }) => entry.kid === key.kid && entry.use === 'sig');
    expect(published).toEqual({ kty: 'EC', kid: 'feedme-1', crv: 'P-256', x: originalPublic.x, y: originalPublic.y,
      alg: 'ES256', use: 'sig', key_ops: ['verify'] });
    const token = await restored.createJwt({ alg: 'ES256' }, { iss: 'https://feedme.example/oauth-client-metadata.json', exp: Math.floor(Date.now() / 1000) + 60 });
    const publicKey = await JoseKey.fromJWK(published);
    expect((await publicKey.verifyJwt(token)).payload.iss).toBe('https://feedme.example/oauth-client-metadata.json');
  });
  it('does not publish private parameters even if supplied by the adapter', async () => {
    const key = await JoseKey.generate(['ES256'], 'feedme-1');
    mock.oauthClient.mockResolvedValue({ jwks: { keys: [key.privateJwk] } });
    const { keys } = await (await GET({} as APIContext)).json();
    expect(keys).toHaveLength(1);
    expect(Object.keys(keys[0]).sort()).toEqual(['alg', 'crv', 'key_ops', 'kid', 'kty', 'use', 'x', 'y']);
  });
  it('fails closed when key discovery is unavailable', async () => {
    mock.oauthClient.mockRejectedValue(new Error('secret diagnostics'));
    const response = await GET({} as APIContext);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ keys: [] });
  });
});
