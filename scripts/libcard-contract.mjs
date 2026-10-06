// Consumer contract pinned to crs48/LIBCard at fed406d. Keep this independent
// of Feedme's serializer so a server change cannot silently weaken the check.
import assert from 'node:assert/strict';

export const libcardHeaders = { Accept: 'application/json', 'User-Agent': 'LibCard (+https://github.com/crs48/LIBCard)' };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const boundedString = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;

export const contractOrigin = value => {
  const url = new URL(value);
  assert.ok(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Use a bare HTTPS origin without credentials, query, or fragment.');
  assert.ok(!['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname) && !url.hostname.endsWith('.localhost'), 'A local preview is not a production LibCard origin.');
  return url.origin;
};

export const assertLibcardResponse = (body, origin) => {
  assert.ok(record(body), 'Expected a JSON object.');
  assert.ok(boundedString(body.creatorName, 200), 'Invalid creatorName.');
  assert.equal(contractOrigin(body.origin), contractOrigin(origin), 'Response origin must match the configured LibCard origin.');
  assert.ok(Number.isInteger(body.defaultAmountCents) && body.defaultAmountCents >= 100 && body.defaultAmountCents <= 100_000, 'Invalid defaultAmountCents.');
  assert.ok(Array.isArray(body.targets) && body.targets.length <= 100, 'Invalid target list.');
  const ids = new Set();
  for (const target of body.targets) {
    assert.ok(record(target) && typeof target.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(target.id), 'Invalid target ID.');
    assert.ok(!ids.has(target.id), 'Duplicate target ID.'); ids.add(target.id);
    assert.ok(boundedString(target.label, 200), 'Invalid target label.');
    assert.ok(target.url === null || boundedString(target.url, 2048), 'Invalid target URL.');
    assert.ok(['creator', 'link', 'social'].includes(target.kind), 'Invalid target kind.');
    assert.ok(Number.isSafeInteger(target.publicCount) && target.publicCount >= 0, 'Invalid publicCount.');
    assert.ok(Number.isInteger(target.publicShareMillis) && target.publicShareMillis >= 0 && target.publicShareMillis <= 1000, 'Invalid publicShareMillis.');
  }
  assert.ok([0, 1000].includes(body.targets.reduce((sum, target) => sum + target.publicShareMillis, 0)), 'Public shares must total zero or 1000.');
  return body;
};

// The same credential-free request is used by HTTP smoke and the deployment
// check. A redirect fails readiness even when LibCard could follow it.
export const checkLibcardEndpoint = async (origin, fetcher = fetch) => {
  const endpoint = new URL('/api/public/libcard', contractOrigin(origin));
  const request = async method => {
    const response = await fetcher(endpoint.href, { method, headers: libcardHeaders, credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, `${method} ${endpoint.pathname} must return 200 directly (got ${response.status}).`);
    assert.equal(response.headers.get('location'), null, 'Public endpoint must not redirect.');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
    assert.match(response.headers.get('content-type') || '', /^application\/json(?:;|$)/i);
    assert.equal(response.headers.get('set-cookie'), null, 'Public API must not set a session cookie.');
    return response;
  };
  const head = await request('HEAD'); assert.equal(await head.text(), '');
  const response = await request('GET');
  assert.ok(response.body, 'Public API has no body.');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength; assert.ok(size <= 256 * 1024, 'Public response exceeds 256 KiB.'); chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  const body = assertLibcardResponse(JSON.parse(Buffer.concat(chunks).toString('utf8')), origin);
  // Feedme's privacy allowlist is intentionally narrower than LibCard's
  // forward-compatible parser, which ignores future fields.
  assert.deepEqual(Object.keys(body).sort(), ['creatorName', 'defaultAmountCents', 'origin', 'targets']);
  for (const target of body.targets) assert.deepEqual(Object.keys(target).sort(), ['id', 'kind', 'label', 'publicCount', 'publicShareMillis', 'url']);
  return body;
};
