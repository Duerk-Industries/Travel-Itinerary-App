/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getAuthFlag, getReservedUsernames } from '../src/config/authFlags';

describe('auth-flags yaml config', () => {
  const originalConfigPath = process.env.AUTH_FLAGS_CONFIG_PATH;
  let tempDir = '';
  let configPath = '';

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-flags-test-'));
    configPath = path.join(tempDir, 'auth-flags.yaml');
    fs.writeFileSync(
      configPath,
      [
        'flags:',
        '  usernameLoginEnabled: true',
        '  multiEmailEnabled: yes',
        '  appleOAuthEnabled: false',
        'reservedUsernames:',
        '  - admin',
        '  - Support',
      ].join('\n'),
      'utf8'
    );
    process.env.AUTH_FLAGS_CONFIG_PATH = configPath;
  });

  afterAll(() => {
    if (originalConfigPath === undefined) {
      delete process.env.AUTH_FLAGS_CONFIG_PATH;
    } else {
      process.env.AUTH_FLAGS_CONFIG_PATH = originalConfigPath;
    }
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads flags and reserved usernames', () => {
    expect(getAuthFlag('usernameLoginEnabled')).toBe(true);
    expect(getAuthFlag('multiEmailEnabled')).toBe(true);
    expect(getAuthFlag('appleOAuthEnabled')).toBe(false);
    expect(getReservedUsernames()).toEqual(['admin', 'support']);
  });
});
