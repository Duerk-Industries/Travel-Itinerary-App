/// <reference types="jest" />
/// <reference types="node" />
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

  describe('backend URL default (extra.backendUrl)', () => {
    const BACKEND_KEYS = [
      'EXPO_PUBLIC_BACKEND_URL',
      'BACKEND_URL',
      'WEB_URL',
      'API_BASE_URL',
      'REACT_APP_BACKEND_URL',
      'REACT_NATIVE_APP_BACKEND_URL',
      'NODE_ENV',
      'EAS_BUILD',
    ];
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
      BACKEND_KEYS.forEach((k) => {
        saved[k] = process.env[k];
        delete process.env[k];
      });
      jest.resetModules();
      // Neutralize the .env files app.config.ts loads (app/.env supplies a
      // real EXPO_PUBLIC_BACKEND_URL) so the fallback branch is exercised.
      jest.doMock('dotenv', () => ({
        __esModule: true,
        default: { config: () => ({ parsed: {} }) },
        config: () => ({ parsed: {} }),
      }));
    });

    afterEach(() => {
      jest.dontMock('dotenv');
      BACKEND_KEYS.forEach((k) => {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      });
      jest.resetModules();
    });

    const loadBackendUrl = (): string => {
      let value = '';
      jest.isolateModules(() => {
        const mod = require('../app.config');
        value = (mod.default ?? mod).extra.backendUrl;
      });
      return value;
    };

    it('never defaults to localhost inside an EAS build, even when NODE_ENV=development', () => {
      process.env.NODE_ENV = 'development';
      process.env.EAS_BUILD = 'true';
      expect(loadBackendUrl()).toBe('https://wander-bunnies.com');
    });

    it('uses localhost only for local expo start dev (NODE_ENV=development, no EAS_BUILD)', () => {
      process.env.NODE_ENV = 'development';
      expect(loadBackendUrl()).toBe('http://localhost:4000');
    });

    it('defaults to the hosted backend for a local production export', () => {
      process.env.NODE_ENV = 'production';
      expect(loadBackendUrl()).toBe('https://wander-bunnies.com');
    });

    it('honors an explicit EXPO_PUBLIC_BACKEND_URL over the default', () => {
      process.env.NODE_ENV = 'development';
      process.env.EAS_BUILD = 'true';
      process.env.EXPO_PUBLIC_BACKEND_URL = 'https://staging.example.com';
      expect(loadBackendUrl()).toBe('https://staging.example.com');
    });
  });
});
