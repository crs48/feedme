import { describe, it, expect } from 'vitest';
import { demoPath, demoPolicy, isolatedEnvironment } from '../../scripts/static-demo.mjs';

describe('public demo build boundaries', () => {
  it('cannot inherit live configuration, data paths, keys, or Node preload hooks', () => {
    const env = isolatedEnvironment('/tmp/fresh-fixtures', 4567, {
      PATH: '/bin', FEEDME_MODE: 'live', DATA_DIR: '/private/real-data', PUBLIC_URL: 'https://real.example',
      STRIPE_SECRET_KEY: 'do-not-inherit', DATA_ENCRYPTION_KEY: 'do-not-inherit', HABITAT_URL: 'https://real-provider.example',
      OWNER_DID: 'did:web:real.example', NODE_OPTIONS: '--import=untrusted.mjs',
    });
    expect(env).toEqual({ PATH: '/bin', NODE_ENV: 'production', FEEDME_MODE: 'demo', DATA_DIR: '/tmp/fresh-fixtures',
      PUBLIC_URL: 'http://127.0.0.1:4567', HOST: '127.0.0.1', PORT: '4567', BLUESKY_HANDLE: 'alex.example.com', TIP_AMOUNTS: '11,22,44,88' });
  });
  it('blocks forms and network requests even before the demo controller loads', () => {
    expect(demoPolicy).toContain("form-action 'none'");
    expect(demoPolicy).toContain("connect-src 'none'");
    expect(demoPolicy).toContain("frame-src 'none'");
    expect(demoPolicy).toContain("script-src 'self';");
  });
  it.each([
    ['/', '/demo/'], ['/support/sauna#story', '/demo/support/sauna/#story'],
    ['/discover?view=extended', '/demo/discover/extended/'], ['/following?view=people', '/demo/following/people/'],
    ['/thanks?id=receipt-secret', '/demo/thanks/'], ['/share/opaque', '/demo/share/sample/'],
    ['/share/opaque.png', '/demo/share/sample.png'], ['/auth/login?returnTo=/studio', '/demo/login/'],
    ['/api/admin/export', '#demo-export'], ['/api/stripe/webhook', '/get-started/'],
    ['/demo/avatars/12.jpg', '/demo/avatars/12.jpg'], ['/_astro/site.css', '/_astro/site.css'],
    ['/lexicons/fund.feedme.profile.json', '/lexicons/fund.feedme.profile.json'], ['#story', '#story'],
    ['/?tipsPage=1#supporters', '/demo/tips/1/#supporters'],
    ['https://bsky.app/profile/did%3Aplc%3Adddddddddddddddddddddddd', '/demo/following/people/'],
    ['https://github.com/crs48/feedme', 'https://github.com/crs48/feedme'], ['https://maya.example.com', '/demo/recommend/dddddddddddddddddddddddd/'],
    ['https://example.com/garden', '/demo/recommend/dddddddddddddddddddddddd/'],
  ])('maps %s to a static destination', (source, expected) => expect(demoPath(source)).toBe(expected));
  it('rewrites the isolated build server origin without carrying over a receipt ID', () => {
    expect(demoPath('http://127.0.0.1:4567/share/id.png', '/', 'http://127.0.0.1:4567')).toBe('/demo/share/sample.png');
  });
});
