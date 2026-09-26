import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export const safeWebUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
};
export const videoEmbed = (value: string) => {
  const safe = safeWebUrl(value);
  if (!safe) return undefined;
  const url = new URL(safe);
  const youtube = ['youtube.com', 'www.youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname)
    ? url.searchParams.get('v') || /^\/(?:embed|shorts)\/([\w-]{11})$/.exec(url.pathname)?.[1]
    : url.hostname === 'youtu.be' ? url.pathname.slice(1) : undefined;
  if (youtube && /^[\w-]{11}$/.test(youtube)) return { src: `https://www.youtube-nocookie.com/embed/${youtube}`, kind: 'iframe' as const };
  const vimeo = ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(url.hostname) && /^\/(?:video\/)?(\d+)$/.exec(url.pathname)?.[1];
  if (vimeo) return { src: `https://player.vimeo.com/video/${vimeo}?dnt=1`, kind: 'iframe' as const };
  if (/\.(mp4|webm)$/i.test(url.pathname)) return { src: safe, kind: 'video' as const };
  return undefined;
};
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
// A standalone Markdown link to a supported video becomes an accessible player.
// Raw author HTML is disabled; only markup generated here reaches the sanitizer.
const parser = new Marked({ gfm: true, breaks: false, renderer: {
  html() { return ''; },
  paragraph(token) {
    const only = token.tokens?.length === 1 ? token.tokens[0] : undefined;
    if (only?.type === 'link') {
      const embed = videoEmbed(only.href);
      if (embed) {
        const label = escape(only.text || 'Project video');
        return embed.kind === 'iframe'
          ? `<figure><iframe src="${escape(embed.src)}" title="${label}" loading="lazy" allowfullscreen referrerpolicy="no-referrer"></iframe><figcaption><a href="${escape(only.href)}">${label} ↗</a></figcaption></figure>`
          : `<figure><video controls playsinline preload="none" aria-label="${label}" src="${escape(embed.src)}"></video><figcaption><a href="${escape(only.href)}">${label} ↗</a></figcaption></figure>`;
      }
    }
    return `<p>${this.parser.parseInline(token.tokens)}</p>`;
  },
} });
export const renderMarkdown = (input: string) => sanitizeHtml(parser.parse(input, { async: false }), {
  allowedTags: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'iframe', 'video'],
  allowedAttributes: { a: ['href', 'title', 'rel'], img: ['src', 'alt', 'title', 'loading', 'decoding', 'referrerpolicy'], iframe: ['src', 'title', 'loading', 'allowfullscreen', 'referrerpolicy'], video: ['src', 'controls', 'playsinline', 'preload', 'aria-label'], ol: ['start'] },
  allowedSchemes: ['https', 'mailto'], allowedSchemesByTag: { img: ['https'], iframe: ['https'], video: ['https'] }, allowProtocolRelative: false,
  allowedIframeHostnames: ['www.youtube-nocookie.com', 'player.vimeo.com'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer ugc' }),
    img: (_tag, attrs) => ({ tagName: 'img', attribs: { ...(safeWebUrl(attrs.src) ? { src: safeWebUrl(attrs.src)! } : {}), alt: attrs.alt || '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' } }),
  },
});
