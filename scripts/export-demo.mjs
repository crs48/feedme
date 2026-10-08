import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { load } from 'cheerio';
import { tsImport } from 'tsx/esm/api';
import { demoPath, demoPolicy, demoOrigin, isolatedEnvironment } from './static-demo.mjs';

const { supporterTimeline } = await tsImport('../src/lib/support-timeline.ts', import.meta.url);

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'site-dist');
const temporary = await mkdtemp(join(tmpdir(), 'feedme-public-demo-'));
const reservation = createServer().listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((done) => reservation.close(done));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--import', './scripts/demo-offline.mjs', 'dist/server/entry.mjs'], {
  cwd: root, env: isolatedEnvironment(temporary, port), stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', (data) => { logs += data; });
child.stderr.on('data', (data) => { logs += data; });
const jar = new Map();
const request = async (path, data) => {
  const response = await fetch(`${origin}${path}`, {
    method: data ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(15_000),
    headers: { cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '), origin,
      ...(data ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    ...(data ? { body: new URLSearchParams(data) } : {}),
  });
  for (const entry of response.headers.getSetCookie()) {
    const [key, ...rest] = entry.split(';')[0].split('='); jar.set(key, rest.join('='));
  }
  if (response.status >= 400) throw new Error(`Demo render ${path}: HTTP ${response.status}\n${await response.text()}`);
  return response;
};
const save = async (path, body) => { const file = join(output, path); await mkdir(resolve(file, '..'), { recursive: true }); await writeFile(file, body); };
let db;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Demo server stopped: ${logs}`);
    try { await request('/'); ready = true; break; } catch { await new Promise((done) => setTimeout(done, 100)); }
  }
  if (!ready) throw new Error(`Demo server did not start: ${logs}`);
  // This database was created above in an unguessable, empty temporary directory.
  // No configuration can substitute the operator's database here.
  db = new DatabaseSync(join(temporary, 'demo.sqlite'));
  const rows = (kind) => db.prepare('SELECT value FROM records WHERE kind=?').all(kind).map((row) => JSON.parse(row.value));
  const put = (kind, value) => db.prepare('INSERT OR REPLACE INTO records VALUES (?,?,?)').run(kind, value.id || 'self', JSON.stringify(value));
  const fixtureToday = Date.parse(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`);
  const daysAgo = (days) => new Date(fixtureToday - days * 86400_000).toISOString();
  const projects = rows('project').map((project) => ({ ...project, createdAt: daysAgo(95) }));
  // Show the beyond-aspiration state as well as works in progress.
  projects.find((project) => project.id === 'field-notes').target = 15000;
  projects.forEach((project) => put('project', project));
  for (const [index, support] of rows('support').entries()) {
    put('support', { ...support, createdAt: daysAgo(index * 2.8 + 1), paidAt: daysAgo(index * 2.8 + 1) });
  }
  const seed = rows('support')[0];
  for (let index = 0; index < 12; index++) {
    put('support', { ...seed, id: `fictional-${index}`, projectId: projects[index % 3].id,
      amount: [1100, 2200, 4400, 8800][index % 4], createdAt: daysAgo(index + 1), paidAt: daysAgo(index + 1),
      visibility: index % 3 === 0 ? 'anonymous' : index % 3 === 1 ? 'private' : 'public',
      supporterDid: index % 3 === 0 ? undefined : seed.supporterDid,
      note: index % 3 === 1 ? 'Fictional note for the studio preview. Keep making good things!' : '',
      announceAnonymously: index % 3 === 0, activityId: `fictional-activity-${index}`,
    });
  }
  for (const [index, status] of ['pending', 'failed', 'refunded', 'disputed'].entries()) {
    put('support', { ...seed, id: `fictional-${status}`, projectId: projects[index % 3].id, amount: 2200,
      createdAt: daysAgo(index + 2), paidAt: status === 'pending' || status === 'failed' ? undefined : daysAgo(index + 2),
      visibility: 'private', status, refundedAmount: status === 'refunded' ? 2200 : 0, disputed: status === 'disputed', note: '' });
  }
  put('project', { ...projects[0], id: 'repair-cafe', title: 'A neighborhood repair café', summary: 'A monthly afternoon of fixing things, sharing skills, and meeting neighbors.',
    description: '## A little less waste\n\nBring a broken toaster or a favorite jacket. Let’s learn to repair things together.\n\n- Borrow tools\n- Share a skill\n- Make a friend', status: 'draft', target: 60000, image: '', category: 'Community' });
  rows('update').forEach((update, index) => put('update', { ...update, createdAt: daysAgo(index + 1) }));
  await request('/auth/demo', { role: 'supporter' });
  // Exercise the app's real demo checkout to render a legitimate fictional receipt + share card.
  const home = load(await (await request('/')).text());
  const checkout = await request('/api/checkout', {
    requestId: home('input[name=requestId]').attr('value'), amount: '22', frequency: 'monthly', visibility: 'public',
    'percentage:backyard-sauna': '50', 'percentage:open-source': '30', 'percentage:field-notes': '20',
  });
  const receiptPath = checkout.headers.get('location');
  if (!receiptPath?.startsWith('/thanks?id=')) throw new Error(`Demo checkout failed: ${receiptPath}`);
  const receipt = await (await request(receiptPath)).text();
  const sharePath = load(receipt)('[data-share-url]').attr('value');
  if (!sharePath) throw new Error('Demo checkout did not produce a public support card.');
  const shareRoute = new URL(sharePath, origin).pathname;
  const png = await request(`${shareRoute}.png`);
  await cp(join(root, 'dist/client'), output, { recursive: true });
  await save('demo/share/sample.png', Buffer.from(await png.arrayBuffer()));
  const helper = load(await readFile(join(output, 'demo-runtime/index.html'), 'utf8'));
  const runtimeAssets = helper('link[rel=stylesheet],script[src]').toString();
  if (!runtimeAssets.includes('<script')) throw new Error('Missing compiled demo controller.');
  const pick = (value, fields) => Object.fromEntries(fields.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
  const data = {
    projects: rows('project').map((p) => pick(p, ['id','title','summary','description','category','kind','status','color','target','image','link','createdAt'])),
    payments: rows('support').map((s) => ({ ...pick(s, ['id','projectId','amount','currency','visibility','supporterDid','note','status','refundedAmount','disputed','createdAt','paidAt','frequency','recurringRootId']),
      ...(s.allocations ? { allocations: s.allocations.map((part) => pick(part, ['projectId','amount'])) } : {}) })),
    subscriptions: rows('subscription').map((s) => pick(s, ['id','status','cancelAtPeriodEnd'])),
  };
  const map = (href, base) => demoPath(href, base, origin);
  const toolbar = `<aside class="static-demo-bar" aria-label="Demo navigation"><div><a class="demo-product" href="/">← Feedme</a><span>Interactive demo <span class="demo-status-dot"></span></span><a href="/get-started/">Set up your own ↗</a></div><nav aria-label="Demo screens"><a href="/demo/">Creator page</a><a href="/demo/updates/">Updates</a><a href="/demo/discover/">Discover</a><a href="/demo/studio/">Dashboard</a><a href="/demo/studio/projects/">Projects</a><a href="/demo/studio/settings/">Settings</a><a href="/demo/login/">Sign in</a><button type="button" data-demo-reset>Reset demo</button></nav><p>Fictional people and payments. Nothing is charged or published. Edits stay in this browser tab.</p></aside><div id="demo-notice" class="demo-toast" role="status" tabindex="-1" hidden></div><noscript><p class="demo-noscript">Browse every screen without JavaScript. Enable it to try simulated tips and local edits.</p></noscript>`;
  const render = async (path, target, admin = false) => {
    const response = await request(path);
    if (response.status !== 200) throw new Error(`Unexpected redirect for demo screen ${path}: ${response.headers.get('location')}`);
    const $ = load(await response.text());
    $('[http-equiv="Content-Security-Policy"]').remove();
    $('head').prepend(`<meta http-equiv="Content-Security-Policy" content="${demoPolicy}">`);
    $('head').append(runtimeAssets);
    $('.demo-strip').remove();
    $('body').attr('data-static-demo', '').attr('data-demo-screen', path.split('?')[0]);
    $('input[name=requestId]').remove();
    $('form').each((_, element) => {
      const form = $(element), action = form.attr('action') || path.split('?')[0];
      form.attr('data-demo-action', action).attr('data-demo-method', form.attr('method') || 'get').attr('action', '#demo-notice').attr('method', 'get');
      form.contents().wrapAll('<fieldset data-demo-controls disabled></fieldset>');
      if (action === '/auth/login') form.replaceWith('<p class="notice">Real sign-in uses AT Protocol OAuth on your own server. No account is needed for this demo. Choose a preview below.</p>');
    });
    $('a[href],link[href]').each((_, element) => {
      const href = $(element).attr('href');
      if ($(element).is('[data-feedme-attribution]')) return;
      if ($(element).is('link[rel=canonical]')) $(element).attr('href', `${demoOrigin}${target}`);
      else $(element).attr('href', map(href, path));
    });
    $('meta[property="og:url"]').attr('content', `${demoOrigin}${target}`);
    $('meta[property="og:image"],meta[name="twitter:image"]').each((_, element) => {
      const value = $(element).attr('content');
      if (value?.startsWith(origin)) $(element).attr('content', `${demoOrigin}${map(value, path)}`);
    });
    $('img[src]').each((_, element) => $(element).attr('src', map($(element).attr('src'), path)));
    $('body').prepend(toolbar);
    $('[data-share-url]').attr('value', `${demoOrigin}/demo/share/sample/`);
    $('.support-share').prepend('<p class="static-sample-note">Example public card · the fixed 50% / 30% / 20% split below illustrates link previews.</p>');
    $('.creator-card-actions .button').text('Meet this creator →');
    $('.admin-pagination').remove(); // The client report shows all fixture rows and filters them locally.
    if (admin) $('.admin-demo').text('Studio preview · all supporter identities, notes, and payment records below are fictional.');
    if (path.startsWith('/thanks')) {
      $('h2').filter((_, el) => $(el).text() === 'Your support breakdown').parent().attr('data-demo-breakdown', '');
      $('h1').next('p').text('This is a simulated tip. No money changed hands and no payment will recur.');
    }
    $('head').append(`<script type="application/json" id="demo-data">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>`);
    const staticPath = target.split(/[?#]/)[0];
    await save(`${staticPath.replace(/^\//, '')}index.html`, $.html());
  };
  const publicRoutes = ['/', '/updates', '/circle', '/following', '/following?view=people', '/discover', '/recommendations', '/login', '/billing', '/about', '/privacy', '/protocol',
    ...projects.map((project) => `/support/${project.id}`), ...['network','mutuals','following','followers','extended','explore'].map((view) => `/discover?view=${view}`),
    ...['a','b','c','d','e','f'].map((letter) => `/recommend?did=did:plc:${letter.repeat(24)}`), receiptPath, shareRoute];
  for (const base of ['/', ...projects.map((project) => `/support/${project.id}`)]) {
    const id = base.startsWith('/support/') ? base.split('/').at(-1) : undefined;
    const count = supporterTimeline(rows('support'), 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', id).total;
    for (let page = 1; page < Math.ceil(count / 12); page++) publicRoutes.push(`${base}?tipsPage=${page}`);
  }
  for (const path of publicRoutes) await render(path, map(path, '/'));
  await request('/auth/demo', {});
  for (const path of ['/studio', '/studio/projects', '/studio/projects/new', ...rows('project').map((project) => `/studio/projects/${project.id}`), '/studio/payments', '/studio/supporters', '/studio/updates', '/studio/settings', '/studio/stripe', '/studio/data']) {
    await render(path, map(path, '/'), true);
  }
  // Lexicons are checked-in schemas, never the public/private records described by them.
  await cp(join(root, 'lexicons'), join(output, 'lexicons'), { recursive: true });
  await rm(join(output, 'demo-runtime'), { recursive: true });
  await save('404.html', '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Not found · Feedme</title><body><main><h1>A little off the path.</h1><p>This demo page does not exist.</p><a href="/">About Feedme</a> · <a href="/demo/">Explore the demo</a></main></body></html>');
  await save('robots.txt', 'User-agent: *\nDisallow: /demo/\nSitemap: https://feedme.fund/sitemap.xml\n');
  await save('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://feedme.fund/</loc></url><url><loc>https://feedme.fund/get-started/</loc></url></urlset>');
  await save('.nojekyll', '');
  console.log(`Exported ${publicRoutes.length + 11} demo screens from a fresh fictional database. No provider requests or live data.`);
} finally {
  db?.close(); child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((done) => setTimeout(done, 5000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(temporary, { recursive: true, force: true });
}
