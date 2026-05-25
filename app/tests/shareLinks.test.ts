import { buildFollowShareLink } from '../utils/shareLinks';

describe('buildFollowShareLink', () => {
  it('builds web follow links with the current origin', () => {
    expect(
      buildFollowShareLink('ABC 123', {
        platformOs: 'web',
        webOrigin: 'https://example.com/',
        scheme: 'travelitineraryplanner',
      })
    ).toBe('https://example.com/app?followCode=ABC%20123');
  });

  it('builds native deep links with the configured Expo scheme', () => {
    expect(
      buildFollowShareLink('ABC123', {
        platformOs: 'ios',
        scheme: 'travelitineraryplanner',
      })
    ).toBe('travelitineraryplanner://app?followCode=ABC123');
  });

  it('falls back to the app scheme when Expo config is unavailable', () => {
    expect(
      buildFollowShareLink('ABC123', {
        platformOs: 'android',
        scheme: null,
      })
    ).toBe('travelitineraryplanner://app?followCode=ABC123');
  });
});
