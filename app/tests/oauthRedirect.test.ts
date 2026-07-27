/// <reference types="jest" />
/// <reference types="node" />
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

  it('uses the current HTTPS origin even if it differs from the backend origin', () => {
    expect(
      buildWebOAuthRedirectUrl({
        currentOrigin: 'https://wander-bunnies.com',
        backendUrl: 'https://duerk.org',
      })
    ).toBe('https://wander-bunnies.com/login');
  });

  it('uses the backend origin as a safe fallback when the current origin is not HTTPS', () => {
    expect(
      buildWebOAuthRedirectUrl({
        currentOrigin: 'http://insecure-site.com',
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
