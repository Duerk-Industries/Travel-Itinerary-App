/**
 * @jest-environment node
 *
 * Locks in that the Sentry Expo config plugin is registered in the dynamic
 * app/app.config.ts (the single source of truth for the Expo config). The
 * plugin is what triggers source-map upload during EAS native builds and
 * `expo export`, so dropping it silently would mean production crashes lose
 * symbolication on the very next deploy.
 */
/// <reference types="jest" />
/// <reference types="node" />
const SENTRY_PLUGIN = '@sentry/react-native/expo';

describe('Sentry Expo config plugin', () => {
  it('is registered in the dynamic app.config.ts plugins array', () => {
    jest.isolateModules(() => {});
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../app.config');
    const config = mod.default ?? mod;
    const plugins = (config.plugins ?? []) as Array<string | [string, unknown]>;
    const present = plugins.some((entry) =>
      Array.isArray(entry) ? entry[0] === SENTRY_PLUGIN : entry === SENTRY_PLUGIN,
    );
    expect(present).toBe(true);
  });

  it('wires SENTRY_ORG/SENTRY_PROJECT/SENTRY_URL through to the plugin options', () => {
    // expo.config.shared.cjs's loadEnv() re-reads server/.env, server/.local_env,
    // and app/.env with dotenv `override: true` on every call, so any local env
    // file always wins over a value preset here. Assert the plugin options
    // mirror whatever the resolved process.env ends up holding after that load,
    // rather than asserting a hardcoded value that a local checkout may not have.
    const originalEnv = { ...process.env };
    try {
      let config: any;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('../app.config');
        config = mod.default ?? mod;
      });
      const plugins = (config.plugins ?? []) as Array<string | [string, Record<string, unknown>]>;
      const entry = plugins.find((item) => Array.isArray(item) && item[0] === SENTRY_PLUGIN) as
        | [string, Record<string, unknown>]
        | undefined;
      expect(entry).toBeDefined();
      expect(entry?.[1]).toMatchObject({
        organization: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        url: process.env.SENTRY_URL ?? 'https://sentry.io/',
      });
    } finally {
      process.env = originalEnv;
    }
  });

  it('defaults the Sentry URL to sentry.io when SENTRY_URL is unset', () => {
    const originalEnv = { ...process.env };
    delete process.env.SENTRY_URL;
    try {
      let config: any;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('../app.config');
        config = mod.default ?? mod;
      });
      const plugins = (config.plugins ?? []) as Array<string | [string, Record<string, unknown>]>;
      const entry = plugins.find((item) => Array.isArray(item) && item[0] === SENTRY_PLUGIN) as
        | [string, Record<string, unknown>]
        | undefined;
      expect(entry?.[1]?.url).toBe('https://sentry.io/');
    } finally {
      process.env = originalEnv;
    }
  });
});
