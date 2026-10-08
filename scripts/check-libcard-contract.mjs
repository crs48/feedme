// Production build routing with an isolated DB and no external provider access.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { load } from 'cheerio';
import { isolatedEnvironment } from './static-demo.mjs';
import { checkLibcardEndpoint, libcardHeaders } from './libcard-contract.mjs';

const root = resolve(import.meta.dirname, '..');
const canonical = 'https://creator-feedme.example';
for (const scenario of ['ready', 'ready-all', 'disabled', 'unavailable']) {
  const dir = await mkdtemp(join(tmpdir(), 'feedme-libcard-contract-'));
  let child;
  try {
    const reservation = createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port; await new Promise(done => reservation.close(done));
    const transport = `http://127.0.0.1:${port}`;
    const env = { ...isolatedEnvironment(dir, port), PUBLIC_URL: canonical, TIP_AMOUNTS: '11,5.05,44,88', LIBCARD_DEFAULT_SUPPORT: scenario === 'ready-all' ? 'all' : 'explicit',
      ...(scenario === 'disabled' ? {} : { LIBCARD_REPO: 'crs48/LIBCard' }),
      ...(scenario === 'unavailable' ? { LIBCARD_DEMO_SOURCE: 'github' } : {}),
    };
    if (scenario.startsWith('ready')) {
      const seeded = spawnSync(process.execPath, ['--import', 'tsx', 'tests/fixtures/libcard/seed.ts'], {
        cwd: root, env: { ...env, FEEDME_CONTRACT_FIXTURE: 'temporary' }, encoding: 'utf8', timeout: 15_000,
      });
      assert.equal(seeded.status, 0, seeded.stderr);
    }
    child = spawn(process.execPath, ['--import', './scripts/demo-offline.mjs', 'dist/server/entry.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = ''; child.stdout.on('data', data => logs += data); child.stderr.on('data', data => logs += data);
    const request = (path, options = {}) => fetch(`${transport}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...options });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(logs);
      try { if ((await request('/api/health')).status === 200) { ready = true; break; } } catch { /* Wait for listening. */ }
      await new Promise(done => setTimeout(done, 100));
    }
    assert.ok(ready, logs);
    if (!scenario.startsWith('ready')) {
      for (const method of ['GET', 'HEAD']) {
        const response = await request('/api/public/libcard', { method, headers: libcardHeaders, credentials: 'omit' });
        assert.equal(response.status, scenario === 'disabled' ? 404 : 503);
        assert.equal(response.headers.get('location'), null);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        if (method === 'HEAD') assert.equal(await response.text(), '');
      }
      continue;
    }
    const body = await checkLibcardEndpoint(canonical, (url, options) => {
      assert.equal(url, `${canonical}/api/public/libcard`);
      assert.deepEqual(options.headers, libcardHeaders); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual');
      return request('/api/public/libcard', options);
    });
    assert.equal(body.creatorName, 'Ada Example'); assert.equal(body.defaultAmountCents, 505);
    assert.deepEqual(body.targets.filter(t => !t.id.startsWith('auto-')).map(t => [t.id, t.kind]), [['creator', 'creator'], ['presence', 'link'], ['open-source', 'link'], ['x', 'social']]);
    assert.deepEqual(body.targets.filter(t => t.id.startsWith('auto-')).map(t => t.label), scenario === 'ready-all' ? ['Résumé', 'github'] : []);
    const skippedUrls = ['https://example.com/card-only-link', 'https://example.com/always-skipped-link', 'https://instagram.com/card-only-social', 'https://youtube.com/@always-skipped-social'];
    assert.ok(body.targets.every(t => !skippedUrls.includes(t.url)));
    assert.ok(body.targets.every(t => t.publicCount === 0 && t.publicShareMillis === 0));
    for (const [query, amount, presence] of [['?amount=22.00&presence=1', '22.00', '1'], ['?amount=1000.00&presence=1', '1000.00', '1'], ['?presence=1', '5.05', '1'], ['', '5.05', '0']]) {
      const response = await request(`/checkout${query}`); assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      const $ = load(await response.text()); assert.equal($('input[name="amount"]').val(), amount); assert.equal($('input[name="pick:presence"]').val(), presence);
      assert.equal($('input[name="pick:creator"]').val(), '0');
    }
    for (const path of ['/', '/checkout?skipped-link=1&skipped-social=1']) {
      const page = load(await (await request(path)).text());
      for (const url of skippedUrls) assert.equal(page(`a[href="${url}"]`).length, 0, `Skipped source item appeared on ${path}`);
      assert.equal(page('input[name="pick:skipped-link"],input[name="pick:skipped-social"]').length, 0);
      assert.ok(page('[data-pick-input]').toArray().every(input => page(input).val() === '0'));
    }
    const login = await request('/auth/demo', { method: 'POST', headers: { origin: canonical }, body: new URLSearchParams({ role: 'admin' }) });
    assert.equal(login.status, 303);
    const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const studio = await request('/studio/projects', { headers: { cookie } }); assert.equal(studio.status, 200);
    assert.equal(studio.headers.get('cache-control'), 'private, no-store');
    const $ = load(await studio.text()); assert.match($('#libcard').text(), /Target ID nervous-system belongs to a native project\. Choose a different LibCard ID\./);
    assert.match($('#libcard').text(), /last good snapshot is unchanged/);
    const skippedRows = $('#libcard .libcard-admin-row').filter((_, el) => $(el).text().includes('Skipped in LibCard'));
    assert.equal(skippedRows.length, 4); assert.equal(skippedRows.find('form,input,button').length, 0);
    for (const url of skippedUrls) assert.equal(skippedRows.find(`a[href="${url}"]`).length, 1);
    assert.equal($('#libcard input[name="id"][value="skipped-link"],#libcard input[name="id"][value="skipped-social"]').length, 0);
    const authed = await request('/api/public/libcard', { headers: { ...libcardHeaders, cookie } });
    assert.equal(authed.headers.get('cache-control'), 'public, max-age=60'); assert.equal(authed.headers.get('set-cookie'), null);
    assert.deepEqual(await authed.json(), body);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit'); let timer;
      child.kill('SIGTERM');
      await Promise.race([stopped, new Promise(done => { timer = setTimeout(done, 5000); })]); clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await stopped; }
    }
    await rm(dir, { recursive: true, force: true });
  }
}
console.log('LibCard contract HTTP smoke passed: committed consumer fixture, exact anonymous request, GET/HEAD, no redirects, canonical origin, cache isolation, 404/503, prefill, source skips in both modes, read-only skipped Studio rows, and collision diagnostics.');
