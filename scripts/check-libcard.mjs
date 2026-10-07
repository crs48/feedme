// Exercise the built app through plain HTTP forms. No browser JavaScript or live providers.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { load } from 'cheerio';
import { isolatedEnvironment } from './static-demo.mjs';

const root = resolve(import.meta.dirname, '..');
const dir = await mkdtemp(join(tmpdir(), 'feedme-libcard-check-'));
const reservation = createServer().listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(done => reservation.close(done));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--import', './scripts/demo-offline.mjs', 'dist/server/entry.mjs'], {
  cwd: root, env: { ...isolatedEnvironment(dir, port), LIBCARD_REPO: 'example/card' }, stdio: ['ignore','pipe','pipe'],
});
let logs = ''; child.stdout.on('data', data => logs += data); child.stderr.on('data', data => logs += data);
const jar = new Map();
const request = async (path, body, cookies = jar) => {
  const response = await fetch(`${origin}${path}`, { method: body ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000),
    headers: { origin, cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; '), ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    ...(body ? { body: body instanceof URLSearchParams ? body : new URLSearchParams(body) } : {}) });
  for (const entry of response.headers.getSetCookie()) { const [key, ...value] = entry.split(';')[0].split('='); cookies.set(key, value.join('=')); }
  return response;
};
const page = async (path, body) => {
  const response = await request(path,body); assert.equal(response.status,200, `${path}: ${await response.clone().text()}`);
  return load(await response.text());
};
const fields = $ => {
  const result = new URLSearchParams();
  $('form[data-pick-visit] input[name],form[data-pick-visit] textarea[name],form[data-pick-visit] select[name]').each((_,el) => {
    const input = $(el), type = input.attr('type');
    if (input.is('[disabled]') || (['checkbox','radio'].includes(type) && !input.is('[checked]'))) return;
    result.set(input.attr('name'), String(input.val() || ''));
  });
  return result;
};
try {
  let ready = false;
  for (let i=0;i<100;i++) {
    if (child.exitCode !== null) throw new Error(logs);
    try { if ((await request('/')).status === 200) { ready = true; break; } } catch { /* Await startup. */ }
    await new Promise(done => setTimeout(done,100));
  }
  assert.ok(ready, logs);
  const initial = fields(await page('/'));
  assert.equal(initial.get('amount'),'22.00');
  assert.equal([...initial].filter(([key]) => key.startsWith('pick:')).length,9);
  const automatic = [...initial.keys()].filter(key => key.startsWith('pick:auto-'));
  assert.equal(automatic.length,3);
  const prefilled = fields(await page(`/checkout?${encodeURIComponent(automatic[0].slice(5))}=2`));
  assert.equal(prefilled.get(automatic[0]),'2');
  assert.ok([...initial].filter(([key]) => key.startsWith('pick:')).every(([,v]) => v === '0'));
  const publicBefore = await (await request('/api/public/libcard')).json();
  assert.ok(publicBefore.targets.every(p => p.publicCount === 0 && p.publicShareMillis === 0));
  initial.set('intent','all'); initial.set('note','fixture-private-note');
  const equal = fields(await page('/checkout', initial));
  assert.ok([...equal].filter(([key]) => key.startsWith('pick:')).every(([,v]) => v === '1'));
  equal.set('intent','amount-4400');
  const larger = fields(await page('/checkout',equal)); assert.equal(larger.get('amount'),'44.00'); assert.equal(larger.get('pick:x'),'1');
  larger.set('intent','creator');
  const selected = fields(await page('/checkout',larger)); assert.equal(selected.get('pick:x'),'0'); assert.equal(selected.get('pick:creator'),'1');
  selected.set('pick:presence','3'); selected.set('visibility','public'); selected.set('frequency','monthly'); selected.set('intent','review');
  const posted = await request('/api/checkout/review',selected); assert.equal(posted.status,303);
  const reviewUrl = posted.headers.get('location'); assert.ok(reviewUrl.startsWith('/checkout/review?token=')); assert.ok(!reviewUrl.includes('fixture-private-note'));
  const reviewResponse = await request(reviewUrl); assert.equal(reviewResponse.headers.get('cache-control'),'private, no-store');
  const review = load(await reviewResponse.text()); assert.match(review.text(),/\$11/); assert.match(review.text(),/\$33/); assert.match(review.text(),/fixture-private-note/);
  const token = new URL(reviewUrl,origin).searchParams.get('token');
  const outsider = await page('/checkout'); // Refreshing a form must not invalidate another review in this browser.
  assert.ok(outsider('input[name=requestId]').val());
  const wrongBrowser = await request(reviewUrl, undefined, new Map()); assert.equal(wrongBrowser.status,400);
  const login = await request('/auth/demo',{role:'supporter',returnTo:reviewUrl}); assert.equal(login.headers.get('location'),reviewUrl);
  const identified = await page(reviewUrl); assert.ok(identified('form[action="/api/checkout"] input[name=reviewId]').val());
  const edited = fields(await page('/checkout',{editReview:token})); assert.equal(edited.get('note'),'fixture-private-note'); assert.equal(edited.get('amount'),'44.00'); assert.equal(edited.get('pick:presence'),'3');
  const final = await request('/api/checkout',{reviewId:token}); assert.equal(final.status,303); assert.ok(final.headers.get('location').startsWith('/thanks?id='));
  const repeated = await request('/api/checkout',{reviewId:token}); assert.equal(repeated.headers.get('location'),final.headers.get('location'));
  const receipt = await page(final.headers.get('location')); assert.match(receipt.text(),/No money changed hands/);
  const publicResponse = await request('/api/public/libcard'); assert.equal(publicResponse.headers.get('cache-control'),'public, max-age=60');
  const signal = await publicResponse.json(); assert.equal(signal.defaultAmountCents,2200);
  assert.deepEqual(signal.targets.slice(0,2).map(p => [p.publicCount,p.publicShareMillis]),[[1,250],[1,750]]);
  assert.ok(!JSON.stringify(signal).includes('fixture-private-note'));
  const shareUrl = new URL(receipt('[data-share-url]').val());
  const share = await page(shareUrl.pathname); assert.equal(share('.share-allocation').length,0); assert.match(share.text(),/\$3,000 aspiration/);
  const image = await request(`${shareUrl.pathname}.png`); assert.equal(image.status,200); assert.equal(image.headers.get('content-type'),'image/png');
  for (const visibility of ['anonymous','private']) {
    const f = fields(await page('/checkout?creator=1')); f.set('visibility',visibility); f.set('intent','review');
    const response = await request('/api/checkout/review', f); const next = response.headers.get('location'); await page(next);
    const id = new URL(next,origin).searchParams.get('token'); assert.equal((await request('/api/checkout',{reviewId:id})).status,303);
  }
  assert.deepEqual(await (await request('/api/public/libcard')).json(),signal);
  const old = fields(await page('/checkout?gone=1&x=10')); assert.ok([...old].filter(([key]) => key.startsWith('pick:')).every(([,v]) => v === '0'));
  await request('/auth/demo', {role:'admin'});
  const studio = await page('/studio/projects'); assert.match(studio.text(),/From LibCard/);
  const automaticReview = fields(await page('/checkout'));
  automaticReview.set(automatic[0], '1'); automaticReview.set('intent', 'review');
  const autoPosted = await request('/api/checkout/review', automaticReview); assert.equal(autoPosted.status,303);
  const autoReviewUrl = autoPosted.headers.get('location');
  const autoReview = await page(autoReviewUrl); assert.match(autoReview.text(), /Résumé/);
  await request('/api/studio',{action:'libcard-override',id:automatic[0].slice(5),hidden:'yes',aspiration:'',returnTo:'/studio/projects'});
  assert.ok(!fields(await page('/')).has(automatic[0]));
  assert.ok(!(await (await request('/api/public/libcard')).json()).targets.some(p => p.id === automatic[0].slice(5)));
  const autoToken = new URL(autoReviewUrl,origin).searchParams.get('token');
  const unavailable = await request('/api/checkout',{reviewId:autoToken});
  assert.ok(unavailable.headers.get('location').includes('no%20longer'));
  await request('/api/studio',{action:'libcard-override',id:'presence',hidden:'yes',aspiration:'5000',returnTo:'/studio/projects'});
  assert.ok(!(await (await request('/api/public/libcard')).json()).targets.some(p => p.id === 'presence'));
  console.log('LibCard HTTP smoke passed: offline fixture, no-JS shortcuts, prefill, review/edit/sign-in, exact allocation, idempotency, privacy, public API, share PNG, and Studio overrides.');
} finally {
  child.kill('SIGTERM');
  if (child.exitCode === null) await Promise.race([once(child,'exit'),new Promise(done => setTimeout(done,5000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(dir,{recursive:true,force:true});
}
