import type { APIRoute } from 'astro';
import { oauthClient } from '../lib/auth';
export const GET: APIRoute = async () => { try { return Response.json((await oauthClient()).jwks); } catch { return Response.json({ keys: [] }, { status: 503 }); } };
