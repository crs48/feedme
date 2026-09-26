import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/auth';
import { paymentsCsv, reportQuery, selectedPayments } from '../../../lib/analytics';
import { payments, projects } from '../../../lib/repository';
import { auditAdmin } from '../../../lib/admin';
export const GET: APIRoute = (context) => {
  let user;
  try { user = requireAdmin(context); }
  catch { return new Response('Administrator access is required.', { status: 403, headers: { 'Cache-Control': 'private, no-store' } }); }
  try {
    const query = reportQuery(context.url.searchParams);
    const csv = paymentsCsv(selectedPayments(payments(), query), projects(true));
    auditAdmin(user.did, 'payments.export', `${query.from}:${query.to}`);
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="feedme-payments-${query.to}.csv"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new Response('Invalid report date range.', { status: 400 }); }
};
