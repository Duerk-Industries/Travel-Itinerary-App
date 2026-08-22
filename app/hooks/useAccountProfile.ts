import { useCallback, useState } from 'react';
import {
  type AppearancePreference,
  loadStoredAppearancePreference,
  persistAppearancePreference,
} from '../utils/appearancePreference';
import {
  type MapApp,
  loadStoredMapPreference,
  persistMapPreference,
} from '../utils/mapLinks';
import { type TemperatureUnit } from '../utils/temperatureUnit';

export type AccountProfile = {
  firstName: string;
  lastName: string;
  email: string;
  homeAddress: string;
  preferredAirport: string;
  appearancePreference: AppearancePreference;
  temperatureUnit: TemperatureUnit;
  mapPreference?: MapApp;
  entitlements?: {
    costTracking?: boolean;
    aiItineraryGeneration?: boolean;
    aiAssistantGuide?: boolean;
  };
  tierKey?: string;
};

const EMPTY_PROFILE: AccountProfile = {
  firstName: '',
  lastName: '',
  email: '',
  homeAddress: '',
  preferredAirport: '',
  appearancePreference: 'auto',
  temperatureUnit: 'fahrenheit',
};

/**
 * Owns the account-profile state cluster previously held inline in App.tsx:
 *   - `accountProfile` object (firstName/lastName/email/homeAddress/preferredAirport/appearancePreference/temperatureUnit)
 *   - `mapApp` (standalone — read by map-link builders)
 *   - `appearancePreference` (standalone — drives the theme)
 *
 * Map and appearance preferences are duplicated: there is a standalone slice
 * that drives theme/map rendering, plus a copy nested inside `accountProfile`
 * that the account-form edits as a single record. `updateMapPreference` /
 * `updateAppearancePreference` keep both slices in sync AND persist to
 * localStorage in one step, matching the prior inline behavior exactly.
 */
export const useAccountProfile = () => {
  const [accountProfile, setAccountProfile] = useState<AccountProfile>(EMPTY_PROFILE);
  const [mapApp, setMapApp] = useState<MapApp>(() => loadStoredMapPreference('google'));
  const [appearancePreference, setAppearancePreference] = useState<AppearancePreference>(() =>
    loadStoredAppearancePreference('auto')
  );

  const updateMapPreference = useCallback((pref: MapApp) => {
    setMapApp(pref);
    persistMapPreference(pref);
    setAccountProfile((prev) => ({ ...prev, mapPreference: pref }));
  }, []);

  const updateAppearancePreference = useCallback((pref: AppearancePreference) => {
    setAppearancePreference(pref);
    persistAppearancePreference(pref);
    setAccountProfile((prev) => ({ ...prev, appearancePreference: pref }));
  }, []);

  const clearAccountProfile = useCallback(() => {
    setAccountProfile(EMPTY_PROFILE);
  }, []);

  return {
    accountProfile,
    mapApp,
    appearancePreference,
    setAccountProfile,
    setMapApp,
    setAppearancePreference,
    updateMapPreference,
    updateAppearancePreference,
    clearAccountProfile,
  };
};
