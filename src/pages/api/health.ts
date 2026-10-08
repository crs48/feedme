import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { releaseInfo } from '../../lib/version';
import { config } from '../../lib/config';
export const GET: APIRoute = () => {
  getDb().prepare('SELECT 1').get();
  const cfg = config();
  return Response.json({ ok: true, version: releaseInfo.version, databaseSchema: releaseInfo.databaseVersion, mode: cfg.demo ? 'demo' : cfg.sandbox ? 'sandbox' : 'live' });
};
