// Only used in a fresh temporary child process by check-libcard-contract.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { getDb, openDatabase, putRecord, setKv } from '../../../src/lib/db';
import { config } from '../../../src/lib/config';
import { importLibcard, overrideLibcard, refreshLibcard } from '../../../src/lib/libcard';
import { parseLibcard } from '../../../src/lib/libcard-schema';
import { demoProfile, demoProjects } from '../../../src/lib/seed';
import { stringify } from 'yaml';
import type { LibcardDocument } from '../../../src/lib/libcard-schema';

assert.equal(process.env.FEEDME_CONTRACT_FIXTURE, 'temporary');
assert.equal(process.env.FEEDME_MODE, 'demo');
const source = config().libcard!;
const yaml = readFileSync(new URL('./enabled.config.yaml', import.meta.url), 'utf8');
const skippedYaml = readFileSync(new URL('./skipped.config.yaml', import.meta.url), 'utf8');
// Start empty instead of importing the unrelated default demo's native
// open-source project and payment history into this contract fixture.
const initial = openDatabase(join(config().dataDir, 'demo.sqlite'));
setKv(initial, 'app', 'initialized', true);
putRecord(initial, 'profile', 'self', demoProfile);
initial.close();
const db = getDb();
const document = parseLibcard(yaml, source);
const skipped = parseLibcard(skippedYaml, source).items;
const apply = (document: LibcardDocument) => importLibcard(db, { source, document, hash: createHash('sha256').update(stringify(document)).digest('hex'), checkedAt: new Date().toISOString(), catalogVersion: 2 });
// Cover both previously imported and never-imported skipped items in Studio.
apply({ ...document, items: [...document.items, ...[skipped[0], skipped[2]].map(item => ({ ...item, feedme: { id: `skipped-${item.kind}`, blurb: '' } }))] });
apply({ ...document, items: [...document.items, ...skipped] });
overrideLibcard(db, 'retired', true);
// The normal offline refresh tries to import this ID. Verify its diagnostic is
// visible in Studio while the transaction preserves the consumer fixture.
putRecord(db, 'project', 'nervous-system', { ...demoProjects[0], id: 'nervous-system' });
const result = await refreshLibcard(true);
assert.match(result?.error || '', /Target ID nervous-system belongs to a native project/);
db.close();
