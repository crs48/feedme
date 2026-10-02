import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { directorySnapshotSchema, emptyDirectory } from '../../src/lib/directory-model';

// Static builds never crawl or open a live application database.
const path = process.env.DIRECTORY_SNAPSHOT_PATH;
export const directory = (() => {
  if (!path) return emptyDirectory();
  const file = resolve(path);
  if (statSync(file).size > 2_000_001) throw new Error('Directory snapshot exceeds the public size limit.');
  return directorySnapshotSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
})();
