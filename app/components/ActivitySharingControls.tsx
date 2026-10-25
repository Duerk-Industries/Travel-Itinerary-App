import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useEffect, useRef, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import type { SharedActivityTemplate } from '../../server/src/types';

/** Sharing is an independent opt-in, with the exact allowlist preview before enabling. */
export default function ActivitySharingControls({ tripId, backendUrl, headers }: {
  tripId: string; backendUrl: string; headers: Record<string, string>;
}) {
  const _styleTheme = useStyleTheme();
  const scope = `${backendUrl}:${tripId}:${JSON.stringify(headers)}`;
  const current = useRef(scope); current.current = scope;
  useEffect(() => () => { if (current.current === scope) current.current = ''; }, [scope]);
  const [state, setState] = useState<{ scope: string; enabled: boolean; activities: SharedActivityTemplate[] } | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false; setState(null); setPreview(false); setError('');
    void fetch(`${backendUrl}/api/trips/${tripId}/activity-sharing`, { headers }).then(async response => {
      if (!response.ok) return;
      const body = await response.json(); if (!cancelled) setState({ scope, ...body });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [scope]);
  const update = async (enabled: boolean) => {
    if (lock.current || (enabled && !preview)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`${backendUrl}/api/trips/${tripId}/activity-sharing`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Sharing could not be updated.');
      if (current.current === scope) { setState(previous => previous && { ...previous, enabled }); setPreview(false); }
    } catch (error) { if (current.current === scope) setError((error as Error).message); }
    finally { lock.current = false; if (current.current === scope) setBusy(false); }
  };
  if (state?.scope !== scope) return null;
  return <View style={themeStyle('components_ActivitySharingControls_1', {  }, _styleTheme)}>
    <Text style={themeStyle('components_ActivitySharingControls_2', {  }, _styleTheme)}>Share activity ideas: {state.enabled ? 'On' : 'Off'}</Text>
    <Text>When this blog is public and discoverable, other travelers can copy its catalog-backed activity ideas. Only public catalog names, categories, estimated durations and catalog coordinates are shared, now and for future catalog additions. Notes, costs, bookings, traveler details and private addresses are excluded. Existing copies remain after sharing stops.</Text>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    {state.enabled ? <TouchableOpacity accessibilityRole="button" disabled={busy} style={themeStyle('components_ActivitySharingControls_3', {  }, _styleTheme)} onPress={() => void update(false)}><Text>{busy ? 'Updating…' : 'Stop sharing activity ideas'}</Text></TouchableOpacity>
      : <TouchableOpacity accessibilityRole="button" disabled={busy} style={themeStyle('components_ActivitySharingControls_4', {  }, _styleTheme)} onPress={() => setPreview(value => !value)}><Text>Preview activity sharing</Text></TouchableOpacity>}
    {preview && <View style={themeStyle('components_ActivitySharingControls_5', {  }, _styleTheme)}>
      <Text>These public catalog ideas can be copied:</Text>
      {state.activities.map(activity => <Text key={activity.id}>{activity.name} · {activity.activityType} · {activity.duration}</Text>)}
      {!state.activities.length && <Text>No eligible catalog activities yet. Add an idea from Nearby first.</Text>}
      <TouchableOpacity accessibilityRole="button" disabled={busy || !state.activities.length} style={themeStyle('components_ActivitySharingControls_6', {  }, _styleTheme)} onPress={() => void update(true)}><Text>{busy ? 'Updating…' : 'Allow travelers to copy these activity ideas'}</Text></TouchableOpacity>
    </View>}
  </View>;
}
