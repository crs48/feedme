import type { APIRoute } from 'astro';
import { oauthClient } from '../lib/auth';
export const GET: APIRoute = async () => { try { return Response.json((await oauthClient()).clientMetadata); } catch { return Response.json({ error: 'OAuth requires a configured HTTPS PUBLIC_URL.' }, { status: 503 }); } };
