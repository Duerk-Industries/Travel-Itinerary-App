/**
 * @jest-environment jsdom
 */
import React from 'react';
import { act } from 'react';
// The real react-native-web, not the string stubs the rest of the suite maps react-native to.
const { Pressable, Text } = jest.requireActual('react-native-web') as { Pressable: React.ComponentType<any>; Text: React.ComponentType<any> };
const { createRoot } = jest.requireActual('react-dom/client') as { createRoot: (el: Element) => { render: (node: React.ReactNode) => void; unmount: () => void } };

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mouseDown = (element: Element) => {
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
};

const pressInDuringMouseDown = async (delayPressIn?: number): Promise<boolean> => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const calls: string[] = [];
  await act(async () => {
    root.render(
      <Pressable testID="option" onPressIn={() => calls.push('pressIn')} delayPressIn={delayPressIn}>
        <Text>Option</Text>
      </Pressable>,
    );
  });
  const option = host.querySelector('[data-testid="option"]')!;
  await act(async () => { mouseDown(option); });
  const fired = calls.length > 0;
  await act(async () => { root.unmount(); });
  host.remove();
  return fired;
};

describe('react-native-web onPressIn timing (why dropdown options pass delayPressIn={0})', () => {
  it('does not report the press during mouse-down by default, so a blur handler runs first', async () => {
    expect(await pressInDuringMouseDown(undefined)).toBe(false);
  });

  it('reports the press during mouse-down when the delay is 0, before the input blurs', async () => {
    expect(await pressInDuringMouseDown(0)).toBe(true);
  });
});
