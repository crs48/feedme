import { describe, expect, it } from 'vitest';
import { profileText } from '../src/lib/profile-text';

describe('Bluesky profile bio text', () => {
  it('preserves newlines and emoji while linking URLs, bare domains and handles locally', () => {
    const segments = profileText('hi 👋\nsite: https://crs.land\nsupport: crs.tips @crs.land');
    expect(segments.filter(s => s.href)).toEqual([
      { text: 'crs.land', href: 'https://crs.land/' },
      { text: 'crs.tips', href: 'https://crs.tips/' },
      { text: '@crs.land', href: 'https://bsky.app/profile/crs.land' },
    ]);
    expect(segments.map(s => s.text).join('')).toBe('hi 👋\nsite: crs.land\nsupport: crs.tips @crs.land');
  });
  it('leaves HTML, email addresses, insecure URLs and credential-bearing links as text', () => {
    const text = '<img src=x onerror=alert(1)> chris@example.com javascript:alert(1) http://example.com https://user:pass@example.com';
    const segments = profileText(text);
    expect(segments.every(s => !s.href)).toBe(true);
    expect(segments.map(s => s.text).join('')).toBe(text);
    expect(profileText('')).toEqual([]);
  });
});
