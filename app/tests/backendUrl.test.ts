/// <reference types="jest" />
/// <reference types="node" />
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

  it('does not fall back to localhost for native preview builds without config', () => {
    expect(
      resolveBackendUrl({
        nodeEnv: 'development',
        platformOs: 'ios',
      })
    ).toBe('https://wander-bunnies.com');
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

  it('remaps a loopback backend to 10.0.2.2 on the Android emulator', () => {
    expect(
      resolveBackendUrl({
        appConfigured: 'http://localhost:4000',
        platformOs: 'android',
      })
    ).toBe('http://10.0.2.2:4000');
  });

  it('remaps a 127.0.0.1 backend to 10.0.2.2 on the Android emulator', () => {
    expect(
      resolveBackendUrl({
        appConfigured: 'http://127.0.0.1:4000',
        platformOs: 'android',
      })
    ).toBe('http://10.0.2.2:4000');
  });

  it('preserves an explicit env override over the Android emulator remap', () => {
    expect(
      resolveBackendUrl({
        appConfigured: 'http://localhost:4000',
        envConfigured: 'http://192.168.1.50:4000',
        platformOs: 'android',
      })
    ).toBe('http://192.168.1.50:4000');
  });

  it('leaves loopback as localhost on the iOS simulator (host network is shared)', () => {
    expect(
      resolveBackendUrl({
        appConfigured: 'http://localhost:4000',
        platformOs: 'ios',
      })
    ).toBe('http://localhost:4000');
  });

  it('does not remap non-loopback hosts on Android', () => {
    expect(
      resolveBackendUrl({
        appConfigured: 'https://duerk.org',
        platformOs: 'android',
      })
    ).toBe('https://duerk.org');
  });

  it('falls back to the browser origin when env values are the literal string "undefined"', () => {
    expect(
      resolveBackendUrl({
        appConfigured: 'undefined',
        envConfigured: 'undefined',
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
});
