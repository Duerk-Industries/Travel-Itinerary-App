import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import { useAutomaticMapLocations } from '../hooks/useAutomaticMapLocations';
import TripMap from './TripMap';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { buildTripDayMapUrl, type TripMapPoint, type TripMapPointKind } from '../utils/googleMaps';

type TripDayMapProps = {
  points: TripMapPoint[];
  tripId?: string;
  dayDate?: string;
  backendUrl: string;
  requestHeaders: Record<string, string>;
  testID?: string;
  onOpenChange?: (open: boolean) => void;
};

// Mirrors MARKER_COLOR_BY_KIND in server/src/routes/staticMapRoutes.ts (Google
// Static Maps' named marker colors) and its display order. Keep in sync by
// hand -- same reasoning as TripMapPoint in utils/googleMaps.ts.
const LEGEND_ORDER: TripMapPointKind[] = ['flight', 'lodging', 'activity', 'car_rental'];

const LEGEND_ENTRY = (_theme: import('../theme/theme').AppTheme): Record<TripMapPointKind, { label: string; color: string }> => themeStyle('components_TripDayMap_1', {  }, _theme);

// Small teardrop pin, same silhouette as the markers Google Static Maps draws
// on the image itself, so the legend keys visually match what's pinned above.
const LegendPin: React.FC<{ color: string }> = ({ color }) => { const _styleTheme = useStyleTheme(); return ((
  <Svg width={14} height={18} viewBox="0 0 24 24">
    <Path
      d="M12 1.5C7.31 1.5 3.5 5.28 3.5 9.9c0 6.2 7.2 12.02 8.06 12.7a.7.7 0 0 0 .88 0c.86-.68 8.06-6.5 8.06-12.7 0-4.62-3.81-8.4-8.5-8.4z"
      fill={color}
      stroke={themeStyle('components_TripDayMap_3', {  }, _styleTheme)}
      strokeWidth={1}
    />
    <Circle cx={12} cy={9.9} r={2.9} fill={themeStyle('components_TripDayMap_4', {  }, _styleTheme)} />
  </Svg>
)); };

/**
 * Static, multi-pin map for one day of an itinerary (flights, lodging,
 * activities, car rentals). Backed by GET /api/maps/trip-day — private live image, rate-limited, and gated by the `trip_day_map` feature flag.
 *
 * This is a progressive enhancement, not core functionality: while the flag
 * is off (default) or no API key is configured yet, every request 403s/503s.
 * We fail silently (render nothing) rather than show an error box, matching
 * how the day hero image elsewhere in Overview already falls back to a
 * plain color box instead of surfacing a fetch failure to the user.
 */
