import React from 'react';
import { render } from '@testing-library/react-native';
import NoteInputDialog from '../components/NoteInputDialog';
import { ThemeProvider } from '../theme/ThemeContext';
import { getAppTheme, resolveComponentTheme } from '../theme/theme';

const flatten = (value: unknown): Record<string, unknown> => Array.isArray(value)
  ? Object.assign({}, ...value.map(flatten)) : (value ?? {}) as Record<string, unknown>;

it('updates a standalone dialog when its inherited appearance changes without a theme prop', () => {
  const light = getAppTheme('light', 'light');
  const dark = getAppTheme('dark', 'dark');
  const draw = (theme: typeof light) => <ThemeProvider theme={theme}>
    <NoteInputDialog visible onCancel={jest.fn()} onSubmit={jest.fn()} />
  </ThemeProvider>;
  const screen = render(draw(light));
  expect(flatten(screen.getByText('Add a note').props.style).color).toBe(light.colors.text);
  screen.rerender(draw(dark));
  expect(flatten(screen.getByText('Add a note').props.style).color).toBe(dark.colors.text);
  expect(flatten(screen.getByTestId('note-dialog-title').props.style).backgroundColor).toBe(dark.colors.surfaceMuted);
  screen.rerender(draw(light));
  expect(flatten(screen.getByText('Add a note').props.style).color).toBe(light.colors.text);
});

it('fills legacy partial props from the active theme and reuses complete themes', () => {
  const dark = getAppTheme('dark', 'dark');
  expect(resolveComponentTheme(undefined, dark)).toBe(dark);
  expect(resolveComponentTheme(dark, getAppTheme('light', 'light'))).toBe(dark);
  const partial = resolveComponentTheme({ colors: { text: dark.colors.text } }, dark);
  expect(partial.mode).toBe('dark');
  expect(partial.colors).toEqual(dark.colors);
});
