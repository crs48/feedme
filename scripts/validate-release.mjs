import { execFileSync } from 'node:child_process';
import { parseReleaseTag } from './build-deployment.mjs';

const tag = process.env.RELEASE_TAG;
const version = parseReleaseTag(tag);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sha = git('rev-parse', `refs/tags/${tag}^{commit}`);
git('merge-base', '--is-ancestor', sha, 'origin/main');
const pkg = JSON.parse(git('show', `${sha}:package.json`));
if (pkg.version !== version) throw new Error('Release tag does not match package.json.');
const manifest = JSON.parse(git('show', `${sha}:.release-please-manifest.json`));
if (manifest['.'] !== version) throw new Error('Release tag does not match the release manifest.');
const release = JSON.parse(execFileSync('gh', ['release', 'view', tag, '--repo', 'crs48/feedme', '--json', 'tagName,isDraft,isPrerelease'], { encoding: 'utf8' }));
if (release.isDraft || release.tagName !== tag) throw new Error('Publish an existing, non-draft GitHub release.');
if ((version.startsWith('0.') || version.includes('-')) && !release.isPrerelease) throw new Error('Early versions must be marked as GitHub prereleases.');
console.log(`Validated ${tag} at ${sha}.`);
