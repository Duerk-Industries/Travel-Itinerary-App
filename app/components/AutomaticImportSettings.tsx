import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import type { RecentAutoAssignment } from '../../server/src/ingestion/shared/repository';

export default function AutomaticImportSettings({ backendUrl, headers, onChanged }: {
  backendUrl: string; headers: Record<string, string>; onChanged?: () => void;
}) {
  const _styleTheme = useStyleTheme();
  const [setting, setSetting] = useState<{ available: boolean; enabled: boolean; choice: boolean | null } | null>(null);
  const [recent, setRecent] = useState<RecentAutoAssignment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false), epoch = useRef(0);
  const auth = headers.Authorization;
  const load = useCallback(async () => {
    const current = epoch.current;
    try {
      const [settings, items] = await Promise.all([
        fetch(`${backendUrl}/api/ingestion/settings`, { headers }),
        fetch(`${backendUrl}/api/ingestion/auto-added`, { headers }),
      ]);
      if (!settings.ok || !items.ok) return;
      const [data, history] = await Promise.all([settings.json(), items.json()]);
      if (current !== epoch.current) return;
      setSetting(data.autoAssign ?? null); setRecent(Array.isArray(history.items) ? history.items : []);
    } catch { /* Older servers keep manual import available. */ }
  }, [backendUrl, auth]);
  useEffect(() => {
    epoch.current += 1; setSetting(null); setRecent([]); setError(null); void load();
    return () => { epoch.current += 1; };
  }, [load]);
  const act = async (path: string, method: string, body?: unknown) => {
    if (busy.current) return;
    busy.current = true;
    const current = epoch.current;
    try {
      const response = await fetch(`${backendUrl}/api/ingestion/${path}`, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await response.json();
      if (current !== epoch.current) return;
      if (!response.ok) throw new Error(data.error || 'The change could not be saved. Please try again.');
      setError(null); await load(); if (current === epoch.current) onChanged?.();
    } catch (error) { if (current === epoch.current) setError((error as Error).message); }
    finally { busy.current = false; }
  };
  if (!setting?.available && !recent.length) return null;
  return <View style={themeStyle('components_AutomaticImportSettings_1', {  }, _styleTheme)}>
    <Text accessibilityRole="header">Automatically added bookings</Text>
    <Text>When enabled, an uploaded booking with one strong trip match can be added for you. Uncertain bookings need your review. Forwarded email still needs review. Undo is available for seven days unless someone edits the booking or its finances.</Text>
    {setting?.available && <TouchableOpacity accessibilityRole="switch" accessibilityLabel="Automatically add matching bookings"
      accessibilityState={{ checked: setting.enabled }} style={themeStyle('components_AutomaticImportSettings_2', {  }, _styleTheme)}
      onPress={() => void act('settings', 'PUT', { autoAssign: !setting.enabled })}>
      <Text>Automatically add matching bookings: {setting.enabled ? 'On' : 'Off'}</Text>
    </TouchableOpacity>}
    {error && <Text accessibilityRole="alert">{error}</Text>}
    <TouchableOpacity accessibilityRole="button" style={themeStyle('components_AutomaticImportSettings_3', {  }, _styleTheme)} onPress={() => void load()}><Text>Refresh automatically added bookings</Text></TouchableOpacity>
    {recent.map(row => <View key={row.item.id}>
      <Text>{row.item.providerVendor || row.item.itemType} · Added to {row.tripName || 'your trip'}</Text>
      <Text>{row.reasons.join(' · ')} · Undo until {new Date(row.undoExpiresAt).toLocaleString()}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Undo ${row.item.providerVendor || row.item.itemType}`}
        style={themeStyle('components_AutomaticImportSettings_4', {  }, _styleTheme)} onPress={() => void act(`review-items/${encodeURIComponent(row.item.id)}/undo`, 'POST')}><Text>Undo</Text></TouchableOpacity>
    </View>)}
  </View>;
}
