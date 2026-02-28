import { getEnvValue } from '../src/env';

describe('getEnvValue', () => {
  const key = 'TEST_ENV_TRIM';

  afterEach(() => {
    delete process.env[key];
  });

  test('strips trailing CRLF from direct env values', () => {
    process.env[key] = 'abc123\r\n';
    expect(getEnvValue(key)).toBe('abc123');
  });

  test('keeps internal and leading spaces while removing trailing line breaks', () => {
    process.env[key] = '  value with spaces  \n';
    expect(getEnvValue(key)).toBe('  value with spaces  ');
  });
});
