import type { APIRoute } from 'astro';
import { config } from '../../lib/config';
import { NS } from '../../lib/model';
export const GET: APIRoute = () => {
  const cfg = config();
  if (cfg.sandbox) return new Response('Sandbox instances are not listed in the creator directory.', { status: 404 });
  return Response.json({ protocol: NS, did: cfg.ownerDid, url: cfg.origin, profile: `at://${cfg.ownerDid}/${NS}.profile/self`, mode: cfg.demo ? 'demo' : 'live' }, { headers: { 'Cache-Control': 'public, max-age=300' } });
};
