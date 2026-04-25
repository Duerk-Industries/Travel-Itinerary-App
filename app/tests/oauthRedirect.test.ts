import { buildWebOAuthRedirectUrl } from '../utils/oauthRedirect';

describe('buildWebOAuthRedirectUrl', () => {
  it('uses the current origin when it already matches the backend origin', () => {
    expect(
      buildWebOAuthRedirectUrl({
        currentOrigin: 'https://duerk.org',
        backendUrl: 'https://duerk.org',
      })
    ).toBe('https://duerk.org/login');
  });

  it('uses the canonical backend origin when the browser is on a non-canonical HTTPS host', () => {
    expect(
      buildWebOAuthRedirectUrl({
        currentOrigin: 'https://www.duerk.org',
        backendUrl: 'https://duerk.org',
      })
    ).toBe('https://duerk.org/login');
  });

  it('keeps localhost redirects on the active local origin', () => {
    expect(
      buildWebOAuthRedirectUrl({
        currentOrigin: 'http://localhost:8081',
        backendUrl: 'http://localhost:4000',
      })
    ).toBe('http://localhost:8081/login');
  });
});
