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
  const originalPremiumTrialsFlag = process.env.EXPO_PUBLIC_PREMIUM_TRIALS_ENABLED;
  let fetchSpy: jest.SpyInstance | null = null;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.EXPO_PUBLIC_PREMIUM_TRIALS_ENABLED = 'true';
    fetchSpy?.mockRestore();
    fetchSpy = null;
    WebBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'cancel' });
    AsyncStorage.setItem.mockClear();
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = null;
    if (originalPremiumTrialsFlag == null) {
      delete process.env.EXPO_PUBLIC_PREMIUM_TRIALS_ENABLED;
    } else {
      process.env.EXPO_PUBLIC_PREMIUM_TRIALS_ENABLED = originalPremiumTrialsFlag;
    }
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

  it('does not show the Premium trial welcome dialog when an existing user signs in', async () => {
    const token = makeJwt({
      email: 'existing@example.com',
      firstName: 'Existing',
      lastName: 'User',
      role: 'user',
      userId: 'existing-1',
    });
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ token, firstLogin: false }),
    } as any);

    const { getByPlaceholderText, getByTestId, queryByTestId } = render(<App />);
    fireEvent.changeText(getByPlaceholderText('Email or Username'), 'existing@example.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'Password1!');
    fireEvent.press(getByTestId('auth-form-submit'));

    // Allow auth flow to complete — dialog must NOT appear for a returning user.
    await waitFor(() => {
      expect(queryByTestId('premium-trial-welcome-dialog')).toBeNull();
    });
  });

  it('shows the Premium trial welcome dialog after creating an account', async () => {
    const token = makeJwt({
      email: 'newtraveler@example.com',
      firstName: 'New',
      lastName: 'Traveler',
      role: 'user',
      userId: 'new-user-1',
    });
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        message: 'Account created',
        token,
        user: { id: 'new-user-1', email: 'newtraveler@example.com' },
        firstLogin: true,
      }),
    } as any);

    const { getByTestId, getByPlaceholderText, findByTestId, getByText } = render(<App />);

    fireEvent.press(getByTestId('auth-form-mode-register'));
    fireEvent.changeText(getByPlaceholderText('First name'), 'New');
    fireEvent.changeText(getByPlaceholderText('Last name'), 'Traveler');
    fireEvent.changeText(getByPlaceholderText('Email or Username'), 'newtraveler@example.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'Password1!');
    fireEvent.changeText(getByPlaceholderText('Confirm password'), 'Password1!');
    fireEvent.press(getByTestId('auth-form-submit'));

    expect(await findByTestId('premium-trial-welcome-dialog')).toBeTruthy();
    expect(getByText('Try Premium free')).toBeTruthy();
    expect(getByText('• AI itinerary generation')).toBeTruthy();
  });

  it('opens plan comparison from the new-account welcome dialog and Maybe later routes to Account', async () => {
    const token = makeJwt({
      email: 'plancompare@example.com',
      firstName: 'Plan',
      lastName: 'Compare',
      role: 'user',
      userId: 'plan-compare-1',
    });
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockImplementation(async (...args: unknown[]) => {
      const url = String(args[0]);
      if (url.endsWith('/api/web-auth/register')) {
        return {
          ok: true,
          json: async () => ({
            message: 'Account created',
            token,
            user: { id: 'plan-compare-1', email: 'plancompare@example.com' },
            firstLogin: true,
          }),
        } as any;
      }
      if (url.endsWith('/api/billing/plans')) {
        return {
          ok: true,
          json: async () => ({
            plans: [
              { planKey: 'premium_monthly', amountCents: 500, currency: 'usd', interval: 'month', trialDays: 14 },
              { planKey: 'premium_annual', amountCents: 3500, currency: 'usd', interval: 'year', trialDays: 14 },
            ],
          }),
        } as any;
      }
      if (url.endsWith('/api/billing/status')) {
        return {
          ok: true,
          json: async () => ({
            effectiveTier: 'free',
            isBillingManaged: false,
            plan: null,
            subscriptionStatus: null,
            currentPeriodEnd: null,
            trialEnd: null,
            trialEligible: true,
            trialEndingSoon: false,
            cancelAtPeriodEnd: false,
            inGracePeriod: false,
            accessRevoked: false,
            checkoutAvailable: true,
            portalAvailable: false,
            notifications: [],
          }),
        } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    });

    const { getByTestId, getByPlaceholderText, findByTestId, findByText, queryByTestId } = render(<App />);

    fireEvent.press(getByTestId('auth-form-mode-register'));
    fireEvent.changeText(getByPlaceholderText('First name'), 'Plan');
    fireEvent.changeText(getByPlaceholderText('Last name'), 'Compare');
    fireEvent.changeText(getByPlaceholderText('Email or Username'), 'plancompare@example.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'Password1!');
    fireEvent.changeText(getByPlaceholderText('Confirm password'), 'Password1!');
    fireEvent.press(getByTestId('auth-form-submit'));

    expect(await findByTestId('premium-trial-welcome-dialog')).toBeTruthy();
    fireEvent.press(getByTestId('premium-trial-view-plans'));

    expect(await findByTestId('premium-plan-comparison-dialog')).toBeTruthy();
    expect(await findByText('$35/yr (42% off monthly)')).toBeTruthy();

    fireEvent.press(getByTestId('premium-plan-maybe-later'));

    await waitFor(() => {
      expect(queryByTestId('premium-plan-comparison-dialog')).toBeNull();
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'stp.session',
        expect.stringContaining('"page":"account"'),
      );
    });
  });

  it('does not show the Premium trial welcome dialog when the Premium trials flag is disabled', async () => {
    process.env.EXPO_PUBLIC_PREMIUM_TRIALS_ENABLED = 'false';
    const token = makeJwt({
      email: 'flagoff@example.com',
      firstName: 'Flag',
      lastName: 'Off',
      role: 'user',
      userId: 'flag-off-1',
    });
    fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        message: 'Account created',
        token,
        user: { id: 'flag-off-1', email: 'flagoff@example.com' },
        firstLogin: true,
      }),
    } as any);

    const { getByTestId, getByPlaceholderText, queryByTestId } = render(<App />);

    fireEvent.press(getByTestId('auth-form-mode-register'));
    fireEvent.changeText(getByPlaceholderText('First name'), 'Flag');
    fireEvent.changeText(getByPlaceholderText('Last name'), 'Off');
    fireEvent.changeText(getByPlaceholderText('Email or Username'), 'flagoff@example.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'Password1!');
    fireEvent.changeText(getByPlaceholderText('Confirm password'), 'Password1!');
    fireEvent.press(getByTestId('auth-form-submit'));

    await waitFor(() => {
      expect(queryByTestId('premium-trial-welcome-dialog')).toBeNull();
    });
  });
});
