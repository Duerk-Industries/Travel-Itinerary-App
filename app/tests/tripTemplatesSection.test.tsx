/** @jest-environment jsdom */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { TripTemplatesSection } from '../components/admin/TripTemplatesSection';
import { ThemeProvider } from '../theme/ThemeContext';
import { getAppTheme, themeStyle } from '../theme/theme';
import { pickTextFile, shareTextFile } from '../utils/dataTransferPlatform';

jest.mock('../utils/dataTransferPlatform', () => ({
  pickCsvFile: jest.fn(),
  shareCsvFile: jest.fn(),
  pickTextFile: jest.fn(),
  shareTextFile: jest.fn().mockResolvedValue(undefined),
}));

const BUNDLE = JSON.stringify({ format: 'wanderbunnies.trip-templates', version: 1, templates: [{ id: 'portugal-lisbon-4d' }] });
const rows = [
  { id: 'japan-t01', title: 'Classic Tokyo & Kyoto', days: 7, route: 'Tokyo > Kyoto', countries: ['Japan'], source: 'bundled', enabled: true, activityCount: 20 },
  { id: 'portugal-lisbon-4d', title: 'Lisbon in 4 days', days: 4, route: 'Lisbon', countries: ['Portugal'], source: 'imported', enabled: true, activityCount: 9 },
  { id: 'japan-t02', title: 'Japan, revised', days: 10, route: 'Tokyo', countries: ['Japan'], source: 'imported-override', enabled: false, activityCount: 12 },
];
const media = (extra: Record<string, unknown> = {}) => ({ added: 0, updated: 0, unchanged: 0, rejected: [], ...extra });
const okReport = (applied = false) => ({
  ok: true, applied,
  templates: [
    { id: 'portugal-lisbon-4d', title: 'Lisbon in 4 days', status: 'new', errors: [], warnings: ['hero: empty, so the card falls back to an image search on imageQuery.'] },
    { id: 'japan-t01', title: 'Classic Tokyo & Kyoto', status: 'updated', source: 'bundled', errors: [], warnings: [] },
    { id: 'japan-t03', title: 'Same as before', status: 'unchanged', source: 'bundled', errors: [], warnings: [] },
  ],
  media: { places: media({ added: 9 }), destinations: media({ added: 2 }) },
});
const badReport = {
  ok: false, applied: false,
  templates: [{ id: 'portugal-lisbon-4d', title: 'Lisbon in 4 days', status: 'invalid', errors: ['activities.0.day: 40 is after the last day (3).'], warnings: [] }],
  media: { places: media({ rejected: [{ key: 'portugal/belem-tower', error: 'picture license "CC BY" is not public domain or CC0, the only licenses accepted.' }] }), destinations: media() },
};

type Call = { url: string; init?: RequestInit };
let calls: Call[];
let importReply: any;
const mockServer = () => {
  calls = [];
  (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => (typeof data === 'string' ? data : JSON.stringify(data)) });
    if (String(url).endsWith('/api/admin/trip-templates') && !init?.method) return body({ templates: rows });
    if (String(url).includes('/authoring/instructions')) return body('# Instructions text');
    if (String(url).includes('/authoring/')) return body('{"type":"object"}');
    if (String(url).includes('/export')) return body('{"format":"wanderbunnies.trip-templates"}');
    if (String(url).endsWith('/import')) {
      const sent = JSON.parse(String(init?.body));
      return body(typeof importReply === 'function' ? importReply(sent) : importReply);
    }
    if (init?.method === 'DELETE') return body({}, 204);
    return body({}, 404);
  });
};

const mount = () => render(<TripTemplatesSection backendUrl="http://api.test" headers={{ Authorization: 'Bearer admin' }} />);
const importCalls = () => calls.filter((call) => call.url.endsWith('/import')).map((call) => JSON.parse(String(call.init?.body)));

beforeEach(() => {
  jest.clearAllMocks();
  importReply = okReport();
  mockServer();
});

