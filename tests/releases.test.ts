import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDeployment, parseReleaseTag } from '../scripts/build-deployment.mjs';
import { version } from '../package.json';

describe('release deployment bundle', () => {
  it('ships only installation files and pins the exact verified image digest', async () => {
    const path = await mkdtemp(join(tmpdir(), 'feedme-bundle-'));
    try {
      const digest = `sha256:${'a'.repeat(64)}`;
      await buildDeployment(path, version, digest);
      expect((await readdir(path)).sort()).toEqual(['.env.example', '.gitignore', 'README.md', 'compose.yaml', 'release.json', 'renovate.json']);
      expect(await readFile(join(path, 'compose.yaml'), 'utf8')).toContain(`image: ghcr.io/crs48/feedme:${version}@${digest}`);
      expect(JSON.parse(await readFile(join(path, 'release.json'), 'utf8'))).toMatchObject({ version, image: `ghcr.io/crs48/feedme:${version}@${digest}` });
    } finally { await rm(path, { recursive: true, force: true }); }
  });
  it('rejects branch names, malformed tags and mismatched deployment versions', async () => {
    for (const tag of ['main', 'v01.2.3', 'v1.2', 'v1.2.3;echo', 'v1.2.3\n', '--help']) expect(() => parseReleaseTag(tag)).toThrow();
    expect(parseReleaseTag('v1.2.3-rc.1')).toBe('1.2.3-rc.1');
    await expect(buildDeployment('/unused', version, 'not-a-digest')).rejects.toThrow('digest');
    await expect(buildDeployment('/unused', '999.0.0')).rejects.toThrow('disagree');
  });
});
