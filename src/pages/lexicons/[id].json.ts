import type { APIRoute } from 'astro';
import { protocolSchemas } from '../../lib/protocol';
export const GET: APIRoute = ({ params }) => {
  const schema = protocolSchemas.find((s) => s.id === params.id);
  return schema ? Response.json(schema) : new Response('Schema not found', { status: 404 });
};
