import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, TextInput, Text, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import DropdownOptionButton from './DropdownOptionButton';

export type LocationOption = {
  id: string;
  sourceType: 'country' | 'state' | 'city' | 'destination';
  name: string;
  countryId?: string;
  countryName?: string;
  stateId?: string;
  stateName?: string;
};

type LocationSelectorProps = {
  backendUrl: string;
  headers: Record<string, string>;
  selectedLocations: LocationOption[];
  onAddLocation: (location: LocationOption) => void;
  onRemoveLocation: (locationId: string) => void;
  onNext?: () => void;
  styles: Record<string, any>;
  placeholder?: string;
  title?: string;
  locationSearchKind?: 'country_state' | 'country_destination' | 'destination';
  showCitySearch?: boolean;
};

const LocationSelectorComponent: React.FC<LocationSelectorProps> = ({
  backendUrl,
  headers,
  selectedLocations,
  onAddLocation,
  onRemoveLocation,
  onNext,
  styles,
  placeholder = "Search countries or states",
  title = "Search countries or states",
  locationSearchKind = 'country_state',
  showCitySearch = true,
}) => {
  const [countryStateQuery, setCountryStateQuery] = useState('');
  const [countryStateSuggestions, setCountryStateSuggestions] = useState<LocationOption[]>([]);
  const [countryStateLoading, setCountryStateLoading] = useState(false);
  const [cityQuery, setCityQuery] = useState('');
  const [citySuggestions, setCitySuggestions] = useState<LocationOption[]>([]);
  const [cityLoading, setCityLoading] = useState(false);
  const countryStateInputRef = useRef<any>(null);
  const cityInputRef = useRef<any>(null);
  const addGuardRef = useRef<Set<string>>(new Set());
  const countryStateCacheRef = useRef<Map<string, { ts: number; results: LocationOption[] }>>(new Map());
  const cityCacheRef = useRef<Map<string, { ts: number; results: LocationOption[] }>>(new Map());
  const cacheTtlMs = 5 * 60 * 1000;
  const countryStateMinChars = 2;
  const cityMinChars = 2;
  const debounceMs = 220;

  const selectedIds = useMemo(() => new Set(selectedLocations.map((item) => item.id)), [selectedLocations]);
  const selectedCountryIds = useMemo(
    () => selectedLocations.filter((item) => item.sourceType === 'country').map((item) => item.id),
    [selectedLocations]
  );
  const selectedStateIds = useMemo(
    () => selectedLocations.filter((item) => item.sourceType === 'state').map((item) => item.id),
    [selectedLocations]
  );
  const canSearchCities = showCitySearch && (selectedCountryIds.length > 0 || selectedStateIds.length > 0);

  useEffect(() => {
    addGuardRef.current = new Set(selectedLocations.map((item) => item.id));
  }, [selectedLocations]);

  useEffect(() => {
    const q = countryStateQuery.trim();
    if (!q || q.length < countryStateMinChars) {
      setCountryStateSuggestions([]);
      setCountryStateLoading(false);
      return;
    }
    const cacheKey = q.toLowerCase();
    const cached = countryStateCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.ts < cacheTtlMs) {
      setCountryStateSuggestions(cached.results.filter((item) => !selectedIds.has(String(item.id))));
      setCountryStateLoading(false);
      return;
    }
    setCountryStateLoading(true);
    let active = true;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `${backendUrl}/api/places/location-options?kind=${encodeURIComponent(locationSearchKind)}&q=${encodeURIComponent(q)}&limit=20`,
          { headers }
        );
        if (!res.ok) {
          if (active) setCountryStateSuggestions([]);
          return;
        }
        const data = await res.json();
        if (!active) return;
        const next = Array.isArray(data) ? data : [];
        countryStateCacheRef.current.set(cacheKey, { ts: Date.now(), results: next });
        setCountryStateSuggestions(next.filter((item: LocationOption) => !selectedIds.has(String(item.id))));
      } catch {
        if (active) setCountryStateSuggestions([]);
      } finally {
        if (active) setCountryStateLoading(false);
      }
    }, debounceMs);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [countryStateQuery, backendUrl, JSON.stringify(headers), selectedIds, countryStateMinChars, debounceMs, locationSearchKind]);

  useEffect(() => {
    if (!showCitySearch) {
      setCitySuggestions([]);
      setCityLoading(false);
      return;
    }
    const q = cityQuery.trim();
    if (!q || q.length < cityMinChars || !canSearchCities) {
      setCitySuggestions([]);
      setCityLoading(false);
      return;
    }
    const cacheKey = `${q.toLowerCase()}|${selectedCountryIds.join(',')}|${selectedStateIds.join(',')}`;
    const cached = cityCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.ts < cacheTtlMs) {
      setCitySuggestions(cached.results.filter((item) => !selectedIds.has(String(item.id))));
      setCityLoading(false);
      return;
    }
    setCityLoading(true);
    let active = true;
    const handle = setTimeout(async () => {
      try {
        const countryIds = selectedCountryIds.join(',');
        const stateIds = selectedStateIds.join(',');
        const res = await fetch(
          `${backendUrl}/api/places/location-options?kind=city&q=${encodeURIComponent(q)}&limit=25&countryIds=${encodeURIComponent(countryIds)}&stateIds=${encodeURIComponent(stateIds)}`,
          { headers }
        );
        if (!res.ok) {
          if (active) setCitySuggestions([]);
          return;
        }
        const data = await res.json();
        if (!active) return;
        const next = Array.isArray(data) ? data : [];
        cityCacheRef.current.set(cacheKey, { ts: Date.now(), results: next });
        setCitySuggestions(next.filter((item: LocationOption) => !selectedIds.has(String(item.id))));
      } catch {
        if (active) setCitySuggestions([]);
      } finally {
        if (active) setCityLoading(false);
      }
    }, debounceMs);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [cityQuery, backendUrl, JSON.stringify(headers), selectedIds, selectedCountryIds.join('|'), selectedStateIds.join('|'), canSearchCities, cityMinChars, debounceMs, showCitySearch]);

  const addLocations = (items: LocationOption[]) => {
    const seen = new Set(addGuardRef.current);
    items.forEach((item) => {
      if (!seen.has(item.id)) {
        onAddLocation(item);
        seen.add(item.id);
      }
    });
    addGuardRef.current = seen;
  };

  const buildCountryOption = (id?: string, name?: string): LocationOption | null => {
    if (!id || !name) return null;
    return { id, name, sourceType: 'country' };
  };

  const buildStateOption = (id?: string, name?: string, countryId?: string, countryName?: string): LocationOption | null => {
    if (!id || !name) return null;
    return { id, name, sourceType: 'state', countryId, countryName };
  };

  const normalizeName = (value?: string) => String(value ?? '').trim().toLowerCase();

  const handleAddCountryState = (loc: LocationOption) => {
    const toAdd: LocationOption[] = [];
    if (loc.sourceType === 'state') {
      const stateName = normalizeName(loc.name);
      const countryName = normalizeName(loc.countryName);
      const countryOption = buildCountryOption(loc.countryId, loc.countryName);
      if (countryOption) toAdd.push(countryOption);
      if (stateName && countryName && stateName === countryName) {
        addLocations(toAdd);
        setCountryStateQuery('');
        setCountryStateSuggestions([]);
        countryStateInputRef.current?.focus();
        return;
      }
    }
    toAdd.push(loc);
    addLocations(toAdd);
    setCountryStateQuery('');
    setCountryStateSuggestions([]);
    countryStateInputRef.current?.focus();
  };

  const handleAddCity = (loc: LocationOption) => {
    addLocations([loc]);
    setCityQuery('');
    setCitySuggestions([]);
    cityInputRef.current?.focus();
  };

  const handleCountryStateManualAdd = () => {
    const trimmed = countryStateQuery.trim();
    if (!trimmed) return;
    const manualLocation: LocationOption = {
      id: `manual-country-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      sourceType: 'country',
      name: trimmed,
    };
    handleAddCountryState(manualLocation);
  };

  const handleCityManualAdd = () => {
    const trimmed = cityQuery.trim();
    if (!trimmed) return;
    const manualLocation: LocationOption = {
      id: `manual-city-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      sourceType: 'city',
      name: trimmed,
    };
    handleAddCity(manualLocation);
  };

  const handleCountryStateSubmit = () => {
    if (countryStateQuery.trim()) {
      if (countryStateSuggestions.length > 0) {
        handleAddCountryState(countryStateSuggestions[0]);
      } else {
        handleCountryStateManualAdd();
      }
    } else {
      onNext?.();
    }
  };

  const handleCitySubmit = () => {
    if (!showCitySearch) return;
    if (!canSearchCities) return;
    if (cityQuery.trim()) {
      if (citySuggestions.length > 0) {
        handleAddCity(citySuggestions[0]);
      } else {
        handleCityManualAdd();
      }
    }
  };

  const handleCountryStateKeyPress = (e: any) => {
    if (Platform.OS === 'web') {
      if (e?.nativeEvent?.key === 'Tab' && countryStateQuery.trim()) {
        e.preventDefault();
        handleCountryStateSubmit();
      }
    }
  };

  const handleCityKeyPress = (e: any) => {
    if (Platform.OS === 'web') {
      if (e?.nativeEvent?.key === 'Tab' && cityQuery.trim()) {
        e.preventDefault();
        handleCitySubmit();
      }
    }
  };

  const labelForType = (sourceType: LocationOption['sourceType']) => {
    if (sourceType === 'city') return 'City';
    if (sourceType === 'state') return 'State';
    if (sourceType === 'destination') return 'Destination';
    return 'Country';
  };

  const showCountryStateDropdown =
    countryStateSuggestions.length > 0 || (countryStateQuery.trim().length > 0 && countryStateSuggestions.length === 0);
  const showCityDropdown =
    citySuggestions.length > 0 || (cityQuery.trim().length > 0 && citySuggestions.length === 0 && canSearchCities);
  // zIndex must elevate on native too, not just web — otherwise this dropdown's absolutely
  // positioned suggestion list doesn't stack above sibling fields rendered after it (e.g.
  // MustSeeAttractionSelector, or later form rows), and the two visually overlap.
  const activeDropdownZIndex = showCountryStateDropdown || showCityDropdown ? 800 : 1;

  return (
    <View style={{ position: 'relative', zIndex: activeDropdownZIndex }} testID="location-selector-root">
      <View style={[styles.row, { alignItems: 'flex-start', zIndex: showCountryStateDropdown ? activeDropdownZIndex : 1 }]}>
        <View style={[styles.dropdown, { flex: 1 }]}>
          <TextInput
            ref={countryStateInputRef}
            style={[styles.input, { flex: 1 }]}
            placeholder={placeholder}
            value={countryStateQuery}
            onChangeText={setCountryStateQuery}
            onKeyPress={handleCountryStateKeyPress}
            onSubmitEditing={handleCountryStateSubmit}
            accessibilityLabel={title}
          />
          {showCountryStateDropdown && (
            <View style={styles.dropdownList}>
              {countryStateSuggestions.map((location) => (
                <DropdownOptionButton
                  key={`location-suggestion-${location.id}`}
                  styles={styles}
                  onPress={() => handleAddCountryState(location)}
                  testID={`location-suggestion-${location.id}`}
                >
                  <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                    <Text style={styles.bodyText}>{location.name}</Text>
                    <Text style={styles.helperText}>{labelForType(location.sourceType)}</Text>
                  </View>
                </DropdownOptionButton>
              ))}
              {countryStateSuggestions.length === 0 && countryStateQuery.trim().length > 0 ? (
                <DropdownOptionButton
                  key="manual-country-option"
                  styles={styles}
                  onPress={handleCountryStateManualAdd}
                  testID="manual-country-option"
                >
                  <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                    <Text style={styles.bodyText}>Add "{countryStateQuery.trim()}"</Text>
                    <Text style={styles.helperText}>Manual Country</Text>
                  </View>
                </DropdownOptionButton>
              ) : null}
            </View>
          )}
        </View>
        {countryStateLoading && (
          <ActivityIndicator size="small" color="#0d6efd" style={{ marginLeft: 8, marginTop: 10 }} testID="country-state-loading" />
        )}
        <TouchableOpacity 
            style={[styles.button, styles.smallButton, { marginLeft: 8 }]} 
            onPress={handleCountryStateSubmit}
            testID="add-country-state-button"
        >
            <Text style={styles.buttonText}>Add</Text>
        </TouchableOpacity>
      </View>

      {showCitySearch && (
        <>
          <View style={[styles.row, { alignItems: 'flex-start', marginTop: 12, zIndex: showCityDropdown ? activeDropdownZIndex : 1 }]}>
            <View style={[styles.dropdown, { flex: 1 }]}>
              <TextInput
                ref={cityInputRef}
                style={[styles.input, { flex: 1 }]}
                placeholder="Search cities"
                value={cityQuery}
                onChangeText={setCityQuery}
                onKeyPress={handleCityKeyPress}
                onSubmitEditing={handleCitySubmit}
                accessibilityLabel="Search cities"
                editable={canSearchCities}
              />
              {showCityDropdown && (
                <View style={styles.dropdownList}>
                  {citySuggestions.map((location) => (
                    <DropdownOptionButton
                      key={`city-suggestion-${location.id}`}
                      styles={styles}
                      onPress={() => handleAddCity(location)}
                      testID={`city-suggestion-${location.id}`}
                    >
                      <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                        <Text style={styles.bodyText}>{location.name}</Text>
                        <Text style={styles.helperText}>City</Text>
                      </View>
                    </DropdownOptionButton>
                  ))}
                  {citySuggestions.length === 0 && cityQuery.trim().length > 0 && canSearchCities ? (
                    <DropdownOptionButton
                      key="manual-city-option"
                      styles={styles}
                      onPress={handleCityManualAdd}
                      testID="manual-city-option"
                    >
                      <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
                        <Text style={styles.bodyText}>Add "{cityQuery.trim()}"</Text>
                        <Text style={styles.helperText}>Manual City</Text>
                      </View>
                    </DropdownOptionButton>
                  ) : null}
                </View>
              )}
            </View>
            {cityLoading && (
              <ActivityIndicator size="small" color="#0d6efd" style={{ marginLeft: 8, marginTop: 10 }} testID="city-loading" />
            )}
            <TouchableOpacity
              style={[styles.button, styles.smallButton, { marginLeft: 8 }]}
              onPress={handleCitySubmit}
              testID="add-city-button"
              disabled={!canSearchCities}
            >
              <Text style={styles.buttonText}>Add</Text>
            </TouchableOpacity>
          </View>

          {!canSearchCities && (
            <Text style={[styles.helperText, { marginTop: 4 }]}>Select at least one country or state to add cities.</Text>
          )}
        </>
      )}

      {selectedLocations.length > 0 && (
        <View style={[styles.row, { flexWrap: 'wrap', gap: 8, marginTop: 8 }]}>
          {selectedLocations.map((location) => (
            <View key={`selected-location-${location.id}`} style={styles.payerChip} testID={`selected-location-${location.id}`}>
              <Text style={styles.cellText}>{location.name}</Text>
              <TouchableOpacity onPress={() => onRemoveLocation(location.id)} testID={`remove-location-${location.id}`}>
                <Text style={styles.removeText}>x</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

export const LocationSelector = React.memo(LocationSelectorComponent);
