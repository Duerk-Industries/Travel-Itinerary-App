/** @jest-environment jsdom */
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import KeyboardViewport from '../components/KeyboardViewport';
import KeyboardAwareModal from '../components/KeyboardAwareModal';

const originalPlatform = Platform.OS;
const originalViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
afterEach(() => {
  Object.assign(Platform, { OS: originalPlatform });
  if (originalViewport) Object.defineProperty(window, 'visualViewport', originalViewport);
  else Reflect.deleteProperty(window, 'visualViewport');
});

it('bounds web content to the keyboard-reduced viewport, follows browser panning, and restores height', () => {
  Object.assign(Platform, { OS: 'web' });
  const visual = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  const remove = jest.spyOn(visual, 'removeEventListener');
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
  const { getByTestId, unmount } = render(<KeyboardViewport testID="viewport"><View /></KeyboardViewport>);
  const style = () => Object.assign({}, ...getByTestId('viewport').props.style);
  expect(style()).toMatchObject({ height: 844, top: 0 });
  act(() => { visual.height = 480; visual.offsetTop = 100; visual.dispatchEvent(new Event('resize')); });
  expect(style()).toMatchObject({ height: 480, maxHeight: 480, top: 100 });
  act(() => { visual.offsetTop = 140; visual.dispatchEvent(new Event('scroll')); });
  expect(style()).toMatchObject({ height: 480, top: 140 });
  act(() => { visual.scale = 2; visual.height = 240; visual.dispatchEvent(new Event('resize')); });
  expect(style()).toMatchObject({ height: 480 });
  act(() => { visual.scale = 1; visual.height = 844; visual.offsetTop = 0; visual.dispatchEvent(new Event('resize')); });
  expect(style()).toMatchObject({ height: 844, top: 0 });
  unmount();
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
});

it.each(['ios', 'android'] as const)('avoids the native %s keyboard once per window, including independent modals', os => {
  Object.assign(Platform, { OS: os });
  const { UNSAFE_getAllByType } = render(
    <KeyboardViewport>
      <KeyboardViewport><View /></KeyboardViewport>
      <KeyboardViewport independent><View /></KeyboardViewport>
    </KeyboardViewport>
  );
  const boundaries = UNSAFE_getAllByType(KeyboardAvoidingView);
  expect(boundaries.map(node => node.props.enabled)).toEqual([true, false, true]);
  expect(boundaries[0].props.behavior).toBe(os === 'ios' ? 'padding' : 'height');
});

it('resizes a modal opened before the keyboard and restores both modal and page afterwards', () => {
  Object.assign(Platform, { OS: 'web' });
  const visual = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
  const screen = render(<KeyboardViewport testID="page">
    <KeyboardAwareModal visible onRequestClose={() => undefined}><View testID="form" /></KeyboardAwareModal>
  </KeyboardViewport>);
  const boundaryHeights = () => screen.UNSAFE_getAllByType(View)
    .map(node => Object.assign({}, ...(Array.isArray(node.props.style) ? node.props.style : [node.props.style])))
    .filter(style => style.position === 'fixed').map(style => style.height);
  expect(boundaryHeights()).toEqual([844, 844]);
  act(() => { visual.height = 360; visual.dispatchEvent(new Event('resize')); });
  expect(boundaryHeights()).toEqual([360, 360]);
  act(() => { visual.height = 844; visual.dispatchEvent(new Event('resize')); });
  expect(boundaryHeights()).toEqual([844, 844]);
});

it('handles browsers without visualViewport by tracking window resize', () => {
  Object.assign(Platform, { OS: 'web' });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
  const originalHeight = window.innerHeight;
  const screen = render(<KeyboardViewport testID="page" />);
  try {
    act(() => { window.innerHeight = 400; window.dispatchEvent(new Event('resize')); });
    expect(Object.assign({}, ...screen.getByTestId('page').props.style).height).toBe(400);
  } finally { window.innerHeight = originalHeight; }
});
