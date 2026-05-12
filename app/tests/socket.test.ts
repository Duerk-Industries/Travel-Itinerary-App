/**
 * @jest-environment jsdom
 */

import { Platform } from 'react-native';
import { resolveSocketServerUrl } from '../utils/socket';

describe('socket URL resolution', () => {
  const originalOS = Platform.OS;
  const originalEnv = { ...process.env };

  afterEach(() => {
    Platform.OS = originalOS;
    process.env = { ...originalEnv };
  });

  it('uses the configured API backend for native sockets', () => {
    Platform.OS = 'ios';
    process.env.API_BASE = 'http://api.example.test:4000';

    expect(resolveSocketServerUrl()).toBe('http://api.example.test:4000');
  });

  it('uses the local API backend for web dev instead of the web dev-server origin', () => {
    Platform.OS = 'web';
    delete process.env.EXPO_PUBLIC_BACKEND_URL;
    delete process.env.BACKEND_URL;
    delete process.env.WEB_URL;
    delete process.env.API_BASE_URL;
    delete process.env.API_BASE;

    expect(resolveSocketServerUrl()).toBe('http://localhost:4000');
  });
});
