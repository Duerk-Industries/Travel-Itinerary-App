/**
 * @jest-environment node
 *
 * Regression guard: every `<Modal ...>` from react-native must declare
 * `onRequestClose`. Without it, Android's hardware back button bypasses
 * the modal and exits the app (or pops the navigation stack), which is
 * almost never what we want. Catching this at the source-text level is
 * cheap and avoids having to mount every screen.
 */
/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '..');
const scanDirs = ['components', 'tabs', 'App.tsx'];

const collectFiles = (target: string): string[] => {
  const full = path.join(appRoot, target);
  const stat = fs.statSync(full);
  if (stat.isFile()) return [full];
  const out: string[] = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...collectFiles(path.join(target, entry.name)));
      continue;
    }
    if (!/\.(tsx|jsx)$/.test(entry.name)) continue;
    out.push(path.join(full, entry.name));
  }
  return out;
};

const findModalOpens = (source: string): Array<{ tag: string; index: number }> => {
  // Match each `<Modal ...>` opening tag (including multi-line) but not closing
  // tags or other components like `<ShareTripModal`. Capture up to the first
  // matching `>` that isn't inside braces.
  const opens: Array<{ tag: string; index: number }> = [];
  const re = /<Modal(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 0;
    let end = -1;
    for (let i = m.index; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) continue;
    opens.push({ tag: source.slice(m.index, end + 1), index: m.index });
  }
  return opens;
};

describe('<Modal> Android hardware-back handling', () => {
  const files = scanDirs.flatMap(collectFiles);

  it('finds at least one Modal in the codebase (sanity check)', () => {
    const total = files.reduce(
      (acc, file) => acc + findModalOpens(fs.readFileSync(file, 'utf8')).length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it.each(files)('every <Modal> in %s declares onRequestClose', (file) => {
    const source = fs.readFileSync(file, 'utf8');
    const offenders = findModalOpens(source)
      .filter(({ tag }) => !/onRequestClose\s*=/.test(tag))
      .map(({ tag, index }) => {
        const line = source.slice(0, index).split('\n').length;
        const preview = tag.replace(/\s+/g, ' ').slice(0, 100);
        return `${path.relative(appRoot, file)}:${line} — ${preview}`;
      });
    expect(offenders).toEqual([]);
  });
});
