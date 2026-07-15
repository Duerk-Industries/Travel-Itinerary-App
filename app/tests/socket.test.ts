/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { Platform } from 'react-native';
import { resolveSocketServerUrl, resolveSocketTransports } from '../utils/socket';

describe('socket URL resolution', () => {
  const originalOS = Platform.OS;
  const originalEnv = { ...process.env };

  afterEach(() => {
    Platform.OS = originalOS;
    process.env = { ...originalEnv };
  });

  it('uses the configured API backend for native sockets', () => {
    Platform.OS = 'ios';
    delete process.env.EXPO_PUBLIC_BACKEND_URL;
    delete process.env.BACKEND_URL;
    delete process.env.WEB_URL;
    delete process.env.API_BASE_URL;
    delete process.env.REACT_APP_BACKEND_URL;
    delete process.env.REACT_NATIVE_APP_BACKEND_URL;
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

  it('connects via polling first on web, upgrading to websocket opportunistically', () => {
    // socket.io does not reliably fall back to polling when a websocket-first
    // connection fails outright (a documented upstream limitation), so polling
    // must be the first-listed transport for the connection to be reliable
    // wherever the initial websocket handshake gets rejected upstream.
    Platform.OS = 'web';
    expect(resolveSocketTransports()).toEqual(['polling', 'websocket']);
  });

  it('also connects via polling first on native, for the same reason', () => {
    Platform.OS = 'ios';
    expect(resolveSocketTransports()).toEqual(['polling', 'websocket']);
  });

  it('remaps a loopback socket URL to 10.0.2.2 on the Android emulator', () => {
    Platform.OS = 'android';
    delete process.env.BACKEND_URL;
    delete process.env.WEB_URL;
    delete process.env.API_BASE_URL;
    delete process.env.API_BASE;
    delete process.env.REACT_APP_BACKEND_URL;
    delete process.env.REACT_NATIVE_APP_BACKEND_URL;
    process.env.EXPO_PUBLIC_BACKEND_URL = 'http://localhost:4000';

    expect(resolveSocketServerUrl()).toBe('http://10.0.2.2:4000');
  });

  it('keeps a loopback socket URL on the iOS simulator (host network is shared)', () => {
    Platform.OS = 'ios';
    delete process.env.BACKEND_URL;
    delete process.env.WEB_URL;
    delete process.env.API_BASE_URL;
    delete process.env.API_BASE;
    delete process.env.REACT_APP_BACKEND_URL;
    delete process.env.REACT_NATIVE_APP_BACKEND_URL;
    process.env.EXPO_PUBLIC_BACKEND_URL = 'http://localhost:4000';

    expect(resolveSocketServerUrl()).toBe('http://localhost:4000');
  });
});