describe('TripTemplatesSection', () => {
  it('lists the templates with where each came from', async () => {
    const ui = mount();
    expect(await ui.findByText('Lisbon in 4 days')).toBeTruthy();
    expect(ui.getByText(/japan-t01 · 7 days · Japan · 20 activities · Built in/)).toBeTruthy();
    expect(ui.getByText(/portugal-lisbon-4d · 4 days · Portugal · 9 activities · Imported$/)).toBeTruthy();
    expect(ui.getByText(/Imported \(replaces built-in\) · switched off/)).toBeTruthy();
    expect(calls[0].init?.headers).toEqual({ Authorization: 'Bearer admin' });
  });

  it('downloads the instructions, an example, the schema and the live templates as files', async () => {
    const ui = mount();
    await ui.findByText('Lisbon in 4 days');
    fireEvent.press(ui.getByTestId('trip-templates-download-instructions'));
    await waitFor(() => expect(shareTextFile).toHaveBeenCalledWith('wanderbunnies-itinerary-instructions.md', '# Instructions text', { mimeType: 'text/markdown' }));
    fireEvent.press(ui.getByTestId('trip-templates-download-example'));
    fireEvent.press(ui.getByTestId('trip-templates-download-schema'));
    fireEvent.press(ui.getByTestId('trip-templates-download-all'));
    fireEvent.press(ui.getByTestId('trip-templates-download-japan-t01'));
    await waitFor(() => expect(shareTextFile).toHaveBeenCalledTimes(5));
    const urls = calls.map((call) => call.url);
    expect(urls).toEqual(expect.arrayContaining([
      'http://api.test/api/admin/trip-templates/authoring/example', 'http://api.test/api/admin/trip-templates/authoring/schema',
      'http://api.test/api/admin/trip-templates/export', 'http://api.test/api/admin/trip-templates/export?ids=japan-t01',
    ]));
    expect((shareTextFile as jest.Mock).mock.calls[4]).toEqual(['japan-t01.json', '{"format":"wanderbunnies.trip-templates"}', { mimeType: 'application/json' }]);
  });

  it('checks a chosen file first, shows what would change, and only then imports it', async () => {
    (pickTextFile as jest.Mock).mockResolvedValue({ name: 'portugal.json', size: BUNDLE.length, text: BUNDLE });
    const ui = mount();
    await ui.findByText('Lisbon in 4 days');
    expect(ui.getByTestId('trip-templates-import').props.accessibilityState.disabled).toBe(true);

    fireEvent.press(ui.getByTestId('trip-templates-pick-file'));
    expect(await ui.findByTestId('trip-templates-report')).toBeTruthy();
    expect(ui.getByText('portugal.json')).toBeTruthy();
    expect(importCalls()).toEqual([{ bundle: JSON.parse(BUNDLE), dryRun: true }]);
    expect(ui.getByTestId('trip-templates-summary').props.children.join('')).toContain('Ready to import: 1 new · 1 updated · 1 unchanged');
    expect(ui.getByText('New')).toBeTruthy();
    expect(ui.getByText('Updated')).toBeTruthy();
    expect(ui.getByText(/hero: empty/)).toBeTruthy();
    expect(ui.getByText(/japan-t01 · replaces the built-in version/)).toBeTruthy();
    expect(ui.getByText(/japan-t03 · same as the built-in version/)).toBeTruthy();
    expect(ui.getByTestId('trip-templates-import').props.accessibilityState.disabled).toBe(false);

    importReply = okReport(true);
    fireEvent.press(ui.getByTestId('trip-templates-import'));
    await waitFor(() => expect(ui.getByTestId('trip-templates-message').props.children).toMatch(/Imported/));
    expect(importCalls()[1]).toEqual({ bundle: JSON.parse(BUNDLE), dryRun: false });
    expect(ui.getByTestId('trip-templates-summary').props.children.join('')).toMatch(/^Imported: /);
    expect(calls.filter((call) => call.url === 'http://api.test/api/admin/trip-templates' && !call.init?.method)).toHaveLength(2);
    expect(ui.getByTestId('trip-templates-import').props.accessibilityState.disabled).toBe(true);
  });

  it('shows each problem for the LLM to fix, and will not import', async () => {
    importReply = badReport;
    const ui = mount();
    fireEvent.changeText(ui.getByTestId('trip-templates-json'), BUNDLE);
    fireEvent.press(ui.getByTestId('trip-templates-check'));
    expect(await ui.findByText(/activities\.0\.day: 40 is after the last day/)).toBeTruthy();
    expect(ui.getByText('Needs fixes')).toBeTruthy();
    expect(ui.getByText(/Place portugal\/belem-tower: picture license "CC BY"/)).toBeTruthy();
    expect(ui.getByText(/Copy these messages back to the LLM/)).toBeTruthy();
    expect(ui.getByTestId('trip-templates-summary').props.children.join('')).toMatch(/^Not importable yet: /);
    expect(ui.getByTestId('trip-templates-import').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(ui.getByTestId('trip-templates-import'));
    expect(importCalls().filter((sent) => sent.dryRun === false)).toHaveLength(0);
  });

  it('explains text that is not JSON without calling the server, and ignores an empty box', async () => {
    const ui = mount();
    await ui.findByText('Lisbon in 4 days');
    fireEvent.changeText(ui.getByTestId('trip-templates-json'), 'Here is your itinerary: {');
    fireEvent.press(ui.getByTestId('trip-templates-check'));
    expect(await ui.findByText(/This is not valid JSON/)).toBeTruthy();
    expect(importCalls()).toEqual([]);
    expect(ui.getByTestId('trip-templates-import').props.accessibilityState.disabled).toBe(true);
    fireEvent.changeText(ui.getByTestId('trip-templates-json'), '   ');
    expect(ui.getByTestId('trip-templates-check').props.accessibilityState?.disabled ?? ui.getByTestId('trip-templates-check').props.disabled).toBeTruthy();
  });

  it('asks for a new check when the text is edited after one', async () => {
    const ui = mount();
    fireEvent.changeText(ui.getByTestId('trip-templates-json'), BUNDLE);
    fireEvent.press(ui.getByTestId('trip-templates-check'));
    await ui.findByTestId('trip-templates-report');
    expect(ui.getByTestId('trip-templates-import').props.accessibilityState.disabled).toBe(false);
    fireEvent.changeText(ui.getByTestId('trip-templates-json'), `${BUNDLE} `);
    expect(ui.queryByTestId('trip-templates-report')).toBeNull();
    expect(ui.getByTestId('trip-templates-import').props.accessibilityState.disabled).toBe(true);
  });

  it('reports a file that cannot be read or is too large', async () => {
    (pickTextFile as jest.Mock).mockRejectedValue(new Error('The file is larger than 10 MiB.'));
    const ui = mount();
    fireEvent.press(ui.getByTestId('trip-templates-pick-file'));
    expect(await ui.findByText('The file is larger than 10 MiB.')).toBeTruthy();
    (pickTextFile as jest.Mock).mockResolvedValue(null);
    fireEvent.press(ui.getByTestId('trip-templates-pick-file'));
    await waitFor(() => expect(pickTextFile).toHaveBeenCalledTimes(2));
    expect(importCalls()).toEqual([]);
  });

  it('removes an imported template after a second confirming press, but not a built-in one', async () => {
    const ui = mount();
    await ui.findByText('Lisbon in 4 days');
    expect(ui.queryByTestId('trip-templates-remove-japan-t01')).toBeNull();
    expect(ui.getByText('Restore built-in')).toBeTruthy();
    fireEvent.press(ui.getByTestId('trip-templates-remove-portugal-lisbon-4d'));
    expect(calls.some((call) => call.init?.method === 'DELETE')).toBe(false);
    fireEvent.press(ui.getByTestId('trip-templates-remove-confirm-portugal-lisbon-4d'));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/imported/portugal-lisbon-4d') && call.init?.method === 'DELETE')).toBe(true));
    expect(await ui.findByText('Removed the imported version of portugal-lisbon-4d.')).toBeTruthy();
  });

  it('surfaces a server refusal', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Admin access required' }), text: async () => '' }));
    const ui = mount();
    expect(await ui.findByText('Admin access required')).toBeTruthy();
  });
});

