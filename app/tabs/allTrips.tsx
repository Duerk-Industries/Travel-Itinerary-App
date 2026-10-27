import { themeStyle } from '../theme/theme';
import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Trip } from '../../server/src/types';
import type { FollowedTrip } from './follow';
import { getTripPeriod, TripPeriod } from '../utils/tripPeriod';
import FollowTripButton from '../components/FollowTripButton';
import { formatDateLong } from '../utils/formatDateLong';

type Props = {
  backendUrl: string;
  headers: Record<string, string>;
  trips: Trip[];
  followedTrips: FollowedTrip[];
  activeTripId: string | null;
  styles: Record<string, any>;
  onSelectTrip: (id: string) => void;
  onSelectFollowedTrip: (id: string) => void;
  onBack: () => void;
  onNavigate?: (page: string) => void;
  onFollowTrip?: (code: string) => Promise<string | null>;
  hiddenPages?: Set<string>;
};

export default function AllTripsTab({ backendUrl, headers, trips, followedTrips, activeTripId, styles, onSelectTrip, onSelectFollowedTrip, onBack, onNavigate, onFollowTrip, hiddenPages }: Props) {
  const _styleTheme = useStyleTheme();
  const [details, setDetails] = useState<Record<string, Trip>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(followedTrips.length > 0);
    setError(false);
    void Promise.allSettled(followedTrips.map(async (trip) => {
      const response = await fetch(`${backendUrl}/api/trips/${encodeURIComponent(trip.tripId)}`, { headers });
      if (!response.ok) throw new Error('Unable to load followed trip dates');
      return await response.json() as Trip;
    })).then((loaded) => {
      if (!cancelled) {
        const resolved = loaded.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
        setDetails(Object.fromEntries(resolved.map((trip) => [trip.id, trip])));
        setError(loaded.some((result) => result.status === 'rejected'));
      }
    }).catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [backendUrl, headers, followedTrips, retry]);

  const ownedIds = new Set(trips.map((trip) => trip.id));
  const entries = [
    ...trips.map((trip) => ({ ...trip, following: false })),
    ...followedTrips.filter((trip) => !ownedIds.has(trip.tripId)).map((trip) => ({
      ...details[trip.tripId], id: trip.tripId, name: trip.tripName,
      destination: trip.destination, following: true,
    })),
  ].sort((a, b) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999') || a.name.localeCompare(b.name));

  return (
    <View style={[styles.card, themeStyle('tabs_allTrips_layout1', {  }, _styleTheme)]}>
      <ScrollView contentContainerStyle={styles.homeScrollContent} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={onBack}><Text style={styles.homeModalRowMeta}>‹ Home</Text></Pressable>
        <View style={[styles.row, themeStyle('tabs_allTrips_layout2', {  }, _styleTheme)]}>
          <Text accessibilityRole="header" style={styles.homeTitle}>All Trips</Text>
          <View style={[styles.row, themeStyle('tabs_allTrips_layout3', {  }, _styleTheme)]}>
            {!hiddenPages?.has('create-trip') && onNavigate ? <Pressable accessibilityRole="button" testID="all-trips-create-button" style={[styles.button, styles.smallButton]} onPress={() => onNavigate('create-trip')}><Text style={styles.buttonText}>+ Create Trip</Text></Pressable> : null}
            {!hiddenPages?.has('follow') && onFollowTrip ? <FollowTripButton styles={styles} onFollowTrip={onFollowTrip} /> : null}
          </View>
        </View>
        <Text style={styles.homeModalRowMeta}>Select a trip to make it your active trip.</Text>
        {loading ? <Text accessibilityLiveRegion="polite" style={styles.homeModalRowMeta}>Loading followed trips…</Text> : null}
        {error ? <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)}><Text style={styles.homeModalRowMeta}>Unable to load followed trip dates. Tap to retry.</Text></Pressable> : null}
        {(['Current', 'Upcoming', 'Unscheduled', 'Past'] as TripPeriod[]).filter((period) => entries.some((trip) => getTripPeriod(trip) === period)).map((period) => (
          <View key={period} testID={`all-trips-${period.toLowerCase()}`} style={themeStyle('tabs_allTrips_layout4', {  }, _styleTheme)}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{period}</Text>
            {[false, true].map((following) => {
              const rows = entries.filter((trip) => trip.following === following && getTripPeriod(trip) === period);
              if (!rows.length) return null;
              return <View key={String(following)} style={themeStyle('tabs_allTrips_layout5', {  }, _styleTheme)}>
                <Text accessibilityRole="header" style={styles.homeModalRowTitle}>{following ? 'Following' : 'One the Trip'}</Text>
                {rows.map((trip) => (
                  <Pressable key={trip.id} accessibilityRole="button" accessibilityLabel={`Select ${trip.name}`} accessibilityState={{ selected: trip.id === activeTripId }}
                    testID={`all-trips-row-${trip.id}`}
                    style={({ pressed }) => [styles.homeModalRow, trip.id === activeTripId && styles.homeModalRowActive, pressed && styles.homeModalRowPressed]}
                    onPress={() => following ? onSelectFollowedTrip(trip.id) : onSelectTrip(trip.id)}>
                    <View style={styles.homeModalRowText}>
                      <Text style={styles.homeModalRowTitle}>{trip.name}</Text>
                      {trip.destination ? <Text style={styles.homeModalRowMeta}>{trip.destination}</Text> : null}
                      <Text style={styles.homeModalRowMeta}>{trip.startDate ? `${formatDateLong(trip.startDate)}${trip.endDate ? ` – ${formatDateLong(trip.endDate)}` : ''}` : following && !details[trip.id] ? 'Dates unavailable' : trip.durationDays ? `Dates not set · ${trip.durationDays} day(s)` : 'Dates not set'}</Text>
                    </View>
                    {trip.id === activeTripId ? <Text style={styles.homeModalActiveBadge}>Active</Text> : null}
                  </Pressable>
                ))}
              </View>;
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
