import type { APIRoute } from 'astro';
import { config } from '../../lib/config';
import { supportShare } from '../../lib/support-shares';
import { supportCardPng } from '../../lib/support-card-image';

export const GET: APIRoute = async ({ params }) => {
  // Always recheck visibility and settlement before looking in the image cache.
  const card = supportShare(params.id);
  if (!card) return new Response('Support card unavailable.', { status: 404 });
  const image = await supportCardPng(card, config().demo);
  return new Response(new Uint8Array(image), { headers: { 'Content-Type': 'image/png', 'Content-Length': String(image.length), 'Cache-Control': 'no-store' } });
};
