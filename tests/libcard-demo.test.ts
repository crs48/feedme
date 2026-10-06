import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/lib/config';
import { isolatedEnvironment } from '../scripts/static-demo.mjs';

afterEach(() => vi.unstubAllEnvs());
describe('real-source LibCard demo configuration', () => {
  it('requires an explicit opt-in while retaining simulated payment and admin identity mode', () => {
    vi.stubEnv('FEEDME_MODE', 'demo'); vi.stubEnv('LIBCARD_REPO', 'crs48/LIBCard'); vi.stubEnv('LIBCARD_DEMO_SOURCE', '');
    expect(config()).toMatchObject({ demo: true, libcardRemoteDemo: false });
    vi.stubEnv('LIBCARD_DEMO_SOURCE', 'github');
    expect(config()).toMatchObject({ demo: true, libcardRemoteDemo: true, ownerDid: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' });
    vi.stubEnv('LIBCARD_REPO', ''); expect(config().libcardRemoteDemo).toBe(false);
    vi.stubEnv('LIBCARD_DEMO_SOURCE', 'typo'); expect(() => config()).toThrow('LIBCARD_DEMO_SOURCE');
  });
  it('isolates real-source demo history from the fictional database and static Pages export', () => {
    const dir = mkdtempSync(join(tmpdir(), 'feedme-demo-isolation-'));
    try {
      const env = isolatedEnvironment(dir, 4321, process.env);
      const read = (source: string) => {
        const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
          import { getDb, listRecords } from './src/lib/db.ts';
          const db = getDb();
          console.log(JSON.stringify(Object.fromEntries(['project','update','friend','support'].map(kind => [kind, listRecords(db, kind).length]))));
        `], { encoding: 'utf8', timeout: 10_000, env: { ...env, LIBCARD_REPO: 'crs48/LIBCard', LIBCARD_DEMO_SOURCE: source } });
        expect(result.status, result.stderr).toBe(0);
        return JSON.parse(result.stdout);
      };
      const fictional = read('fixture'); expect(fictional.support).toBeGreaterThan(0);
      expect(read('github')).toEqual({ project: 0, update: 0, friend: 0, support: 0 });
      expect(read('fixture')).toEqual(fictional);
      expect(readdirSync(dir)).toEqual(expect.arrayContaining(['demo.sqlite', 'demo-libcard.sqlite']));
      const isolated = isolatedEnvironment(dir, 4321, { ...process.env, LIBCARD_REPO: 'crs48/LIBCard', LIBCARD_DEMO_SOURCE: 'github' });
      expect(isolated).not.toHaveProperty('LIBCARD_REPO'); expect(isolated).not.toHaveProperty('LIBCARD_DEMO_SOURCE');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
