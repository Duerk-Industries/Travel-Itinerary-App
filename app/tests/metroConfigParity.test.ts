/**
 * @jest-environment node
 *
 * The workspace-root Metro config (used for EAS builds) and the app-local
 * Metro config (used for `expo start`) must agree on resolver behavior.
 * They previously drifted, and that drift is what shipped the
 * "Unimplemented component: <RNCSafeAreaProvider>" bug to production.
 *
 * This test loads both configs, then asserts the parts of the resolver
 * that matter for bundling correctness are equivalent.
 */
/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(workspaceRoot, 'app');

const loadConfig = (rel: string) => {
  // Clear Metro/Expo module caches so each load is fresh — both configs
  // call `getDefaultConfig` which mutates internal state.
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(workspaceRoot, rel));
};

describe('Metro config parity (root EAS config vs. app local config)', () => {
  const rootConfig: any = loadConfig('metro.config.cjs');
  const appConfig: any = loadConfig('app/metro.config.js');

  it('keeps image-size-safe as a workspace instead of a broken file override', () => {
    const rootPackage = JSON.parse(
      fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8'),
    );
    const rootLock = JSON.parse(
      fs.readFileSync(path.join(workspaceRoot, 'package-lock.json'), 'utf8'),
    );

    expect(rootPackage.workspaces).toContain('packages/image-size-safe');
    expect(rootPackage.overrides?.['image-size']).toBeUndefined();
    expect(rootLock.packages?.['node_modules/image-size']?.resolved).toBe(
      'packages/image-size-safe',
    );
    // npm may dedupe Metro's compatible `^1.0.2` request to the workspace
    // safety package. It should never materialize a separate vulnerable copy.
    const nestedMetroImageSize = rootLock.packages?.['node_modules/metro/node_modules/image-size'];
    expect(nestedMetroImageSize == null ? '2.0.3' : nestedMetroImageSize.version).toBe('2.0.3');
  });

  it('both configs leave resolverMainFields to Expo defaults (platform-aware)', () => {
    // Expo's default is an array. We just want to confirm neither config
    // replaced it with the flat ['react-native', 'browser', ...] override
    // that broke web — i.e. the first entry on Expo's web platform is not
    // hard-pinned to 'react-native'.
    expect(Array.isArray(rootConfig.resolver.resolverMainFields)).toBe(true);
    expect(rootConfig.resolver.resolverMainFields).toEqual(
      appConfig.resolver.resolverMainFields,
    );
  });

  it('both configs add svg to sourceExts the same way (or both leave it alone)', () => {
    expect(rootConfig.resolver.sourceExts.includes('svg')).toBe(
      appConfig.resolver.sourceExts.includes('svg'),
    );
  });

  it('both configs treat svg as an asset the same way', () => {
    expect(rootConfig.resolver.assetExts.includes('svg')).toBe(
      appConfig.resolver.assetExts.includes('svg'),
    );
  });

  it('both configs install a resolveRequest hook', () => {
    expect(typeof rootConfig.resolver.resolveRequest).toBe('function');
    expect(typeof appConfig.resolver.resolveRequest).toBe('function');
  });

  it('both configs alias engine.io-client node transports for non-web platforms', () => {
    // Smoke-test the resolveRequest by passing a known engine.io stub.
    const fakeContext: any = {
      originModulePath: '/fake/node_modules/engine.io-client/build/cjs/socket.js',
      resolveRequest: jest.fn(() => ({ type: 'sourceFile', filePath: '/resolved' })),
    };
    rootConfig.resolver.resolveRequest(
      fakeContext,
      './transports/polling-xhr.node.js',
      'ios',
    );
    expect(fakeContext.resolveRequest).toHaveBeenCalledWith(
      fakeContext,
      './transports/polling-xhr.js',
      'ios',
    );

    const fakeContext2: any = {
      originModulePath: '/fake/node_modules/engine.io-client/build/cjs/socket.js',
      resolveRequest: jest.fn(() => ({ type: 'sourceFile', filePath: '/resolved' })),
    };
    appConfig.resolver.resolveRequest(
      fakeContext2,
      './transports/polling-xhr.node.js',
      'android',
    );
    expect(fakeContext2.resolveRequest).toHaveBeenCalledWith(
      fakeContext2,
      './transports/polling-xhr.js',
      'android',
    );
  });

  it('neither config special-cases pdfjs-dist (dead alias removed)', () => {
    // The only places that import pdfjs-dist do so via deep subpath
    // (`pdfjs-dist/legacy/build/pdf.mjs` from transferParsing.web.ts; or
    // node-only debug scripts that never go through Metro). A bare-specifier
    // alias for `pdfjs-dist` would never match either pattern, so an earlier
    // attempt to "guard pdfjs-dist to web-only" was dead code that also
    // caused Metro to fail at config-load if pdfjs-dist wasn't installed.
    // This test locks in that the alias stays out.
    const fakeContext: any = {
      originModulePath: '/fake/app/utils/transferParsing.web.ts',
      resolveRequest: jest.fn(() => ({ type: 'sourceFile', filePath: '/fallback' })),
    };
    rootConfig.resolver.resolveRequest(fakeContext, 'pdfjs-dist', 'web');
    // Falls through to the default resolver instead of short-circuiting.
    expect(fakeContext.resolveRequest).toHaveBeenCalledWith(fakeContext, 'pdfjs-dist', 'web');
    expect(rootConfig.resolver.extraNodeModules?.['pdfjs-dist']).toBeUndefined();
    expect(appConfig.resolver.extraNodeModules?.['pdfjs-dist']).toBeUndefined();
  });

  it('both configs share the same blockList shape (no metro-private API)', () => {
    // After dropping the `metro-config/private/...` exclusionList helper,
    // blockList should be either an array of RegExp or undefined.
    const check = (bl: unknown) => {
      if (bl === undefined) return true;
      if (Array.isArray(bl)) return bl.every((entry) => entry instanceof RegExp);
      return bl instanceof RegExp;
    };
    expect(check(rootConfig.resolver.blockList)).toBe(true);
    expect(check(appConfig.resolver.blockList)).toBe(true);
  });

  it('neither config configures react-native-svg-transformer (dead config removed)', () => {
    // The transformer was set up but no SVG files / react-native-svg package
    // exist; importing one would crash at runtime. Confirm both configs
    // leave babelTransformerPath to the Expo default.
    const isSvgTransformer = (p: string | undefined) => p?.includes('react-native-svg-transformer');
    expect(isSvgTransformer(rootConfig.transformer?.babelTransformerPath)).toBeFalsy();
    expect(isSvgTransformer(appConfig.transformer?.babelTransformerPath)).toBeFalsy();
  });

  it('root config URL rewriting preserves absolute URL protocol slashes', () => {
    expect(typeof rootConfig.server?.rewriteRequestUrl).toBe('function');
    expect(rootConfig.server.rewriteRequestUrl('http://127.0.0.1:8081//node_modules%5Cexpo//AppEntry.bundle')).toBe(
      'http://127.0.0.1:8081/node_modules/expo/AppEntry.bundle',
    );
    expect(rootConfig.server.rewriteRequestUrl('/assets//..//icons%5Cicon.png')).toBe('/assets/icons/icon.png');
  });

  it('app local config watches packages/ so workspace types stay hot-reloadable', () => {
    // app/ imports TS source directly from ../../packages/messaging and
    // ../../packages/domain. If watchFolders ever loses coverage of that
    // directory, edits to those packages will silently stop triggering HMR
    // in `expo start`. We assert at least one entry in the resolved
    // watchFolders ends with 'packages' (Windows + POSIX safe).
    const watchFolders: string[] = appConfig.watchFolders ?? [];
    const watchesPackages = watchFolders.some((p) => /[\\/]packages$/.test(p));
    expect(watchesPackages).toBe(true);
  });

  it('app local config does NOT watch the full workspaceRoot (HMR perf guard)', () => {
    // Watching the whole workspaceRoot causes Metro to crawl server/,
    // functions/, .firebase-data/ and root scripts/ on every file event,
    // even though blockList prevents them from resolving. Regression guard
    // for the narrowing we did in app/metro.config.js.
    const watchFolders: string[] = appConfig.watchFolders ?? [];
    const workspaceRoot = path.resolve(__dirname, '..', '..');
    const watchesWorkspaceRoot = watchFolders.some(
      (p) => path.resolve(p) === workspaceRoot,
    );
    expect(watchesWorkspaceRoot).toBe(false);
  });

  it('roots local web serving at the workspace so Expo entry and lazy-module URLs resolve', () => {
    const previous = process.env.WANDERBUNNIES_WEB_DEV;
    try {
      process.env.WANDERBUNNIES_WEB_DEV = '1';
      const webConfig: any = loadConfig('app/metro.config.js');
      expect(path.resolve(webConfig.server.unstable_serverRoot)).toBe(workspaceRoot);
    } finally {
      if (previous == null) {
        delete process.env.WANDERBUNNIES_WEB_DEV;
      } else {
        process.env.WANDERBUNNIES_WEB_DEV = previous;
      }
    }
  });

  it('enables workspace-root serving from both web launchers', () => {
    for (const scriptName of ['start-web.js', 'export-web.js']) {
      const launcher = fs.readFileSync(path.join(appRoot, 'scripts', scriptName), 'utf8');
      expect(launcher).toContain("WANDERBUNNIES_WEB_DEV: '1'");
    }
  });

  it('runtime app sources do not import Node core modules or shims directly', () => {
    const runtimeEntries = [
      'App.tsx',
      'AppEntry.js',
      'AppRoot.js',
      'components',
      'contexts',
      'hooks',
      'tabs',
      'theme',
      'utils',
    ];
    const nodeCoreModules = [
      'assert',
      'buffer',
      'child_process',
      'crypto',
      'fs',
      'http',
      'https',
      'net',
      'os',
      'path',
      'process',
      'stream',
      'tls',
      'url',
      'zlib',
    ];
    const importPattern = new RegExp(
      String.raw`(?:from\s+['"]|require\(\s*['"])(${nodeCoreModules.join('|')})(?:['"])`,
    );
    const offenders: string[] = [];

    const visit = (target: string) => {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        for (const child of fs.readdirSync(target)) {
          visit(path.join(target, child));
        }
        return;
      }
      if (!/\.(tsx?|jsx?)$/.test(target) || /\.test\./.test(target)) return;
      const source = fs.readFileSync(target, 'utf8');
      if (importPattern.test(source)) {
        offenders.push(path.relative(workspaceRoot, target).replace(/\\/g, '/'));
      }
    };

    for (const entry of runtimeEntries) {
      visit(path.join(appRoot, entry));
    }
    expect(offenders).toEqual([]);
  });

  it('runtime app sources do not import server-only Stripe modules', () => {
    const runtimeEntries = [
      'App.tsx',
      'AppEntry.js',
      'AppRoot.js',
      'components',
      'contexts',
      'hooks',
      'tabs',
      'theme',
      'utils',
    ];
    const forbiddenImportPattern = /(?:from\s+['"]|require\(\s*['"])(?:stripe|@stripe\/[^'"]+|(?:\.\.\/)+server\/|.*server\/src\/billing\/|.*server\/src\/routes\/billingRoutes)(?:['"])/;
    const offenders: string[] = [];

    const visit = (target: string) => {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        for (const child of fs.readdirSync(target)) {
          visit(path.join(target, child));
        }
        return;
      }
      if (!/\.(tsx?|jsx?)$/.test(target) || /\.test\./.test(target)) return;
      const source = fs.readFileSync(target, 'utf8');
      if (forbiddenImportPattern.test(source)) {
        offenders.push(path.relative(workspaceRoot, target).replace(/\\/g, '/'));
      }
    };

    for (const entry of runtimeEntries) {
      visit(path.join(appRoot, entry));
    }
    expect(offenders).toEqual([]);
  });
});
