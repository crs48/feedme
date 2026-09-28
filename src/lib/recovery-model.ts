import { createHash } from 'node:crypto';
import { z } from 'zod';
import { didSchema, friendSchema, NS, profileSchema, projectSchema, updateSchema } from './model';

export const RECOVERY = `${NS}.recovery`;
export const RECOVERY_INDEX = `${NS}.recoveryIndex`;
export const CHECKPOINT = `${NS}.checkpoint`;
const id = z.string().min(1).max(256);
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const supportRecoverySchema = z.object({
  id, projectId: id, amount: cents, currency: z.literal('usd'),
  visibility: z.enum(['anonymous', 'private', 'public']), supporterDid: didSchema.optional(), note: z.string().max(500),
  status: z.enum(['pending', 'paid', 'failed', 'refunded', 'disputed']), refundedAmount: cents, disputed: z.boolean(),
  createdAt: z.iso.datetime(), paidAt: z.iso.datetime().optional(),
  checkoutId: id.optional(), paymentIntentId: id.optional(), accountId: id.optional(),
  frequency: z.enum(['once', 'monthly', 'yearly']).optional(), subscriptionId: id.optional(), invoiceId: id.optional(), recurringRootId: id.optional(),
  announceAnonymously: z.boolean().optional(), activityId: id.optional(),
  allocations: z.array(z.object({ projectId: id, amount: cents, activityId: id })).min(1).max(100).optional(),
}).superRefine((s, ctx) => {
  if (s.refundedAmount > s.amount || (s.allocations && (s.allocations.reduce((n, p) => n + p.amount, 0) !== s.amount || new Set(s.allocations.map(p => p.projectId)).size !== s.allocations.length)))
    ctx.addIssue({ code: 'custom', message: 'Invalid payment allocation or refund total.' });
  if (s.visibility === 'anonymous' && s.supporterDid) ctx.addIssue({ code: 'custom', message: 'Anonymous support cannot contain a supporter identity.' });
});
const subscription = z.object({ id, accountId: id, subscriptionId: id, customerId: id, status: id, cancelAtPeriodEnd: z.boolean(), currentPeriodEnd: z.number().int().nonnegative().optional(), eventCreated: z.number().int().nonnegative() });
const audit = z.object({ id, actor: didSchema, action: id, target: z.string().max(2048), createdAt: z.iso.datetime() });
export const recordSchemas = { profile: profileSchema, project: projectSchema, update: updateSchema, friend: friendSchema, support: supportRecoverySchema, subscription, 'admin-event': audit };
// These are logical application data, never OAuth credentials, cookies, API keys or cached profiles.
export const portableKv = (namespace: string, key: string) => ['support-share-id', 'support-share-payment', 'payment-order'].includes(namespace) || (namespace === 'app' && ['stripe-account', 'legacy-payment-projections'].includes(key));
export type RecoveryLocation = { table: 'records' | 'kv'; kind: string; key: string };
export const portableLocation = ({ table, kind, key }: RecoveryLocation) => table === 'records' ? Object.hasOwn(recordSchemas, kind) : portableKv(kind, key);
export const parsePortableValue = (location: RecoveryLocation, value: unknown): unknown => {
  if (!portableLocation(location)) throw new Error('This record is not part of the private recovery format.');
  if (location.table === 'records') {
    const parsed = recordSchemas[location.kind as keyof typeof recordSchemas].parse(value);
    if (('id' in parsed && parsed.id !== location.key) || (location.kind === 'profile' && location.key !== 'self')) throw new Error('Recovery record key mismatch.');
    return parsed;
  }
  if (location.kind === 'payment-order') return z.object({ created: z.number().int().nonnegative(), closed: z.boolean() }).parse(value);
  if (location.key === 'legacy-payment-projections') return z.boolean().parse(value);
  if (location.kind === 'support-share-id') return z.string().regex(/^[A-Za-z0-9_-]{24}$/).parse(value);
  return id.parse(value);
};
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
};
export const hashValue = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const recoveryKey = (location: RecoveryLocation) => hashValue([location.table, location.kind, location.key]);
export const recoveryEnvelopeSchema = z.object({
  $type: z.literal(RECOVERY), version: z.literal(1), owner: didSchema, instance: z.uuid(),
  table: z.enum(['records', 'kv']), kind: id, key: id, json: z.string().max(200_000).refine(value => Buffer.byteLength(value, 'utf8') <= 200_000, 'Recovery record exceeds the byte limit.'),
});
export type RecoveryEnvelope = z.infer<typeof recoveryEnvelopeSchema>;
export const recoveryEnvelope = (owner: string, instance: string, location: RecoveryLocation, value: unknown): RecoveryEnvelope => recoveryEnvelopeSchema.parse({
  $type: RECOVERY, version: 1, owner, instance, ...location, json: canonical(parsePortableValue(location, value)),
});
export const indexSchema = z.object({ $type: z.literal(RECOVERY_INDEX), version: z.literal(1), owner: didSchema, instance: z.uuid(), records: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(500) });
export const checkpointSchema = z.object({
  $type: z.literal(CHECKPOINT), version: z.literal(1), owner: didSchema, instance: z.uuid(), space: z.string().startsWith('at://').max(2048),
  indexes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(200),
  digest: z.string().regex(/^[a-f0-9]{64}$/), count: z.number().int().nonnegative().max(100_000), createdAt: z.iso.datetime(),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;
export const inventoryDigest = (rows: { rkey: string; digest: string }[]) => hashValue(rows.toSorted((a, b) => a.rkey < b.rkey ? -1 : a.rkey > b.rkey ? 1 : 0));
