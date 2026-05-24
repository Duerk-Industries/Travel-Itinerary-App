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
    SafeAreaView: ({ children }: any) => <div>{children}</div>,
    StyleSheet: { create: (s: any) => s },
    Text: ({ children }: any) => <span>{children}</span>,
  };
});

// We can test resolveComponentExport behavior by mocking the require call
jest.mock('../AppRoot', () => {
  // Test forwardRef
  return {
    default: React.forwardRef((props, ref: any) => <div ref={ref}>AppRoot</div>),
  };
}, { virtual: true });

describe('AppEntry', () => {
  let originalErrorUtils;
  let getGlobalHandlerMock;
  let setGlobalHandlerMock;

  beforeEach(() => {
    jest.resetModules();
    getGlobalHandlerMock = jest.fn(() => jest.fn());
    setGlobalHandlerMock = jest.fn();
    originalErrorUtils = globalThis.ErrorUtils;
    globalThis.ErrorUtils = {
      getGlobalHandler: getGlobalHandlerMock,
      setGlobalHandler: setGlobalHandlerMock,
    };
  });

  afterEach(() => {
    globalThis.ErrorUtils = originalErrorUtils;
  });

  it('registers the root component and sets global error handler', () => {
    require('../AppEntry');
    const { registerRootComponent } = require('expo');
    expect(registerRootComponent).toHaveBeenCalled();
    expect(setGlobalHandlerMock).toHaveBeenCalled();
  });
});
