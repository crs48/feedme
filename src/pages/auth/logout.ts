import type { APIRoute } from 'astro';
import { logout } from '../../lib/auth';
export const POST: APIRoute = (context) => { logout(context); return context.redirect('/', 303); };
