import { RichText } from '@atproto/api';
import { safeWebUrl } from './markdown';
import { accountIdentifier } from './identity-settings';
import type { TextSegment } from './bsky-content';

// Profile descriptions have no facets in getProfile. Use Bluesky's own local
// detector, without resolving mentions or fetching anything on behalf of a bio.
export const profileText = (text: string): TextSegment[] => {
  if (!text) return [];
  const rich = new RichText({ text });
  rich.detectFacetsWithoutResolution();
  return [...rich.segments()].map(segment => {
    const link = segment.link && safeWebUrl(segment.link.uri);
    if (link) return { text: segment.text.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), href: link };
    if (segment.mention) {
      try {
        const handle = accountIdentifier(segment.text);
        if (!handle.startsWith('did:')) return { text: segment.text, href: `https://bsky.app/profile/${encodeURIComponent(handle)}` };
      } catch { /* Render unrecognized text as text. */ }
    }
    return { text: segment.text };
  });
};
