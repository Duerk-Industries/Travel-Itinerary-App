import { resolveComponentTheme as resolveStyleTheme, themeStyle } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
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
  theme?: any;
};

const BlogDiscoveryPanel: React.FC<Props> = ({ backendUrl, headers, tripId, searchEnabled, placesEnabled, textColor: _textColorOverride, mutedColor: _mutedColorOverride, borderColor: _borderColorOverride, backgroundColor: _backgroundColorOverride, theme: _providedTheme }) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const textColor = _textColorOverride ?? themeStyle('components_BlogDiscoveryPanel_20', {  }, (theme ?? _styleTheme));
  const mutedColor = _mutedColorOverride ?? themeStyle('components_BlogDiscoveryPanel_21', {  }, (theme ?? _styleTheme));
  const borderColor = _borderColorOverride ?? themeStyle('components_BlogDiscoveryPanel_22', {  }, (theme ?? _styleTheme));
  const backgroundColor = _backgroundColorOverride ?? themeStyle('components_BlogDiscoveryPanel_23', {  }, (theme ?? _styleTheme));
  const accentColor = theme?.colors?.link ?? themeStyle('components_BlogDiscoveryPanel_24', {  }, (theme ?? _styleTheme));
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
    <View testID="blog-discovery-panel" style={themeStyle('components_BlogDiscoveryPanel_1', { borderColor: borderColor, backgroundColor: backgroundColor }, (theme ?? _styleTheme))}>
      <Text style={themeStyle('components_BlogDiscoveryPanel_2', { textColor: textColor }, (theme ?? _styleTheme))}>Find a memory</Text>
      {searchEnabled ? (
        <View style={themeStyle('components_BlogDiscoveryPanel_3', {  }, (theme ?? _styleTheme))}>
          <View style={themeStyle('components_BlogDiscoveryPanel_4', {  }, (theme ?? _styleTheme))}>
            <TextInput testID="blog-search-input" accessibilityLabel="Search trip blog" value={query} onChangeText={(value) => { setQuery(value); setNextCursor(null); }} onSubmitEditing={() => search()} maxLength={100} placeholder="Search notes…" placeholderTextColor={mutedColor} style={themeStyle('components_BlogDiscoveryPanel_5', { borderColor: borderColor, textColor: textColor }, (theme ?? _styleTheme))} />
            <TouchableOpacity testID="blog-search-submit" accessibilityRole="button" disabled={query.trim().length < 2 || Boolean(busy)} onPress={() => search()} style={themeStyle('components_BlogDiscoveryPanel_6', { accentColor: accentColor }, (theme ?? _styleTheme))}>
              {busy === 'search' ? <ActivityIndicator color={themeStyle('components_BlogDiscoveryPanel_25', {  }, (theme ?? _styleTheme))} /> : <Text style={themeStyle('components_BlogDiscoveryPanel_7', {  }, (theme ?? _styleTheme))}>Search</Text>}
            </TouchableOpacity>
          </View>
          {results.map((result) => <View key={result.id} style={themeStyle('components_BlogDiscoveryPanel_8', { borderColor: borderColor }, (theme ?? _styleTheme))}><Text style={themeStyle('components_BlogDiscoveryPanel_9', { textColor: textColor }, (theme ?? _styleTheme))}>{result.localDate}</Text><Text style={themeStyle('components_BlogDiscoveryPanel_10', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{result.snippet}</Text></View>)}
          {nextCursor ? <TouchableOpacity testID="blog-search-more" accessibilityRole="button" disabled={Boolean(busy)} onPress={() => search(nextCursor)} style={themeStyle('components_BlogDiscoveryPanel_11', {  }, (theme ?? _styleTheme))}><Text style={themeStyle('components_BlogDiscoveryPanel_12', { accentColor: accentColor }, (theme ?? _styleTheme))}>Load more matches</Text></TouchableOpacity> : null}
        </View>
      ) : null}
      {placesEnabled ? (
        <View style={themeStyle('components_BlogDiscoveryPanel_13', {  }, (theme ?? _styleTheme))}>
          <TouchableOpacity testID="blog-load-places" accessibilityRole="button" disabled={Boolean(busy)} onPress={loadPlaces} style={themeStyle('components_BlogDiscoveryPanel_14', {  }, (theme ?? _styleTheme))}><Text style={themeStyle('components_BlogDiscoveryPanel_15', { accentColor: accentColor }, (theme ?? _styleTheme))}>{busy === 'places' ? 'Loading places…' : places.length ? 'Refresh places' : 'Show every place visited'}</Text></TouchableOpacity>
          {places.map((place) => {
            const url = buildMapUrl(place.name, loadStoredMapPreference());
            return <TouchableOpacity key={`${place.name}:${place.firstDate}`} accessibilityRole="link" onPress={() => url && Linking.openURL(url)} style={themeStyle('components_BlogDiscoveryPanel_16', { borderColor: borderColor }, (theme ?? _styleTheme))}><Text style={themeStyle('components_BlogDiscoveryPanel_17', { textColor: textColor }, (theme ?? _styleTheme))}>{place.name}</Text><Text style={themeStyle('components_BlogDiscoveryPanel_18', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{[place.firstDate, `${place.occurrences} visit${place.occurrences === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</Text></TouchableOpacity>;
          })}
        </View>
      ) : null}
      {notice ? <Text accessibilityRole="alert" style={themeStyle('components_BlogDiscoveryPanel_19', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{notice}</Text> : null}
    </View>
  );
};

export default BlogDiscoveryPanel;
