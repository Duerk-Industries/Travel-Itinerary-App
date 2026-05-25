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

  describe('iOS ATS', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      jest.resetModules();
    });

    it('keeps a narrow localhost exception in production (no blanket NSAllowsArbitraryLoads)', () => {
      process.env.NODE_ENV = 'production';
      jest.resetModules();
      const config = loadConfig();
      const ats = (config.ios?.infoPlist as any)?.NSAppTransportSecurity;
      expect(ats).toBeDefined();
      expect(ats.NSAllowsArbitraryLoads).toBeUndefined();
      expect(ats.NSExceptionDomains?.localhost?.NSExceptionAllowsInsecureHTTPLoads).toBe(true);
    });

    it('allows arbitrary loads in development for LAN dev hosts', () => {
      process.env.NODE_ENV = 'development';
      jest.resetModules();
      const config = loadConfig();
      const ats = (config.ios?.infoPlist as any)?.NSAppTransportSecurity;
      expect(ats.NSAllowsArbitraryLoads).toBe(true);
    });
  });
});
