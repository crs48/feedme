const errorCodes = new Set([
  'invalid_request', 'invalid_client', 'invalid_scope', 'invalid_grant', 'unauthorized_client',
  'unsupported_response_type', 'unsupported_response_mode', 'unsupported_grant_type',
  'invalid_dpop_proof', 'use_dpop_nonce', 'access_denied', 'server_error', 'temporarily_unavailable',
]);
const topics = [
  'response_mode', 'private_key_jwt', 'jwks', 'key_ops', 'signature', 'audience',
  'redirect_uri', 'client_id', 'scope', 'pkce', 'dpop', 'resolve', 'fetch', 'algorithm', 'assertion',
] as const;

// Provider errors can contain request bodies, tokens, and account identifiers.
// Log only fixed diagnostic labels and HTTP status, never their message or payload.
export const authErrorSummary = (error: unknown): Array<{ code: string; status?: number; topics: string[] }> => {
  const seen = new Set<object>();
  const visit = (value: unknown): ReturnType<typeof authErrorSummary> => {
    if (!value || typeof value !== 'object' || seen.has(value) || seen.size >= 4) return [];
    seen.add(value);
    const entry = value as { error?: unknown; status?: unknown; message?: unknown; cause?: unknown };
    const message = typeof entry.message === 'string' ? entry.message.toLowerCase() : '';
    return [{
      code: typeof entry.error === 'string' && errorCodes.has(entry.error) ? entry.error : 'unknown',
      ...(typeof entry.status === 'number' && Number.isInteger(entry.status) && entry.status >= 100 && entry.status <= 599 ? { status: entry.status } : {}),
      topics: topics.filter((topic) => message.includes(topic)),
    }, ...visit(entry.cause)];
  };
  return visit(error);
};

export const reportAuthError = (stage: 'authorize' | 'callback', error: unknown) => {
  console.error('OAuth sign-in failed', JSON.stringify({ stage, errors: authErrorSummary(error) }));
};
