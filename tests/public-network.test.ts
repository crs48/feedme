import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mock.lookup }));
vi.mock('node:https', () => ({ request: mock.request }));
import { publicJson, PublicHttpError } from '../src/lib/public-network';
beforeEach(() => { mock.lookup.mockReset().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]); mock.request.mockReset(); });
const respond = (status: number, body: string) => mock.request.mockImplementation((_url, options, callback) => {
  const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void };
  req.destroy = error => { req.emit('error', error); };
  req.end = () => {
    options.lookup('example.com', {}, (error: unknown, address: string, family: number) => { expect(error).toBeNull(); expect(address).toBe('8.8.8.8'); expect(family).toBe(4); });
    const response = Object.assign(new EventEmitter(), { statusCode: status }); callback(response);
    response.emit('data', Buffer.from(body)); response.emit('end');
  }; return req;
});
describe('bounded public network transport', () => {
  it('rejects mixed public/private DNS results before connecting', async () => {
    mock.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    await expect(publicJson('https://example.com')).rejects.toThrow('public address'); expect(mock.request).not.toHaveBeenCalled();
  });
  it('pins validated DNS and enforces each response byte limit', async () => {
    respond(200, '{"ok":true}'); expect(await publicJson('https://example.com')).toEqual({ ok: true });
    respond(200, '{"too":"long"}'); await expect(publicJson('https://example.com', { maxBytes: 5 })).rejects.toThrow('too large');
  });
  it('preserves provider throttling even when the response is HTML and never follows redirects', async () => {
    for (const status of [429, 503, 302]) {
      respond(status, '<html>Error</html>');
      await expect(publicJson('https://example.com')).rejects.toEqual(new PublicHttpError(status));
    }
    expect(mock.request).toHaveBeenCalledTimes(3);
  });
});
