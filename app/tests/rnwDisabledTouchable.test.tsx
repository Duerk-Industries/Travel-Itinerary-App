/** @jest-environment jsdom */
import React, { act } from 'react';
const { TouchableOpacity, TouchableHighlight, Text } = jest.requireActual('react-native-web');
const { createRoot } = jest.requireActual('react-dom/client');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([TouchableOpacity, TouchableHighlight])('preserves disabled pointer behavior without deprecated props', async (Component) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const onPress = jest.fn();
  try {
    await act(async () => { root.render(<Component disabled testID="disabled" onPress={onPress} style={{ pointerEvents: 'auto' }}><Text>Disabled</Text></Component>); });
    const button = host.querySelector('[data-testid="disabled"]') as HTMLElement;
    expect(getComputedStyle(button).pointerEvents).toBe('none');
    await act(async () => { button.click(); });
    expect(onPress).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).not.toContain('props.pointerEvents is deprecated');
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    warn.mockRestore();
  }
});
