import React, { memo, useEffect, useMemo, useState } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { buildTripDayMapUrl, type TripMapPoint } from '../utils/googleMaps';

type TripDayMapProps = {
  points: TripMapPoint[];
  backendUrl: string;
  requestHeaders: Record<string, string>;
  testID?: string;
};

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
});

const TripDayMap = memo(TripDayMapComponent);
export default TripDayMap;
