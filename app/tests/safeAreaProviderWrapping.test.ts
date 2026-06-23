/// <reference types="jest" />
/// <reference types="node" />
/**
 * Regression test: AppRoot must wrap its child component in
 * `<SafeAreaProvider>`. Without that ancestor, `react-native-safe-area-context`
 * (used directly and by @react-navigation/native) reports zero insets on iOS
 * devices with a notch / dynamic island, so the auth form and nav bar render
 * under the system chrome.
 *
 * Locking in the wrap structurally (without mounting React) keeps this test
 * compatible with the React 19 + react-test-renderer interop pain we saw
 * elsewhere.
 */

import React from 'react';

// Spy on SafeAreaProvider exported by the package so we can verify the
// rendered tree without driving a full renderer.
let safeAreaProviderRefs: unknown[] = [];
jest.mock('react-native-safe-area-context', () => {
  const SafeAreaProvider = (props: { children?: React.ReactNode }) => {
    safeAreaProviderRefs.push(props);
    return null;
  };
  return {
    SafeAreaProvider,
    SafeAreaView: SafeAreaProvider,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

describe('AppRoot SafeAreaProvider wrapping', () => {
  beforeEach(() => {
    safeAreaProviderRefs = [];
    jest.resetModules();
  });

  it('produces a React element whose top-level type is SafeAreaProvider', () => {
    jest.doMock('../App', () => ({ __esModule: true, default: () => null }), {
      virtual: false,
    });
    const { SafeAreaProvider } = require('react-native-safe-area-context');
    const AppRoot = require('../AppRoot');
    const fn = typeof AppRoot === 'function' ? AppRoot : AppRoot.default;

    const element = fn();
    expect(React.isValidElement(element)).toBe(true);
    expect(element.type).toBe(SafeAreaProvider);
    // The provider must have a single child (the App component element).
    const child = (element.props as { children?: React.ReactElement }).children;
    expect(React.isValidElement(child)).toBe(true);
  });

  it('falls back to rendering the app directly if SafeAreaProvider is unavailable', () => {
    // Simulate a runtime where react-native-safe-area-context failed to load
    // (e.g., a stripped build or future regression). The fallback must
    // still render the app rather than crashing.
    jest.resetModules();
    jest.doMock('react-native-safe-area-context', () => ({}), { virtual: false });
    jest.doMock('../App', () => {
      const FakeApp = () => null;
      return { __esModule: true, default: FakeApp };
    }, { virtual: false });

    const AppRoot = require('../AppRoot');
    const fn = typeof AppRoot === 'function' ? AppRoot : AppRoot.default;

    const element = fn();
    expect(React.isValidElement(element)).toBe(true);
    // No SafeAreaProvider available, so the element is the App itself,
    // not a provider wrapper.
    expect(typeof element.type).toBe('function');
  });
});
