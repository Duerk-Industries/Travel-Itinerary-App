import React, { useState } from 'react';
import { ActivityIndicator, Linking, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { buildMapUrl, loadStoredMapPreference } from '../utils/mapLinks';

type Props = {
  backendUrl: string;
  headers: Record<string, string>;
  tripId: string;
  searchEnabled?: boolean;
  placesEnabled?: boolean;
  textColor?: string;
  mutedColor?: string;
  borderColor?: string;
  backgroundColor?: string;
};

const BlogDiscoveryPanel: React.FC<Props> = ({ backendUrl, headers, tripId, searchEnabled, placesEnabled, textColor = '#111827', mutedColor = '#6b7280', borderColor = '#d1d5db', backgroundColor = '#fff' }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [places, setPlaces] = useState<any[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  if (!searchEnabled && !placesEnabled) return null;

  const search = async (cursor: string | null = null) => {
    if (query.trim().length < 2 || busy) return;
    setBusy('search'); setNotice('');
    try {
      const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const response = await fetch(`${backendUrl}/api/trips/${tripId}/blog/search?q=${encodeURIComponent(query.trim())}${suffix}`, { headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to search');
      setResults((current) => cursor ? [...current, ...(data.results || [])] : (data.results || []));
      setNextCursor(data.nextCursor || null);
      setNotice((data.results || []).length ? '' : 'No matching entries.');
    } catch (error: any) { setNotice(error.message || 'Unable to search'); }
    finally { setBusy(null); }
  };

  const loadPlaces = async () => {
    if (busy) return;
    setBusy('places'); setNotice('');
    try {
      const response = await fetch(`${backendUrl}/api/trips/${tripId}/blog/places`, { headers });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to load places');
      setPlaces(data.places || []);
      setNotice((data.places || []).length ? '' : 'No places have been recorded yet.');
    } catch (error: any) { setNotice(error.message || 'Unable to load places'); }
    finally { setBusy(null); }
  };

  return (
    <View testID="blog-discovery-panel" style={{ borderWidth: 1, borderColor, borderRadius: 10, padding: 12, marginBottom: 16, backgroundColor }}>
      <Text style={{ color: textColor, fontWeight: '800', fontSize: 16 }}>Find a memory</Text>
      {searchEnabled ? (
        <View style={{ marginTop: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput testID="blog-search-input" accessibilityLabel="Search trip blog" value={query} onChangeText={(value) => { setQuery(value); setNextCursor(null); }} onSubmitEditing={() => search()} maxLength={100} placeholder="Search notes…" placeholderTextColor={mutedColor} style={{ flex: 1, minHeight: 44, borderWidth: 1, borderColor, borderRadius: 8, paddingHorizontal: 10, color: textColor }} />
            <TouchableOpacity testID="blog-search-submit" accessibilityRole="button" disabled={query.trim().length < 2 || Boolean(busy)} onPress={() => search()} style={{ minHeight: 44, minWidth: 70, borderRadius: 8, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }}>
              {busy === 'search' ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Search</Text>}
            </TouchableOpacity>
          </View>
          {results.map((result) => <View key={result.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: borderColor }}><Text style={{ color: textColor, fontWeight: '700' }}>{result.localDate}</Text><Text style={{ color: mutedColor }}>{result.snippet}</Text></View>)}
          {nextCursor ? <TouchableOpacity testID="blog-search-more" accessibilityRole="button" disabled={Boolean(busy)} onPress={() => search(nextCursor)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#2563eb', fontWeight: '700' }}>Load more matches</Text></TouchableOpacity> : null}
        </View>
      ) : null}
      {placesEnabled ? (
        <View style={{ marginTop: 12 }}>
          <TouchableOpacity testID="blog-load-places" accessibilityRole="button" disabled={Boolean(busy)} onPress={loadPlaces} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#2563eb', fontWeight: '700' }}>{busy === 'places' ? 'Loading places…' : places.length ? 'Refresh places' : 'Show every place visited'}</Text></TouchableOpacity>
          {places.map((place) => {
            const url = buildMapUrl(place.name, loadStoredMapPreference());
            return <TouchableOpacity key={`${place.name}:${place.firstDate}`} accessibilityRole="link" onPress={() => url && Linking.openURL(url)} style={{ minHeight: 44, justifyContent: 'center', borderTopWidth: 1, borderTopColor: borderColor }}><Text style={{ color: textColor, fontWeight: '700' }}>{place.name}</Text><Text style={{ color: mutedColor, fontSize: 12 }}>{[place.firstDate, `${place.occurrences} visit${place.occurrences === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</Text></TouchableOpacity>;
          })}
        </View>
      ) : null}
      {notice ? <Text accessibilityRole="alert" style={{ color: mutedColor, marginTop: 8 }}>{notice}</Text> : null}
    </View>
  );
};

export default BlogDiscoveryPanel;
