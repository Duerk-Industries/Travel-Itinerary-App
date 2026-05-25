import path from 'path';

describe('app.config.ts', () => {
  const loadConfig = () => {
    jest.isolateModules(() => {});
    const mod = require('../app.config');
    return mod.default ?? mod;
  };

  it('declares a top-level semver version (required by App Store / Play Store)', () => {
    const config = loadConfig();
    expect(typeof config.version).toBe('string');
    expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('keeps the top-level version in sync with package.json', () => {
    const config = loadConfig();
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    expect(config.version).toBe(pkg.version);
  });

  it('still exposes per-platform build identifiers', () => {
    const config = loadConfig();
    expect(config.ios?.buildNumber).toBeDefined();
    expect(config.android?.versionCode).toBeDefined();
  });
});
