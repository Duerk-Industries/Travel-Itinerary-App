import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import Icon from '../components/Icon';
import IconText from '../components/IconText';
import { ThemeProvider } from '../theme/ThemeContext';
import { getAppTheme } from '../theme/theme';

it.each(['light', 'dark'] as const)('uses shared SVG icons and theme colors in %s mode', mode => {
  const theme = getAppTheme(mode, mode);
  const view = render(<ThemeProvider theme={theme}><IconText>🔔 Notifications</IconText></ThemeProvider>);
  expect(view.UNSAFE_getByType(Icon).props).toMatchObject({ name: 'bell', color: theme.colors.text, size: theme.typography.body });
  expect(view.getByLabelText('bell Notifications')).toBeTruthy();
  expect(view.queryByText(/🔔/)).toBeNull();
});

it('preserves explicit accessibility labels and text styling', () => {
  const view = render(<IconText accessibilityLabel="Remove photo" style={{ color: 'red', fontSize: 20 }}>🗑</IconText>);
  expect(view.getByLabelText('Remove photo')).toBeTruthy();
  expect(view.UNSAFE_getByType(Icon).props).toMatchObject({ name: 'trash', color: 'red', size: 20 });
});

it('leaves user-authored text and route separators as text', () => {
  const view = render(<><Text>My trip was amazing 😂</Text><IconText>LAX → SFO</IconText></>);
  expect(view.getByText('My trip was amazing 😂')).toBeTruthy();
  expect(view.getByText('LAX → SFO')).toBeTruthy();
  expect(view.UNSAFE_queryAllByType(Icon)).toHaveLength(0);
});
