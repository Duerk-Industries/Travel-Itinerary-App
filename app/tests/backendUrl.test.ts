import { resolveBackendUrl } from '../utils/backendUrl';

describe('resolveBackendUrl', () => {
  it('uses the local backend when the web app is running on localhost even if app config points to duerk.org', () => {
    expect(
      resolveBackendUrl({
        appConfigured: 'https://duerk.org',
        platformOs: 'web',
        browserLocation: {
          hostname: 'localhost',
          protocol: 'http:',
          port: '19006',
          origin: 'http://localhost:19006',
        },
      })
    ).toBe('http://localhost:4000');
  });

  it('remaps loopback config to the active localhost host in web development', () => {
    expect(
      resolveBackendUrl({
        appConfigured: 'http://127.0.0.1:4000',
        platformOs: 'web',
        browserLocation: {
          hostname: 'localhost',
          protocol: 'http:',
          port: '8081',
          origin: 'http://localhost:8081',
        },
      })
    ).toBe('http://localhost:4000');
  });

  it('uses the current deployed origin when the browser is on a real host and config points to localhost', () => {
    expect(
      resolveBackendUrl({
        appConfigured: 'http://localhost:4000',
        platformOs: 'web',
        browserLocation: {
          hostname: 'duerk.org',
          protocol: 'https:',
          port: '',
          origin: 'https://duerk.org',
        },
      })
    ).toBe('https://duerk.org');
  });

  it('prefers an explicit env override over app config', () => {
    expect(
      resolveBackendUrl({
        appConfigured: 'https://duerk.org',
        envConfigured: 'http://localhost:4000',
        nodeEnv: 'development',
        platformOs: 'ios',
      })
    ).toBe('http://localhost:4000');
  });

  it('uses the configured production backend when the browser is on the deployed host', () => {
    expect(
      resolveBackendUrl({
        appConfigured: 'https://duerk.org',
        envConfigured: 'https://duerk.org',
        platformOs: 'web',
        browserLocation: {
          hostname: 'duerk.org',
          protocol: 'https:',
          port: '',
          origin: 'https://duerk.org',
        },
      })
    ).toBe('https://duerk.org');
  });

  it('uses the local backend when the web app is on 127.0.0.1 even with a production config', () => {
    expect(
      resolveBackendUrl({
        appConfigured: 'https://duerk.org',
        envConfigured: 'https://duerk.org',
        platformOs: 'web',
        browserLocation: {
          hostname: '127.0.0.1',
          protocol: 'http:',
          port: '8081',
          origin: 'http://127.0.0.1:8081',
        },
      })
    ).toBe('http://127.0.0.1:4000');
  });
});
