import { describe, expect, it } from 'vitest';
import { renderMarkdown, videoEmbed } from '../src/lib/markdown';
import { parsePostView, richText } from '../src/lib/bsky-content';
import { postUriFromInput } from '../src/lib/project-log';

describe('rich project content', () => {
  it('renders headings, lists, links, code, tables, and accessible HTTPS images', () => {
    const html = renderMarkdown('## The build\n\n**Progress** and [plans](https://example.com/plans)\n\n- Cedar\n- Stove\n\n![Cedar wall](https://example.com/wall.jpg)\n\n```ts\nconst ready = true;\n```\n\n| Part | Status |\n| --- | --- |\n| Wall | Up |');
    for (const tag of ['<h2>', '<strong>', '<ul>', '<pre>', '<table>']) expect(html).toContain(tag);
    expect(html).toContain('alt="Cedar wall"');
    expect(html).toContain('loading="lazy"');
  });
  it('removes executable HTML, unsafe URL schemes, and arbitrary iframes', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<iframe src="https://evil.test"></iframe>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29) ![bad](data:image/svg+xml,evil)');
    expect(html).not.toMatch(/<script|<iframe|onerror|javascript:|data:image/);
  });
  it('embeds only supported video links and leaves other links as links', () => {
    expect(renderMarkdown('[Workshop tour](https://youtu.be/abcdefghijk)')).toContain('https://www.youtube-nocookie.com/embed/abcdefghijk');
    expect(renderMarkdown('[Tour](https://vimeo.com/123456)')).toContain('https://player.vimeo.com/video/123456?dnt=1');
    expect(renderMarkdown('[Tour](https://example.com/movie.mp4)')).toContain('<video controls');
    expect(renderMarkdown('[Ordinary link](https://evil.test/watch?v=abcdefghijk)')).not.toContain('<iframe');
    expect(videoEmbed('https://youtube.com.evil.test/watch?v=abcdefghijk')).toBeUndefined();
    expect(videoEmbed('https://user:password@youtube.com/watch?v=abcdefghijk')).toBeUndefined();
  });
  it('uses UTF-8 facet boundaries and rejects overlapping or unsafe links', () => {
    const text = '🌱 See this';
    const facet = { index: { byteStart: 5, byteEnd: 8 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com/' }] };
    expect(richText(text, [facet])).toEqual([{ text: '🌱 ' }, { text: 'See', href: 'https://example.com/' }, { text: ' this' }]);
    expect(richText(text, [{ ...facet, index: { byteStart: 1, byteEnd: 8 } }])).toEqual([{ text }]);
    expect(richText(text, [{ ...facet, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'javascript:alert(1)' }] }])).toEqual([{ text }]);
  });
  it('normalizes native image/video cards while discarding unsafe media URLs', () => {
    const post = { uri: 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3mposttest222', cid: 'cid', author: { did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', handle: 'alex.test' }, record: { text: 'A photo', createdAt: '2026-09-25T12:00:00Z' } };
    expect(parsePostView({ ...post, embed: { $type: 'app.bsky.embed.images#view', images: [{ fullsize: 'https://example.com/image.jpg', alt: 'Our wall' }, { fullsize: 'javascript:alert(1)', alt: 'bad' }] } })?.images).toEqual([{ url: 'https://example.com/image.jpg', alt: 'Our wall' }]);
    expect(parsePostView({ ...post, embed: { $type: 'app.bsky.embed.video#view', playlist: 'https://video.bsky.app/test/playlist.m3u8', alt: 'Building together' } })?.video?.alt).toBe('Building together');
    expect(parsePostView({ ...post, author: { ...post.author, viewer: { blockedBy: true } } })).toBeUndefined();
    expect(parsePostView({ ...post, labels: [{ val: '!hide' }] })).toBeUndefined();
    expect(parsePostView({ ...post, labels: [{ val: 'graphic-media' }] })?.sensitive).toBe(true);
  });
  it('accepts native Bluesky post references, not arbitrary websites', () => {
    expect(postUriFromInput('https://bsky.app/profile/alex.test/post/3mposttest222')).toBe('at://alex.test/app.bsky.feed.post/3mposttest222');
    expect(() => postUriFromInput('https://evil.test/profile/alex.test/post/3mposttest222')).toThrow();
  });
  it('preserves safe author avatars but omits invalid or labeled profile images', () => {
    const author = { did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', handle: 'alex.test', avatar: 'https://cdn.bsky.app/avatar.jpg' };
    const post = { uri: `at://${author.did}/app.bsky.feed.post/3mposttest222`, author, record: { text: 'Hello', createdAt: '2026-09-25T12:00:00Z' } };
    expect(parsePostView(post)?.avatar).toBe(author.avatar);
    for (const avatar of [undefined, 7, 'javascript:alert(1)', 'data:image/svg+xml,evil', 'http://example.com/a.jpg', 'https://user:password@example.com/a.jpg']) {
      expect(parsePostView({ ...post, author: { ...author, avatar } })?.avatar).toBeUndefined();
    }
    expect(parsePostView({ ...post, author: { ...author, labels: [{ val: '!warn' }] } })?.avatar).toBeUndefined();
  });
});
