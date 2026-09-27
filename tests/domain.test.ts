import { afterEach, describe, expect, it } from 'vitest';
import { centsFromInput, netSupport, privateReceipt, publicAcknowledgment, type Support } from '../src/lib/model';
import { enqueue, getKv, listRecords, openDatabase, pendingWrites, putRecord, readRecord, setKv, transaction } from '../src/lib/db';
import { isOwner } from '../src/lib/auth';
import { safeReturnPath } from '../src/lib/http';
import { config } from '../src/lib/config';

const owner = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
export const sample: Support = { id: 'tip-1', projectId: 'sauna', amount: 2500, currency: 'usd', visibility: 'public', supporterDid: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', note: 'Private note, never publish', status: 'paid', refundedAmount: 0, disputed: false, createdAt: '2026-09-25T12:00:00.000Z', checkoutId: 'cs_123', paymentIntentId: 'pi_123', accountId: 'acct_creator' };

describe('privacy and money boundaries', () => {
  it('parses decimal amounts without floating-point rounding or exponent notation', () => {
    expect(centsFromInput('19.99')).toBe(1999);
    expect(centsFromInput('1.1')).toBe(110);
    for (const input of ['0.99', '1000.01', '1e2', 'NaN', '5.001', '-5', '']) expect(() => centsFromInput(input)).toThrow();
  });
  it('public acknowledgments contain only explicitly public fields', () => {
    const result = publicAcknowledgment(sample, owner)!;
    expect(Object.keys(result).sort()).toEqual(['$type', 'amount', 'createdAt', 'creator', 'currency', 'project', 'supporter']);
    expect(JSON.stringify(result)).not.toMatch(/Private note|acct_|pi_|cs_/);
    expect(publicAcknowledgment({ ...sample, visibility: 'anonymous' }, owner)).toBeNull();
    expect(publicAcknowledgment({ ...sample, visibility: 'private' }, owner)).toBeNull();
    expect(publicAcknowledgment({ ...sample, supporterDid: undefined }, owner)).toBeNull();
  });
  it('drops social identity even if an anonymous record accidentally includes a DID', () => {
    const receipt = privateReceipt({ ...sample, visibility: 'anonymous' });
    expect(receipt).not.toHaveProperty('supporter');
    expect(receipt.note).toBe(sample.note);
  });
  it('excludes pending, refunded, and disputed funds from support totals', () => {
    expect(netSupport({ ...sample, refundedAmount: 500 })).toBe(2000);
    for (const status of ['pending', 'failed', 'refunded', 'disputed'] as const) expect(netSupport({ ...sample, status })).toBe(0);
    expect(publicAcknowledgment({ ...sample, disputed: true }, owner)).toBeNull();
  });
  it('requires the configured owner and prevents open redirects', () => {
    expect(isOwner()).toBe(false);
    expect(isOwner({ did: sample.supporterDid! })).toBe(false);
    expect(isOwner({ did: owner })).toBe(true);
    expect(safeReturnPath('//evil.test')).toBe('/');
    expect(safeReturnPath('/\\evil.test')).toBe('/');
    expect(safeReturnPath('/support/sauna')).toBe('/support/sauna');
  });
});

describe('durable operational storage', () => {
  afterEach(() => { delete process.env.DATA_ENCRYPTION_KEY; delete process.env.FEEDME_MODE; delete process.env.OWNER_DID; delete process.env.PUBLIC_URL; });
  it('rolls back the record and outbox together', () => {
    const db = openDatabase(':memory:');
    expect(() => transaction(db, () => { putRecord(db, 'support', sample.id, sample); enqueue(db, 'private', 'fund.feedme.support', sample.id, sample); throw new Error('interrupted'); })).toThrow();
    expect(listRecords(db, 'support')).toEqual([]);
    expect(pendingWrites(db)).toEqual([]);
    db.close();
  });
  it('preserves a newer write if an older in-flight sync completes', () => {
    const db = openDatabase(':memory:');
    enqueue(db, 'public', 'fund.feedme.project', 'sauna', { title: 'old' });
    const old = pendingWrites(db)[0];
    enqueue(db, 'public', 'fund.feedme.project', 'sauna', { title: 'new' });
    db.prepare('DELETE FROM outbox WHERE id=? AND revision=?').run(old.id, old.revision);
    expect(pendingWrites(db)[0].value).toEqual({ title: 'new' });
    db.close();
  });
  it('encrypts local values and detects tampering', () => {
    process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
    const db = openDatabase(':memory:');
    putRecord(db, 'support', sample.id, sample);
    const stored = db.prepare('SELECT value FROM records').get() as { value: string };
    expect(stored.value).toMatch(/^enc:/);
    expect(stored.value).not.toContain(sample.note);
    expect(readRecord(db, 'support', sample.id)).toEqual(sample);
    process.env.DATA_ENCRYPTION_KEY = 'b'.repeat(64);
    expect(() => readRecord(db, 'support', sample.id)).toThrow();
    db.close();
  });
  it('expires browser and OAuth state', () => {
    const db = openDatabase(':memory:');
    setKv(db, 'session', 'expired', { did: owner }, -100);
    expect(getKv(db, 'session', 'expired')).toBeUndefined();
    db.close();
  });
  it('fails closed for a live instance without HTTPS and an encryption key', () => {
    process.env.FEEDME_MODE = 'live'; process.env.OWNER_DID = owner;
    expect(() => config()).toThrow(/HTTPS/);
    process.env.PUBLIC_URL = 'https://creator.example.com';
    expect(() => config()).toThrow(/DATA_ENCRYPTION_KEY/);
  });
});
