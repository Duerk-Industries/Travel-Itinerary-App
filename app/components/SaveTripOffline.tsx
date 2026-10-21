import React, { useEffect, useRef, useState } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import type { Trip } from '../../server/src/types';
import type { AppTheme } from '../theme/theme';
import { useLayoutBreakpoints } from '../hooks/useLayoutBreakpoints';
import { downloadOfflineTripSnapshot } from '../utils/downloadOfflineTripSnapshot';
import { estimateBytes, getConnectionCost, readWifiOnlyPreference, shouldWarnBeforeDownload, writeWifiOnlyPreference } from '../utils/offlineDownloadPolicy';
import { loadOfflineTripCache, saveOfflineTripSnapshot, startOfflineAccessPeriod, type OfflineCacheOwner } from '../utils/offlineTripCache';

export default function SaveTripOffline({ trip, trips, groups, owner, token, costTrackingAllowed, disabled, theme }: {
  trip: Pick<Trip, 'id' | 'groupId'>; trips: unknown[]; groups: unknown[];
  owner: OfflineCacheOwner; token: string; costTrackingAllowed: boolean; disabled?: boolean; theme?: AppTheme;
}) {
  const { isPhoneLayout } = useLayoutBreakpoints();
  const [menuOpen, setMenuOpen] = useState(false);
  const colors = theme?.colors;
  // Same look as the page's primary and secondary buttons; plain defaults when no theme is passed.
  const primary = { backgroundColor: colors?.cta ?? '#F59E0B', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 6, alignItems: 'center' as const, justifyContent: 'center' as const, minHeight: 44 };
  const secondary = { backgroundColor: colors?.surfaceMuted ?? '#F1F5F9', borderWidth: 1, borderColor: colors?.border ?? '#CBD5E1', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 6, alignItems: 'center' as const, justifyContent: 'center' as const, minHeight: 44 };
  const primaryText = { color: '#0B1726', fontWeight: '700' as const };
  const secondaryText = { color: colors?.text ?? '#0F172A', fontWeight: '700' as const };
  const textColor = { color: colors?.text ?? '#0F172A' };
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  const [mobileWarning, setMobileWarning] = useState<string | null>(null);
  const [wifiOnly, setWifiOnly] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const epoch = useRef(0), inFlight = useRef(false);
  useEffect(() => {
    epoch.current += 1; setNotice(null); setConfirm(false); setMobileWarning(null); setBusy(false); inFlight.current = false;
    return () => { epoch.current += 1; };
  }, [owner.userId, owner.environment, trip.id, token]);
  useEffect(() => {
    let cancelled = false;
    void readWifiOnlyPreference().then(value => { if (!cancelled) setWifiOnly(value); });
    return () => { cancelled = true; };
  }, []);
  const toggleWifiOnly = () => {
    const next = !wifiOnly;
    setWifiOnly(next);
    void writeWifiOnlyPreference(next);
  };
  // Saving is always allowed on mobile data; we only ask first when the user chose
  // Wi-Fi only or the last saved copy of this trip was large.
  const start = async () => {
    if (inFlight.current || disabled) return;
    const previous = await loadOfflineTripCache(owner).catch(() => null);
    const bytes = estimateBytes(previous?.snapshots[trip.id]);
    if (shouldWarnBeforeDownload(wifiOnly, await getConnectionCost(), bytes)) {
      setMobileWarning(`You're on mobile data.${bytes ? ` This trip was about ${Math.ceil(bytes / 1024 / 1024 * 10) / 10} MB last time.` : ''} Save it now, or wait for Wi-Fi?`);
      return;
    }
    if (Platform.OS === 'web') setConfirm(true); else void save();
  };
  const save = async () => {
    setMobileWarning(null);
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setConfirm(false); setNotice('Downloading trip details…');
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
  };
  const saveButton = <TouchableOpacity accessibilityRole="button" disabled={busy || disabled} accessibilityState={{ disabled: busy || disabled, busy }}
    style={[primary, (busy || disabled) && { opacity: 0.6 }]} onPress={() => { setMenuOpen(false); void start(); }}>
    <Text style={primaryText}>{busy ? 'Saving offline copy…' : 'Save this trip offline'}</Text>
  </TouchableOpacity>;
  const wifiButton = <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: wifiOnly }}
    accessibilityLabel="Download over Wi-Fi only" style={secondary} onPress={toggleWifiOnly}>
    <Text style={secondaryText}>{wifiOnly ? '☑' : '☐'} Update saved trips over Wi-Fi only</Text>
  </TouchableOpacity>;
  return <View style={{ padding: 8, gap: 8, alignItems: 'center' }}>
    {isPhoneLayout ? <View style={{ alignSelf: 'stretch', gap: 8 }}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Offline options" accessibilityState={{ expanded: menuOpen }}
        style={[secondary, { flexDirection: 'row', justifyContent: 'space-between' }]} onPress={() => setMenuOpen(open => !open)}>
        <Text style={secondaryText}>Offline options</Text><Text style={secondaryText}>{menuOpen ? '▴' : '▾'}</Text>
      </TouchableOpacity>
      {menuOpen && <View style={{ gap: 8 }}>{saveButton}{wifiButton}</View>}
    </View> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>{saveButton}{wifiButton}</View>}
    {mobileWarning && <View style={{ gap: 8 }}>
      <Text accessibilityLiveRegion="polite" style={textColor}>{mobileWarning}</Text>
      <TouchableOpacity accessibilityRole="button" style={primary}
        onPress={() => { setMobileWarning(null); if (Platform.OS === 'web') setConfirm(true); else void save(); }}><Text style={primaryText}>Save on mobile data</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" style={secondary} onPress={() => setMobileWarning(null)}><Text style={secondaryText}>Wait for Wi-Fi</Text></TouchableOpacity>
    </View>}
    {confirm && <View style={{ gap: 8 }}>
      <Text style={textColor}>This browser will keep private trip details on this device. Avoid saving on shared devices. Browser storage is not encrypted by WanderBunnies. Signing out removes saved trip copies.</Text>
      <TouchableOpacity accessibilityRole="button" style={primary} onPress={() => void save()}><Text style={primaryText}>Save on this device</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" style={secondary} onPress={() => setConfirm(false)}><Text style={secondaryText}>Cancel offline save</Text></TouchableOpacity>
    </View>}
    {notice && <Text accessibilityLiveRegion="polite" style={textColor}>{notice}</Text>}
  </View>;
}
