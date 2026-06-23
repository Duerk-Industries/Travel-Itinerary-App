/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      scheme: 'travelitineraryplanner',
      extra: {
        backendUrl: 'https://duerk.org',
        refreshIntervalMs: 60000,
      },
    },
  },
}));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })),
}));

jest.mock('expo-linking', () => ({
  createURL: jest.fn((path: string, options?: { scheme?: string }) => `${options?.scheme ?? 'travelitineraryplanner'}://${path}`),
}));

jest.mock('../assets/wanderbunnies-reference.png', () => 1);

delete process.env.EXPO_PUBLIC_BACKEND_URL;
delete process.env.BACKEND_URL;
delete process.env.WEB_URL;
delete process.env.API_BASE_URL;
delete process.env.REACT_APP_BACKEND_URL;
delete process.env.REACT_NATIVE_APP_BACKEND_URL;

const App = require('../App').default;
const ExpoLinking = require('expo-linking');
const WebBrowser = require('expo-web-browser');
const AsyncStorage = require('@react-native-async-storage/async-storage').default;

const makeJwt = (payload: Record<string, unknown>) => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `test.${encoded}.sig`;
};

describe('App startup', () => {
  let fetchSpy: jest.SpyInstance | null = null;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    fetchSpy?.mockRestore();
    fetchSpy = null;
    WebBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'cancel' });
    AsyncStorage.setItem.mockClear();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = null;
  });

  it('completes pending browser auth sessions when the app module loads', () => {
    expect(WebBrowser.maybeCompleteAuthSession).toHaveBeenCalledTimes(1);
  });

  it('renders the signed-out native shell without crashing', () => {
    const { getByText } = render(<App />);
    expect(getByText('WanderBunnies')).toBeTruthy();
  });

  it('uses Expo Linking to build the native Google OAuth redirect URL', async () => {
    const { getByTestId } = render(<App />);
    fireEvent.press(getByTestId('auth-form-google'));

    await waitFor(() => {
      expect(ExpoLinking.createURL).toHaveBeenCalledWith('login', { scheme: 'travelitineraryplanner' });
      expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
        'https://duerk.org/api/auth/google?redirect_uri=travelitineraryplanner%3A%2F%2Flogin',
        'travelitineraryplanner://login',
      );
    });
  });

  it('exchanges native Google OAuth auth codes before applying the session', async () => {
    const token = makeJwt({
      email: 'traveler@example.com',
      firstName: 'Tara',
      lastName: 'Traveler',
      role: 'user',
      userId: 'u1',
    });
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ token, requirePasswordSetup: true }),
    } as any);
    WebBrowser.openAuthSessionAsync.mockResolvedValueOnce({
      type: 'success',
      url: 'travelitineraryplanner://login?auth_code=native-code',
    });

    const { getByTestId } = render(<App />);
    const originalBuffer = (globalThis as any).Buffer;
    try {
      (globalThis as any).Buffer = undefined;
      fireEvent.press(getByTestId('auth-form-google'));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith('https://duerk.org/api/auth/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'native-code' }),
        });
      });
      await waitFor(() => {
        expect(AsyncStorage.setItem).toHaveBeenCalledWith(
          'stp.session',
          expect.stringContaining('"name":"Tara Traveler"')
        );
      });
    } finally {
      (globalThis as any).Buffer = originalBuffer;
    }
  });
});
