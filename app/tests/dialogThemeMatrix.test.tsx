/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import ChecklistInputDialog from '../components/ChecklistInputDialog';
import NoteInputDialog from '../components/NoteInputDialog';
import PlacePickerDialog from '../components/PlacePickerDialog';
import { getAppTheme } from '../theme/theme';

const flatten = (style: any): Record<string, any> => Array.isArray(style)
  ? Object.assign({}, ...style.map(flatten))
  : (style ?? {});

const contrast = (foreground: string, background: string): number => {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    return rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

describe('standalone input dialogs across appearances and platforms', () => {
  const originalOS = Platform.OS;
  afterEach(() => { Platform.OS = originalOS; });

  it.each([
    ['web', 'light'], ['web', 'dark'],
    ['ios', 'light'], ['ios', 'dark'],
    ['android', 'light'], ['android', 'dark'],
  ] as const)('keeps titles, fields, errors, and actions legible on %s in %s mode', (platform, mode) => {
    Platform.OS = platform;
    const theme = getAppTheme(mode, mode);
    const common = { visible: true, theme, onCancel: jest.fn(), onSubmit: jest.fn() };
    const cases = [
      { element: <NoteInputDialog {...common} />, card: 'note-dialog', title: 'Add a note', input: 'note-dialog-title', submit: 'note-dialog-submit' },
      { element: <ChecklistInputDialog {...common} />, card: 'checklist-dialog', title: 'Add a checklist', input: 'checklist-dialog-title', submit: 'checklist-dialog-submit' },
      { element: <PlacePickerDialog {...common} backendUrl="http://api.test" headers={{}} />, card: 'place-dialog', title: 'Add a place', input: 'place-dialog-name', submit: 'place-dialog-submit' },
    ];
    for (const { element, card, title, input, submit } of cases) {
      const view = render(element);
      const surface = flatten(view.getByTestId(card).props.style).backgroundColor;
      const titleColor = flatten(view.getByText(title).props.style).color;
      const fieldColor = flatten(view.getByTestId(input).props.style).color;
      const fieldSurface = flatten(view.getByTestId(input).props.style).backgroundColor;
      expect(surface).toBe(theme.colors.surface);
      expect(contrast(titleColor, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fieldColor, fieldSurface)).toBeGreaterThanOrEqual(4.5);
      expect(flatten(view.getByTestId(submit).props.style).minHeight).toBeGreaterThanOrEqual(44);
      fireEvent.press(view.getByTestId(submit));
      const error = view.getByText(/required/i);
      expect(contrast(flatten(error.props.style).color, surface)).toBeGreaterThanOrEqual(4.5);
      view.unmount();
    }
  });
});
