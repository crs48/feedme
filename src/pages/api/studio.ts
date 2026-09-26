import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { requireOwner } from '../../lib/auth';
import { config } from '../../lib/config';
import { formObject, errorMessage, redirectNotice } from '../../lib/http';
import { project, saveFriend, saveProfile, saveProject, saveUpdate, updates } from '../../lib/repository';
import { createPrivateSpace, drainOutbox } from '../../lib/habitat';
import { connectStripe } from '../../lib/payments';
import { getDb, enqueue } from '../../lib/db';
import { TID } from '@atproto/common-web';
import { POST as POST_COLLECTION, projectPost, projectUri, shortPostText } from '../../lib/social-model';
import { publishPost } from '../../lib/social-repo';
import { loadOwnPost } from '../../lib/project-log';
import { publicPostText } from '../../lib/social-model';
import { z } from 'zod';

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
      case 'post-update': {
        const p = project(String(form.projectId));
        if (!p || p.status === 'archived') throw new Error('Choose an available project.');
        const id = z.uuid().parse(form.requestId);
        const text = publicPostText(form.text);
        const createdAt = new Date().toISOString();
        const postUri = await publishPost(config().ownerDid, `update:${id}`, projectPost(text, {
          title: p.title, summary: p.summary, uri: projectUri(config().ownerDid, p.id), url: `${config().origin}/support/${p.id}`,
        }, createdAt));
        saveUpdate({ id, projectId: p.id, text, createdAt, postUri });
        return redirectNotice('/studio', config().demo ? 'Demo post saved to your project log.' : 'Published on Bluesky. It will appear in the project log after Bluesky indexes it.');
      }
      case 'link-post': {
        if (config().demo) throw new Error('Linking real Bluesky posts is available after connecting a live creator account.');
        const p = project(String(form.projectId));
        if (!p || p.status === 'archived') throw new Error('Choose an available project.');
        const post = await loadOwnPost(String(form.postUrl || ''));
        if (!updates().some((u) => u.projectId === p.id && u.postUri === post.uri)) saveUpdate({ id: randomUUID(), projectId: p.id, text: post.text.length >= 3 ? post.text.slice(0, 2000) : 'Media update', createdAt: new Date(post.createdAt).toISOString(), postUri: post.uri });
        return redirectNotice('/studio', 'Bluesky post added to the project log, including its media.');
      }
      case 'update': {
        const update = saveUpdate({ ...form, id: randomUUID(), createdAt: new Date().toISOString() });
        if (form.share === 'yes') {
          const p = project(update.projectId)!;
          const record = projectPost(shortPostText(update.text), {
            title: p.title, summary: p.summary, uri: projectUri(config().ownerDid, p.id), url: `${config().origin}/support/${p.id}`,
          }, update.createdAt);
          if (config().demo) await publishPost(config().ownerDid, `update:${update.id}`, record);
          else enqueue(getDb(), 'public', POST_COLLECTION, TID.nextStr(), record);
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
