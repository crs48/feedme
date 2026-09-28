import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

export type BackupObject = { key: string; createdAt: string };
export type BackupStore = { remote: boolean; put: (key: string, body: Buffer) => Promise<void>; get: (key: string) => Promise<Buffer>; list: () => Promise<BackupObject[]>; remove: (key: string) => Promise<void> };
export const backupName = /^feedme-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}\.fmbak$/;
const safeName = (key: string) => { if (!backupName.test(key)) throw new Error('Invalid backup name.'); return key; };
export const fileBackupStore = (directory: string): BackupStore => {
  const root = resolve(directory);
  return { remote: false,
    put: async (key, body) => { await mkdir(root, { recursive: true, mode: 0o700 }); const path = join(root, safeName(key)); await writeFile(`${path}.partial`, body, { mode: 0o600, flag: 'wx', flush: true }); await rename(`${path}.partial`, path); },
    get: (key) => readFile(join(root, safeName(key))),
    list: async () => { await mkdir(root, { recursive: true, mode: 0o700 }); return (await readdir(root)).filter(key => backupName.test(key)).map(key => ({ key, createdAt: nameDate(key) })); },
    remove: (key) => rm(join(root, safeName(key)), { force: true }),
  };
};
const nameDate = (key: string) => `${key.slice(7, 20)}:${key.slice(21, 23)}:${key.slice(24, 26)}.${key.slice(27, 31)}`;
export const backupStore = (env: NodeJS.ProcessEnv = process.env): BackupStore | undefined => {
  if (env.BACKUP_S3_BUCKET) {
    if (env.BACKUP_S3_ENDPOINT && new URL(env.BACKUP_S3_ENDPOINT).protocol !== 'https:') throw new Error('Use an HTTPS backup endpoint.');
    const prefix = (env.BACKUP_S3_PREFIX || 'feedme/').replace(/\/?$/, '/');
    const bucket = env.BACKUP_S3_BUCKET;
    const client = new S3Client({ region: env.BACKUP_S3_REGION || 'us-east-1', endpoint: env.BACKUP_S3_ENDPOINT || undefined, forcePathStyle: env.BACKUP_S3_PATH_STYLE === 'true',
      ...(env.BACKUP_S3_ACCESS_KEY_ID && env.BACKUP_S3_SECRET_ACCESS_KEY ? { credentials: { accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY } } : {}), maxAttempts: 2 });
    const requestOptions = () => ({ abortSignal: AbortSignal.timeout(60_000) });
    return { remote: true,
      put: async (key, body) => { await client.send(new PutObjectCommand({ Bucket: bucket, Key: prefix + safeName(key), Body: body, ContentType: 'application/octet-stream' }), requestOptions()); },
      get: async (key) => { const value = await client.send(new GetObjectCommand({ Bucket: bucket, Key: prefix + safeName(key) }), requestOptions()); if ((value.ContentLength || 0) > 400 * 1024 * 1024) throw new Error('Backup is too large.'); if (!value.Body) throw new Error('Empty backup object.'); return Buffer.from(await value.Body.transformToByteArray()); },
      list: async () => {
        const result: BackupObject[] = []; let cursor: string | undefined;
        do { const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: cursor }), requestOptions());
          for (const item of page.Contents || []) { const key = item.Key?.slice(prefix.length); if (key && backupName.test(key)) result.push({ key, createdAt: nameDate(key) }); }
          if (result.length > 100_000 || (page.IsTruncated && (!page.NextContinuationToken || page.NextContinuationToken === cursor))) throw new Error('Backup listing cannot be completed safely.');
          cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (cursor); return result;
      },
      remove: async (key) => { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: prefix + safeName(key) }), requestOptions()); },
    };
  }
  return env.BACKUP_DIR ? fileBackupStore(env.BACKUP_DIR) : undefined;
};
// Preserve 24 hours of quarter-hour snapshots, 30 distinct days and 12 distinct months.
export const expiredBackups = (items: BackupObject[]) => {
  const sorted = items.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  const keep = new Set(sorted.slice(0, 96).map(item => item.key));
  for (const [length, count] of [[10, 30], [7, 12]]) { const seen = new Set<string>(); for (const item of sorted) { const period = item.createdAt.slice(0, length); if (!seen.has(period) && seen.size < count) { keep.add(item.key); seen.add(period); } } }
  return sorted.filter(item => !keep.has(item.key));
};
