import React, { memo, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
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

  const mapUrl = useMemo(() => buildTripDayMapUrl(points, backendUrl), [points, backendUrl]);

  const imageSource = useMemo(
    () => (mapUrl ? { uri: mapUrl, headers: requestHeaders } : undefined),
    [mapUrl, requestHeaders]
  );

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
