import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '../../lib/auth';
import { config } from '../../lib/config';
import { formObject, errorMessage, redirectNotice } from '../../lib/http';
import { adminReturnPath, auditAdmin } from '../../lib/admin';
import { people } from '../../lib/people';
import { profile, project, saveFriend, saveProfile, saveProject, saveUpdate, updates } from '../../lib/repository';
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
  let returnTo = '/studio';
  let user;
  try { user = requireAdmin(context); }
  catch { return new Response('Administrator access is required.', { status: 403, headers: { 'Cache-Control': 'private, no-store' } }); }
  try {
    const form = await formObject(context.request);
    returnTo = adminReturnPath(form.returnTo);
    switch (form.action) {
      case 'project': {
        const id = form.id ? String(form.id) : `${String(form.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45)}-${randomUUID().slice(0, 8)}`;
        const existing = project(id);
        if (form.id && !existing) throw new Error('Project not found.');
        saveProject({ ...form, status: form.status || 'draft', id, createdAt: existing?.createdAt || new Date().toISOString(), target: Math.round(Number(form.target || 0) * 100) });
        auditAdmin(user.did, existing ? 'project.edit' : 'project.create', id);
        returnTo = `/studio/projects/${id}`;
        break;
      }
      case 'project-status': {
        const p = project(String(form.id));
        if (!p) throw new Error('Project not found.');
        const status = z.enum(['active', 'complete', 'archived']).parse(form.status);
        saveProject({ ...p, status });
        auditAdmin(user.did, `project.${status}`, p.id);
        break;
      }
      case 'project-duplicate': {
        const p = project(String(form.id));
        if (!p) throw new Error('Project not found.');
        const id = `${p.id.slice(0, 45)}-${randomUUID().slice(0, 8)}`;
        saveProject({ ...p, id, title: `${p.title.slice(0, 90)} (copy)`, status: 'draft', createdAt: new Date().toISOString() });
        auditAdmin(user.did, 'project.duplicate', id);
        returnTo = `/studio/projects/${id}`;
        break;
      }
      case 'profile-import': {
        const person = (await people([config().ownerDid])).get(config().ownerDid);
        if (!person) throw new Error('Bluesky could not be reached. Your saved profile is unchanged.');
        saveProfile({ ...profile(), name: person.name, handle: person.handle, avatar: config().demo ? '' : person.avatar || '', bio: person.bio && person.bio.length >= 3 ? person.bio : profile().bio });
        auditAdmin(user.did, 'profile.import', 'self');
        break;
      }
      case 'profile': saveProfile({ ...profile(), ...form }); auditAdmin(user.did, 'profile.edit', 'self'); break;
      case 'friend': saveFriend({ ...form, id: randomUUID() }); auditAdmin(user.did, 'circle.add', String(form.name)); break;
      case 'post-update': {
        const p = project(String(form.projectId));
        if (!p || !['active', 'complete'].includes(p.status)) throw new Error('Choose an available project.');
        const id = z.uuid().parse(form.requestId);
        const text = publicPostText(form.text);
        const createdAt = new Date().toISOString();
        const postUri = await publishPost(config().ownerDid, `update:${id}`, projectPost(text, {
          title: p.title, summary: p.summary, uri: projectUri(config().ownerDid, p.id), url: `${config().origin}/support/${p.id}`,
        }, createdAt));
        saveUpdate({ id, projectId: p.id, text, createdAt, postUri });
        auditAdmin(user.did, 'update.publish', p.id);
        return redirectNotice(returnTo, config().demo ? 'Demo post saved to your project log.' : 'Published on Bluesky. It will appear in the project log after Bluesky indexes it.');
      }
      case 'link-post': {
        if (config().demo) throw new Error('Linking real Bluesky posts is available after connecting a live creator account.');
        const p = project(String(form.projectId));
        if (!p || !['active', 'complete'].includes(p.status)) throw new Error('Choose an available project.');
        const post = await loadOwnPost(String(form.postUrl || ''));
        if (!updates().some((u) => u.projectId === p.id && u.postUri === post.uri)) saveUpdate({ id: randomUUID(), projectId: p.id, text: post.text.length >= 3 ? post.text.slice(0, 2000) : 'Media update', createdAt: new Date(post.createdAt).toISOString(), postUri: post.uri });
        auditAdmin(user.did, 'update.link', p.id);
        return redirectNotice(returnTo, 'Bluesky post added to the project log, including its media.');
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
        auditAdmin(user.did, 'update.create', update.projectId);
        break;
      }
      case 'space':
        if (config().demo) throw new Error('Private storage connects in live mode.');
        await createPrivateSpace(); auditAdmin(user.did, 'habitat.connect', 'self'); break;
      case 'stripe':
        if (config().demo) throw new Error('Stripe connects in live mode. No real payments are taken in this demo.');
        const onboarding = await connectStripe();
        auditAdmin(user.did, 'stripe.onboarding', 'self');
        return context.redirect(onboarding.url, 303);
      case 'sync': {
        const result = await drainOutbox();
        auditAdmin(user.did, 'records.sync', String(result.sent));
        return redirectNotice(returnTo, `${result.sent} records synced. ${result.failed ? 'The remaining records are queued for retry.' : 'Your data is up to date.'}`);
      }
      default: throw new Error('Unknown action.');
    }
    return redirectNotice(returnTo, config().demo ? 'Saved to this demo.' : 'Saved. Published changes are visible here; Sync records sends them to AT Protocol.');
  } catch (error) { return redirectNotice(returnTo, errorMessage(error), true); }
};
