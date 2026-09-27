import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { getDb } from '../../lib/db';
import { refreshCreatorCircle } from '../../lib/creator-circle';
import { drainOutbox } from '../../lib/habitat';
export const POST: APIRoute = async ({ request }) => {
  const secret = process.env.SYNC_SECRET;
  const actual = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || secret.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return new Response('Unauthorized', { status: 401 });
  getDb().prepare('DELETE FROM kv WHERE expires IS NOT NULL AND expires < ?').run(Date.now());
  const result = await drainOutbox();
  await refreshCreatorCircle();
  return Response.json(result);
};
