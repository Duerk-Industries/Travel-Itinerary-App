import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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
}) => {
  const [name, setName] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
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
      <Pressable style={styles.overlay} onPress={handleCancel} testID="place-dialog-overlay">
        <Pressable
          style={styles.dialog}
          onPress={(e: { stopPropagation: () => void }) => e.stopPropagation()}
          accessibilityRole={'dialog' as any}
          accessibilityLabel="Add a place"
          testID="place-dialog"
        >
          <Text style={styles.title}>Add a place</Text>
          <Text style={styles.label}>Place name</Text>
          <View style={styles.autocompleteWrap}>
            <View style={styles.autocompleteInputRow}>
              <TextInput
                testID="place-dialog-name"
                style={[styles.input, styles.autocompleteInput]}
                value={name}
                placeholder="e.g. Hagia Sophia"
                onChangeText={handleNameChange}
                autoFocus
              />
              {loading ? (
                <ActivityIndicator size="small" color="#2563eb" style={styles.loadingIndicator} testID="place-dialog-loading" />
              ) : null}
            </View>
            {showDropdown ? (
              <View style={styles.dropdownList} testID="place-dialog-suggestions">
                {suggestions.map((item) => (
                  <Pressable
                    key={`place-suggestion-${item.id}`}
                    testID={`place-dialog-suggestion-${item.id}`}
                    style={({ pressed }: { pressed: boolean }) => [styles.dropdownOption, pressed && styles.dropdownOptionPressed]}
                    onPress={() => handleSelectSuggestion(item)}
                  >
                    <Text style={styles.dropdownOptionText}>{item.name}</Text>
                    {item.destinationName ? (
                      <Text style={styles.dropdownOptionHelper}>{item.destinationName}</Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
          {!canSearch ? (
            <Text style={styles.searchHint}>
              Add a destination to this trip to search suggested places, or type a custom name below.
            </Text>
          ) : null}
          <Text style={styles.label}>Time (optional)</Text>
          <TextInput
            testID="place-dialog-time"
            style={styles.input}
            value={time}
            placeholder="e.g. 09:00"
            onChangeText={setTime}
          />
          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            testID="place-dialog-notes"
            style={[styles.input, styles.textarea]}
            value={notes}
            placeholder="Add details for this location"
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable testID="place-dialog-cancel" style={styles.btnGhost} onPress={handleCancel}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable testID="place-dialog-submit" style={styles.btnPrimary} onPress={handleSubmit}>
              <Text style={styles.btnPrimaryText}>Add place</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 8 },
  title: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: '#111827', backgroundColor: '#fff',
  },
  textarea: { minHeight: 88, textAlignVertical: 'top' },
  error: { color: '#dc2626', fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  btnGhost: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  btnGhostText: { color: '#374151', fontWeight: '600' },
  btnPrimary: { backgroundColor: '#2563eb', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
  autocompleteWrap: { position: 'relative', zIndex: 20 },
  autocompleteInputRow: { flexDirection: 'row', alignItems: 'center' },
  autocompleteInput: { flex: 1 },
  loadingIndicator: { marginLeft: 8 },
  searchHint: { fontSize: 11, color: '#6b7280', marginTop: -2 },
  dropdownList: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    maxHeight: 220,
    overflow: 'hidden',
    zIndex: 30,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
  },
  dropdownOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
  },
  dropdownOptionPressed: { backgroundColor: '#eff6ff' },
  dropdownOptionText: { fontSize: 14, color: '#111827', fontWeight: '500' },
  dropdownOptionHelper: { fontSize: 11, color: '#6b7280', marginTop: 2 },
});

export default PlacePickerDialog;
