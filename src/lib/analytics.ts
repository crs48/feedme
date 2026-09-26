import { netSupport, supportParts, type Support, type Project } from './model';
import type { Subscription } from './recurring';

const day = 86_400_000;
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);
export const paymentDate = (s: Support) => s.paidAt || s.createdAt;
export type ReportQuery = { range: string; from: string; to: string; start: number; end: number; interval: 'week' | 'month'; project: string; q: string; status: string; frequency: string; visibility: string };
const date = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && isoDay(Date.parse(value)) === value ? Date.parse(value) : undefined;
export const reportQuery = (params: URLSearchParams, now = new Date()): ReportQuery => {
  const today = Date.parse(now.toISOString().slice(0, 10));
  const range = ['week', 'month', '30d', '90d', 'year', 'all', 'custom'].includes(params.get('range') || '') ? params.get('range')! : '30d';
  const defaultStart = range === 'week' ? today - ((new Date(today).getUTCDay() + 6) % 7) * day
    : range === 'month' ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    : range === 'year' ? Date.UTC(now.getUTCFullYear(), 0, 1)
    : range === 'all' ? Date.UTC(2000, 0, 1) : today - (range === '90d' ? 89 : 29) * day;
  if (range === 'custom' && (date(params.get('from')) === undefined || date(params.get('to')) === undefined)) throw new Error('Enter valid From and Through dates for a custom report.');
  const start = range === 'custom' ? date(params.get('from')) ?? defaultStart : defaultStart;
  const last = range === 'custom' ? date(params.get('to')) ?? today : today;
  if (start > last || start < Date.UTC(2000, 0, 1) || last > today) throw new Error('Choose a valid date range between 2000 and today. Dates use UTC.');
  return { range, from: isoDay(start), to: isoDay(last), start, end: last + day,
    interval: params.get('interval') === 'month' || (!params.has('interval') && range === 'all') ? 'month' : 'week',
    project: (params.get('project') || '').slice(0, 64), q: (params.get('q') || '').trim().toLowerCase().slice(0, 100),
    status: params.get('status') || '', frequency: params.get('frequency') || '', visibility: params.get('visibility') || '',
  };
};
export const projectPayment = (s: Support, projectId: string) => {
  if (!projectId) return s;
  return supportParts(s).find((part) => part.projectId === projectId);
};
export const selectedPayments = (records: Support[], query: ReportQuery) => records.flatMap((original) => {
  const s = projectPayment(original, query.project);
  const time = Date.parse(paymentDate(original));
  if (!s || time < query.start || time >= query.end || !Number.isFinite(time) ||
    (query.status && s.status !== query.status) || (query.frequency && (s.frequency || 'once') !== query.frequency) ||
    (query.visibility && s.visibility !== query.visibility)) return [];
  const searchable = [original.id, s.visibility === 'anonymous' ? 'anonymous' : s.supporterDid || 'guest', ...supportParts(s).map((part) => part.projectId)].join(' ').toLowerCase();
  return query.q && !searchable.includes(query.q) ? [] : [{ ...s, id: original.id }];
}).sort((a, b) => paymentDate(b).localeCompare(paymentDate(a)) || a.id.localeCompare(b.id));

