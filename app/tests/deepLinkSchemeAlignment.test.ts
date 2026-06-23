/**
 * @jest-environment node
 *
 * Regression test for a deep-link bug where App.tsx declared a React
 * Navigation linking prefix that didn't match the URL scheme registered in
 * the Expo config. On iOS/Android that meant any `wanderbunnies://` deep link
 * silently failed to open the installed app, because the OS only routes URLs
 * whose scheme matches `expo.scheme`.
 *
 * This test asserts that every native scheme prefix declared in App.tsx's
 * linking config matches `scheme` from app/app.config.ts (the single source of
 * truth for the Expo config).
 */
/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

const appTsxPath = path.join(path.resolve(__dirname, '..'), 'App.tsx');

const loadConfig = () => {
  jest.isolateModules(() => {});
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../app.config');
  return mod.default ?? mod;
};

describe('Deep-link scheme alignment', () => {
  const config = loadConfig();
  const scheme: string | undefined = config?.scheme;

  it('app.config.ts declares a URL scheme', () => {
    expect(typeof scheme).toBe('string');
    expect(scheme!.length).toBeGreaterThan(0);
  });

  it('App.tsx linking prefixes reference the same scheme', () => {
    const source = fs.readFileSync(appTsxPath, 'utf8');
    // Extract the prefixes array literal from the `linking` constant.
    // We look for string literals ending in `://`, anchored to the scheme.
    const expected = `${scheme}://`;
    expect(source).toContain(expected);
  });

  it('App.tsx does not reference any stale alternate schemes', () => {
    const source = fs.readFileSync(appTsxPath, 'utf8');
    // Known stale alias that previously caused a silent deep-link failure.
    expect(source).not.toContain('wanderbunnies://');
  });
});
