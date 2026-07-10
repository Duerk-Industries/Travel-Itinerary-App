/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { act, renderHook } from '@testing-library/react-native';

const persistAppearancePreferenceMock = jest.fn<void, [unknown]>();
const loadStoredAppearancePreferenceMock = jest.fn<string, [unknown]>(() => 'auto');
const persistMapPreferenceMock = jest.fn<void, [unknown]>();
const loadStoredMapPreferenceMock = jest.fn<string, [unknown]>(() => 'google');

jest.mock('../utils/appearancePreference', () => ({
  isAppearancePreference: (v: unknown) => v === 'light' || v === 'dark' || v === 'auto',
  loadStoredAppearancePreference: (fallback: unknown) =>
    loadStoredAppearancePreferenceMock(fallback),
  persistAppearancePreference: (value: unknown) => persistAppearancePreferenceMock(value),
}));

jest.mock('../utils/mapLinks', () => ({
  loadStoredMapPreference: (fallback: unknown) => loadStoredMapPreferenceMock(fallback),
  persistMapPreference: (value: unknown) => persistMapPreferenceMock(value),
  buildMapUrl: jest.fn(),
}));

import { useAccountProfile } from '../hooks/useAccountProfile';

describe('useAccountProfile', () => {
  beforeEach(() => {
    persistAppearancePreferenceMock.mockReset();
    persistMapPreferenceMock.mockReset();
    loadStoredAppearancePreferenceMock.mockReset().mockReturnValue('auto');
    loadStoredMapPreferenceMock.mockReset().mockReturnValue('google');
  });

  it('initializes accountProfile to all-empty values', () => {
    const { result } = renderHook(() => useAccountProfile());
    expect(result.current.accountProfile).toEqual({
      firstName: '',
      lastName: '',
      email: '',
      homeAddress: '',
      preferredAirport: '',
      appearancePreference: 'auto',
      temperatureUnit: 'fahrenheit',
    });
  });

  it('reads initial mapApp + appearancePreference from storage helpers', () => {
    loadStoredMapPreferenceMock.mockReturnValue('apple');
    loadStoredAppearancePreferenceMock.mockReturnValue('dark');
    const { result } = renderHook(() => useAccountProfile());
    expect(result.current.mapApp).toBe('apple');
    expect(result.current.appearancePreference).toBe('dark');
  });

  it('updateMapPreference updates standalone state, nested profile slice, and persists', () => {
    const { result } = renderHook(() => useAccountProfile());
    act(() => {
      result.current.updateMapPreference('waze');
    });
    expect(result.current.mapApp).toBe('waze');
    expect(result.current.accountProfile.mapPreference).toBe('waze');
    expect(persistMapPreferenceMock).toHaveBeenCalledWith('waze');
  });

  it('updateAppearancePreference updates standalone state, nested profile slice, and persists', () => {
    const { result } = renderHook(() => useAccountProfile());
    act(() => {
      result.current.updateAppearancePreference('dark');
    });
    expect(result.current.appearancePreference).toBe('dark');
    expect(result.current.accountProfile.appearancePreference).toBe('dark');
    expect(persistAppearancePreferenceMock).toHaveBeenCalledWith('dark');
  });

  it('setAccountProfile replaces the profile object', () => {
    const { result } = renderHook(() => useAccountProfile());
    act(() => {
      result.current.setAccountProfile({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        homeAddress: '',
        preferredAirport: 'LHR',
        appearancePreference: 'light',
        temperatureUnit: 'celsius',
      });
    });
    expect(result.current.accountProfile.firstName).toBe('Ada');
    expect(result.current.accountProfile.preferredAirport).toBe('LHR');
  });

  it('clearAccountProfile resets only the profile, not mapApp or appearancePreference', () => {
    const { result } = renderHook(() => useAccountProfile());
    act(() => {
      result.current.setAccountProfile({
        firstName: 'x',
        lastName: 'y',
        email: 'z',
        homeAddress: '',
        preferredAirport: '',
        appearancePreference: 'auto',
        temperatureUnit: 'fahrenheit',
      });
      result.current.updateMapPreference('waze');
    });
    act(() => {
      result.current.clearAccountProfile();
    });
    expect(result.current.accountProfile.firstName).toBe('');
    // Clearing profile should not revert the user's persisted map preference.
    expect(result.current.mapApp).toBe('waze');
  });
});
