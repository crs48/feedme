import type { APIRoute } from 'astro';
import { oauthClient } from '../lib/auth';
export const GET: APIRoute = async () => {
  try {
    const keys = (await oauthClient()).jwks.keys.map((key) => {
      if (key.kty !== 'EC' || key.crv !== 'P-256') throw new Error('Expected an ES256 signing key.');
      // Habitat's Fosite verifier requires use=sig, which the AT Protocol SDK
      // omits. Describe our existing signing key explicitly without rotating it.
      return { kty: key.kty, kid: key.kid, crv: key.crv, x: key.x, y: key.y,
        alg: 'ES256', use: 'sig', key_ops: ['verify'] };
    });
    return Response.json({ keys });
  } catch { return Response.json({ keys: [] }, { status: 503 }); }
};
