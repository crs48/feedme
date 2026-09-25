import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { requireOwner } from '../../lib/auth';
import { config } from '../../lib/config';
import { formObject, errorMessage, redirectNotice } from '../../lib/http';
import { project, saveFriend, saveProfile, saveProject, saveUpdate } from '../../lib/repository';
import { createPrivateSpace, drainOutbox } from '../../lib/habitat';
import { connectStripe } from '../../lib/payments';
import { getDb, enqueue } from '../../lib/db';

export const POST: APIRoute = async (context) => {
  try {
    requireOwner(context);
    const form = await formObject(context.request);
    switch (form.action) {
      case 'project': {
        const id = form.id ? String(form.id) : `${String(form.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45)}-${randomUUID().slice(0, 8)}`;
        const existing = project(id);
        if (form.id && !existing) throw new Error('Project not found.');
        saveProject({ ...form, id, createdAt: existing?.createdAt || new Date().toISOString(), target: Math.round(Number(form.target || 0) * 100) });
        break;
      }
      case 'profile': saveProfile(form); break;
      case 'friend': saveFriend({ ...form, id: randomUUID() }); break;
      case 'update': {
        const update = saveUpdate({ ...form, id: randomUUID(), createdAt: new Date().toISOString() });
        if (form.share === 'yes' && !config().demo) {
          const p = project(update.projectId)!;
          const uri = `${config().origin}/support/${p.id}`;
          // Explicit opt-in. A stable rkey makes retries idempotent.
          enqueue(getDb(), 'public', 'app.bsky.feed.post', update.id, {
            $type: 'app.bsky.feed.post', text: Array.from(update.text).slice(0, 280).join(''), createdAt: update.createdAt,
            embed: { $type: 'app.bsky.embed.external', external: { uri, title: p.title, description: p.summary } },
          });
        }
        break;
      }
      case 'space':
        if (config().demo) throw new Error('Private storage connects in live mode.');
        await createPrivateSpace(); break;
      case 'stripe':
        if (config().demo) throw new Error('Stripe connects in live mode. No real payments are taken in this demo.');
        return context.redirect((await connectStripe()).url, 303);
      case 'sync': {
        const result = await drainOutbox();
        return redirectNotice('/studio', `${result.sent} records synced. ${result.failed ? 'The remaining records are queued for retry.' : 'Your data is up to date.'}`);
      }
      default: throw new Error('Unknown action.');
    }
    return redirectNotice('/studio', config().demo ? 'Saved to this demo.' : 'Saved. Use Sync records to publish queued changes.');
  } catch (error) { return redirectNotice('/studio', errorMessage(error), true); }
};
