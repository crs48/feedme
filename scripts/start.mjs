import { randomBytes } from 'node:crypto';

// Release local writer locks on an ordinary container shutdown.
process.once('SIGTERM', () => process.exit(0));
process.once('SIGINT', () => process.exit(130));

// Keep one replica. The HTTP server and retry loop share the same environment.
process.env.SYNC_SECRET ||= randomBytes(32).toString('hex');
await import('../dist/server/entry.mjs');
const run = async () => {
  if (process.env.FEEDME_MODE !== 'live') return;
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 4321}/api/sync`, {
      method: 'POST', headers: { authorization: `Bearer ${process.env.SYNC_SECRET}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) console.error('Background synchronization returned', response.status);
  } catch { console.error('Background synchronization unavailable; will retry.'); }
};
// Completion-based scheduling avoids overlapping drains during an outage.
const schedule = () => setTimeout(() => { void run().finally(schedule); }, 30_000).unref();
schedule();
