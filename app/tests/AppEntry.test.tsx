/// <reference types="jest" />
/// <reference types="node" />
import React from 'react';
import { render } from '@testing-library/react-native';

// Mock expo BEFORE the suite-wide ErrorUtils is touched. react-native and
// react-native-safe-area-context come from the suite-wide mocks under
// tests/__mocks__/ — those expose string host components, which is what
// @testing-library/react-native expects for host-name detection.
jest.mock('expo', () => ({
  registerRootComponent: jest.fn(),
}));

jest.mock(
  '../AppRoot',
  () => {
    const ReactImpl = require('react');
    return {
      default: ReactImpl.forwardRef((_props: unknown, _ref: unknown) => null),
    };
  },
  { virtual: true },
);

type ErrorUtilsShape = {
  getGlobalHandler: jest.Mock;
  setGlobalHandler: jest.Mock;
};

const globalWithErrorUtils = globalThis as typeof globalThis & {
  ErrorUtils?: ErrorUtilsShape;
  __wanderBunniesAppMounted?: boolean;
};

// Install the ErrorUtils mock once, BEFORE AppEntry is first required, so
// the module's startup-error handler attaches to the mock instead of the
// real (or missing) one.
const setGlobalHandlerMock = jest.fn();
const getGlobalHandlerMock = jest.fn(() => jest.fn());
const originalErrorUtils = globalWithErrorUtils.ErrorUtils;
globalWithErrorUtils.ErrorUtils = {
  getGlobalHandler: getGlobalHandlerMock,
  setGlobalHandler: setGlobalHandlerMock,
};

// Require AppEntry once so module-level work runs exactly once. Subsequent
// tests reuse the same Root/handler — this matches how the real app boots
// (single startup) and avoids splitting React across `jest.resetModules()`.
require('../AppEntry');
const { registerRootComponent } = require('expo');
const Root = registerRootComponent.mock.calls[0][0];
const capturedHandler = setGlobalHandlerMock.mock.calls[0][0];

afterAll(() => {
  globalWithErrorUtils.ErrorUtils = originalErrorUtils;
  delete globalWithErrorUtils.__wanderBunniesAppMounted;
});

describe('AppEntry', () => {
  beforeEach(() => {
    delete globalWithErrorUtils.__wanderBunniesAppMounted;
  });

  it('registers the root component and installs the global error handler', () => {
    expect(registerRootComponent).toHaveBeenCalledTimes(1);
    expect(typeof Root).toBe('function');
    expect(setGlobalHandlerMock).toHaveBeenCalledTimes(1);
    expect(typeof capturedHandler).toBe('function');
  });

  it('renders the StartupFailure UI when the global error handler captures a startup error', () => {
    capturedHandler(new Error('Fatal boom'), true);

    const { getByText } = render(<Root />);
    expect(getByText('WanderBunnies could not start')).toBeTruthy();
    expect(getByText('Fatal boom')).toBeTruthy();
  });

  it('does not overwrite an existing global handler twice on re-import', () => {
    // Re-requiring the cached module is a no-op, and the module's own guard
    // (`__hasWanderBunniesHandler`) prevents a second `setGlobalHandler`
    // call even if the module were forcibly reloaded.
    require('../AppEntry');
    expect(setGlobalHandlerMock).toHaveBeenCalledTimes(1);
  });
});
