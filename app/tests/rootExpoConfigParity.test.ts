/**
 * @jest-environment node
 *
 * Root-level Expo/EAS files exist only so `eas build` also works from the
 * repository root. app/app.config.ts and app/eas.json remain the canonical
 * metadata for the app package.
 */
/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(appRoot, '..');

describe('root Expo/EAS config parity', () => {
  it('has no root app.json competing with the root app.config.js delegate', () => {
    expect(fs.existsSync(path.join(workspaceRoot, 'app.json'))).toBe(false);
  });

  it('keeps root eas.json identical to app/eas.json', () => {
    const rootEas = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'eas.json'), 'utf8'));
    const appEas = JSON.parse(fs.readFileSync(path.join(appRoot, 'eas.json'), 'utf8'));
    expect(rootEas).toEqual(appEas);
  });

  it('maps app asset paths for root Expo config resolution', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rootModule = require('../../app.config');
    const rootConfig = rootModule.default ?? rootModule;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const appConfig = require('../app.config').default;

    expect(rootConfig.name).toBe(appConfig.name);
    expect(rootConfig.slug).toBe(appConfig.slug);
    expect(rootConfig.owner).toBe(appConfig.owner);
    expect(rootConfig.extra?.eas?.projectId).toBe(appConfig.extra?.eas?.projectId);
    expect(rootConfig.ios?.bundleIdentifier).toBe(appConfig.ios?.bundleIdentifier);
    expect(rootConfig.android?.package).toBe(appConfig.android?.package);
    expect(rootConfig.icon).toBe('./app/assets/wanderbunnies-app-icon.png');
    expect(rootConfig.splash?.image).toBe('./app/assets/wanderbunnies-splash-screen.png');
    expect(rootConfig.android?.adaptiveIcon?.foregroundImage).toBe('./app/assets/wanderbunnies-android-foreground.png');
    expect(rootConfig.android?.adaptiveIcon?.monochromeImage).toBe('./app/assets/wanderbunnies-android-monochrome.png');
  });

  it('resolves the root Sentry Expo plugin through the app workspace', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rootModule = require('../../app.config');
    const rootConfig = rootModule.default ?? rootModule;
    const sentryPlugin = (rootConfig.plugins ?? []).find((entry: unknown) =>
      Array.isArray(entry) && String(entry[0]).includes('@sentry'),
    ) as [string, unknown] | undefined;

    expect(sentryPlugin).toBeDefined();
    expect(fs.existsSync(sentryPlugin![0])).toBe(true);
    expect(path.resolve(sentryPlugin![0]).startsWith(path.join(appRoot, 'node_modules'))).toBe(true);
  });
});
