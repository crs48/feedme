import type { APIRoute } from 'astro';
import { config } from '../../lib/config';
import { NS } from '../../lib/model';
export const GET: APIRoute = () => {
  const cfg = config();
  return Response.json({ protocol: NS, did: cfg.ownerDid, url: cfg.origin, profile: `at://${cfg.ownerDid}/${NS}.profile/self`, mode: cfg.demo ? 'demo' : 'live' }, { headers: { 'Cache-Control': 'public, max-age=300' } });
};
