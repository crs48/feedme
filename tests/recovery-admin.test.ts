import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
const state = vi.hoisted(() => ({ did: 'owner', demo: false, backup: vi.fn(async () => ({ verifiedAt: 'now' })), resume: vi.fn(async () => {}), discover: vi.fn(async () => []), stage: vi.fn(), sync: vi.fn(), verify: vi.fn() }));
vi.mock('../src/lib/auth', () => ({ requireAdmin: () => { if (!state.did) throw new Error('No session'); return { did: state.did }; } }));
vi.mock('../src/lib/config', () => ({ config: () => ({ ownerDid: 'owner', demo: state.demo }) }));
vi.mock('../src/lib/db', () => ({ getDb: () => ({}), setKv: vi.fn() }));
vi.mock('../src/lib/backups', () => ({ runBackup: state.backup }));
vi.mock('../src/lib/recovery-import', () => ({ discoverRecoverySpaces: state.discover, stageHabitatRecovery: state.stage }));
vi.mock('../src/lib/recovery-control', () => ({ resumeRecovery: state.resume, verifyRecovery: state.verify }));
vi.mock('../src/lib/habitat', () => ({ drainOutbox: state.sync }));
import { POST } from '../src/pages/api/admin/data';
const request = (action: string, extra: Record<string, string> = {}) => POST({ request: new Request('https://feedme.example/api/admin/data', { method: 'POST', body: new URLSearchParams({ action, ...extra }) }) } as APIContext);
afterEach(() => { state.did = 'owner'; state.demo = false; vi.clearAllMocks(); });
describe('creator-only recovery administration', () => {
  it('rejects additional admins and missing sessions before touching backup providers', async () => {
    for (const did of ['other-admin', '']) { state.did = did; expect((await request('backup')).status).toBe(403); }
    expect(state.backup).not.toHaveBeenCalled();
  });
  it('never invokes providers in demo mode', async () => {
    state.demo = true; expect((await request('backup')).headers.get('location')).toContain('preview'); expect(state.backup).not.toHaveBeenCalled();
  });
  it('requires single-writer acknowledgement before resuming', async () => {
    expect((await request('resume')).headers.get('location')).toContain('previous%20server'); expect(state.resume).not.toHaveBeenCalled();
    await request('resume', { oldServerStopped: 'yes' }); expect(state.resume).toHaveBeenCalledOnce();
  });
  it('does not stage an unlisted space', async () => {
    await request('stage', { space: 'at://unowned', oldServerStopped: 'yes' }); expect(state.stage).not.toHaveBeenCalled();
  });
});
