/**
 * @jest-environment node
 *
 * Regression guard for the "Unimplemented component: <RNCSafeAreaProvider>"
 * deploy failure.
 *
 * Both Metro configs (workspace-root for EAS, app/ for local dev) previously
 * forced `resolverMainFields: ['react-native', 'browser', 'module', 'main']`.
 * That static array overrode Expo's platform-aware defaults and caused the
 * web bundle to resolve `react-native-safe-area-context` to its native
 * `src/index.tsx` instead of the RN-Web-compatible `lib/module/index.js`,
 * which renders the unimplemented native component on web.
 *
 * If a future change reintroduces a flat resolverMainFields with
 * 'react-native' before 'browser', this test fails and points at the
 * file to fix.
 */
/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = path.resolve(__dirname, '..', '..');
const targets = [
  path.join(workspaceRoot, 'app', 'metro.config.js'),
  path.join(workspaceRoot, 'metro.config.cjs'),
];

describe('Metro resolverMainFields must remain platform-aware', () => {
  it.each(targets)('%s does not force a flat resolverMainFields override', (file) => {
    const source = fs.readFileSync(file, 'utf8');
    // Look for an explicit `resolverMainFields:` array assignment in the
    // config. Inline comments referencing the name are fine.
    const flatOverride = /resolverMainFields\s*:\s*\[/.test(source);
    if (!flatOverride) {
      expect(flatOverride).toBe(false);
      return;
    }
    // If a future override is intentionally added, it must NOT put
    // 'react-native' before 'browser' as a static list (that's the exact
    // shape that broke web). Allow the override only if it's clearly
    // platform-conditional (e.g. wrapped in a function or ternary on
    // `platform === 'web'`).
    const offendingShape = /resolverMainFields\s*:\s*\[\s*['"]react-native['"]\s*,\s*['"]browser['"]/.test(
      source,
    );
    expect(offendingShape).toBe(false);
  });
});