describe('TripTemplatesSection colors', () => {
  const channel = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
  const ratio = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

  it.each(['light', 'dark'] as const)('keeps every label readable on its background in %s mode', (mode) => {
    const theme = getAppTheme(mode, mode);
    const s: any = themeStyle('components_admin_TripTemplatesSection_1', { StyleSheet }, theme);
    const flat = (key: string) => StyleSheet.flatten(s[key]) as Record<string, string>;
    const pairs: Array<[string, string, string]> = [
      ['buttonText', 'button', 'primary action'], ['outlineButtonText', 'outlineButton', 'secondary action'], ['dangerButtonText', 'dangerButton', 'remove'],
      ['disabledButtonText', 'disabledButton', 'disabled action'], ['pillNew', 'pillNew', 'new pill'], ['pillUpdated', 'pillUpdated', 'updated pill'],
      ['pillInvalid', 'pillInvalid', 'invalid pill'], ['pillUnchanged', 'pillUnchanged', 'unchanged pill'], ['message', 'message', 'message'],
    ];
    for (const [text, surface, label] of pairs) {
      expect({ label, ratio: ratio(flat(text).color, flat(surface).backgroundColor) >= 4.5 }).toEqual({ label, ratio: true });
    }
    for (const key of ['helper', 'mutedText', 'errorText', 'warningText', 'successText', 'resultTitle', 'cardTitle']) {
      for (const background of [theme.colors.surface, theme.colors.background]) {
        expect({ key, ok: ratio(flat(key).color, background) >= 4.5 }).toEqual({ key, ok: true });
      }
    }
    expect(ratio(flat('input').color, flat('input').backgroundColor)).toBeGreaterThanOrEqual(4.5);
    for (const key of ['button', 'outlineButton', 'dangerButton', 'disabledButton']) expect(Number(flat(key).minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('renders inside a theme provider in dark mode', async () => {
    const ui = render(<ThemeProvider theme={getAppTheme('dark', 'dark')}><TripTemplatesSection backendUrl="http://api.test" headers={{}} /></ThemeProvider>);
    expect(await ui.findByText('Lisbon in 4 days')).toBeTruthy();
  });
});
