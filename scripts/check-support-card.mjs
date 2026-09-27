// Disposable container smoke test. No Stripe or Bluesky requests are made.
import { strict as assert } from 'node:assert';
const base = 'http://127.0.0.1:4321';
const origin = 'https://feedme.example.com';
const cookies = new Map();
const request = async (path, body) => {
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET', redirect: 'manual',
    headers: { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
      ...(body ? { origin, 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    ...(body ? { body: new URLSearchParams(body) } : {}),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const [key, ...value] = cookie.split(';')[0].split('=');
    cookies.set(key, value.join('='));
  }
  return response;
};
assert.equal((await request('/auth/demo', { role: 'supporter' })).status, 303);
const home = await (await request('/')).text();
const requestId = home.match(/name="requestId" value="([^"]+)"/)[1];
const checkout = await request('/api/checkout', { requestId, amount: '22', frequency: 'once', visibility: 'public', note: 'PRIVATE SMOKE TEST NOTE',
  'percentage:backyard-sauna': '50', 'percentage:open-source': '30', 'percentage:field-notes': '20' });
assert.equal(checkout.status, 303);
const receipt = await (await request(checkout.headers.get('location'))).text();
const sharePath = receipt.match(/\/share\/[A-Za-z0-9_-]{24}/)[0];
const page = await fetch(`${base}${sharePath}`);
assert.equal(page.status, 200);
const html = await page.text();
assert.ok(html.includes(`${origin}${sharePath}.png`));
assert.ok(html.includes('summary_large_image'));
assert.ok(!html.includes('PRIVATE SMOKE TEST NOTE'));
assert.ok(!html.includes(requestId));
const image = await fetch(`${base}${sharePath}.png`);
assert.equal(image.status, 200);
assert.equal(image.headers.get('content-type'), 'image/png');
const png = Buffer.from(await image.arrayBuffer());
assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
assert.equal(png.readUInt32BE(16), 1200);
assert.equal(png.readUInt32BE(20), 630);
assert.ok(png.length > 10000 && png.length < 1_000_000);
assert.equal((await fetch(`${base}/share/${requestId}.png`)).status, 404);
console.log('Public checkout, share metadata, and container PNG/font rendering verified.');
