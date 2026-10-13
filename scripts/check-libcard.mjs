// Exercise the built app through plain HTTP forms. No browser JavaScript or live providers.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
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
  const home = await page('/');
  // The browser's implicit Enter action is the first submit button in tree order.
  const defaultSubmit = home('form[data-pick-visit] button').filter((_, el) => !['button', 'reset'].includes(home(el).attr('type'))).first();
  assert.equal(defaultSubmit.attr('name'), 'intent'); assert.equal(defaultSubmit.attr('value'), 'review');
  assert.equal(defaultSubmit.attr('formaction'), undefined, 'Enter must review, never activate a preset or pick shortcut.');
  const initial = fields(home);
  assert.equal(initial.get('amount'),'22.00');
  assert.equal([...initial].filter(([key]) => key.startsWith('pick:')).length,9);
  const automatic = [...initial.keys()].filter(key => key.startsWith('pick:auto-'));
  assert.equal(automatic.length,3);
  const prefilled = fields(await page(`/checkout?${encodeURIComponent(automatic[0].slice(5))}=2`));
  assert.equal(prefilled.get(automatic[0]),'2');
  assert.ok([...initial].filter(([key]) => key.startsWith('pick:')).every(([key,v]) => v === (key === 'pick:creator' ? '1' : '0')));
  const publicBefore = await (await request('/api/public/libcard')).json();
  const automaticTarget = publicBefore.targets.find(p => p.id === automatic[0].slice(5));
  assert.ok(automaticTarget);
  assert.ok(publicBefore.targets.every(p => p.publicCount === 0 && p.publicShareMillis === 0));
  initial.set('intent','all'); initial.set('note','fixture-private-note');
  const equal = fields(await page('/checkout', initial));
  assert.ok([...equal].filter(([key]) => key.startsWith('pick:')).every(([key,v]) => v === (key === 'pick:creator' ? '0' : '1')));
  equal.set('intent','amount-4400');
  const larger = fields(await page('/checkout',equal)); assert.equal(larger.get('amount'),'44.00'); assert.equal(larger.get('pick:x'),'1');
  larger.set('intent','creator');
  const selected = fields(await page('/checkout',larger)); assert.equal(selected.get('pick:x'),'0'); assert.equal(selected.get('pick:creator'),'1');
  selected.set('pick:presence','3'); selected.set('pick:x','1'); selected.set('visibility','public'); selected.set('frequency','monthly'); selected.set('intent','review');
  const posted = await request('/api/checkout/review',selected); assert.equal(posted.status,303);
  const reviewUrl = posted.headers.get('location'); assert.ok(reviewUrl.startsWith('/checkout/review?token=')); assert.ok(!reviewUrl.includes('fixture-private-note'));
  const reviewResponse = await request(reviewUrl); assert.equal(reviewResponse.headers.get('cache-control'),'private, no-store');
  const review = load(await reviewResponse.text()); assert.match(review.text(),/\$11/); assert.match(review.text(),/\$33/); assert.match(review.text(),/fixture-private-note/);
  const token = new URL(reviewUrl,origin).searchParams.get('token');
  const loginLink = review('a').filter((_, el) => review(el).text() === 'Sign in with Bluesky').last().attr('href');
  assert.ok(loginLink, 'Named review must explain Bluesky sign-in.');
  const loginPage = await page(loginLink);
  assert.equal(loginPage('form[action="/auth/login"] input[name=returnTo]').val(), reviewUrl);
  assert.equal(loginPage('a[href="https://bsky.app/"]').attr('target'), '_blank', 'Signup must preserve the gift tab.');
  const badHandle = await request('/auth/login', { handle: 'missing-full-handle', returnTo: reviewUrl });
  const retryUrl = new URL(badHandle.headers.get('location'), origin);
  assert.equal(retryUrl.searchParams.get('returnTo'), reviewUrl);
  assert.equal((await page(retryUrl.pathname + retryUrl.search))('input[name=editReview]').val(), token);
  const anonymous = await request('/api/checkout/review', { intent: 'anonymous', editReview: token });
  const anonymousUrl = anonymous.headers.get('location');
  assert.ok(anonymousUrl.startsWith('/checkout/review?token=') && anonymousUrl !== reviewUrl);
  const anonymousReview = await page(anonymousUrl);
  assert.match(anonymousReview.text(), /No account or sign-in needed/);
  assert.match(anonymousReview.text(), /fixture-private-note/); assert.match(anonymousReview.text(), /Monthly/);
  assert.equal(anonymousReview('form[action="/api/checkout"] input[name=reviewId]').length, 1, 'Anonymous gift must proceed without sign-in.');
  const attach = anonymousReview('form[action="/api/checkout/review"]:has(input[value="attach-profile"])');
  assert.match(attach.text(), /Add my Bluesky profile/);
  assert.equal(attach.find('button.button').length, 0, 'Optional profile attachment must not compete with payment.');
  const attached = await request('/api/checkout/review', { intent: 'attach-profile', editReview: attach.find('input[name=editReview]').val() });
  const attachLogin = new URL(attached.headers.get('location'), origin);
  assert.equal(attachLogin.pathname, '/login');
  const privateUrl = attachLogin.searchParams.get('returnTo');
  assert.ok(privateUrl.startsWith('/checkout/review?token=') && privateUrl !== anonymousUrl);
  const privateReview = await page(privateUrl);
  assert.match(privateReview.text(), /Monthly · private/); assert.match(privateReview.text(), /fixture-private-note/);
  assert.match(privateReview.text(), /\$44 to Alex Rivers/);
  assert.equal((await page(anonymousUrl))('form[action="/api/checkout"]').length, 1, 'Adding a profile must leave the original anonymous gift available.');
  assert.equal((await page(reviewUrl))('.review-identity').length, 1, 'Converting must not mutate the original named review.');
  const wrongConversion = await request('/api/checkout/review', { intent: 'anonymous', editReview: token }, new Map());
  assert.ok(wrongConversion.headers.get('location').startsWith('/checkout?error='));
  const outsider = await page('/checkout'); // Refreshing a form must not invalidate another review in this browser.
  assert.ok(outsider('input[name=requestId]').val());
  const wrongBrowser = await request(reviewUrl, undefined, new Map()); assert.equal(wrongBrowser.status,400);
  const login = await request('/auth/demo',{role:'supporter',returnTo:reviewUrl}); assert.equal(login.headers.get('location'),reviewUrl);
  const identified = await page(reviewUrl); assert.ok(identified('form[action="/api/checkout"] input[name=reviewId]').val());
  const edited = fields(await page('/checkout',{editReview:token})); assert.equal(edited.get('note'),'fixture-private-note'); assert.equal(edited.get('amount'),'44.00'); assert.equal(edited.get('pick:presence'),'3');
  const final = await request('/api/checkout',{reviewId:token}); assert.equal(final.status,303); assert.ok(final.headers.get('location').startsWith('/thanks?id='));
  const repeated = await request('/api/checkout',{reviewId:token}); assert.equal(repeated.headers.get('location'),final.headers.get('location'));
  const receipt = await page(final.headers.get('location')); assert.match(receipt.text(),/No money changed hands/);
  assert.equal(receipt('[data-receipt-state]').attr('data-receipt-state'), 'confirmed');
  assert.equal(receipt('#stay-connected').is('[open]'), false, 'Social actions are optional after a complete gift.');
  const foreignReceipt = await request(final.headers.get('location'), undefined, new Map());
  assert.equal(foreignReceipt.status, 404);
  const foreign = load(await foreignReceipt.text());
  assert.equal(foreign('[data-receipt-state]').attr('data-receipt-state'), 'unavailable');
  assert.equal(foreign('#stay-connected, [data-receipt-recurring], [data-receipt-details]').length, 0);
  assert.doesNotMatch(foreign.text(), /Confirming your payment|fixture-private-note|\$44/);

  // Only mutate this script's temporary, fictional database to exercise rendered states.
  const fixtureDb = new DatabaseSync(join(dir, 'demo.sqlite'));
  try {
    const original = fixtureDb.prepare("SELECT value FROM records WHERE kind='support' AND id=?").get(token).value;
    const support = JSON.parse(original);
    try {
      for (const [patch, kind] of [[{status:'pending'}, 'pending'], [{status:'failed'}, 'failed'], [{status:'refunded'}, 'refunded'], [{status:'disputed', disputed:true}, 'disputed'], [{refundedAmount:100}, 'partially-refunded']]) {
        fixtureDb.prepare("UPDATE records SET value=? WHERE kind='support' AND id=?").run(JSON.stringify({...support,...patch}),token);
        const status = await page(final.headers.get('location'));
        assert.equal(status('[data-receipt-state]').attr('data-receipt-state'), kind);
        assert.equal(status('#stay-connected, form[action="/api/social"]').length, 0, 'Unconfirmed or adjusted payments must not prompt social onboarding.');
        assert.equal(status('a').filter((_,el) => status(el).text() === 'Check payment status').length, kind === 'pending' ? 1 : 0);
      }
    } finally { fixtureDb.prepare("UPDATE records SET value=? WHERE kind='support' AND id=?").run(original, token); }
  } finally { fixtureDb.close(); }
  const publicResponse = await request('/api/public/libcard'); assert.equal(publicResponse.headers.get('cache-control'),'public, max-age=60');
  const signal = await publicResponse.json(); assert.equal(signal.defaultAmountCents,2200);
  assert.deepEqual(signal.targets.slice(0,2).map(p => [p.publicCount,p.publicShareMillis]),[[0,0],[1,750]]);
  assert.ok(!JSON.stringify(signal).includes('fixture-private-note'));
  const shareUrl = new URL(receipt('[data-share-url]').val());
  const share = await page(shareUrl.pathname); assert.equal(share('.share-allocation').length,0); assert.match(share.text(),/\$3,000 aspiration/);
  const image = await request(`${shareUrl.pathname}.png`); assert.equal(image.status,200); assert.equal(image.headers.get('content-type'),'image/png');
  for (const visibility of ['anonymous','private']) {
    const f = fields(await page('/checkout?creator=1')); f.set('visibility',visibility); f.set('intent','review');
    const response = await request('/api/checkout/review', f); const next = response.headers.get('location'); await page(next);
    const id = new URL(next,origin).searchParams.get('token'); assert.equal((await request('/api/checkout',{reviewId:id})).status,303);
    if (visibility === 'anonymous') {
      await request('/auth/logout', {});
      const receiptPath = `/thanks?id=${id}`;
      const guestReceipt = await page(receiptPath);
      assert.equal(guestReceipt('[data-receipt-state]').attr('data-receipt-state'), 'confirmed');
      assert.equal(guestReceipt('#stay-connected').is('[open]'), false);
      const connectUrl = guestReceipt('#stay-connected > .receipt-section-body > a').attr('href');
      const connectionPath = new URL(connectUrl, origin).searchParams.get('returnTo');
      assert.equal(connectionPath, `${receiptPath}&connect=1`);
      const guestLogin = await page(connectUrl);
      assert.match(guestLogin.text(), /Your tip is complete/);
      assert.equal(guestLogin('a').filter((_, el) => guestLogin(el).text() === 'Back to your receipt').attr('href'), connectionPath);
      assert.doesNotMatch(guestLogin.text(), /Just here to tip|Review as an anonymous gift/);
      const connected = await request('/auth/demo', { role: 'supporter', returnTo: connectionPath });
      assert.equal(connected.headers.get('location'), connectionPath);
      const returned = await page(connectionPath);
      assert.equal(returned('#stay-connected').is('[open]'), true);
      assert.match(returned.text(), /Connected as/);
    }

  }
  assert.deepEqual(await (await request('/api/public/libcard')).json(),signal);
  const old = fields(await page('/checkout?gone=1&x=10')); assert.ok([...old].filter(([key]) => key.startsWith('pick:')).every(([key,v]) => v === (key === 'pick:creator' ? '1' : '0')));
  await request('/auth/demo', {role:'admin'});
  const studio = await page('/studio/projects'); assert.match(studio.text(),/From LibCard/);
  const automaticReview = fields(await page('/checkout'));
  automaticReview.set(automatic[0], '1'); automaticReview.set('intent', 'review');
  const autoPosted = await request('/api/checkout/review', automaticReview); assert.equal(autoPosted.status,303);
  const autoReviewUrl = autoPosted.headers.get('location');
  const autoReview = await page(autoReviewUrl); assert.ok(autoReview.text().includes(automaticTarget.label));
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
