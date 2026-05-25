/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// We must mock expo and react-native before requiring AppEntry
jest.mock('expo', () => ({
  registerRootComponent: jest.fn(),
}));

jest.mock('react-native', () => {
  return {
    Platform: { OS: 'android' },
    StatusBar: { currentHeight: 42 },
    View: ({ children }: any) => <div>{children}</div>,
    StyleSheet: { create: (s: any) => s },
    Text: ({ children }: any) => <span>{children}</span>,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => <div>{children}</div>,
}));

// We can test resolveComponentExport behavior by mocking the require call
jest.mock('../AppRoot', () => {
  // Test forwardRef
  return {
    default: React.forwardRef((props, ref: any) => <div ref={ref}>AppRoot</div>),
  };
}, { virtual: true });

describe('AppEntry', () => {
  type ErrorUtilsShape = {
    getGlobalHandler: jest.Mock;
    setGlobalHandler: jest.Mock;
  };

  let originalErrorUtils: unknown;
  let getGlobalHandlerMock: jest.Mock;
  let setGlobalHandlerMock: jest.Mock;
  const globalWithErrorUtils = globalThis as typeof globalThis & {
    ErrorUtils?: ErrorUtilsShape;
  };

  beforeEach(() => {
    jest.resetModules();
    getGlobalHandlerMock = jest.fn(() => jest.fn());
    setGlobalHandlerMock = jest.fn();
    originalErrorUtils = globalWithErrorUtils.ErrorUtils;
    globalWithErrorUtils.ErrorUtils = {
      getGlobalHandler: getGlobalHandlerMock,
      setGlobalHandler: setGlobalHandlerMock,
    };
    delete (globalThis as any).__wanderBunniesAppMounted;
  });

  afterEach(() => {
    globalWithErrorUtils.ErrorUtils = originalErrorUtils as ErrorUtilsShape | undefined;
    delete (globalThis as any).__wanderBunniesAppMounted;
  });

  it('registers the root component and sets global error handler', () => {
    require('../AppEntry');
    const { registerRootComponent } = require('expo');
    expect(registerRootComponent).toHaveBeenCalled();
    expect(setGlobalHandlerMock).toHaveBeenCalled();
  });
});
