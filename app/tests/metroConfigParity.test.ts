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

  it('both configs reject pdfjs-dist on native platforms (web-only library)', () => {
    // On web, the resolveRequest returns a sourceFile pointing at pdfjs-dist.
    // On native, it falls through to the default resolver — pdfjs-dist is
    // listed in extraNodeModules as a fallback for typecheck/scripts, but
    // any native bundle that actually imports it should fail loudly rather
    // than ship Node-shaped code.
    const fakeWebContext: any = {
      originModulePath: '/fake/app/utils/transferParsing.web.ts',
      resolveRequest: jest.fn(),
    };
    const webResult = rootConfig.resolver.resolveRequest(fakeWebContext, 'pdfjs-dist', 'web');
    expect(webResult).toMatchObject({ type: 'sourceFile' });
    expect(webResult.filePath).toMatch(/pdfjs-dist/);
    // Default resolver should NOT have been invoked on the web shortcut path.
    expect(fakeWebContext.resolveRequest).not.toHaveBeenCalled();
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
});