const settled = (s: Support) => ['paid', 'refunded', 'disputed'].includes(s.status);
export const summarizePayments = (records: Support[]) => {
  const confirmed = records.filter(settled);
  const net = records.reduce((sum, s) => sum + netSupport(s), 0);
  const gross = confirmed.reduce((sum, s) => sum + s.amount, 0);
  const refunded = confirmed.reduce((sum, s) => sum + (s.status === 'refunded' ? s.amount : Math.min(s.amount, s.refundedAmount)), 0);
  const disputed = confirmed.reduce((sum, s) => sum + (s.status !== 'refunded' && (s.disputed || s.status === 'disputed') ? Math.max(0, s.amount - s.refundedAmount) : 0), 0);
  const positive = records.filter((s) => netSupport(s) > 0);
  return { net, gross, refunded, disputed, count: confirmed.length, average: confirmed.length ? Math.round(net / confirmed.length) : 0,
    knownSupporters: new Set(positive.flatMap((s) => s.visibility !== 'anonymous' && s.supporterDid ? [s.supporterDid] : [])).size,
    anonymousPayments: positive.filter((s) => s.visibility === 'anonymous' || !s.supporterDid).length,
    pending: records.filter((s) => s.status === 'pending').length, failed: records.filter((s) => s.status === 'failed').length,
  };
};
const bucketStart = (time: number, interval: 'week' | 'month') => {
  const d = new Date(time);
  return interval === 'month' ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
    : Date.parse(isoDay(time)) - ((d.getUTCDay() + 6) % 7) * day;
};
export const earningsSeries = (records: Support[], query: ReportQuery) => {
  const times = records.map((s) => Date.parse(paymentDate(s))).filter(Number.isFinite);
  const start = query.range === 'all' ? Math.max(query.start, times.length ? Math.min(...times) : query.end - 30 * day) : query.start;
  const buckets = [];
  for (let time = bucketStart(start, query.interval); time < query.end;) {
    const d = new Date(time);
    const end = query.interval === 'month' ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) : time + 7 * day;
    const payments = records.filter((s) => Date.parse(paymentDate(s)) >= time && Date.parse(paymentDate(s)) < end);
    buckets.push({ date: isoDay(time), ...summarizePayments(payments) });
    time = end;
  }
  return buckets;
};
export const projectPerformance = (records: Support[], projects: Project[]) => {
  const ids = [...new Set([...projects.map((p) => p.id), ...records.flatMap((s) => supportParts(s).map((part) => part.projectId))])];
  return ids.map((id) => ({ id, title: projects.find((p) => p.id === id)?.title || id,
    ...summarizePayments(records.flatMap((s) => supportParts(s).filter((part) => part.projectId === id))) })).sort((a, b) => b.net - a.net);
};
export const supporterPerformance = (records: Support[]) => {
  const named = records.filter((s) => s.visibility !== 'anonymous' && s.supporterDid && netSupport(s) > 0);
  return [...new Set(named.map((s) => s.supporterDid!))].map((did) => {
    const payments = named.filter((s) => s.supporterDid === did).sort((a, b) => paymentDate(b).localeCompare(paymentDate(a)));
    return { did, ...summarizePayments(payments), first: paymentDate(payments[payments.length - 1]), last: paymentDate(payments[0]),
      projects: [...new Set(payments.flatMap((s) => supportParts(s).filter((part) => netSupport(part) > 0).map((part) => part.projectId)))],
    };
  }).sort((a, b) => b.net - a.net);
};
export const recurringSummary = (records: Support[], subscriptions: Subscription[], projectId = '') => {
  const active = subscriptions.filter((s) => s.status === 'active').flatMap((subscription) => {
    const root = records.find((s) => s.id === subscription.id);
    const support = root && projectPayment(root, projectId);
    return support ? [{ subscription, support }] : [];
  });
  return { active: active.length, ending: active.filter(({ subscription }) => subscription.cancelAtPeriodEnd).length,
    monthly: Math.round(active.reduce((sum, { support }) => sum + (support.frequency === 'yearly' ? support.amount / 12 : support.frequency === 'monthly' ? support.amount : 0), 0)),
    pastDue: subscriptions.filter((s) => ['past_due', 'unpaid'].includes(s.status) && (!projectId || records.some((p) => p.id === s.id && projectPayment(p, projectId)))).length,
  };
};

const csvCell = (input: unknown) => {
  const value = String(input ?? '');
  return `"${(/^[\s]*[=+@\-]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
};
export const paymentsCsv = (records: Support[], projects: Project[]) => [
  ['Payment', 'Date UTC', 'Project', 'Amount USD', 'Net USD', 'Refunded USD', 'Status', 'Frequency', 'Visibility', 'Supporter DID'],
  ...records.flatMap((s) => supportParts(s).map((part) => [s.id, paymentDate(s), projects.find((p) => p.id === part.projectId)?.title || part.projectId,
    (part.amount / 100).toFixed(2), (netSupport(part) / 100).toFixed(2), (part.refundedAmount / 100).toFixed(2), part.status, part.frequency || 'once', part.visibility,
    part.visibility === 'anonymous' ? '' : part.supporterDid || '',
  ])),
].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';

export const adminReport = (params: URLSearchParams) => {
  try { return { query: reportQuery(params), error: '' }; }
  catch (error) { return { query: reportQuery(new URLSearchParams()), error: error instanceof Error ? error.message : 'Invalid date range.' }; }
};
export const reportPage = <T>(items: T[], params: URLSearchParams, size = 25) => {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.max(1, Math.min(pages, Number.parseInt(params.get('page') || '1') || 1));
  const href = (value: number) => { const p = new URLSearchParams(params); p.set('page', String(value)); return `?${p}`; };
  return { items: items.slice((page - 1) * size, page * size), page, pages, previous: href(page - 1), next: href(page + 1) };
};
export const displayDate = (input: string) => new Date(input).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
