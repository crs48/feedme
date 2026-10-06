import type { APIRoute } from 'astro';
import { config } from '../../../lib/config';
import { loadLibcardSnapshot, libcardTargets } from '../../../lib/libcard';
import { payments } from '../../../lib/repository';
import { publicLibcard } from '../../../lib/libcard-public';
export const GET: APIRoute = async () => {
  const cfg = config();
  if (!cfg.libcard) return Response.json({ error: 'LibCard is disabled.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const snapshot = await loadLibcardSnapshot();
  if (!snapshot) return Response.json({ error: 'LibCard is not available yet.' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });
  return Response.json(publicLibcard(snapshot.document.profile.name, cfg.origin, cfg.defaultTipAmount, libcardTargets(snapshot), payments()), { headers: { 'Cache-Control': 'public, max-age=60' } });
};
export const HEAD: APIRoute = async context => { const response = await GET(context); return new Response(null, { status: response.status, headers: response.headers }); };
