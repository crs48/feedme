import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Project, Support } from '../src/lib/model';
import { demoProfile, demoProjects } from '../src/lib/seed';
import { aspirationProgress } from '../src/lib/aspiration';
import { publicSupportCard } from '../src/lib/support-card';
import { supportCardPng, supportCardSvg } from '../src/lib/support-card-image';

let db: DatabaseSync;
vi.mock('../src/lib/db', async (original) => ({ ...await original<typeof import('../src/lib/db')>(), getDb: () => db }));
import { openDatabase, putRecord } from '../src/lib/db';
import { ensureSupportShare, supportShare } from '../src/lib/support-shares';

const receipt: Support = { id: 'private-billing-id', projectId: 'backyard-sauna', amount: 10000, currency: 'usd', status: 'paid', visibility: 'public',
  supporterDid: 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', note: 'PRIVATE NOTE', paymentIntentId: 'pi_SECRET', refundedAmount: 0, disputed: false, createdAt: '2026-09-27T12:00:00Z',
  allocations: [{ projectId: 'backyard-sauna', amount: 5000, activityId: 'a1' }, { projectId: 'open-source', amount: 3000, activityId: 'a2' }, { projectId: 'field-notes', amount: 2000, activityId: 'a3' }] };
const card = (s: Support = receipt, projects: Project[] = demoProjects) => publicSupportCard(s, demoProfile, projects, new Map([['backyard-sauna', 312500]]));

describe('public allocation cards', () => {
  it('projects only public percentages, titles and aspiration progress', () => {
    const result = card()!;
    expect(result.projects.map((p) => p.percentage)).toEqual([50, 30, 20]);
    expect(result.projects[0].progress).toMatchObject({ percentage: 125, exceeded: true, surplus: 25, surplusFill: 25 });
    expect(result.other).toEqual({ count: 0, percentage: 0 });
    for (const forbidden of ['PRIVATE NOTE', 'private-billing-id', 'pi_SECRET', receipt.supporterDid!, 'amount', '10000', '5000']) expect(JSON.stringify(result)).not.toContain(forbidden);
  });
  it.each<Partial<Support>>([{ visibility: 'private' }, { visibility: 'anonymous', announceAnonymously: true }, { status: 'pending' }, { status: 'failed' }, { status: 'refunded' }, { status: 'disputed' }, { disputed: true }, { refundedAmount: 10000 }, { supporterDid: undefined }])('never produces a card for ineligible support %j', (patch) => {
    expect(card({ ...receipt, ...patch })).toBeUndefined();
  });
  it('recalculates allocation percentages after partial refunds', () => {
    const result = card({ ...receipt, refundedAmount: 6000 })!;
    expect(result.projects.map(({ id, percentage }) => [id, percentage])).toEqual([['open-source', 50], ['field-notes', 50]]);
  });
  it('uses deterministic rounding and does not inflate a top-six subset to 100%', () => {
    const projects = Array.from({ length: 8 }, (_, index) => ({ ...demoProjects[0], id: `project-${index}` }));
    const parts = projects.map(({ id }) => ({ projectId: id, amount: 1, activityId: id }));
    const result = card({ ...receipt, amount: 8, allocations: parts }, projects)!;
    expect(result.projects).toHaveLength(6);
    expect(result.projects.map((p) => p.percentage)).toEqual(Array(6).fill(12.5));
    expect(result.other).toEqual({ count: 2, percentage: 25 });
    const thirds = card({ ...receipt, amount: 3, allocations: receipt.allocations!.map((p) => ({ ...p, amount: 1 })) })!;
    expect(thirds.projects.map((p) => p.percentage)).toEqual([33.4, 33.3, 33.3]);
  });
  it('does not expose draft or missing titles, and refuses inconsistent receipts', () => {
    const result = card(receipt, [{ ...demoProjects[0], status: 'draft', title: 'SECRET DRAFT' }, demoProjects[2]])!;
    expect(result.projects.map((p) => p.id)).toEqual(['field-notes']);
    expect(result.other).toEqual({ count: 2, percentage: 80 });
    expect(JSON.stringify(result)).not.toContain('SECRET DRAFT');
    expect(card({ ...receipt, amount: 9999 })).toBeUndefined();
  });
  it('handles single-project support and ongoing work without a target', () => {
    const result = card({ ...receipt, allocations: undefined }, [{ ...demoProjects[0], target: 0 }])!;
    expect(result.projects[0]).toMatchObject({ percentage: 100, progress: undefined });
  });
  it('keeps surplus growing past multiple aspirations and handles small overages', () => {
    expect(aspirationProgress(350, 100)).toMatchObject({ percentage: 350, fill: 100, surplus: 250, surplusFill: 100 });
    expect(aspirationProgress(115, 100)?.surplus).toBe(15);
    expect(aspirationProgress(100001, 100000)).toMatchObject({ exceeded: true, surplus: 0 });
    expect(aspirationProgress(100, 100)?.exceeded).toBe(false);
    expect(aspirationProgress(100, 0)).toBeUndefined();
  });
  it('renders a real 1200 × 630 PNG using bundled fonts and escapes user text', async () => {
    const result = card()!;
    result.projects[0].title = '</text><image href="https://evil.example/a"/>';
    const svg = supportCardSvg(result);
    expect(svg).not.toContain('<image');
    expect(svg).toContain('&lt;/text&gt;');
    const png = await supportCardPng(result);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(png.length).toBeLessThan(1_000_000);
    expect(await supportCardPng(result)).toBe(png);
    expect(supportCardSvg(result, true)).toContain('DEMO · NO PAYMENT');
  });
});

describe('opaque public support links', () => {
  beforeEach(() => {
    db = openDatabase(':memory:');
    putRecord(db, 'profile', 'self', demoProfile);
    demoProjects.forEach((p) => putRecord(db, 'project', p.id, p));
    putRecord(db, 'support', receipt.id, receipt);
  });
  afterEach(() => db.close());
  it('has a stable random share ID and does not accept a billing ID as a public link', () => {
    const id = ensureSupportShare(receipt.id)!;
    expect(id).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(ensureSupportShare(receipt.id)).toBe(id);
    expect(supportShare(id)?.projects).toHaveLength(3);
    expect(supportShare(receipt.id)).toBeUndefined();
    expect(supportShare('x'.repeat(24))).toBeUndefined();
    expect(ensureSupportShare('nonexistent')).toBeUndefined();
  });
  it('rechecks settlement and privacy on every read and excludes private money from progress', () => {
    const id = ensureSupportShare(receipt.id)!;
    putRecord(db, 'support', 'private', { ...receipt, id: 'private', visibility: 'private', amount: 900000, allocations: undefined });
    expect(supportShare(id)?.projects[0].progress?.percentage).toBe(2);
    for (const patch of [{ disputed: true }, { refundedAmount: receipt.amount }, { visibility: 'private' }, { visibility: 'anonymous' }]) {
      putRecord(db, 'support', receipt.id, { ...receipt, ...patch });
      expect(supportShare(id)).toBeUndefined();
      expect(ensureSupportShare(receipt.id)).toBeUndefined();
    }
  });
  it('gives each recurring payment its own link', () => {
    const first = ensureSupportShare(receipt.id);
    putRecord(db, 'support', 'renewal', { ...receipt, id: 'renewal', recurringRootId: receipt.id });
    expect(ensureSupportShare('renewal')).not.toBe(first);
  });
});
