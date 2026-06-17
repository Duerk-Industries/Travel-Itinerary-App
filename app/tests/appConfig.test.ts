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

  it('does not opt out of React Native New Architecture', () => {
    const config = loadConfig();
    expect(config.newArchEnabled).not.toBe(false);
  });

  it('declares automatic userInterfaceStyle so iOS/Android honor dark mode', () => {
    const config = loadConfig();
    expect(config.userInterfaceStyle).toBe('automatic');
  });

  it('opts in to Android edge-to-edge so SDK 54 / Android 15 system bars do not overlap content', () => {
    const config = loadConfig();
    expect((config.android as any)?.edgeToEdgeEnabled).toBe(true);
  });

  it('keeps the Android soft keyboard in pan mode so inputs scroll above the keyboard', () => {
    const config = loadConfig();
    expect((config.android as any)?.softwareKeyboardLayoutMode).toBe('pan');
  });

  describe('iOS ATS', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEasBuild = process.env.EAS_BUILD;
    const originalEasProfile = process.env.EAS_BUILD_PROFILE;
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    afterEach(() => {
      restore('NODE_ENV', originalNodeEnv);
      restore('EAS_BUILD', originalEasBuild);
      restore('EAS_BUILD_PROFILE', originalEasProfile);
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

    it('does NOT leak arbitrary loads into an EAS production build when NODE_ENV is unset', () => {
      // Reproduces the real eas build environment: NODE_ENV is undefined during
      // config resolution, but EAS_BUILD / EAS_BUILD_PROFILE are set.
      restore('NODE_ENV', undefined);
      process.env.EAS_BUILD = 'true';
      process.env.EAS_BUILD_PROFILE = 'production';
      jest.resetModules();
      const config = loadConfig();
      const ats = (config.ios?.infoPlist as any)?.NSAppTransportSecurity;
      expect(ats.NSAllowsArbitraryLoads).toBeUndefined();
      expect(ats.NSExceptionDomains?.localhost?.NSExceptionAllowsInsecureHTTPLoads).toBe(true);
    });

    it('does NOT leak arbitrary loads into an EAS preview build', () => {
      restore('NODE_ENV', undefined);
      process.env.EAS_BUILD = 'true';
      process.env.EAS_BUILD_PROFILE = 'preview';
      jest.resetModules();
      const config = loadConfig();
      const ats = (config.ios?.infoPlist as any)?.NSAppTransportSecurity;
      expect(ats.NSAllowsArbitraryLoads).toBeUndefined();
    });

    it('still allows arbitrary loads for the EAS development dev-client profile (LAN host)', () => {
      restore('NODE_ENV', undefined);
      process.env.EAS_BUILD = 'true';
      process.env.EAS_BUILD_PROFILE = 'development';
      jest.resetModules();
      const config = loadConfig();
      const ats = (config.ios?.infoPlist as any)?.NSAppTransportSecurity;
      expect(ats.NSAllowsArbitraryLoads).toBe(true);
    });
  });
});
