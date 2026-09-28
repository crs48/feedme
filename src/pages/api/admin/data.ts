import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/auth';
import { config } from '../../../lib/config';
import { getDb, setKv } from '../../../lib/db';
import { errorMessage, formObject, redirectNotice } from '../../../lib/http';
import { runBackup } from '../../../lib/backups';
import { discoverRecoverySpaces, stageHabitatRecovery } from '../../../lib/recovery-import';
import { resumeRecovery, verifyRecovery } from '../../../lib/recovery-control';
import { drainOutbox } from '../../../lib/habitat';

let staging: Promise<unknown> | undefined;
export const POST: APIRoute = async (context) => {
  let user;
  try { user = requireAdmin(context); } catch { return new Response('Administrator access is required.', { status: 403 }); }
  try {
    if (user.did !== config().ownerDid) return new Response('Only the creator can manage recovery.', { status: 403 });
    if (config().demo) return redirectNotice('/studio/data', 'This is a preview. Backups and recovery connect in live mode.');
    const form = await formObject(context.request);
    switch (form.action) {
      case 'backup': { const status = await runBackup(true); if (status?.error) throw new Error(status.error); break; }
      case 'verify': { const status = await verifyRecovery(true); if (!status) throw new Error('Create and sync private storage before verifying it.'); if (status.error) throw new Error(status.error); break; }
      case 'sync': await drainOutbox(); break;
      case 'discover': setKv(getDb(), 'recovery', 'spaces', await discoverRecoverySpaces()); break;
      case 'stage': {
        if (staging) throw new Error('A recovery preview is already running.');
        const space = String(form.space || '');
        const spaces = await discoverRecoverySpaces();
        if (!spaces.some(s => s.space === space && s.checkpoint)) throw new Error('Select an owned Feedme space with a complete recovery checkpoint.');
        if (form.oldServerStopped !== 'yes') throw new Error('Stop the previous server before preparing a replacement.');
        staging = stageHabitatRecovery(space); try { await staging; } finally { staging = undefined; } break;
      }
      case 'resume': if (form.oldServerStopped !== 'yes') throw new Error('Confirm that the previous server is stopped.'); await resumeRecovery(); break;
      default: throw new Error('Choose a recovery action.');
    }
    return redirectNotice('/studio/data', 'Data protection status updated.');
  } catch (error) { return redirectNotice('/studio/data', errorMessage(error), true); }
};
