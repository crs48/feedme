import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ share: vi.fn(), id: vi.fn(), png: vi.fn(), previous: vi.fn(), upload: vi.fn() }));
vi.mock('../src/lib/config', () => ({ config: () => ({ origin: 'https://creator.example', demo: false }) }));
vi.mock('../src/lib/support-shares', () => ({ ensureSupportShare: mocks.id, supportShare: mocks.share }));
vi.mock('../src/lib/support-card-image', () => ({ supportCardPng: mocks.png }));
vi.mock('../src/lib/social-repo', () => ({ publishedPost: mocks.previous, uploadSocialImage: mocks.upload }));
import { supportSharePost } from '../src/lib/support-share-post';

describe('Bluesky support-card attachments', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.id.mockReturnValue('opaque-public-id');
    mocks.share.mockReturnValue({ creator: { name: 'Creator' } });
    mocks.png.mockResolvedValue(Buffer.from('rendered image'));
    mocks.upload.mockResolvedValue({ $type: 'blob', ref: { $link: 'bafkreipreview' }, mimeType: 'image/png', size: 14 });
  });
  it('attaches the rendered PNG to a native external embed without receipt details', async () => {
    const result = await supportSharePost('actor-did', 'secret-receipt-id', 'My public words');
    expect(result).toMatchObject({ text: 'My public words', embed: { $type: 'app.bsky.embed.external', external: {
      uri: 'https://creator.example/share/opaque-public-id', title: 'Supporting Creator', thumb: { mimeType: 'image/png' },
    } } });
    expect(JSON.stringify(result)).not.toContain('secret-receipt-id');
    expect(mocks.upload).toHaveBeenCalledWith('actor-did', Buffer.from('rendered image'));
  });
  it('reuses the original attachment after a lost publish response without reuploading changing totals', async () => {
    const record = { text: 'Original words', createdAt: 'original-time', embed: { external: { thumb: { ref: 'original-blob' } } } };
    mocks.previous.mockReturnValue({ rkey: 'original-key', record });
    expect(await supportSharePost('actor-did', 'receipt', 'Original words')).toEqual(record);
    expect(mocks.png).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    // Carry the submitted text through so publishPost can reject changed retries.
    expect(await supportSharePost('actor-did', 'receipt', 'Changed words')).toEqual({ ...record, text: 'Changed words' });
  });
  it('does not create an attachment for a tip without an eligible public card', async () => {
    mocks.id.mockReturnValue(undefined);
    expect(await supportSharePost('actor-did', 'private', 'A cheer')).toBeUndefined();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
