import { config } from './config';
import { getDb, getKv, setKv } from './db';
import { publicJson } from './public-network';
import { directorySnapshotSchema, freshDirectory, type DirectorySnapshot } from './directory-model';

// Only this public snapshot is downloaded. Viewer identities/graphs are never sent.
export const directoryHints = async () => {
  const cfg = config();
  if (cfg.demo || !cfg.directoryUrl) return undefined;
  try {
    const db = getDb();
    let snapshot = getKv<DirectorySnapshot>(db, 'directory-snapshot', cfg.directoryUrl);
    if (!snapshot) {
      snapshot = directorySnapshotSchema.parse(await publicJson(cfg.directoryUrl, { maxBytes: 2_000_001 }));
      setKv(db, 'directory-snapshot', cfg.directoryUrl, snapshot, 300_000);
    }
    if (!freshDirectory(snapshot)) return undefined;
    return { dids: [...new Set(snapshot.creators.filter(c => c.siteStatus === 'reachable').map(c => c.did))], partial: snapshot.source.partial };
  } catch { return undefined; } // Direct graph and relay lookup remain independent.
};
