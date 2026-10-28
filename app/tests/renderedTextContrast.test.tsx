/** @jest-environment jsdom */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../theme/ThemeContext';
import { buildStyles, getAppTheme } from '../theme/theme';

// Renders dialogs, forms, panels and buttons in light and dark mode and checks every piece of text against the
// background it is drawn on. Text with no color of its own is black (react-native's default), exactly as on a device,
// so unthemed text, background tokens used as text colors, and text on a mismatched fill all show up here.

const flat = (style: any): Record<string, any> => (Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : style) || {};
const parse = (color: any): [number, number, number] | null => {
  if (typeof color !== 'string') return null;
  if (/^#[\da-f]{6}$/i.test(color)) return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) as [number, number, number];
  if (/^#[\da-f]{3}$/i.test(color)) return [1, 2, 3].map((i) => parseInt(color[i] + color[i], 16)) as [number, number, number];
  const rgb = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  return rgb ? [+rgb[1], +rgb[2], +rgb[3]] : null;
};
const channel = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
const luminance = (c: number[]) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(parse(a)!), luminance(parse(b)!)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const MIN_CONTRAST = 4.5;
// Components whose props are too involved for generic defaults get the minimum they need to render.
const PROPS: Record<string, any> = {
  AuthForm: { authMode: 'login', authForm: { firstName: '', lastName: '', email: '', password: '', confirmPassword: '' }, showResendConfirmation: true, resendConfirmationLoading: false, authErrorMessage: 'Something went wrong', appleOAuthEnabled: true, loginWithApple: () => {} },
  PendingInvitesModal: { invites: [{ id: 'i', groupId: 'g', groupName: 'Group', invitedBy: 'A', tripName: 'Trip', tripStartDate: '2026-01-01' }], pendingTripShareInvites: [], pendingFollowCode: 'ABC' },
  PaymentDialog: { participants: [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bob' }], sortedIds: ['a', 'b'], participantLabel: (id: string) => id, defaultPayerId: 'a' },
  TripItemDetailsDialog: { kind: 'flight', title: 'Flight', subtitle: 'Sub', status: 'Booked', rows: [{ label: 'From', value: 'SEA' }] },
  BlogDayStarterCard: { draft: 'A draft paragraph' },
  TripTemplatePicker: { selectedLocations: [], startDate: '', tripName: 'T' },
  PhotoFirstComposer: { files: [], dayDates: ['2026-01-01'], context: {} },
};
// Decorative glyphs (emoji, arrows, check marks) are drawn in their own colors or are not read as text.
const hasReadableText = (text: string) => /[\p{L}\p{N}]/u.test(text);
const IGNORED_COMPONENTS = new Set(['KeepsakeMapCaptureHost']);

const components = fs.readdirSync(path.resolve(__dirname, '../components'))
  .filter((name) => /\.tsx$/.test(name) && !/\.(web|native|types)\./.test(name))
  .filter((name) => /Dialog|Modal|Form|Button|Panel|Popover|Sheet|Picker|Landing|Banner|Card|Composer|Controls|Settings|Confirm/.test(name))
  .map((name) => name.replace('.tsx', ''))
  .filter((name) => !IGNORED_COMPONENTS.has(name));

const textOf = (node: any): string => (node.children || []).map((child: any) => (typeof child === 'string' ? child : textOf(child))).join('').trim();

describe.each(['light', 'dark'] as const)('rendered text is readable in %s mode', (mode) => {
  const theme = getAppTheme(mode, mode);
  const styles = buildStyles(theme);

  it('has no low-contrast text in dialogs, forms, panels and buttons', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const failures: string[] = [];
    let rendered = 0;
    for (const name of components) {
      const props = new Proxy({
        visible: true, open: true, theme, styles, groupMembers: [], members: [], userMembers: [], headers: {},
        backendUrl: 'http://x', title: 'Title', message: 'Message', draft: {}, options: [], items: [], trip: {}, tripId: 't', ...PROPS[name],
      } as Record<string, any>, {
        get: (target, key: string) => (key in target ? target[key] : /^on[A-Z]|^set[A-Z]|^handle/.test(String(key)) ? jest.fn() : undefined),
      });
      let tree: any;
      try {
        const Component = require(`../components/${name}`).default;
        if (!Component) continue;
        const view = render(<ThemeProvider theme={theme}><Component {...props} /></ThemeProvider>);
        tree = view.toJSON();
        view.unmount();
      } catch {
        continue; // needs real data or native modules to mount; covered by its own tests
      }
      rendered += 1;
      const walk = (node: any, background: string, inherited: string | null) => {
        if (!node || typeof node === 'string') return;
        const style = flat(node.props?.style);
        let behind = background;
        if (parse(style.backgroundColor) && style.opacity !== 0) behind = style.backgroundColor;
        let color = inherited;
        if (node.type === 'Text' || node.type === 'TextInput') {
          color = style.color ?? inherited ?? '#000000';
          const text = textOf(node);
          const own = (node.children || []).some((child: any) => typeof child === 'string' && child.trim());
          if (((own && hasReadableText(text)) || node.type === 'TextInput') && parse(color) && parse(behind)) {
            const ratio = contrast(color!, behind);
            if (ratio < MIN_CONTRAST) failures.push(`${name}: "${text.slice(0, 40)}" ${color} on ${behind} = ${ratio.toFixed(2)}`);
          }
        }
        for (const child of node.children || []) walk(child, behind, node.type === 'Text' ? color : null);
      };
      (Array.isArray(tree) ? tree : tree ? [tree] : []).forEach((root: any) => walk(root, theme.colors.background, null));
    }
    expect(rendered).toBeGreaterThan(40);
    expect(failures).toEqual([]);
  });
});
