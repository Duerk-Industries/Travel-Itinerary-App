/**
 * @jest-environment node
 */

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
  openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })),
}));

jest.mock('expo-linking', () => ({
  createURL: jest.fn((path: string, options?: { scheme?: string }) => `${options?.scheme ?? 'travelitineraryplanner'}://${path}`),
}));

jest.mock('../assets/wanderbunnies-reference.png', () => 1);

const App = require('../App').default;
const ExpoLinking = require('expo-linking');
const WebBrowser = require('expo-web-browser');

describe('App startup', () => {
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
});
