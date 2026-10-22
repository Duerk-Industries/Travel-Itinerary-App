import React, { useEffect, useRef, useState } from 'react';
import { Linking, TextInput, TouchableOpacity, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import { useAppTheme } from '../theme/ThemeContext';
import { randomUUID } from 'expo-crypto';
import type { NearbyPlace, Activity } from '../../server/src/types';
import { GetYourGuideCta } from './GetYourGuideCta';

export default function NearbyPlacesPanel({ tripId, date, center, backendUrl, headers, onAdded, destination }: {
  tripId: string; date: string; center?: { lat: number; lng: number }; backendUrl: string;
  headers: Record<string, string>; onAdded?: () => void; destination?: string | null;
}) {
  const { colors } = useAppTheme();
  const [enabled, setEnabled] = useState(false);
  const [partner, setPartner] = useState(false);
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [area, setArea] = useState('');
  const [query, setQuery] = useState('');
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<Record<string, { activity: Activity; key: string }>>({});
  const keys = useRef<Record<string, string>>({});
  const busy = useRef(new Set<string>());
  const scope = `${backendUrl}:${JSON.stringify(headers)}:${tripId}:${date}:${center?.lat}:${center?.lng}:${query}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const auth = JSON.stringify(headers);
  useEffect(() => {
    let cancelled = false; setEnabled(false);
    void fetch(`${backendUrl}/api/trips/${encodeURIComponent(tripId)}/planning-capabilities`, { headers }).then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      if (!cancelled) { setEnabled(data.nearby === true); setPartner(data.partner === true); }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [backendUrl, tripId, auth]);
  const load = async (offset = 0) => {
    const requestScope = scope;
    setLoading(true); setError(null);
    const params = new URLSearchParams({ tripId, offset: String(offset), ...(query ? { area: query } : center ? { lat: String(center.lat), lng: String(center.lng) } : {}) });
    try {
      const response = await fetch(`${backendUrl}/api/activities/nearby?${params}`, { headers });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.places)) throw new Error(data.error || 'Nearby could not load.');
      if (scopeRef.current !== requestScope) return;
      setPlaces(previous => offset ? [...previous, ...data.places] : data.places); setNextOffset(data.nextOffset ?? null);
    } catch (error) { if (scopeRef.current === requestScope) setError((error as Error).message); }
    finally { if (scopeRef.current === requestScope) setLoading(false); }
  };
  useEffect(() => { setAdded({}); keys.current = {}; if (enabled) void load(); }, [enabled, scope, auth]);
  const add = async (place: NearbyPlace) => {
    if (busy.current.has(place.catalogId)) return;
    busy.current.add(place.catalogId); setPending(previous => ({ ...previous, [place.catalogId]: true })); setError(null);
    const key = keys.current[place.catalogId] ||= randomUUID();
    const requestScope = scope;
    try {
      const response = await fetch(`${backendUrl}/api/activities`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ tripId, date, catalogId: place.catalogId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not add this place. Retry uses the same request.');
      if (scopeRef.current === requestScope) setAdded(previous => ({ ...previous, [place.catalogId]: { activity: data, key } }));
      onAdded?.();
    } catch (error) { if (scopeRef.current === requestScope) setError((error as Error).message); }
    finally { busy.current.delete(place.catalogId); setPending(previous => ({ ...previous, [place.catalogId]: false })); }
  };
  const undo = async (id: string) => {
    const operation = added[id]; if (!operation || busy.current.has(id)) return;
    busy.current.add(id);
    try {
      const response = await fetch(`${backendUrl}/api/activities/${operation.activity.id}`, { method: 'DELETE', headers: { ...headers, 'Idempotency-Key': operation.key } });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not undo this addition.');
      setAdded(previous => { const next = { ...previous }; delete next[id]; return next; }); delete keys.current[id]; onAdded?.();
    } catch (error) { setError((error as Error).message); }
    finally { busy.current.delete(id); }
  };
  if (!enabled) return null;
  return <View style={{ padding: 12, gap: 10 }} accessibilityLabel="Nearby activities">
    <Text style={{ fontSize: 18, fontWeight: '700' }}>Nearby · {date}</Text>
    <Text tone="muted">Places within 2 km. Durations and travel times are estimates.</Text>
    <TextInput accessibilityLabel="Search another area" placeholder="Search another area by landmark" placeholderTextColor={colors.textMuted} value={area} onChangeText={setArea}
      style={{ color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 10, minHeight: 44 }} />
    <TouchableOpacity accessibilityRole="button" onPress={() => setQuery(area.trim())} style={{ minHeight: 44 }}><Text tone="link">Search another area</Text></TouchableOpacity>
    {error && <Text accessibilityRole="alert">{error}</Text>}
    {loading && <Text>Finding nearby places…</Text>}
    {!loading && !places.length && <Text>No nearby places in this catalog. Try another landmark or add an activity manually.</Text>}
    {places.map(place => <View key={place.catalogId} style={{ gap: 6, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 12 }}>
      <Text style={{ fontWeight: '700' }}>{place.name}</Text><Text tone="muted">{place.distanceMeters} m away · about {place.durationMinutes} min · {place.activityType}</Text>
      <Text>{place.description}</Text>
      {place.sourceUrl && <TouchableOpacity accessibilityRole="link" onPress={() => void Linking.openURL(place.sourceUrl!)}><Text tone="link">{place.sourceLabel || 'Source'}</Text></TouchableOpacity>}
      {added[place.catalogId] ? <TouchableOpacity accessibilityRole="button" onPress={() => void undo(place.catalogId)} style={{ minHeight: 44 }}><Text tone="link">Added to {date} · Undo</Text></TouchableOpacity>
        : <TouchableOpacity accessibilityRole="button" disabled={pending[place.catalogId]} onPress={() => void add(place)} style={{ minHeight: 44 }}><Text tone="link">{pending[place.catalogId] ? 'Adding…' : `Add to ${date}`}</Text></TouchableOpacity>}
      {partner && <><Text>Partner</Text><GetYourGuideCta backendUrl={backendUrl} headers={headers} activity={{ id: place.catalogId, name: place.name, activityType: place.activityType }} destination={destination} featureEnabled /></>}
    </View>)}
    {nextOffset !== null && <TouchableOpacity accessibilityRole="button" disabled={loading} onPress={() => void load(nextOffset)} style={{ minHeight: 44 }}><Text tone="link">More places</Text></TouchableOpacity>}
  </View>;
}
