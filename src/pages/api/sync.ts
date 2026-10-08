import { refreshLibcard } from '../../lib/libcard';
import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { runBackup } from '../../lib/backups';
import { verifyRecovery } from '../../lib/recovery-control';
import { getDb, setKv } from '../../lib/db';
import { refreshCreatorCircle } from '../../lib/creator-circle';
import { refreshCreatorBluesky } from '../../lib/creator-bluesky';
import { drainOutbox } from '../../lib/habitat';
export const POST: APIRoute = async ({ request }) => {
  const secret = process.env.SYNC_SECRET;
  const actual = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || secret.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return new Response('Unauthorized', { status: 401 });
  getDb().prepare('DELETE FROM kv WHERE expires IS NOT NULL AND expires < ?').run(Date.now());
  const [result] = await Promise.allSettled([drainOutbox(), runBackup(), verifyRecovery(), refreshCreatorCircle(), refreshLibcard(), refreshCreatorBluesky()]);
  if (result.status === 'rejected') {
    setKv(getDb(), 'recovery', 'sync-error', { at: new Date().toISOString(), message: 'Recovery data could not be prepared. Review data compatibility and reconnect the creator account before retrying.' });
    return Response.json({ error: 'Synchronization needs attention. Backups were attempted independently.' }, { status: 503 });
  }
  return Response.json(result.value);
};
