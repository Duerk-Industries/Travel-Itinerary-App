import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Trip } from '../../server/src/types';

import { downloadOfflineTripSnapshot } from '../utils/downloadOfflineTripSnapshot';
import { estimateBytes, getConnectionCost, readWifiOnlyPreference, shouldWarnBeforeDownload } from '../utils/offlineDownloadPolicy';
import { loadOfflineTripCache, saveOfflineTripSnapshot, startOfflineAccessPeriod, type OfflineCacheOwner } from '../utils/offlineTripCache';
import { ThemedText as Text } from './ThemedText';

/**
 * Saving a trip for offline use is one flow with two places on screen: a download icon in the top bar starts it, and a
 * panel at the bottom of the page shows its progress, result and any question (shared-device and mobile-data prompts).
 * The "Wi-Fi only" choice for automatic refreshes lives in Account settings; this reads it fresh on every save.
 */
export type SaveTripOfflineController = {
  /** A trip is open and the person is signed in, so saving makes sense. */
  available: boolean;
  busy: boolean;
  disabled: boolean;
  notice: string | null;
  /** Web only: the shared-device warning that must be accepted before anything is stored. */
  confirmDevice: boolean;
  /** Set when saving would use mobile data and the person should choose first. */
  mobileWarning: string | null;
  start: () => Promise<void>;
  save: () => Promise<void>;
  acceptMobileData: () => void;
  waitForWifi: () => void;
  cancelDeviceConfirm: () => void;
  dismissNotice: () => void;
};

type Params = {
  trip: Pick<Trip, 'id' | 'groupId'> | null | undefined;
  trips: unknown[];
  groups: unknown[];
  owner: OfflineCacheOwner | null | undefined;
  token: string | null | undefined;
  costTrackingAllowed: boolean;
  disabled?: boolean;
};

export function useSaveTripOffline({ trip, trips, groups, owner, token, costTrackingAllowed, disabled = false }: Params): SaveTripOfflineController {
  const [confirmDevice, setConfirmDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mobileWarning, setMobileWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const available = Boolean(trip && owner && token);

  // A different trip, account or sign-in fences off anything still running and clears what was on screen.
  useEffect(() => {
    epoch.current += 1; setNotice(null); setConfirmDevice(false); setMobileWarning(null); setBusy(false); inFlight.current = false;
    return () => { epoch.current += 1; };
  }, [owner?.userId, owner?.environment, trip?.id, token]);

  const save = useCallback(async () => {
    setMobileWarning(null);
    if (!trip || !owner || !token || inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setConfirmDevice(false); setNotice('Downloading trip details…');
    const current = epoch.current;
    try {
      const previous = await loadOfflineTripCache(owner);
      const snapshot = await downloadOfflineTripSnapshot({ trip, backendUrl: owner.environment, token, costTrackingAllowed, useBundle: true, previous: previous?.snapshots[trip.id] });
      if (current !== epoch.current) return;
      // Extend access only after the server has authorized a complete download.
      await startOfflineAccessPeriod(owner);
      if (current !== epoch.current) return;
      await saveOfflineTripSnapshot(owner, snapshot, { trips, groups });
      if (current === epoch.current) {
        const serialized = JSON.stringify(snapshot);
        // Hermes builds without TextEncoder still report a conservative bound.
        const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(serialized).byteLength : serialized.length * 4;
        setNotice(`Saved up to ${Math.ceil(bytes / 1024)} KB · ${new Date().toLocaleString()}. Trip details are available offline; base maps need a connection.`);
      }
    } catch {
      if (current === epoch.current) setNotice('Could not save this trip. Your previous saved copy is still available. Check your connection and device storage, then try again.');
    } finally { if (current === epoch.current) { inFlight.current = false; setBusy(false); } }
  }, [trip, owner, token, costTrackingAllowed, disabled, trips, groups]);

  // Saving is always allowed on mobile data; the person is only asked first when they chose Wi-Fi only in Account
  // settings, or when the last saved copy of this trip was large.
  const start = useCallback(async () => {
    if (!trip || !owner || inFlight.current || disabled) return;
    const previous = await loadOfflineTripCache(owner).catch(() => null);
    const bytes = estimateBytes(previous?.snapshots[trip.id]);
    const wifiOnly = await readWifiOnlyPreference();
    if (shouldWarnBeforeDownload(wifiOnly, await getConnectionCost(), bytes)) {
      setMobileWarning(`You're on mobile data.${bytes ? ` This trip was about ${Math.ceil(bytes / 1024 / 1024 * 10) / 10} MB last time.` : ''} Save it now, or wait for Wi-Fi?`);
      return;
    }
    if (Platform.OS === 'web') setConfirmDevice(true); else void save();
  }, [trip, owner, disabled, save]);

  return {
    available, busy, disabled, notice, confirmDevice, mobileWarning, start, save,
    acceptMobileData: () => { setMobileWarning(null); if (Platform.OS === 'web') setConfirmDevice(true); else void save(); },
    waitForWifi: () => setMobileWarning(null),
    cancelDeviceConfirm: () => setConfirmDevice(false),
    dismissNotice: () => setNotice(null),
  };
}

const DownloadIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 22 }) => (
  // Material "file download" glyph: an arrow into a tray.
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path fill={color} d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z" />
  </Svg>
);

