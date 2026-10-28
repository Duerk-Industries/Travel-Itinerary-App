import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import { shadowStyle } from '../utils/shadowStyle';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Modal from './KeyboardAwareModal';

import DateField from './DateField';

export type PlacePickerSubmit = {
  day: number;
  name: string;
  time?: string;
  notes?: string;
};

type PlaceSuggestion = {
  id: string;
  name: string;
  destinationName?: string;
};

export type PlacePickerDialogProps = {
  visible: boolean;
  defaultDay?: number;
  backendUrl: string;
  headers: Record<string, string>;
  selectedLocationIds?: string[];
  selectedLocationNames?: string[];
  onSubmit: (payload: PlacePickerSubmit) => void;
  onCancel: () => void;
  theme?: AppTheme;
};

const MIN_QUERY_CHARS = 2;
const DEBOUNCE_MS = 220;
const CACHE_TTL_MS = 5 * 60 * 1000;

const PlacePickerDialog: React.FC<PlacePickerDialogProps> = ({
  visible,
  defaultDay,
  backendUrl,
  headers,
  selectedLocationIds = [],
  selectedLocationNames = [],
  onSubmit,
  onCancel,
  theme: _providedTheme,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const [name, setName] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const colors = theme?.colors;
  const cacheRef = useRef<Map<string, { ts: number; results: PlaceSuggestion[] }>>(new Map());
  const lastSelectedRef = useRef<string | null>(null);

  const canSearch = selectedLocationIds.length > 0 || selectedLocationNames.length > 0;

  useEffect(() => {
    const q = name.trim();
    if (!q || q.length < MIN_QUERY_CHARS || !canSearch) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    if (lastSelectedRef.current === q) {
      // Field was just populated from a suggestion pick — don't reopen the dropdown.
      return;
    }
    const cacheKey = `${q.toLowerCase()}|${selectedLocationIds.join(',')}|${selectedLocationNames.join('|')}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setSuggestions(cached.results);
      setLoading(false);
      return;
    }
    setLoading(true);
    let active = true;
    const handle = setTimeout(async () => {
      try {
        const idsParam = selectedLocationIds.join(',');
        const namesParam = selectedLocationNames.join('|');
        const res = await fetch(
          `${backendUrl}/api/places/location-options?kind=attraction&q=${encodeURIComponent(q)}&limit=25&selectedIds=${encodeURIComponent(
            idsParam
          )}&selectedNames=${encodeURIComponent(namesParam)}`,
          { headers }
        );
        if (!res.ok) {
          if (active) setSuggestions([]);
          return;
        }
        const data = await res.json();
        if (!active) return;
        const next = (Array.isArray(data) ? data : []) as PlaceSuggestion[];
        cacheRef.current.set(cacheKey, { ts: Date.now(), results: next });
        setSuggestions(next);
      } catch {
        if (active) setSuggestions([]);
      } finally {
        if (active) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [name, canSearch, backendUrl, JSON.stringify(headers), selectedLocationIds.join(','), selectedLocationNames.join('|')]);

  const handleNameChange = (text: string) => {
    if (lastSelectedRef.current && text !== lastSelectedRef.current) {
      lastSelectedRef.current = null;
    }
    setName(text);
    if (error) setError('');
  };

  const handleSelectSuggestion = (item: PlaceSuggestion) => {
    lastSelectedRef.current = item.name;
    setName(item.name);
    setSuggestions([]);
  };

  const resetFields = () => {
    setName('');
    setTime('');
    setNotes('');
    setError('');
    setSuggestions([]);
    lastSelectedRef.current = null;
  };

  const handleSubmit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Place name is required');
      return;
    }
    const dayNum = defaultDay != null && Number.isFinite(defaultDay) && defaultDay >= 1 ? defaultDay : 1;
    onSubmit({
      day: Math.round(dayNum),
      name: trimmedName,
      time: time.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    resetFields();
  };

  const handleCancel = () => {
    resetFields();
    onCancel();
  };

  const showDropdown = suggestions.length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <Pressable style={styles((theme ?? _styleTheme)).overlay} onPress={handleCancel} testID="place-dialog-overlay">
        <Pressable
          style={[styles((theme ?? _styleTheme)).dialog, colors && themeStyle('components_PlacePickerDialog_1', { colors: colors }, (theme ?? _styleTheme))]}
          onPress={(e: { stopPropagation: () => void }) => e.stopPropagation()}
          accessibilityRole={'dialog' as any}
          accessibilityLabel="Add a place"
          testID="place-dialog"
        >
          <ScrollView
            testID="place-dialog-scroll"
            style={themeStyle('dialogScroll', {}, (theme ?? _styleTheme))}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
          <Text style={[styles((theme ?? _styleTheme)).title, colors && themeStyle('components_PlacePickerDialog_2', { colors: colors }, (theme ?? _styleTheme))]}>Add a place</Text>
          <Text style={[styles((theme ?? _styleTheme)).label, colors && themeStyle('components_PlacePickerDialog_3', { colors: colors }, (theme ?? _styleTheme))]}>Place name</Text>
          <View style={styles((theme ?? _styleTheme)).autocompleteWrap}>
            <View style={styles((theme ?? _styleTheme)).autocompleteInputRow}>
              <TextInput
                testID="place-dialog-name"
                style={[styles((theme ?? _styleTheme)).input, styles((theme ?? _styleTheme)).autocompleteInput, colors && themeStyle('components_PlacePickerDialog_4', { colors: colors }, (theme ?? _styleTheme))]}
                placeholderTextColor={colors?.textMuted}
                value={name}
                placeholder="e.g. Hagia Sophia"
                onChangeText={handleNameChange}
                autoFocus
              />
              {loading ? (
                <ActivityIndicator size="small" color={themeStyle('components_PlacePickerDialog_19', {  }, (theme ?? _styleTheme))} style={styles((theme ?? _styleTheme)).loadingIndicator} testID="place-dialog-loading" />
              ) : null}
            </View>
            {showDropdown ? (
              <ScrollView style={[styles((theme ?? _styleTheme)).dropdownList, colors && themeStyle('components_PlacePickerDialog_5', { colors: colors }, (theme ?? _styleTheme))]} nestedScrollEnabled keyboardShouldPersistTaps="handled" testID="place-dialog-suggestions">
                {suggestions.map((item) => (
                  <Pressable
                    key={`place-suggestion-${item.id}`}
                    testID={`place-dialog-suggestion-${item.id}`}
                    style={({ pressed }: { pressed: boolean }) => [styles((theme ?? _styleTheme)).dropdownOption, colors && themeStyle('components_PlacePickerDialog_6', { colors: colors }, (theme ?? _styleTheme)), pressed && themeStyle('components_PlacePickerDialog_7', { colors: colors }, (theme ?? _styleTheme))]}
                    onPress={() => handleSelectSuggestion(item)}
                  >
                    <Text style={[styles((theme ?? _styleTheme)).dropdownOptionText, colors && themeStyle('components_PlacePickerDialog_8', { colors: colors }, (theme ?? _styleTheme))]}>{item.name}</Text>
                    {item.destinationName ? (
                      <Text style={[styles((theme ?? _styleTheme)).dropdownOptionHelper, colors && themeStyle('components_PlacePickerDialog_9', { colors: colors }, (theme ?? _styleTheme))]}>{item.destinationName}</Text>
                    ) : null}
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>
          {!canSearch ? (
            <Text style={[styles((theme ?? _styleTheme)).searchHint, colors && themeStyle('components_PlacePickerDialog_10', { colors: colors }, (theme ?? _styleTheme))]}>
              Add a destination to this trip to search suggested places, or type a custom name below.
            </Text>
          ) : null}
          <Text style={[styles((theme ?? _styleTheme)).label, colors && themeStyle('components_PlacePickerDialog_11', { colors: colors }, (theme ?? _styleTheme))]}>Time (optional)</Text>
          <DateField
            mode="time"
            testID="place-dialog-time"
            accessibilityLabel="Time"
            styles={{
              input: [styles((theme ?? _styleTheme)).input, colors && themeStyle('components_PlacePickerDialog_12', { colors: colors }, (theme ?? _styleTheme))],
              cellText: themeStyle('components_PlacePickerDialog_13', { colors: colors }, (theme ?? _styleTheme)),
            }}
            theme={theme}
            value={time}
            placeholder="e.g. 09:00"
            onChange={setTime}
          />
          <Text style={[styles((theme ?? _styleTheme)).label, colors && themeStyle('components_PlacePickerDialog_14', { colors: colors }, (theme ?? _styleTheme))]}>Notes (optional)</Text>
          <TextInput
            testID="place-dialog-notes"
            style={[styles((theme ?? _styleTheme)).input, styles((theme ?? _styleTheme)).textarea, colors && themeStyle('components_PlacePickerDialog_15', { colors: colors }, (theme ?? _styleTheme))]}
            placeholderTextColor={colors?.textMuted}
            value={notes}
            placeholder="Add details for this location"
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
          />
          {error ? <Text style={[styles((theme ?? _styleTheme)).error, theme?.mode === 'dark' && themeStyle('components_PlacePickerDialog_16', {  }, (theme ?? _styleTheme))]}>{error}</Text> : null}
          <View style={styles((theme ?? _styleTheme)).actions}>
            <Pressable testID="place-dialog-cancel" style={styles((theme ?? _styleTheme)).btnGhost} onPress={handleCancel}>
              <Text style={[styles((theme ?? _styleTheme)).btnGhostText, colors && themeStyle('components_PlacePickerDialog_17', { colors: colors }, (theme ?? _styleTheme))]}>Cancel</Text>
            </Pressable>
            <Pressable testID="place-dialog-submit" style={styles((theme ?? _styleTheme)).btnPrimary} onPress={handleSubmit}>
              <Text style={styles((theme ?? _styleTheme)).btnPrimaryText}>Add place</Text>
            </Pressable>
          </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_PlacePickerDialog_18', { StyleSheet: StyleSheet, shadowStyle: shadowStyle }, _theme);

export default PlacePickerDialog;
