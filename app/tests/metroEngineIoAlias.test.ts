/// <reference types="jest" />
/// <reference types="node" />
/**
 * Verifies the Metro resolver alias map declared in metro.shared.cjs (used
 * by both metro.config.cjs and app/metro.config.js). The alias replaces
 * engine.io-client's `*.node.js` transport files with their browser-safe
 * equivalents so that Hermes (iOS/Android) does not try to evaluate
 * Node-only modules like `xmlhttprequest-ssl` or `ws/index.js` at App.tsx
 * import time.
 *
 * We can't drive Metro from a unit test, but we can lock in the alias map
 * itself and the contract: every entry must point to a file that actually
 * exists in the installed engine.io-client package.
 */
import fs from 'node:fs';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ENGINE_IO_NODE_STUBS } = require(path.resolve(__dirname, '..', '..', 'metro.shared.cjs')) as {
  ENGINE_IO_NODE_STUBS: Record<string, string>;
};
const engineIoNodeStubs = ENGINE_IO_NODE_STUBS;

const findEngineIoClientRoot = (): string | null => {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'node_modules', 'engine.io-client'),
    path.resolve(__dirname, '..', 'node_modules', 'engine.io-client'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
};

describe('Metro engine.io-client alias map', () => {
  const engineRoot = findEngineIoClientRoot();
  const workspaceRoot = path.resolve(__dirname, '..', '..');
  // The alias map now lives in metro.shared.cjs (consumed by both the
  // root EAS config and the app-local dev config). Locking the literals
  // in source here means a stray refactor that drops an alias entry will
  // fail this test before it can reach a deploy.
  const metroConfigSources = [path.join(workspaceRoot, 'metro.shared.cjs')];

  it('locates engine.io-client in node_modules', () => {
    expect(engineRoot).not.toBeNull();
  });

  if (!engineRoot) return;

  it.each(Object.entries(engineIoNodeStubs))(
    'each browser-variant target exists on disk: %s -> %s',
    (_nodeForm, browserForm) => {
      // The alias resolves relative to engine.io-client's build output.
      // Both `build/esm/` and `build/cjs/` ship the same file tree, so we
      // assert existence under at least one of those directories.
      const relativeFromBuild = browserForm.replace(/^\.\//, '');
      const esmPath = path.join(engineRoot, 'build', 'esm', relativeFromBuild);
      const cjsPath = path.join(engineRoot, 'build', 'cjs', relativeFromBuild);
      expect(fs.existsSync(esmPath) || fs.existsSync(cjsPath)).toBe(true);
    },
  );

  it('mirrors the keys declared in engine.io-client package.json `browser` field', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(engineRoot, 'package.json'), 'utf8'),
    );
    const browserMap = pkg.browser as Record<string, string | false>;
    // Every alias key we declare should also be substituted by the upstream
    // package's own browser map (under build/esm/ or build/cjs/).
    for (const key of Object.keys(engineIoNodeStubs)) {
      const relative = key.replace(/^\.\//, '');
      const esmKey = `./build/esm/${relative}`;
      const cjsKey = `./build/cjs/${relative}`;
      const hasMatch = Object.prototype.hasOwnProperty.call(browserMap, esmKey)
        || Object.prototype.hasOwnProperty.call(browserMap, cjsKey);
      expect(hasMatch).toBe(true);
    }
  });

  it.each(metroConfigSources)('declares every alias in %s', (configPath) => {
    const source = fs.readFileSync(configPath, 'utf8');
    for (const [nodeForm, browserForm] of Object.entries(engineIoNodeStubs)) {
      expect(source).toContain(nodeForm);
      expect(source).toContain(browserForm);
    }
  });
});
