import { ZodError } from 'zod';
export const formObject = async (request: Request) => Object.fromEntries(await request.formData());
export const errorMessage = (error: unknown) => error instanceof ZodError ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join(' · ') : error instanceof Error ? error.message : 'Something went wrong. Please try again.';
export const redirectNotice = (path: string, message: string, error = false) => new Response(null, { status: 303, headers: { Location: `${path}${path.includes('?') ? '&' : '?'}${error ? 'error' : 'notice'}=${encodeURIComponent(message.slice(0, 500))}` } });
const recommendationReturn = (input: string) => {
  if (!input.startsWith('/recommend?')) return false;
  try { const url = new URL(input, 'https://return.invalid'); return url.origin === 'https://return.invalid' && url.pathname === '/recommend' && [...url.searchParams.keys()].every((key) => key === 'did') && /^did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.:%_-]+)$/.test(url.searchParams.get('did') || '') && !url.hash; } catch { return false; }
};
export const safeReturnPath = (input: unknown) => typeof input === 'string' && (recommendationReturn(input) || /^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(input) || /^\/thanks\?id=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input)) ? input : '/';
