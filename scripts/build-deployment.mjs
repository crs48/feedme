import { readFile, writeFile, mkdir, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const imageRepository = 'ghcr.io/crs48/feedme';
export const parseReleaseTag = tag => {
  if (typeof tag !== 'string' || tag.trim() !== tag || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.[1-9]\d*)?$/.test(tag || '')) throw new Error('Expected a release tag such as v0.2.0 or v0.2.0-beta.1.');
  return tag.slice(1);
};
export const buildDeployment = async (directory, version, digest) => {
  parseReleaseTag(`v${version}`);
  if (digest && !/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid image digest.');
  const image = `${imageRepository}:${version}${digest ? `@${digest}` : ''}`;
  const source = await readFile(join(repositoryRoot, 'deploy/compose.yaml'), 'utf8');
  if (!source.includes(`image: ${imageRepository}:${version} # x-release-please-version`)) throw new Error('The deployment template and package version disagree.');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'compose.yaml'), source.replace(/image: .* # x-release-please-version/, `image: ${image}`));
  // Explicit allowlist: release bundles can never accidentally include local data/secrets.
  for (const [source, destination] of [
    ['.env.example', '.env.example'], ['deploy/README.md', 'README.md'],
    ['deploy/renovate.json', 'renovate.json'], ['deploy/.gitignore', '.gitignore'],
  ]) await copyFile(join(repositoryRoot, source), join(directory, destination));
  await writeFile(join(directory, 'release.json'), `${JSON.stringify({ version, image, source: `https://github.com/crs48/feedme/releases/tag/v${version}` }, null, 2)}\n`);
  return image;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { check: { type: 'boolean' }, output: { type: 'string' }, digest: { type: 'string' } } });
  const { version } = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
  const directory = values.check ? await mkdtemp(join(tmpdir(), 'feedme-deploy-check-')) : resolve(values.output || 'output/deploy');
  try {
    const image = await buildDeployment(directory, version, values.digest);
    console.log(values.check ? `Deployment bundle verified for ${image}.` : `Created ${directory} for ${image}.`);
  } finally { if (values.check) await rm(directory, { recursive: true, force: true }); }
}
