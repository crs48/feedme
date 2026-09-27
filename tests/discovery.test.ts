import { describe, expect, it } from 'vitest';
import { connections, connectionReason, inView, visiblePerson, type GraphPerson } from '../src/lib/discovery-model';
import { publicAddress, publicUrl } from '../src/lib/public-network';
import { creatorFromRecord, didDocumentUrl } from '../src/lib/public-repo';
import { safeReturnPath } from '../src/lib/http';
import { demoProfile } from '../src/lib/seed';
const person = (letter: string, extra = {}): GraphPerson => ({ did: `did:plc:${letter.repeat(24)}`, handle: `${letter}.example`, ...extra });
const me = person('a'), maya = person('b'), jamie = person('c'), sam = person('d'), follower = person('e');
describe('connection-based discovery', () => {
  it('ranks mutuals, follows, followers, and deduplicated second-degree connections with honest reasons', () => {
    const results = connections(me.did, [maya, jamie, maya], [maya, follower], [{ person: maya, follows: [sam, sam, me] }, { person: jamie, follows: [sam] }]);
    expect(results.map((c) => c.did)).toEqual([maya.did, jamie.did, follower.did, sam.did]);
    expect(results[3].via).toHaveLength(2);
    expect(connectionReason(results[0])).toBe('You follow each other');
    expect(connectionReason(results[3])).toContain('1 more in this search');
    expect(results.filter((c) => inView(c, 'mutuals'))).toHaveLength(1);
    expect(results.filter((c) => inView(c, 'extended')).map((c) => c.did)).toEqual([sam.did]);
  });
  it('excludes blocked or muted accounts even if another person follows them', () => {
    const hidden = { ...sam, viewer: { muted: true } };
    expect(connections(me.did, [maya, hidden], [], [{ person: maya, follows: [sam] }]).map((c) => c.did)).toEqual([maya.did]);
    for (const viewer of [{ muted: true }, { blocking: 'at://block' }, { blockedBy: true }, { blockingByList: {} }]) expect(visiblePerson({ ...sam, viewer })).toBe(false);
    expect(visiblePerson({ ...sam, labels: [{ val: '!hide' }] })).toBe(false);
    expect(visiblePerson({ ...sam, labels: [{ val: '!hide', neg: true }] })).toBe(true);
  });
  it('does not invent a connection through someone the viewer does not follow', () => {
    expect(connections(me.did, [], [], [{ person: maya, follows: [sam] }])).toEqual([]);
  });
});
describe('public profile identity and network boundaries', () => {
  const record = { uri: `at://${maya.did}/fund.feedme.profile/self`, value: { ...demoProfile, $type: 'fund.feedme.profile', feedmeUrl: 'https://maya.example', discoverable: true, paymentIntentId: 'PRIVATE' } };
  it('accepts only the requested account and explicit public fields', () => {
    const result = creatorFromRecord(maya.did, record);
    expect(result?.url).toBe('https://maya.example');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(() => creatorFromRecord(sam.did, record)).toThrow();
    expect(() => creatorFromRecord(maya.did, { ...record, value: { ...record.value, $type: 'app.bsky.actor.profile' } })).toThrow();
  });
  it('honors discovery opt-out and does not infer a Feedme home from a generic website', () => {
    expect(creatorFromRecord(maya.did, { ...record, value: { ...record.value, discoverable: false } })).toBeNull();
    expect(creatorFromRecord(maya.did, { ...record, value: { ...record.value, feedmeUrl: undefined, website: 'https://website.example' } })).toBeNull();
    expect(() => creatorFromRecord(maya.did, { ...record, value: { ...record.value, feedmeUrl: 'https://maya.example/path?next=evil' } })).toThrow();
  });
  it('rejects local, reserved, credential-bearing, and non-HTTPS destinations', () => {
    for (const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','100.100.100.100','192.168.1.1','192.0.2.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1','2002:7f00:1::']) expect(publicAddress(ip)).toBe(false);
    for (const ip of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111']) expect(publicAddress(ip)).toBe(true);
    for (const url of ['http://example.com','https://127.1','https://localhost','https://name.local','https://user:secret@example.com','https://example.com:8080']) expect(() => publicUrl(url)).toThrow();
  });
  it('resolves DID web paths without accepting path injection', () => {
    expect(didDocumentUrl('did:web:example.com')).toBe('https://example.com/.well-known/did.json');
    expect(didDocumentUrl('did:web:example.com:people:maya')).toBe('https://example.com/people/maya/did.json');
    for (const did of ['did:web:example.com:%2Fbad','did:web:example.com:..','did:web:localhost']) expect(() => didDocumentUrl(did)).toThrow();
  });
  it('preserves the recommendation through login without allowing an external redirect', () => {
    const path = `/recommend?did=${encodeURIComponent(maya.did)}`;
    expect(safeReturnPath(path)).toBe(path);
    for (const value of [`https://return.invalid${path}`, `//return.invalid${path}`, `${path}&next=https://evil.example`, '/recommend?did=bad', `/recommend?did=${maya.did}#other`]) expect(safeReturnPath(value)).toBe('/');
  });
});
