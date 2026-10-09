import type { APIRoute } from 'astro';
import prompt from '../../docs/agent-setup-prompt.md?raw';

export const GET: APIRoute = () => new Response(prompt, {
  headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
});
