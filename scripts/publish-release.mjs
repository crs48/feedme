import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { buildDeployment, parseReleaseTag, imageRepository } from './build-deployment.mjs';

const tag = process.env.RELEASE_TAG;
const version = parseReleaseTag(tag);
const digest = process.env.IMAGE_DIGEST;
if (!/^sha256:[a-f0-9]{64}$/.test(digest || '')) throw new Error('A tested image digest is required.');
const directory = await mkdtemp(join(tmpdir(), 'feedme-release-'));
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
try {
  await buildDeployment(join(directory, 'feedme'), version, digest);
  const target = `${imageRepository}:${version}`;
  const existing = spawnSync('docker', ['buildx', 'imagetools', 'inspect', target, '--format', '{{json .Manifest}}'], { encoding: 'utf8' });
  if (existing.status === 0) {
    if (JSON.parse(existing.stdout).digest !== digest) throw new Error('This version already has a different image. Publish a new version; never overwrite a release.');
  } else {
    if (!/(manifest unknown|not found)/i.test(existing.stderr) || /(unauthorized|denied)/i.test(existing.stderr)) throw new Error(`Could not inspect the release tag: ${existing.stderr}`);
    run('docker', ['buildx', 'imagetools', 'create', '--tag', target, `${imageRepository}@${digest}`]);
  }
  const archive = `feedme-${version}-deploy.tar.gz`;
  run('tar', ['-czf', join(directory, archive), '-C', directory, 'feedme']);
  await writeFile(join(directory, 'SHA256SUMS'), `${createHash('sha256').update(await readFile(join(directory, archive))).digest('hex')}  ${archive}\n`);
  run('gh', ['release', 'upload', tag, join(directory, archive), join(directory, 'SHA256SUMS'), join(directory, 'feedme/release.json'), '--repo', 'crs48/feedme', '--clobber']);
  console.log(`Published ${target}@${digest} and deployment bundle.`);
} finally { await rm(directory, { recursive: true, force: true }); }
