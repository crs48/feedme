import type { DatabaseSync } from 'node:sqlite';
import { enqueue, getKv, listRecords, readRecord, setKv, transaction } from './db';
import { NS, LEGACY_NS, profileSchema, projectSchema, updateSchema, friendSchema, type Support } from './model';
import { queueSupport } from './support-ledger';

// Local operational records keep their keys. Old public project records are retained
// as aliases for existing links; payment projections must not survive as stale copies.
export const migrateProtocol = (db: DatabaseSync, cfg: { demo: boolean; ownerDid: string; origin: string }) => {
  if (getKv(db, 'app', 'protocol-version') === NS) return;
  transaction(db, () => {
    if (!cfg.demo) {
      const projects = listRecords(db, 'project').flatMap((value) => { const p = projectSchema.safeParse(value); return p.success && p.data.status !== 'draft' ? [p.data] : []; });
      const queued = db.prepare('SELECT 1 FROM outbox WHERE collection LIKE ?').get(`${LEGACY_NS}.%`);
      if (projects.length || queued) {
        const p = profileSchema.safeParse(readRecord(db, 'profile', 'self'));
        if (p.success) enqueue(db, 'public', `${NS}.profile`, 'self', { $type: `${NS}.profile`, ...p.data, feedmeUrl: cfg.origin, discoverable: p.data.discoverable ?? true });
        projects.forEach((p) => enqueue(db, 'public', `${NS}.project`, p.id, { $type: `${NS}.project`, ...p }));
        const published = new Set(projects.map((p) => p.id));
        for (const value of listRecords(db, 'update')) { const u = updateSchema.safeParse(value); if (u.success && published.has(u.data.projectId)) enqueue(db, 'public', `${NS}.update`, u.data.id, { $type: `${NS}.update`, ...u.data }); }
        for (const value of listRecords(db, 'friend')) { const f = friendSchema.safeParse(value); if (f.success) enqueue(db, 'public', `${NS}.recommendation`, f.data.id, { $type: `${NS}.recommendation`, ...f.data }); }
        setKv(db, 'app', 'legacy-payment-projections', true);
        for (const s of listRecords<Support>(db, 'support')) queueSupport(db, s, cfg.ownerDid);
        // Also supersede old queued projections even if their local receipt was removed.
        const old = db.prepare('SELECT collection,rkey FROM outbox WHERE destination=? AND collection IN (?,?)').all('public', `${LEGACY_NS}.activity`, `${LEGACY_NS}.acknowledgment`) as { collection: string; rkey: string }[];
        old.forEach((r) => enqueue(db, 'public', r.collection, r.rkey, null));
      }
    }
    setKv(db, 'app', 'protocol-version', NS);
  });
};