const TripDayMapComponent: React.FC<TripDayMapProps> = ({ points, backendUrl, requestHeaders, testID, tripId, dayDate, onOpenChange }) => {
  const _styleTheme = useStyleTheme();
  const [nativeEnabled, setNativeEnabled] = useState(false);
  const [canLocate, setCanLocate] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [webObjectUrl, setWebObjectUrl] = useState<string | null>(null);

  const mapUrl = useMemo(() => points.length && backendUrl && tripId && dayDate ? `${backendUrl}/api/maps/trip-day?tripId=${encodeURIComponent(tripId)}&dayDate=${encodeURIComponent(dayDate)}` : '', [tripId, dayDate, backendUrl, points.length]);
  // Stable dependency for the effect below — requestHeaders is commonly a fresh object every
  // render, and re-fetching the map on every unrelated re-render would be wasteful. Refetch only
  // when the header *values* actually change (e.g. a token refresh), not the object identity.
  const headersKey = useMemo(() => JSON.stringify(requestHeaders ?? {}), [requestHeaders]);

  // react-native-web's <Image> silently drops `source.headers` — verified against its actual
  // implementation, which has no handling for it at all — so it renders a plain <img src>. A
  // browser can't attach a custom Authorization header to that, and GET /api/maps/trip-day
  // requires one (header-only, no query-token fallback), so on web every request 401s and the
  // whole map disappears with zero visible error. Fetch the bytes ourselves with the header
  // attached instead, and hand the browser a same-origin blob: URL — the standard workaround for
  // an authenticated image on the web. Native's <Image source={{ uri, headers }}> already works
  // correctly and is left alone.
  useEffect(() => {
    if (Platform.OS !== 'web' || !mapUrl) {
      setWebObjectUrl(null);
      return undefined;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    (async () => {
      try {
        const response = await fetch(mapUrl, { headers: requestHeaders });
        if (!response.ok) throw new Error(`map fetch failed: HTTP ${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setWebObjectUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapUrl, headersKey]);

  useEffect(() => {
    let cancelled = false; setNativeEnabled(false); setCanLocate(false); setMapOpen(false);
    if (Platform.OS !== 'web' && tripId && backendUrl) void (async () => {
      const response = await fetch(`${backendUrl}/api/trips/${encodeURIComponent(tripId)}/planning-capabilities`, { headers: requestHeaders });
      if (response?.ok) { const data = await response.json(); if (!cancelled) { setNativeEnabled(data.nativeMap === true); setCanLocate(data.locate === true); } }
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [tripId, backendUrl, headersKey]);

  const imageSource = useMemo(() => {
    if (!mapUrl) return undefined;
    if (Platform.OS === 'web') return webObjectUrl ? { uri: webObjectUrl } : undefined;
    return { uri: mapUrl, headers: requestHeaders };
  }, [mapUrl, requestHeaders, webObjectUrl]);

  const presentKinds = useMemo(() => {
    const seen = new Set(points.map((p) => p.kind));
    return LEGEND_ORDER.filter((kind) => seen.has(kind));
  }, [points]);

  const locations = useAutomaticMapLocations({ points, backendUrl, tripId, dayDate, requestHeaders, enabled: nativeEnabled, canLocate, open: mapOpen });
  const visibilityCallback = useRef(onOpenChange);
  visibilityCallback.current = onOpenChange;
  const mapShown = nativeEnabled ? mapOpen : Boolean(mapUrl && imageSource && !failed);
  useEffect(() => { visibilityCallback.current?.(mapShown); }, [mapShown, tripId, dayDate]);
  useEffect(() => () => { visibilityCallback.current?.(false); }, []);
  if (nativeEnabled) return <TripMap key={JSON.stringify([tripId, dayDate])} testID={testID} nativeEnabled points={locations.points} onOpenChange={setMapOpen} locating={locations.locating} locationNotice={locations.notice} />;
  if (!mapUrl || !imageSource || failed) return null;

  return (
    <View style={styles(_styleTheme).wrap} testID={testID}>
      <Image
        style={styles(_styleTheme).image}
        source={imageSource}
        resizeMode="cover"
        accessibilityLabel="Map of today's stops"
        onError={() => setFailed(true)}
      />
      {presentKinds.length ? (
        <View style={styles(_styleTheme).legend} testID={testID ? `${testID}-legend` : undefined}>
          <Text style={styles(_styleTheme).legendTitle}>Map key</Text>
          <View style={styles(_styleTheme).legendRow}>
            {presentKinds.map((kind) => {
              const entry = LEGEND_ENTRY(_styleTheme)[kind];
              return (
                <View
                  key={kind}
                  style={styles(_styleTheme).legendItem}
                  accessibilityLabel={`${entry.label} pins are shown in this color`}
                >
                  <LegendPin color={entry.color} />
                  <Text style={styles(_styleTheme).legendLabel}>{entry.label}</Text>
                </View>
              );
            })}
          </View>
          <Text style={styles(_styleTheme).legendNote}>Letters (A, B, C…) show the order you'll visit each stop</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_TripDayMap_2', { StyleSheet: StyleSheet }, _theme);

const TripDayMap = memo(TripDayMapComponent);
export default TripDayMap;
