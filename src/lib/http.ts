import { ZodError } from 'zod';
export const formObject = async (request: Request) => Object.fromEntries(await request.formData());
export const errorMessage = (error: unknown) => error instanceof ZodError ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join(' · ') : error instanceof Error ? error.message : 'Something went wrong. Please try again.';
export const redirectNotice = (path: string, message: string, error = false) => new Response(null, { status: 303, headers: { Location: `${path}?${error ? 'error' : 'notice'}=${encodeURIComponent(message.slice(0, 500))}` } });
export const safeReturnPath = (input: unknown) => typeof input === 'string' && /^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(input) ? input : '/';
