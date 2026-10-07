import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { load } from 'cheerio';
import { demoPolicy } from './static-demo.mjs';
const root = resolve(import.meta.dirname, '../site-dist');
const walk = async (path) => (await Promise.all((await readdir(path, { withFileTypes: true })).map(async (entry) => {
  assert(!entry.isSymbolicLink(), `Artifact cannot contain symlinks: ${entry.name}`);
  const file = join(path, entry.name); return entry.isDirectory() ? walk(file) : [file];
}))).flat();
const files = await walk(root), all = new Set(files), html = files.filter((file) => file.endsWith('.html'));
const exists = (url) => all.has(join(root, decodeURIComponent(url.pathname))) || all.has(join(root, decodeURIComponent(url.pathname), 'index.html'));
let links = 0;
for (const file of files) assert(!/(?:\/server\/|\.sqlite|\.env(?:\.|$)|\.pem$|jwks\.json|oauth-client-metadata\.json)/.test(file), `Non-public file: ${file}`);
for (const file of html) {
  const source = await readFile(file, 'utf8'), $ = load(source), relative = file.slice(root.length).replace(/index\.html$/, '');
  assert($('h1').length === 1, `Expected one main heading: ${relative}`);
  if (/^\/libcard\//.test(relative)) {
    assert($('title').text().includes('LibCard'), `Missing LibCard page title: ${relative}`);
    assert($('meta[name=description]').attr('content')?.length > 50, `Missing guide description: ${relative}`);
    assert.equal($('link[rel=canonical]').attr('href'), `https://feedme.fund${relative}`);
    assert.equal($('script:not([type="application/json"]),form,iframe').length, 0, `Integration guides must remain static: ${relative}`);
    assert($('nav[aria-label="Main navigation"] a.libcard-nav[href="/libcard/"]').length === 1, `Missing mobile LibCard navigation: ${relative}`);
    const related = relative === '/libcard/' ? '/libcard/setup/' : '/libcard/';
    assert($(`main a[href="${related}"]`).length > 0, `Missing related integration page: ${relative}`);
  }
  const demo = $('body').is('[data-static-demo]');
  if (demo) {
    assert.equal($('meta[http-equiv="Content-Security-Policy"]').attr('content'), demoPolicy, `Missing offline CSP: ${relative}`);
    assert.equal($('input[name=requestId]').length, 0, `Server form token leaked: ${relative}`);
    assert.equal($('script:not([src]):not([type="application/json"])').length, 0, `Inline executable script: ${relative}`);
    $('form').each((_, form) => {
      assert.equal($(form).attr('action'), '#demo-notice');
      assert.equal($(form).attr('method'), 'get');
      assert($(form).children('fieldset[data-demo-controls][disabled]').length === 1, `Form must fail closed without JS: ${relative}`);
    });
  }
  for (const [selector, attribute] of [['a[href],link[href]', 'href'], ['img[src],script[src],source[src],video[src]', 'src'], ['meta[property="og:image"],meta[name="twitter:image"]', 'content']]) {
    $(selector).each((_, el) => {
      const value = $(el).attr(attribute); if (!value || value.startsWith('#') || /^(mailto:|tel:|data:)/.test(value)) return;
      const url = new URL(value, `https://feedme.fund${relative}`);
      assert(!/^(127\.0\.0\.1|localhost)$/.test(url.hostname), `Loopback URL in artifact: ${value}`);
      if (url.origin !== 'https://feedme.fund') {
        assert(attribute === 'href', `Remote resource in offline demo: ${value}`); return;
      }
      assert(!/^\/(?:api|auth)\//.test(url.pathname), `Live endpoint linked: ${value}`);
      assert(exists(url), `Broken local link from ${relative}: ${value}`); links++;
    });
  }
  $('img[srcset],source[srcset]').each((_, el) => $(el).attr('srcset').split(',').forEach((candidate) => {
    const url = new URL(candidate.trim().split(/\s+/)[0], `https://feedme.fund${relative}`);
    assert(url.origin === 'https://feedme.fund' && exists(url), `Missing responsive image: ${url}`);
  }));
}
for (const route of ['', 'get-started/', 'libcard/', 'libcard/setup/', 'demo/', 'demo/studio/', 'demo/studio/projects/new/', 'demo/studio/payments/', 'demo/studio/supporters/', 'demo/studio/updates/', 'demo/studio/settings/', 'demo/thanks/', 'demo/share/sample/', 'demo/discover/extended/', 'demo/billing/', 'demo/login/', 'demo/following/people/']) assert(all.has(join(root, route, 'index.html')), `Missing screen: ${route}`);
const png = await readFile(join(root, 'demo/share/sample.png'));
assert(all.has(join(root, 'creators/index.html')), 'Missing real creator directory.');
const directorySource = await readFile(join(root, 'directory/v1.json'), 'utf8');
assert(Buffer.byteLength(directorySource) <= 2_000_000, 'Directory snapshot is too large.');
const directory = JSON.parse(directorySource);
assert.equal(directory.schemaVersion, 1);
assert.deepEqual(Object.keys(directory).sort(), ['creators', 'generatedAt', 'schemaVersion', 'source']);
const creatorFields = new Set(['did', 'handle', 'name', 'bio', 'url', 'profileUri', 'profileCid', 'advertisementCheckedAt', 'siteCheckedAt', 'lastVerifiedAt', 'siteStatus']);
for (const creator of directory.creators) {
  assert(Object.keys(creator).every(key => creatorFields.has(key)), 'Unexpected field in public directory.');
  assert.equal(creator.profileUri, `at://${creator.did}/fund.feedme.profile/self`);
  assert(!creator.url || (creator.siteStatus === 'reachable' && creator.lastVerifiedAt), 'Unverified directory link.');
}
assert.equal(png.subarray(1,4).toString(), 'PNG'); assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
assert((await stat(join(root, 'index.html'))).size < 50_000, 'Keep the landing page small.');
console.log(`Static site verified: ${html.length} HTML pages, ${links} local links/assets, offline forms, no server files, 1200×630 share image.`);
