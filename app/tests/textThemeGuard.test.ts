/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

// Plain react-native Text defaults to black. On a dark surface that is invisible, which is how unthemed text slipped
// into several panels. A <Text> with no `style` at all is the clearest sign of it, so this fails when one appears in a
// file that does not use ThemedText (or a style that carries a color). Fix a failure by importing
// `{ ThemedText as Text }` from components/ThemedText, or by giving the text a color.
const ALLOWED: Record<string, string> = {
  'components/NotificationInbox.tsx': 'a modal with its own fixed white background; its text is meant to be dark',
  'components/PendingExpenseLogoutDialog.tsx': 'a modal with its own fixed white background; its text is meant to be dark',
  'components/KeepsakeMapCaptureHost.tsx': 'rendered off screen to capture a print image; never shown in the app theme',
  'components/BlogRichTextView.tsx': 'bare Text here is nested inside Text that already carries the caller-supplied color',
};

const bareTexts = (source: string): number =>
  [...source.matchAll(/<Text(\s[^>]*?)?>/g)].filter((match) => !/style=/.test(match[0])).length;

describe('text follows the theme', () => {
  const appRoot = path.join(__dirname, '..');
  const files = ['components', 'tabs'].flatMap((dir) =>
    fs.readdirSync(path.join(appRoot, dir)).filter((name) => name.endsWith('.tsx')).map((name) => `${dir}/${name}`));

  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no unstyled <Text> outside ThemedText and the reviewed exceptions', () => {
    const offenders = files
      .filter((file) => !(file in ALLOWED))
      .map((file) => ({ file, source: fs.readFileSync(path.join(appRoot, file), 'utf8') }))
      .filter(({ source }) => !source.includes('ThemedText') && bareTexts(source) > 0)
      .map(({ file, source }) => `${file} (${bareTexts(source)})`);
    expect(offenders).toEqual([]);
  });

  it('keeps every exception real, so the list cannot go stale', () => {
    for (const file of Object.keys(ALLOWED)) {
      const source = fs.readFileSync(path.join(appRoot, file), 'utf8');
      expect(bareTexts(source)).toBeGreaterThan(0);
      expect(source.includes('ThemedText')).toBe(false);
    }
  });

  it('uses ThemedText in the panels that were unreadable in dark mode', () => {
    for (const file of ['NearbyPlacesPanel', 'TripsLikeThis', 'TripMap', 'TripMap.web', 'ActivitySharingControls', 'AutomaticImportSettings', 'GmailForwardingConfirmation', 'PendingExpenseRecovery']) {
      expect(fs.readFileSync(path.join(appRoot, 'components', `${file}.tsx`), 'utf8')).toContain("ThemedText as Text");
    }
  });
});
