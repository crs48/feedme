export const demoOrigin = 'https://feedme.fund';
export const demoPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; media-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";

// A clean child environment is essential: builds must never inherit live credentials or data paths.
export const isolatedEnvironment = (dataDir, port, env = process.env) => ({
  PATH: env.PATH || '', NODE_ENV: 'production', FEEDME_MODE: 'demo',
  DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}`, HOST: '127.0.0.1', PORT: String(port),
  BLUESKY_HANDLE: 'alex.example.com', TIP_AMOUNTS: '11,22,44,88',
  LIBCARD_REPO: 'example/libcard', LIBCARD_DEMO_SOURCE: 'fixture', LIBCARD_DEFAULT_SUPPORT: 'all',
});
export const demoPath = (input, base = '/', origin = demoOrigin) => {
  if (!input || input.startsWith('#') || /^(mailto:|tel:|data:)/.test(input)) return input;
  const url = new URL(input, new URL(base, origin));
  if (url.origin !== origin && url.origin !== demoOrigin) {
    if (url.hostname === 'example.com' || url.hostname.endsWith('.example.com')) {
      const letter = ({ maya: 'd', jamie: 'e', jordan: 'c', sam: 'b', devon: 'f' })[url.hostname.split('.')[0]] || (url.pathname === '/garden' ? 'd' : url.pathname === '/press' ? 'e' : 'a');
      return `/demo/recommend/${letter.repeat(24)}/`;
    }
    if (url.hostname === 'bsky.app' && decodeURIComponent(url.pathname).includes('did:plc:')) return '/demo/following/people/';
    return input;
  }
  const path = url.pathname;
  if (/^\/(?:_astro|fonts)\//.test(path) || /^\/demo\/(avatars|projects)\//.test(path) || /\.(svg|jpg|webp|woff2?|png|ico|webmanifest|json|css|js)$/.test(path)) {
    return path.startsWith('/share/') ? '/demo/share/sample.png' : path;
  }
  if (path === '/api/admin/export') return '#demo-export';
  if (path.startsWith('/auth/')) return '/demo/login/';
  if (path.startsWith('/api/')) return '/get-started/';
  if (path === '/thanks' || path.startsWith('/share/')) return path === '/thanks' ? '/demo/thanks/' : '/demo/share/sample/';
  if (path === '/checkout/review') return '/demo/checkout/review/';
  if (path === '/checkout') return `/demo/checkout/${url.search}${url.hash}`;
  if (path === '/discover') return `/demo/discover/${url.searchParams.get('view') ? `${url.searchParams.get('view')}/` : ''}`;
  if (path === '/following') return url.searchParams.get('view') === 'people' ? '/demo/following/people/' : '/demo/following/';
  if (path === '/recommend') return `/demo/recommend/${url.searchParams.get('did')?.split(':').at(-1) || 'dddddddddddddddddddddddd'}/`;
  if (['/studio', '/studio/payments', '/studio/supporters'].includes(path)) return `/demo${path}/${url.search}`;
  const tipsPage = Number(url.searchParams.get('tipsPage'));
  if (Number.isInteger(tipsPage) && tipsPage > 0) return `/demo${path === '/' ? '/' : `${path}/`}tips/${tipsPage}/${url.hash}`;
  return `/demo${path === '/' ? '/' : `${path.replace(/\/$/, '')}/`}${url.hash}`;
};
