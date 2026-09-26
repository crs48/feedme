import type { APIRoute } from 'astro';
import { currentUser } from '../../lib/auth';
import { config } from '../../lib/config';
import { errorMessage, formObject, redirectNotice, safeReturnPath } from '../../lib/http';
import { changeFollow, publishPost } from '../../lib/social-repo';
import { POST as BSKY_POST, projectPost, projectUri, publicPostText } from '../../lib/social-model';
import { profile, project, support } from '../../lib/repository';
import { canShareTip } from '../../lib/tip-sharing';

export const POST: APIRoute = async (context) => {
  const form = await formObject(context.request);
  let returnTo = safeReturnPath(form.returnTo);
  try {
    const user = currentUser(context);
    if (!user) throw new Error('Sign in with your AT Protocol account first.');
    if (form.action === 'follow') {
      if (form.kind !== 'creator' && form.kind !== 'project') throw new Error('Choose a person or project.');
      if (form.enabled !== 'yes' && form.enabled !== 'no') throw new Error('Choose whether to follow.');
      await changeFollow(user.did, form.kind, String(form.subject || ''), form.enabled === 'yes', String(form.title || ''));
      return redirectNotice(returnTo, `${config().demo ? 'Demo: ' : ''}${form.enabled === 'yes' ? 'Following. Find new posts in Following.' : 'Unfollowed.'}`);
    }
    if (form.action === 'post') {
      const s = support(String(form.supportId || ''));
      if (!canShareTip(s, user, context.cookies.get('feedme_checkout')?.value)) throw new Error('A confirmed tip and its original browser or account are required to share.');
      returnTo = `/thanks?id=${encodeURIComponent(s!.id)}`;
      if (form.consent !== 'public') throw new Error('Confirm that you want to publish this message publicly.');
      const p = project(s!.projectId);
      if (!p) throw new Error('This project is no longer available.');
      const text = publicPostText(form.publicText);
      await publishPost(user.did, `tip:${s!.id}`, s!.allocations ? {
        $type: BSKY_POST, text, createdAt: new Date().toISOString(),
        embed: { $type: 'app.bsky.embed.external', external: { uri: config().origin, title: `${profile().name}’s projects`, description: 'Independent work, supported.' } },
      } : projectPost(text, {
        title: p.title, summary: p.summary, uri: projectUri(config().ownerDid, p.id), url: `${config().origin}/support/${p.id}`,
      }, new Date().toISOString()));
      return redirectNotice(returnTo, config().demo ? 'Your demo post is saved. Nothing was published to the network.' : 'Your message is published on Bluesky.');
    }
    throw new Error('Unknown social action.');
  } catch (error) { return redirectNotice(returnTo, errorMessage(error), true); }
};