/** The top-bar button: a download icon with the same footprint as the notification bell beside it. */
export function OfflineSaveButton({ controller, theme: _providedTheme }: { controller: SaveTripOfflineController; theme?: AppTheme }) {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  if (!controller.available) return null;
  const off = controller.busy || controller.disabled;
  const color = theme?.colors.text ?? themeStyle('components_SaveTripOffline_17', {  }, (theme ?? _styleTheme));
  return <TouchableOpacity testID="offline-save-button" accessibilityRole="button" accessibilityLabel="Save this trip offline"
    accessibilityHint="Downloads this trip to this device so you can read it without a connection"
    accessibilityState={{ disabled: off, busy: controller.busy }} disabled={off}
    {...(Platform.OS === 'web' ? ({ title: 'Save this trip offline' } as object) : {})}
    onPress={() => void controller.start()} style={themeStyle('components_SaveTripOffline_1', { controller: controller }, (theme ?? _styleTheme))}>
    {controller.busy ? <ActivityIndicator size="small" color={color} /> : <DownloadIcon color={color} />}
  </TouchableOpacity>;
}

/**
 * Status and questions for the save, anchored to the bottom of the screen so they are seen without scrolling. Renders
 * nothing when there is nothing to say.
 */
export function OfflineSavePanel({ controller, theme: _providedTheme }: { controller: SaveTripOfflineController; theme?: AppTheme }) {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const { notice, confirmDevice, mobileWarning, busy } = controller;
  if (!controller.available || (!notice && !confirmDevice && !mobileWarning)) return null;
  const colors = theme?.colors;
  const primary = themeStyle('components_SaveTripOffline_2', { colors: colors }, (theme ?? _styleTheme));
  const secondary = themeStyle('components_SaveTripOffline_3', { colors: colors }, (theme ?? _styleTheme));
  const primaryText = themeStyle('components_SaveTripOffline_4', {  }, (theme ?? _styleTheme));
  const secondaryText = themeStyle('components_SaveTripOffline_5', { colors: colors }, (theme ?? _styleTheme));
  // Fixed on the web so it stays at the bottom of the window however far the page is scrolled.
  const placement = (Platform.OS === 'web' ? themeStyle('components_SaveTripOffline_6', {  }, (theme ?? _styleTheme)) : themeStyle('components_SaveTripOffline_7', {  }, (theme ?? _styleTheme))) as object;
  return <View pointerEvents="box-none" style={[themeStyle('components_SaveTripOffline_8', {  }, (theme ?? _styleTheme)), placement]}>
    <View testID="offline-save-panel" style={themeStyle('components_SaveTripOffline_9', { colors: colors }, (theme ?? _styleTheme))}>
      {mobileWarning && <View style={themeStyle('components_SaveTripOffline_10', {  }, (theme ?? _styleTheme))}>
        <Text accessibilityLiveRegion="polite">{mobileWarning}</Text>
        <View style={themeStyle('components_SaveTripOffline_11', {  }, (theme ?? _styleTheme))}>
          <TouchableOpacity accessibilityRole="button" style={primary} onPress={controller.acceptMobileData}><Text style={primaryText}>Save on mobile data</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={secondary} onPress={controller.waitForWifi}><Text style={secondaryText}>Wait for Wi-Fi</Text></TouchableOpacity>
        </View>
      </View>}
      {confirmDevice && <View style={themeStyle('components_SaveTripOffline_12', {  }, (theme ?? _styleTheme))}>
        <Text>This browser will keep private trip details on this device. Avoid saving on shared devices. Browser storage is not encrypted by WanderBunnies. Signing out removes saved trip copies.</Text>
        <View style={themeStyle('components_SaveTripOffline_13', {  }, (theme ?? _styleTheme))}>
          <TouchableOpacity accessibilityRole="button" style={primary} onPress={() => void controller.save()}><Text style={primaryText}>Save on this device</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" style={secondary} onPress={controller.cancelDeviceConfirm}><Text style={secondaryText}>Cancel offline save</Text></TouchableOpacity>
        </View>
      </View>}
      {notice && <View style={themeStyle('components_SaveTripOffline_14', {  }, (theme ?? _styleTheme))}>
        <Text accessibilityLiveRegion="polite" style={themeStyle('components_SaveTripOffline_15', {  }, (theme ?? _styleTheme))}>{notice}</Text>
        {!busy && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dismiss message" style={themeStyle('components_SaveTripOffline_16', {  }, (theme ?? _styleTheme))} onPress={controller.dismissNotice}><Text tone="link">Dismiss</Text></TouchableOpacity>}
      </View>}
    </View>
  </View>;
}
