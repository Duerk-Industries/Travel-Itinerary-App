/**
 * @jest-environment node
 *
 * Locks in that the Sentry Expo config plugin is registered in the dynamic
 * app/app.config.ts (the single source of truth for the Expo config). The
 * plugin is what triggers source-map upload during EAS native builds and
 * `expo export`, so dropping it silently would mean production crashes lose
 * symbolication on the very next deploy.
 */
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
});
