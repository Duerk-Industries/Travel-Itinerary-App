import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { LocationOption } from './LocationSelector';
import DropdownOptionButton from './DropdownOptionButton';

export type AttractionOption = {
  id: string;
  sourceType: 'attraction';
  name: string;
  destinationId?: string;
  destinationName?: string;
  countryName?: string;
  stateName?: string;
  activityType?: string;
  budgetTier?: string;
};

type MustSeeAttractionSelectorProps = {
  backendUrl: string;
  headers: Record<string, string>;
  selectedLocations: LocationOption[];
  selectedAttractions: AttractionOption[];
  onAddAttraction: (attraction: AttractionOption) => void;
  onRemoveAttraction: (attractionId: string) => void;
  styles: Record<string, any>;
  placeholder?: string;
  title?: string;
};

const MustSeeAttractionSelectorComponent: React.FC<MustSeeAttractionSelectorProps> = ({
  backendUrl,
  headers,
  selectedLocations,
  selectedAttractions,
  onAddAttraction,
  onRemoveAttraction,
  styles,
  placeholder = 'Must See Attractions',
  title = 'Must See Attractions',
}) => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AttractionOption[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<any>(null);
  const addGuardRef = useRef<Set<string>>(new Set());
  const cacheRef = useRef<Map<string, { ts: number; results: AttractionOption[] }>>(new Map());
  const minChars = 2;
  const debounceMs = 220;
  const cacheTtlMs = 5 * 60 * 1000;

  const selectedAttractionIds = useMemo(
    () => new Set(selectedAttractions.map((item) => item.id)),
    [selectedAttractions]
  );
  const selectedLocationIds = useMemo(
    () => Array.from(new Set(selectedLocations.map((item) => String(item.id ?? '').trim()).filter(Boolean))),
    [selectedLocations]
  );
  const selectedLocationNames = useMemo(
    () => Array.from(new Set(selectedLocations.map((item) => String(item.name ?? '').trim()).filter(Boolean))),
    [selectedLocations]
  );
  const canSearch = selectedLocationNames.length > 0 || selectedLocationIds.length > 0;

  useEffect(() => {
    addGuardRef.current = new Set(selectedAttractions.map((item) => item.id));
  }, [selectedAttractions]);

  useEffect(() => {
    const q = query.trim();
    if (!q || q.length < minChars || !canSearch) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    const cacheKey = `${q.toLowerCase()}|${selectedLocationIds.join(',')}|${selectedLocationNames.join('|')}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.ts < cacheTtlMs) {
      setSuggestions(cached.results.filter((item) => !selectedAttractionIds.has(String(item.id))));
      setLoading(false);
      return;
    }
    setLoading(true);
    let active = true;
    const handle = setTimeout(async () => {
      try {
        const selectedIdsParam = selectedLocationIds.join(',');
        const selectedNamesParam = selectedLocationNames.join('|');
        const res = await fetch(
          `${backendUrl}/api/places/location-options?kind=attraction&q=${encodeURIComponent(q)}&limit=25&selectedIds=${encodeURIComponent(
            selectedIdsParam
          )}&selectedNames=${encodeURIComponent(selectedNamesParam)}`,
          { headers }
        );
        if (!res.ok) {
          if (active) setSuggestions([]);
          return;
        }
        const data = await res.json();
        if (!active) return;
        const next = (Array.isArray(data) ? data : []) as AttractionOption[];
        cacheRef.current.set(cacheKey, { ts: Date.now(), results: next });
        setSuggestions(next.filter((item) => !selectedAttractionIds.has(String(item.id))));
      } catch {
        if (active) setSuggestions([]);
      } finally {
        if (active) setLoading(false);
      }
    }, debounceMs);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [
    query,
    canSearch,
    backendUrl,
    JSON.stringify(headers),
    selectedAttractionIds,
    selectedLocationIds.join(','),
    selectedLocationNames.join('|'),
  ]);

  const addAttractions = (items: AttractionOption[]) => {
    const seen = new Set(addGuardRef.current);
    items.forEach((item) => {
      if (!seen.has(item.id)) {
        onAddAttraction(item);
        seen.add(item.id);
      }
    });
    addGuardRef.current = seen;
  };

  const handleAddSuggestion = (entry: AttractionOption) => {
    addAttractions([entry]);
    setQuery('');
    setSuggestions([]);
    inputRef.current?.focus();
  };

  const handleManualAdd = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const manual: AttractionOption = {
      id: `manual-attraction-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      sourceType: 'attraction',
      name: trimmed,
      // Only auto-tag when unambiguous (a single selected destination) — with
      // multiple destinations we can't guess which one a free-typed
      // attraction belongs to, and an untagged manual entry falls back to the
      // server's destination-verification pass instead of round-robin
      // placement.
      ...(selectedLocationNames.length === 1 ? { destinationName: selectedLocationNames[0] } : {}),
    };
    handleAddSuggestion(manual);
  };

  const handleSubmit = () => {
    if (!canSearch) return;
    if (!query.trim()) return;
    if (suggestions.length > 0) {
      handleAddSuggestion(suggestions[0]);
      return;
    }
    handleManualAdd();
  };

  const handleKeyPress = (e: any) => {
    if (Platform.OS === 'web') {
      if (e.nativeEvent.key === 'Tab' && query.trim()) {
        e.preventDefault();
        handleSubmit();
      }
    }
  };

  const helperLabel = (item: AttractionOption): string => {
    const destination = String(item.destinationName ?? '').trim();
    const tier = String(item.budgetTier ?? '').trim();
    if (destination && tier) return `${destination} - ${tier}`;
    if (destination) return destination;
    if (tier) return tier;
    return 'Attraction';
  };

  const showDropdown = suggestions.length > 0 || (query.trim().length > 0 && suggestions.length === 0 && canSearch);
  // zIndex must elevate on native too, not just web — otherwise this dropdown's absolutely
  // positioned suggestion list doesn't stack above sibling fields rendered after it (e.g.
  // LocationSelector's own dropdown, or later form rows), and the two visually overlap.
  const activeDropdownZIndex = showDropdown ? 800 : 1;

  return (
    <View style={{ marginTop: 12, position: 'relative', zIndex: activeDropdownZIndex }} testID="must-see-attraction-selector-root">
      <View style={[styles.row, { alignItems: 'flex-start', zIndex: activeDropdownZIndex }]}>
        <View style={[styles.dropdown, { flex: 1 }]}>
          <TextInput
            ref={inputRef}
            style={[styles.input, { flex: 1 }]}
            placeholder={placeholder}
            value={query}
            onChangeText={setQuery}
            onKeyPress={handleKeyPress}
            onSubmitEditing={handleSubmit}
            accessibilityLabel={title}
            editable={canSearch}
          />
          {showDropdown && (
            <View style={styles.dropdownList}>
              {suggestions.map((item) => (
                <DropdownOptionButton
                  key={`must-see-suggestion-${item.id}`}
                  styles={styles}
                  onPress={() => handleAddSuggestion(item)}
                  testID={`must-see-suggestion-${item.id}`}
                >
                  <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                    <Text style={styles.bodyText}>{item.name}</Text>
                    <Text style={styles.helperText}>{helperLabel(item)}</Text>
                  </View>
                </DropdownOptionButton>
              ))}
              {suggestions.length === 0 && query.trim().length > 0 && canSearch ? (
                <DropdownOptionButton
                  key="manual-must-see-option"
                  styles={styles}
                  onPress={handleManualAdd}
                  testID="manual-must-see-option"
                >
                  <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                    <Text style={styles.bodyText}>Add "{query.trim()}"</Text>
                    <Text style={styles.helperText}>Manual Attraction</Text>
                  </View>
                </DropdownOptionButton>
              ) : null}
            </View>
          )}
        </View>
        {loading && <ActivityIndicator size="small" color="#0d6efd" style={{ marginLeft: 8 }} testID="must-see-loading" />}
        <TouchableOpacity
          style={[styles.button, styles.smallButton, { marginLeft: 8 }]}
          onPress={handleSubmit}
          testID="add-must-see-button"
          disabled={!canSearch}
        >
          <Text style={styles.buttonText}>Add</Text>
        </TouchableOpacity>
      </View>

      {!canSearch && (
        <Text style={[styles.helperText, { marginTop: 4 }]}>
          Select at least one destination, country, or state to load attractions.
        </Text>
      )}

      {selectedAttractions.length > 0 && (
        <View style={[styles.row, { flexWrap: 'wrap', gap: 8, marginTop: 8 }]}>
          {selectedAttractions.map((item) => (
            <View key={`selected-attraction-${item.id}`} style={styles.payerChip} testID={`selected-attraction-${item.id}`}>
              <Text style={styles.cellText}>{item.name}</Text>
              <TouchableOpacity onPress={() => onRemoveAttraction(item.id)} testID={`remove-attraction-${item.id}`}>
                <Text style={styles.removeText}>x</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

export const MustSeeAttractionSelector = React.memo(MustSeeAttractionSelectorComponent);
