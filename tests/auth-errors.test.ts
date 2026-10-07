import { describe, expect, it } from 'vitest';
import { authErrorSummary } from '../src/lib/auth-errors';

describe('safe OAuth diagnostics', () => {
  it('reports provider codes, status, and fixed topics without copying sensitive details', () => {
    const error = Object.assign(new Error('client_id signature assertion failed: secret-token for private-handle.example'), {
      error: 'invalid_client', status: 401,
      payload: { client_assertion: 'secret-token', error_description: 'private-handle.example' },
    });
    expect(authErrorSummary(error)).toEqual([{ code: 'invalid_client', status: 401, topics: ['signature', 'client_id', 'assertion'] }]);
    expect(JSON.stringify(authErrorSummary(error))).not.toMatch(/secret-token|private-handle/);
  });
  it('bounds nested causes, handles cycles, and rejects unrecognized provider values', () => {
    const error = { error: 'secret-token', status: 1, message: 'secret-token', cause: {} };
    error.cause = error;
    expect(authErrorSummary(error)).toEqual([{ code: 'unknown', topics: [] }]);
    expect(authErrorSummary(new Error('outer', { cause: { error: 'invalid_scope', status: 400 } }))).toEqual([
      { code: 'unknown', topics: [] }, { code: 'invalid_scope', status: 400, topics: [] },
    ]);
    expect(authErrorSummary(null)).toEqual([]);
  });
});
