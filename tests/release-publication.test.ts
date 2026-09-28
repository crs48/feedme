import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { version } from '../package.json';

const exec = promisify(execFile);
const digest = `sha256:${'a'.repeat(64)}`;
const publish = async (state: 'absent' | 'same' | 'different' | 'denied') => {
  const directory = await mkdtemp(join(tmpdir(), 'feedme-publish-test-'));
  const log = join(directory, 'calls.jsonl');
  // Fake executables prevent any registry/GitHub writes while exercising the real
  // CLI, tar packaging and checksum generation end to end.
  const executable = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args)+'\\n');
if (args[0] === 'buildx' && args[2] === 'inspect') {
  if (process.env.REGISTRY_STATE === 'absent') { console.error('manifest unknown'); process.exit(1); }
  if (process.env.REGISTRY_STATE === 'denied') { console.error('unauthorized: not found'); process.exit(1); }
  console.log(JSON.stringify({digest: process.env.REGISTRY_STATE === 'same' ? process.env.IMAGE_DIGEST : 'sha256:'+'b'.repeat(64)}));
}
if (args[0] === 'release') {
  const crypto = require('node:crypto');
  const archive = fs.readFileSync(args[3]);
  const checksum = fs.readFileSync(args[4], 'utf8').split(' ')[0];
  if (crypto.createHash('sha256').update(archive).digest('hex') !== checksum) process.exit(2);
  const release = JSON.parse(fs.readFileSync(args[5], 'utf8'));
  if (!release.image.endsWith('@'+process.env.IMAGE_DIGEST)) process.exit(3);
}
`;
  try {
    for (const command of ['docker', 'gh']) await writeFile(join(directory, command), executable, { mode: 0o755 });
    let failed = false;
    try { await exec(process.execPath, [resolve('scripts/publish-release.mjs')], { env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, CALL_LOG: log, REGISTRY_STATE: state, RELEASE_TAG: `v${version}`, IMAGE_DIGEST: digest } }); }
    catch { failed = true; }
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[]);
    return { failed, promoted: calls.some(args => args[2] === 'create'), uploaded: calls.some(args => args[0] === 'release') };
  } finally { await rm(directory, { recursive: true, force: true }); }
};

describe('release publication gates', () => {
  it('promotes the verified digest and uploads an archive with a matching checksum', async () => {
    expect(await publish('absent')).toEqual({ failed: false, promoted: true, uploaded: true });
  });
  it('can retry asset attachment for the same already-published digest', async () => {
    expect(await publish('same')).toEqual({ failed: false, promoted: false, uploaded: true });
  });
  it.each(['different', 'denied'] as const)('does not mutate a release after a %s registry response', async state => {
    expect(await publish(state)).toEqual({ failed: true, promoted: false, uploaded: false });
  });
});
