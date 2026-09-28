import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { releaseInfo } from '../../lib/version';
export const GET: APIRoute = () => {
  getDb().prepare('SELECT 1').get();
  return Response.json({ ok: true, version: releaseInfo.version, databaseSchema: releaseInfo.databaseVersion });
};
