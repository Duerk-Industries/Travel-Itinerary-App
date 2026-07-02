/// <reference types="jest" />
/// <reference types="node" />
/**
 * @expo/metro-runtime is a declared dependency that must actually be imported
 * by the entry chain so SDK 50+ web bundling enables HMR / async route support.
 * The dependency declaration alone doesn't activate it — Expo's web bundler
 * only wires in the runtime if some module side-effect-imports the package.
 *
 * Asserts the import is present in app/AppEntry.js so we don't silently drop
 * it again in a future refactor.
 */
import fs from 'node:fs';
import path from 'node:path';

const appEntryPath = path.resolve(__dirname, '..', 'AppEntry.js');

describe('@expo/metro-runtime entry import', () => {
  const source = fs.readFileSync(appEntryPath, 'utf8');

  it('AppEntry side-effect imports @expo/metro-runtime', () => {
    // Accept both the bare side-effect form and the (rare) `* as foo` form.
    const sideEffect = /import\s+['"]@expo\/metro-runtime['"]\s*;?/;
    const starForm = /import\s+\*\s+as\s+\w+\s+from\s+['"]@expo\/metro-runtime['"]/;
    expect(sideEffect.test(source) || starForm.test(source)).toBe(true);
  });

  it('the import is positioned at the top of the file so it runs before other modules evaluate', () => {
    const lines = source.split(/\r?\n/);
    // Find first non-empty, non-comment line.
    const firstCodeLineIdx = lines.findIndex((line) => {
      const trimmed = line.trim();
      return trimmed !== '' && !trimmed.startsWith('//');
    });
    expect(firstCodeLineIdx).toBeGreaterThanOrEqual(0);

    // Find the metro-runtime import line.
    const runtimeImportIdx = lines.findIndex((line) =>
      /@expo\/metro-runtime/.test(line),
    );
    expect(runtimeImportIdx).toBeGreaterThanOrEqual(0);
    // It should be the FIRST import (allowing comment lines above it).
    expect(runtimeImportIdx).toBe(firstCodeLineIdx);
  });
});
