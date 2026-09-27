import { config } from './config';
import { supportCardPng } from './support-card-image';
import { ensureSupportShare, supportShare } from './support-shares';
import { publishedPost, uploadSocialImage } from './social-repo';
import { POST } from './social-model';

// Called only after receipt access and explicit public-post consent are checked.
export const supportSharePost = async (actor: string, supportId: string, text: string): Promise<Record<string, unknown> | undefined> => {
  const id = ensureSupportShare(supportId);
  const card = id && supportShare(id);
  if (!card) return;
  // Preserve the exact first attachment on retries, even if public totals moved.
  // publishPost still rejects different text and keeps its original record key.
  const previous = publishedPost(actor, `tip:${supportId}`);
  if (previous) return { ...previous.record, text };
  const png = await supportCardPng(card, config().demo);
  const thumb = await uploadSocialImage(actor, png);
  return { $type: POST, text, createdAt: new Date().toISOString(),
    embed: { $type: 'app.bsky.embed.external', external: {
      uri: `${config().origin}/share/${id}`, title: `Supporting ${card.creator.name}`,
      description: 'Good things, backed. See the project split and what this support helps make possible.',
      ...(thumb ? { thumb } : {}),
    } },
  };
};
