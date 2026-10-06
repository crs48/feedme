import { describe, expect, it } from 'vitest';
import { publicOrigin } from '../src/lib/config';

describe('deployment origins', () => {
  it.each([
    [{ RENDER_EXTERNAL_URL: 'https://feedme-example.onrender.com' }, 'https://feedme-example.onrender.com'],
    [{ RAILWAY_PUBLIC_DOMAIN: 'feedme-example.up.railway.app' }, 'https://feedme-example.up.railway.app'],
    [{ KOYEB_PUBLIC_DOMAIN: 'feedme-example.koyeb.app' }, 'https://feedme-example.koyeb.app'],
    [{ FLY_APP_NAME: 'feedme-example' }, 'https://feedme-example.fly.dev'],
  ])('uses the host origin without hardcoding the generated hostname', (env, expected) => {
    expect(publicOrigin(env)).toBe(expected);
    expect(publicOrigin({ ...env, PUBLIC_URL: 'https://support.example.com/' })).toBe('https://support.example.com');
  });

  it('keeps local defaults and does not derive origins from HTTP request headers', () => {
    expect(publicOrigin({})).toBe('http://127.0.0.1:4321');
    expect(publicOrigin({ HOST: '0.0.0.0', PORT: '10000', HTTP_HOST: 'attacker.example' })).toBe('http://127.0.0.1:4321');
    expect(() => publicOrigin({ PUBLIC_URL: 'invalid', RENDER_EXTERNAL_URL: 'https://valid.onrender.com' })).toThrow();
  });

  it('normalizes the planned crs.tips origin and keeps it canonical over provider domains', () => {
    expect(publicOrigin({ PUBLIC_URL: 'https://crs.tips/', RAILWAY_PUBLIC_DOMAIN: 'generated.up.railway.app', HTTP_HOST: 'attacker.example' })).toBe('https://crs.tips');
  });
});
