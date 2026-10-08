import { describe, expect, it } from 'vitest';
import { blueskyProfileUrl } from '../src/lib/bluesky-url';
import { blueskyPostUrl } from '../src/lib/social-model';
import { parsePostView, richText } from '../src/lib/bsky-content';
import { postUriFromInput } from '../src/lib/project-log';

const did = 'did:plc:fvfdugmhgbbvxjppo2kkveq2';
const profileUrl = `https://bsky.app/profile/${did}`;
const rkey = '3mxfctrokik22';
const uri = `at://${did}/app.bsky.feed.post/${rkey}`;

describe('Bluesky web links', () => {
  it('preserves literal DID colons so Bluesky can resolve the profile', () => {
    expect(blueskyProfileUrl(did)).toBe(profileUrl);
    expect(new URL(blueskyProfileUrl(did)!).pathname).toBe(`/profile/${did}`);
    expect(blueskyProfileUrl('did:web:example.com')).toBe('https://bsky.app/profile/did:web:example.com');
    expect(blueskyProfileUrl('did:web:example.com%3A8443')).toBe('https://bsky.app/profile/did:web:example.com%3A8443');
  });

  it('still accepts normalized handles without resolving them over the network', () => {
    expect(blueskyProfileUrl(' @CRS.land ')).toBe('https://bsky.app/profile/crs.land');
  });

  it('does not turn invalid identities or URL delimiters into links', () => {
    for (const actor of ['', 'not a handle', 'https://evil.example', 'did:plc:bad', `${did}/post/other`, `${did}?x=1`, `${did}#fragment`, 'crs.land/../other', 'did%3Aplc%3Afvfdugmhgbbvxjppo2kkveq2']) {
      expect(blueskyProfileUrl(actor)).toBeUndefined();
    }
  });

  it('uses the same canonical DID in post links and accepts pasted links back', () => {
    const url = `${profileUrl}/post/${rkey}`;
    expect(blueskyPostUrl(uri)).toBe(url);
    expect(postUriFromInput(url)).toBe(uri);
    // Previously generated links remain accepted as input.
    expect(postUriFromInput(`https://bsky.app/profile/${encodeURIComponent(did)}/post/${rkey}`)).toBe(uri);
    expect(blueskyPostUrl(`at://${did}/app.bsky.graph.follow/${rkey}`)).toBeUndefined();
  });

  it('keeps mention and parsed post links usable on Bluesky', () => {
    const text = '@crs.land';
    const facets = [{ index: { byteStart: 0, byteEnd: text.length }, features: [{ $type: 'app.bsky.richtext.facet#mention', did }] }];
    expect(richText(text, facets)).toEqual([{ text, href: profileUrl }]);
    const post = parsePostView({ uri, author: { did, handle: 'crs.land' }, record: { text, facets, createdAt: '2026-10-08T12:00:00Z' } });
    expect(post?.url).toBe(`${profileUrl}/post/${rkey}`);
    expect(post?.segments).toEqual([{ text, href: profileUrl }]);
  });
});
