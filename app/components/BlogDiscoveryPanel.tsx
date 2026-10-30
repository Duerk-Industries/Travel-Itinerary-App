import IconText from './IconText';
import { resolveComponentTheme as resolveStyleTheme, themeStyle } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useState } from 'react';
import { ActivityIndicator, Linking, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { buildMapUrl, loadStoredMapPreference } from '../utils/mapLinks';
import { createIdempotencyKey } from '../utils/idempotencyKey';

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
  /** Called after a rating is saved, so the blog can show the note it added. */
  onRated?: () => void;
};

const BlogDiscoveryPanel: React.FC<Props> = ({ backendUrl, headers, tripId, searchEnabled, placesEnabled, textColor: _textColorOverride, mutedColor: _mutedColorOverride, borderColor: _borderColorOverride, backgroundColor: _backgroundColorOverride, theme: _providedTheme, onRated }) => {
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
  // "Rate this place": a thumb and a written note, saved together.
  const [rating, setRating] = useState<{ key: string; thumb: 1 | -1 | null; note: string } | null>(null);
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

  const saveRating = async (place: any) => {
    if (!rating || busy) return;
    const note = rating.note.trim();
    if (rating.thumb === null && !note) { setNotice('Choose a thumb or write a note first.'); return; }
    if (note && !place.firstDate) { setNotice('This place has no date yet, so a note cannot be filed. Give it a thumb, or add the date to its activity.'); return; }
    setBusy('rate'); setNotice('');
    try {
      const parts: string[] = [];
      if (rating.thumb !== null) {
        const response = await fetch(`${backendUrl}/api/trips/${tripId}/blog/places/rating`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ place: place.name, value: rating.thumb }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Unable to save your thumb');
        parts.push(data.rated > 0 ? 'Your thumb is saved.' : data.matched > 0 ? "Your thumb will count once the activity is marked Completed." : 'No activity or stay is recorded for this place, so the thumb was not kept.');
      }
      if (note) {
        const mark = rating.thumb === 1 ? '👍 ' : rating.thumb === -1 ? '👎 ' : '';
        const response = await fetch(`${backendUrl}/api/trips/${tripId}/blog/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey('place-note'), ...headers },
          body: JSON.stringify({ kindKey: 'core.text', dayDate: place.firstDate, body: `<p><strong>${mark}${escapeHtml(place.name)}</strong></p><p>${escapeHtml(note)}</p>`, tags: ['Place rating'] }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`${parts.join(' ')} ${data.error || 'Your note could not be saved.'}`.trim());
        parts.push(`Your note is on ${place.firstDate}.`);
      }
      setNotice(parts.join(' '));
      setRating(null);
      onRated?.();
    } catch (error: any) { setNotice(error.message || 'Unable to save your rating'); }
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
            const placeKey = `${place.name}:${place.firstDate}`;
            const open = rating?.key === placeKey;
            return (
              <View key={placeKey}>
                <TouchableOpacity accessibilityRole="link" onPress={() => url && Linking.openURL(url)} style={themeStyle('components_BlogDiscoveryPanel_16', { borderColor: borderColor }, (theme ?? _styleTheme))}><Text style={themeStyle('components_BlogDiscoveryPanel_17', { textColor: textColor }, (theme ?? _styleTheme))}>{place.name}</Text><Text style={themeStyle('components_BlogDiscoveryPanel_18', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{[place.firstDate, `${place.occurrences} visit${place.occurrences === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</Text></TouchableOpacity>
                {!open ? (
                  <TouchableOpacity testID={`blog-rate-place-${places.indexOf(place)}`} accessibilityRole="button" accessibilityLabel={`Rate ${place.name}`} disabled={Boolean(busy)} onPress={() => setRating({ key: placeKey, thumb: null, note: '' })} style={themeStyle('components_BlogDiscoveryPanel_14', {  }, (theme ?? _styleTheme))}><Text style={themeStyle('components_BlogDiscoveryPanel_15', { accentColor: accentColor }, (theme ?? _styleTheme))}>Rate this place</Text></TouchableOpacity>
                ) : (
                  <View testID="blog-rate-form">
                    <View style={themeStyle('components_BlogDiscoveryPanel_4', {  }, (theme ?? _styleTheme))}>
                      {([1, -1] as const).map((value) => (
                        <TouchableOpacity key={value} testID={value === 1 ? 'blog-rate-up' : 'blog-rate-down'} accessibilityRole="button" accessibilityState={{ selected: rating?.thumb === value }} accessibilityLabel={value === 1 ? 'Thumbs up' : 'Thumbs down'} onPress={() => setRating((current) => current ? { ...current, thumb: current.thumb === value ? null : value } : current)} style={rating?.thumb === value ? themeStyle('components_BlogDiscoveryPanel_27', { accentColor: accentColor }, (theme ?? _styleTheme)) : themeStyle('components_BlogDiscoveryPanel_26', { borderColor: borderColor }, (theme ?? _styleTheme))}>
                          <IconText style={rating?.thumb === value ? themeStyle('components_BlogDiscoveryPanel_7', {  }, (theme ?? _styleTheme)) : themeStyle('components_BlogDiscoveryPanel_17', { textColor: textColor }, (theme ?? _styleTheme))}>{value === 1 ? '👍' : '👎'}</IconText>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput testID="blog-rate-note" accessibilityLabel={`Your note about ${place.name}`} multiline value={rating?.note ?? ''} onChangeText={(value) => setRating((current) => current ? { ...current, note: value } : current)} maxLength={2000} placeholder="What was it like? (optional)" placeholderTextColor={mutedColor} style={themeStyle('components_BlogDiscoveryPanel_28', { borderColor: borderColor, textColor: textColor }, (theme ?? _styleTheme))} />
                    <View style={themeStyle('components_BlogDiscoveryPanel_4', {  }, (theme ?? _styleTheme))}>
                      <TouchableOpacity testID="blog-rate-save" accessibilityRole="button" disabled={Boolean(busy)} onPress={() => saveRating(place)} style={themeStyle('components_BlogDiscoveryPanel_6', { accentColor: accentColor }, (theme ?? _styleTheme))}>
                        {busy === 'rate' ? <ActivityIndicator color={themeStyle('components_BlogDiscoveryPanel_25', {  }, (theme ?? _styleTheme))} /> : <Text style={themeStyle('components_BlogDiscoveryPanel_7', {  }, (theme ?? _styleTheme))}>Save</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity testID="blog-rate-cancel" accessibilityRole="button" disabled={Boolean(busy)} onPress={() => setRating(null)} style={themeStyle('components_BlogDiscoveryPanel_11', {  }, (theme ?? _styleTheme))}><Text style={themeStyle('components_BlogDiscoveryPanel_12', { accentColor: accentColor }, (theme ?? _styleTheme))}>Cancel</Text></TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ) : null}
      {notice ? <Text accessibilityRole="alert" style={themeStyle('components_BlogDiscoveryPanel_19', { mutedColor: mutedColor }, (theme ?? _styleTheme))}>{notice}</Text> : null}
    </View>
  );
};

export default BlogDiscoveryPanel;
