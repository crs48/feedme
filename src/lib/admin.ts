import { randomUUID } from 'node:crypto';
import { getDb, listRecords, putRecord } from './db';

export type AdminEvent = { id: string; actor: string; action: string; target: string; createdAt: string };
export const auditAdmin = (actor: string, action: string, target: string) => {
  const event: AdminEvent = { id: randomUUID(), actor, action, target, createdAt: new Date().toISOString() };
  putRecord(getDb(), 'admin-event', event.id, event);
};
export const adminEvents = () => listRecords<AdminEvent>(getDb(), 'admin-event').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const adminReturnPath = (value: unknown) => typeof value === 'string' && /^\/studio(?:\/[a-z0-9-]+)*(?:\?[a-zA-Z0-9%=&_-]*)?$/.test(value) ? value : '/studio';
