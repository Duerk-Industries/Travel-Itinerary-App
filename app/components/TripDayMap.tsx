import React, { memo, useEffect, useMemo, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { buildTripDayMapUrl, type TripMapPoint, type TripMapPointKind } from '../utils/googleMaps';

type TripDayMapProps = {
  points: TripMapPoint[];
  backendUrl: string;
  requestHeaders: Record<string, string>;
  testID?: string;
};

// Mirrors MARKER_COLOR_BY_KIND in server/src/routes/staticMapRoutes.ts (Google
// Static Maps' named marker colors) and its display order. Keep in sync by
// hand -- same reasoning as TripMapPoint in utils/googleMaps.ts.
const LEGEND_ORDER: TripMapPointKind[] = ['flight', 'lodging', 'activity', 'car_rental'];

const LEGEND_ENTRY: Record<TripMapPointKind, { label: string; color: string }> = {
  flight: { label: 'Flight', color: '#4285F4' },
  lodging: { label: 'Lodging', color: '#FB8C00' },
  activity: { label: 'Activity', color: '#34A853' },
  car_rental: { label: 'Car rental', color: '#9C27B0' },
};

// Small teardrop pin, same silhouette as the markers Google Static Maps draws
// on the image itself, so the legend keys visually match what's pinned above.
const LegendPin: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={14} height={18} viewBox="0 0 24 24">
    <Path
      d="M12 1.5C7.31 1.5 3.5 5.28 3.5 9.9c0 6.2 7.2 12.02 8.06 12.7a.7.7 0 0 0 .88 0c.86-.68 8.06-6.5 8.06-12.7 0-4.62-3.81-8.4-8.5-8.4z"
      fill={color}
      stroke="#ffffff"
      strokeWidth={1}
    />
    <Circle cx={12} cy={9.9} r={2.9} fill="#ffffff" />
  </Svg>
);

/**
 * Static, multi-pin map for one day of an itinerary (flights, lodging,
 * activities, car rentals). Backed by GET /api/maps/trip-day — server-side
 * cached, rate-limited, and gated by the `trip_day_map` feature flag.
 *
 * This is a progressive enhancement, not core functionality: while the flag
 * is off (default) or no API key is configured yet, every request 403s/503s.
 * We fail silently (render nothing) rather than show an error box, matching
 * how the day hero image elsewhere in Overview already falls back to a
 * plain color box instead of surfacing a fetch failure to the user.
 */
const TripDayMapComponent: React.FC<TripDayMapProps> = ({ points, backendUrl, requestHeaders, testID }) => {
  const [failed, setFailed] = useState(false);
  const [webObjectUrl, setWebObjectUrl] = useState<string | null>(null);

  const mapUrl = useMemo(() => buildTripDayMapUrl(points, backendUrl), [points, backendUrl]);
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

  const imageSource = useMemo(() => {
    if (!mapUrl) return undefined;
    if (Platform.OS === 'web') return webObjectUrl ? { uri: webObjectUrl } : undefined;
    return { uri: mapUrl, headers: requestHeaders };
  }, [mapUrl, requestHeaders, webObjectUrl]);

  const presentKinds = useMemo(() => {
    const seen = new Set(points.map((p) => p.kind));
    return LEGEND_ORDER.filter((kind) => seen.has(kind));
  }, [points]);

  if (!mapUrl || !imageSource || failed) return null;

  return (
    <View style={styles.wrap} testID={testID}>
      <Image
        style={styles.image}
        source={imageSource}
        resizeMode="cover"
        accessibilityLabel="Map of today's stops"
        onError={() => setFailed(true)}
      />
      {presentKinds.length ? (
        <View style={styles.legend} testID={testID ? `${testID}-legend` : undefined}>
          <Text style={styles.legendTitle}>Map key</Text>
          <View style={styles.legendRow}>
            {presentKinds.map((kind) => {
              const entry = LEGEND_ENTRY[kind];
              return (
                <View
                  key={kind}
                  style={styles.legendItem}
                  accessibilityLabel={`${entry.label} pins are shown in this color`}
                >
                  <LegendPin color={entry.color} />
                  <Text style={styles.legendLabel}>{entry.label}</Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.legendNote}>Letters (A, B, C…) show the order you'll visit each stop</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 8,
    marginBottom: 8,
  },
  image: {
    width: '100%',
    aspectRatio: 640 / 400,
  },
  legend: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },
  legendTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#94a3b8',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: 8,
    columnGap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#334155',
  },
  legendNote: {
    fontSize: 11,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
});

const TripDayMap = memo(TripDayMapComponent);
export default TripDayMap;
