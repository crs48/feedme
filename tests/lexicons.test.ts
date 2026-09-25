import { readdirSync, readFileSync } from 'node:fs';
import { Lexicons } from '@atproto/lexicon';
import { describe, expect, it } from 'vitest';
import { demoFriends, demoProfile, demoProjects, demoSupports, demoUpdates } from '../src/lib/seed';
import { privateReceipt, publicAcknowledgment } from '../src/lib/model';

const schemas = readdirSync(new URL('../lexicons/', import.meta.url)).filter((name) => name.endsWith('.json')).map((name) => JSON.parse(readFileSync(new URL(`../lexicons/${name}`, import.meta.url), 'utf8')));
describe('wire record contracts', () => {
  it('registers every lexicon and validates the records produced by the application', () => {
    const lexicons = new Lexicons(schemas);
    const records = [
      ...demoProjects.map((p) => ({ $type: 'social.feedme.project', ...p })),
      { $type: 'social.feedme.profile', ...demoProfile },
      ...demoFriends.map((p) => ({ $type: 'social.feedme.recommendation', ...p })),
      ...demoUpdates.map((p) => ({ $type: 'social.feedme.update', ...p })),
      privateReceipt(demoSupports[0]), publicAcknowledgment(demoSupports[0], 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa')!,
    ];
    for (const record of records) expect(lexicons.validate(record.$type, record).success).toBe(true);
  });
});
