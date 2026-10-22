/**
 * @jest-environment node
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ThemedText } from '../components/ThemedText';
import { ThemeProvider } from '../theme/ThemeContext';
import { getAppTheme, linkTextColor } from '../theme/theme';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const light = getAppTheme('light', 'light');
const dark = getAppTheme('dark', 'dark');

const render = (element: React.ReactElement) => {
  let tree: any;
  act(() => { tree = renderer.create(element); });
  return tree;
};
const hosts = (tree: any): any[] => tree.root.findAll((node: any) => node.type === 'Text');
const colorOf = (node: any): unknown => {
  const flat = ([] as unknown[]).concat(node.props.style ?? []).flat(Infinity) as Array<{ color?: string } | undefined>;
  return flat.reduce<string | undefined>((found, entry) => entry?.color ?? found, undefined);
};

describe('ThemedText', () => {
  it('uses the dark theme\'s text color in dark mode, where plain Text would be black on a dark surface', () => {
    const tree = render(<ThemeProvider theme={dark}><ThemedText>Hello</ThemedText></ThemeProvider>);
    expect(colorOf(hosts(tree)[0])).toBe(dark.colors.text);
    expect(dark.colors.text).not.toBe(light.colors.text);
  });

  it('uses the light theme\'s text color in light mode, and when there is no provider', () => {
    expect(colorOf(hosts(render(<ThemeProvider theme={light}><ThemedText>Hi</ThemedText></ThemeProvider>))[0])).toBe(light.colors.text);
    expect(colorOf(hosts(render(<ThemedText>Hi</ThemedText>))[0])).toBe(light.colors.text);
  });

  it('follows a theme change', () => {
    const tree = render(<ThemeProvider theme={light}><ThemedText>Hi</ThemedText></ThemeProvider>);
    act(() => { tree.update(<ThemeProvider theme={dark}><ThemedText>Hi</ThemedText></ThemeProvider>); });
    expect(colorOf(hosts(tree)[0])).toBe(dark.colors.text);
  });

  it('lets an explicit color win, from an object or an array style', () => {
    const tree = render(<ThemeProvider theme={dark}>
      <ThemedText style={{ color: '#ff0000', fontSize: 12 }}>A</ThemedText>
      <ThemedText style={[{ fontWeight: '700' }, { color: '#00ff00' }]}>B</ThemedText>
      <ThemedText style={{ fontSize: 12 }}>C</ThemedText>
    </ThemeProvider>);
    const [a, b, c] = hosts(tree);
    expect(colorOf(a)).toBe('#ff0000');
    expect(colorOf(b)).toBe('#00ff00');
    expect(colorOf(c)).toBe(dark.colors.text);
  });

  it('supplies muted and link tones', () => {
    const tree = render(<ThemeProvider theme={dark}>
      <ThemedText tone="muted">M</ThemedText>
      <ThemedText tone="link">L</ThemedText>
    </ThemeProvider>);
    const [muted, link] = hosts(tree);
    expect(colorOf(muted)).toBe(dark.colors.textMuted);
    expect(colorOf(link)).toBe(dark.colors.link);
  });

  it('uses a readable link color in light mode, where the teal accent is too pale to read on white', () => {
    const tree = render(<ThemeProvider theme={light}><ThemedText tone="link">L</ThemedText></ThemeProvider>);
    expect(colorOf(hosts(tree)[0])).toBe(light.colors.primary);
    expect(linkTextColor(light)).toBe(light.colors.primary);
    expect(linkTextColor(dark)).toBe(dark.colors.link);
  });

  it('keeps nested text inheriting its parent\'s color unless the nested text asks for a tone', () => {
    const tree = render(<ThemeProvider theme={dark}>
      <ThemedText style={{ color: '#ff0000' }}>
        Error: <ThemedText style={{ fontWeight: '700' }}>bold part</ThemedText> <ThemedText tone="link">link</ThemedText>
      </ThemedText>
    </ThemeProvider>);
    const [outer, nested, nestedLink] = hosts(tree);
    expect(colorOf(outer)).toBe('#ff0000');
    expect(colorOf(nested)).toBeUndefined();
    expect(colorOf(nestedLink)).toBe(linkTextColor(dark));
  });

  it('leaves children and other props exactly as written', () => {
    const tree = render(<ThemedText testID="label" accessibilityRole="header" numberOfLines={2}>Plain string</ThemedText>);
    const host = hosts(tree)[0];
    expect(host.props.children).toBe('Plain string');
    expect(host.props.testID).toBe('label');
    expect(host.props.accessibilityRole).toBe('header');
    expect(host.props.numberOfLines).toBe(2);
  });
});
