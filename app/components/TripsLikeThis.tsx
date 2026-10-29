import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, TouchableOpacity, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import { randomUUID } from 'expo-crypto';
import type { PublicTripInspiration, SharedActivityTemplate } from '../../server/src/types';

export default function TripsLikeThis({ tripId, date, backendUrl, headers, onAdded }: {
  tripId: string; date: string; backendUrl: string; headers: Record<string, string>; onAdded: () => void;
}) {
  const _styleTheme = useStyleTheme();
  const scope = `${backendUrl}:${JSON.stringify(headers)}:${tripId}:${date}`;
  const current = useRef(scope); current.current = scope;
  useEffect(() => () => { if (current.current === scope) current.current = ''; }, [scope]);
  const [result, setResult] = useState<{ scope: string; trips: PublicTripInspiration[] } | null>(null);
  const [enabledScope, setEnabledScope] = useState('');
  const [notice, setNotice] = useState<{ scope: string; text: string } | null>(null);
  const [pending, setPending] = useState('');
  const [added, setAdded] = useState<Record<string, string>>({});
  const keys = useRef(new Map<string, string>());
  const busy = useRef(new Set<string>());
  const sequence = useRef(0);
  const load = async (requestScope: string) => {
    const request = ++sequence.current;
    try {
      const response = await fetch(`${backendUrl}/api/trips/${encodeURIComponent(tripId)}/similar-trips`, { headers });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Trips like this could not load.');
      if (current.current === requestScope && request === sequence.current) setResult({ scope: requestScope, trips: Array.isArray(body.trips) ? body.trips : [] });
    } catch (error) {
      if (current.current === requestScope && request === sequence.current) {
        setResult(null); setNotice({ scope: requestScope, text: (error as Error).message });
      }
    }
  };
  useEffect(() => {
    let cancelled = false;
    let active = false;
    setResult(null); setNotice(null); setAdded({}); keys.current.clear(); setEnabledScope('');
    void (async () => {
      try {
        const response = await fetch(`${backendUrl}/api/trips/${encodeURIComponent(tripId)}/planning-capabilities`, { headers });
        if (!response.ok) return;
        const body = await response.json();
        if (cancelled || current.current !== scope || !body.inspiration) return;
        active = true; setEnabledScope(scope); await load(scope);
      } catch { /* A disabled/unavailable discovery surface does not block planning. */ }
    })();
    const refresh = () => { if (active && !cancelled && current.current === scope) void load(scope); };
    const app = AppState.addEventListener('change', state => { if (state === 'active') { setResult(null); refresh(); } });
    const interval = setInterval(() => { if (AppState.currentState === 'active') refresh(); }, 30_000);
    return () => { cancelled = true; clearInterval(interval); app?.remove(); };
  }, [scope]);

  const copy = async (source: PublicTripInspiration, activity: SharedActivityTemplate) => {
    const identity = `${scope}:${source.username}/${source.tripSlug}/${activity.id}`;
    if (busy.current.has(identity) || added[identity]) return;
    busy.current.add(identity); setPending(identity); setNotice(null);
    const key = keys.current.get(identity) ?? randomUUID(); keys.current.set(identity, key);
    try {
      const response = await fetch(`${backendUrl}/api/activities`, { method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ tripId, date, publicSource: { username: source.username, tripSlug: source.tripSlug, activityId: activity.id } }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not copy this activity. Retry uses the same request.');
      if (current.current !== scope) return;
      setAdded(previous => ({ ...previous, [identity]: body.id }));
      setNotice({ scope, text: `${activity.name} added to ${date}, with credit to the source blog.` }); onAdded();
    } catch (error) {
      if (current.current === scope) { setNotice({ scope, text: (error as Error).message }); void load(scope); }
    } finally { busy.current.delete(identity); if (current.current === scope) setPending(''); }
  };
  const undo = async (identity: string) => {
    if (busy.current.has(identity)) return;
    busy.current.add(identity); setPending(identity);
    try {
      const response = await fetch(`${backendUrl}/api/activities/${added[identity]}`, { method: 'DELETE', headers: { ...headers, 'Idempotency-Key': keys.current.get(identity)! } });
      if (!response.ok) throw new Error((await response.json()).error || 'This activity changed. Review it before removing it.');
      if (current.current !== scope) return;
      setAdded(previous => { const next = { ...previous }; delete next[identity]; return next; }); keys.current.delete(identity);
      setNotice({ scope, text: 'The copied activity was removed.' }); onAdded();
    } catch (error) { if (current.current === scope) setNotice({ scope, text: (error as Error).message }); }
    finally { busy.current.delete(identity); if (current.current === scope) setPending(''); }
  };
  const sharedTrips = result?.scope === scope ? result.trips.filter(source => source.activities?.length > 0) : [];
  if (enabledScope !== scope || !sharedTrips.length) return null;
  return <View accessibilityLabel="Trips like this" style={themeStyle('components_TripsLikeThis_1', {  }, _styleTheme)}>
    <Text style={themeStyle('components_TripsLikeThis_2', {  }, _styleTheme)}>Trips like this</Text>
    <Text tone="muted">Ideas shared by public blogs visiting the same destination. Copies are proposed activities; check current opening hours and availability.</Text>
    {notice?.scope === scope && <Text accessibilityRole="alert" accessibilityLiveRegion="polite">{notice.text}</Text>}
    {sharedTrips.map(source => <View key={`${source.username}/${source.tripSlug}`} style={themeStyle('components_TripsLikeThis_3', {  }, _styleTheme)}>
      <TouchableOpacity accessibilityRole="link" onPress={() => void Linking.openURL(`${backendUrl}${source.sourcePath}`)} style={themeStyle('components_TripsLikeThis_4', {  }, _styleTheme)}><Text tone="link" style={themeStyle('components_TripsLikeThis_5', {  }, _styleTheme)}>{source.title} · Source blog</Text></TouchableOpacity>
      {source.activities.map(activity => {
        const identity = `${scope}:${source.username}/${source.tripSlug}/${activity.id}`;
        return <View key={activity.id} style={themeStyle('components_TripsLikeThis_6', {  }, _styleTheme)}><Text>{activity.name} · {activity.activityType} · about {activity.duration}</Text>
          {activity.sourceUrl && <TouchableOpacity accessibilityRole="link" style={themeStyle('components_TripsLikeThis_7', {  }, _styleTheme)} onPress={() => void Linking.openURL(activity.sourceUrl!)}><Text tone="link">Catalog source</Text></TouchableOpacity>}
          <TouchableOpacity accessibilityRole="button" disabled={pending === identity} style={themeStyle('components_TripsLikeThis_8', {  }, _styleTheme)}
            onPress={() => void (added[identity] ? undo(identity) : copy(source, activity))}>
            <Text tone="link">{pending === identity ? 'Saving…' : added[identity] ? 'Added · Undo' : `Copy to ${date}`}</Text>
          </TouchableOpacity></View>;
      })}
    </View>)}
    <TouchableOpacity accessibilityRole="button" onPress={() => void load(scope)} style={themeStyle('components_TripsLikeThis_9', {  }, _styleTheme)}><Text tone="link">Refresh shared trips</Text></TouchableOpacity>
  </View>;
}
