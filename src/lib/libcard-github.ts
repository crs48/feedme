import type { DatabaseSync } from 'node:sqlite';
import { getKv, setKv } from './db';
import { githubRepoSchema, type LibcardItem } from './libcard-schema';

const reserved = new Set(['orgs', 'sponsors', 'marketplace', 'features', 'topics', 'collections', 'trending', 'about', 'pricing', 'settings', 'notifications', 'explore', 'apps', 'login', 'join']);
export const githubRepo = (item: LibcardItem) => {
  const input = item.github || (item.star || (item.stars && item.stars !== 'off') ? item.url : '');
  if (!githubRepoSchema.safeParse(input).success) return;
  const [owner, name] = new URL(input).pathname.split('/').filter(Boolean);
  if (!owner || !name || reserved.has(owner.toLowerCase()) || ['.', '..'].includes(name)) return;
  const repo = `${owner}/${name.replace(/\.git$/, '')}`;
  return { repo, url: `https://github.com/${repo}`, showCount: Boolean(item.stars && item.stars !== 'off') };
};
export type GitHubStars = { count?: number; checkedAt?: string; attemptedAt: string };
export const cachedGithubStars = (db: DatabaseSync, repo: string) => getKv<GitHubStars>(db, 'libcard-github', repo.toLowerCase());

// One bounded request per distinct repo per six hours, with four concurrent workers.
// No credentials or visitor data are sent; failures preserve the last known number.
export const refreshGithubStars = async (db: DatabaseSync, items: LibcardItem[], fetcher: typeof fetch = fetch) => {
  const deadline = AbortSignal.timeout(8000);
  const repos = [...new Set(items.flatMap(item => { const info = githubRepo(item); return info?.showCount ? [info.repo.toLowerCase()] : []; }))].slice(0, 99);
  const pending = repos.filter(repo => {
    const previous = cachedGithubStars(db, repo);
    return !previous || Date.now() - Date.parse(previous.attemptedAt) >= (previous.count === undefined ? 60 : 360) * 60_000;
  });
  const refresh = async (repo: string) => {
    const previous = cachedGithubStars(db, repo), attemptedAt = new Date().toISOString();
    setKv(db, 'libcard-github', repo, { ...previous, attemptedAt });
    try {
      const response = await fetcher(`https://api.github.com/repos/${repo}`, {
        signal: AbortSignal.any([deadline, AbortSignal.timeout(4000)]), redirect: 'error',
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Feedme-LibCard' },
      });
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 64 * 1024) return; chunks.push(chunk.value); }
      } finally { await reader.cancel(); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (Number.isSafeInteger(data.stargazers_count) && data.stargazers_count >= 0)
        setKv(db, 'libcard-github', repo, { count: data.stargazers_count, checkedAt: attemptedAt, attemptedAt });
    } catch { /* Decorative metadata must not block the catalog or checkout. */ }
  };
  const worker = async () => { for (let repo = pending.shift(); repo && !deadline.aborted; repo = pending.shift()) await refresh(repo); };
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
};
