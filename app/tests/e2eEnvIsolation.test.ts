/** @jest-environment node */
import path from 'path';
import dotenv from 'dotenv';

it('keeps the E2E API URL authoritative when Expo resolves its shared config', () => {
  const previous = { ...process.env };
  const load = jest.spyOn(dotenv, 'config').mockImplementation(() => {
    process.env.EXPO_PUBLIC_BACKEND_URL = 'https://local-config.example';
    return { parsed: {} };
  });
  try {
    process.env.E2E_MODE = '1';
    process.env.EXPO_PUBLIC_BACKEND_URL = 'http://127.0.0.1:4011';
    delete process.env.RELEASE_WEB_BUILD;
    const { createExpoConfig } = require('../../expo.config.shared.cjs');
    const config = createExpoConfig({ appDir: path.resolve(__dirname, '..'), assetPrefix: './' });
    expect(load).not.toHaveBeenCalled();
    expect(config.extra.backendUrl).toBe('http://127.0.0.1:4011');
  } finally {
    process.env = previous;
    load.mockRestore();
  }
});
