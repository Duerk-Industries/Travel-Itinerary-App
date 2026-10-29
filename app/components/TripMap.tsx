import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useEffect, useState } from 'react';
import { AppState, Linking, TouchableOpacity, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import type * as NativeMap from '@maplibre/maplibre-react-native';
import type { TripMapProps } from './TripMap.types';
import { isLocatedMapPoint, mapBounds } from '../utils/planningMapGeometry';
const compatibleBuild = (): boolean => {
  try { return require('expo-constants').default.expoConfig?.extra?.nativeMapRenderer === true; } catch { return false; }
};
// Never load a native module in an old binary or while the independent rollout flag is off.
export default function TripMap({ points, selectedId, onSelect, testID, nativeEnabled = false, onOpenChange, locating = false, locationNotice }: TripMapProps) {
  const _styleTheme = useStyleTheme();
  const [lib, setLib] = useState<typeof NativeMap | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const resolved = points.filter(isLocatedMapPoint).slice(0, 100);
  useEffect(() => { const subscription = AppState.addEventListener('change', state => setActive(state === 'active')); return () => subscription.remove(); }, []);
  useEffect(() => {
    if (!nativeEnabled || !compatibleBuild() || !open || !active) { setLib(null); return; }
    let cancelled = false;
    setFailed(false); setLoaded(false);
    void import('@maplibre/maplibre-react-native').then(value => { if (!cancelled) setLib(value); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [nativeEnabled, open, active]);
  useEffect(() => {
    if (!lib || !open || loaded) return;
    const timer = setTimeout(() => setFailed(true), 10_000);
    return () => clearTimeout(timer);
  }, [lib, open, loaded]);
  const selected = resolved.find(p => p.id === (selectedId ?? selection));
  const choose = (id: string) => { setSelection(id); onSelect?.(id); };
  const bounds = resolved.length ? mapBounds(resolved) : undefined;
  const shape: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: 'FeatureCollection', features: resolved.map((p, n) => ({ type: 'Feature', properties: { id: p.id, label: p.label || String(n + 1) }, geometry: { type: 'Point', coordinates: [p.lng!, p.lat!] } })) };
  return <View testID={testID} style={themeStyle('components_TripMap_1', {  }, _styleTheme)}>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => { setOpen(!open); onOpenChange?.(!open); }} style={themeStyle('components_TripMap_2', {  }, _styleTheme)}><Text tone="link">{open ? 'Hide map' : 'Show map'}</Text></TouchableOpacity>
    {open && <>
      {locating && <Text accessibilityLiveRegion="polite">Finding locations�</Text>}
      {locationNotice && <Text accessibilityLiveRegion="polite">{locationNotice}</Text>}
      {lib && active && !failed && resolved.length > 0 && <lib.MapView testID="native-trip-map" style={themeStyle('components_TripMap_3', {  }, _styleTheme)} mapStyle="https://tiles.openfreemap.org/styles/liberty" attributionEnabled logoEnabled={false} onDidFinishLoadingMap={() => setLoaded(true)} onDidFailLoadingMap={() => setFailed(true)}>
        <lib.Camera animationDuration={0} {...(selected ? { centerCoordinate: [selected.lng!, selected.lat!], zoomLevel: 13 } : resolved.length > 1 ? { bounds: themeStyle('components_TripMap_4', { bounds: bounds }, _styleTheme) } : { centerCoordinate: [resolved[0].lng!, resolved[0].lat!], zoomLevel: 12 })} />
        <lib.ShapeSource id="stops" shape={shape} onPress={event => { const id = event.features[0]?.properties?.id; if (typeof id === 'string') choose(id); }}>
          <lib.CircleLayer id="stop-pins" style={themeStyle('nativeMapLayer1', {  }, _styleTheme)} />
          <lib.SymbolLayer id="stop-labels" style={themeStyle('nativeMapLayer2', {  }, _styleTheme)} />
        </lib.ShapeSource>
        {resolved.length > 1 && <lib.ShapeSource id="visit-order" shape={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: resolved.map(p => [p.lng!, p.lat!]) } }}><lib.LineLayer id="visit-line" belowLayerID="stop-pins" style={themeStyle('nativeMapLayer3', {  }, _styleTheme)} /></lib.ShapeSource>}
      </lib.MapView>}
      {(!lib || failed || !resolved.length) && <Text>Map unavailable. Your stops and external map links are below.</Text>}
      {points.map((point, n) => <View key={point.id}>
        <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: (selectedId ?? selection) === point.id }} onPress={() => choose(point.id)} style={themeStyle('components_TripMap_5', {  }, _styleTheme)}><Text>{point.label || n + 1} · {point.title}{!isLocatedMapPoint(point) ? ' · Not on the map yet' : ''}</Text></TouchableOpacity>
        {isLocatedMapPoint(point) && <TouchableOpacity accessibilityRole="link" onPress={() => { void Linking.openURL(`https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=15/${point.lat}/${point.lng}`); }} style={themeStyle('components_TripMap_6', {  }, _styleTheme)}><Text tone="link">Open {point.title} in Maps</Text></TouchableOpacity>}
      </View>)}
      {[...new Set(points.map(point => point.coordinateAttribution).filter((value): value is string => Boolean(value)))].map(value => <Text key={value}>{value}</Text>)}
      <Text tone="muted">Straight lines show visit order, not directions. © OpenFreeMap © OpenMapTiles © OpenStreetMap contributors</Text>
    </>}
  </View>;
}
