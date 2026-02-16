import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { FollowedTrip } from './follow';

type FollowingTabProps = {
  backendUrl: string;
  headers: Record<string, string>;
  followedTrips: FollowedTrip[];
  styles: any;
  onRequireLogin: () => void;
  selectedTripId: string | null;
  onSelectTrip: (tripId: string | null) => void;
  onUnfollowTrip: (tripId: string) => Promise<void>;
};

type FollowedTripDetail = {
  trip: any | null;
  flights: any[];
  lodgings: any[];
  tours: any[];
  itineraries: any[];
  itineraryDetailsById: Record<string, any[]>;
};

const FollowingTab: React.FC<FollowingTabProps> = ({
  backendUrl,
  headers,
  followedTrips,
  styles,
  onRequireLogin,
  selectedTripId,
  onSelectTrip,
  onUnfollowTrip,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [detail, setDetail] = useState<FollowedTripDetail | null>(null);
  const [unfollowingTripId, setUnfollowingTripId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTripId) {
      setDetail(null);
      setError('');
      return;
    }
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [tripRes, flightsRes, lodgingsRes, toursRes] = await Promise.all([
          fetch(`${backendUrl}/api/trips/${selectedTripId}`, { headers }),
          fetch(`${backendUrl}/api/flights?tripId=${encodeURIComponent(selectedTripId)}`, { headers }),
          fetch(`${backendUrl}/api/lodgings?tripId=${encodeURIComponent(selectedTripId)}`, { headers }),
          fetch(`${backendUrl}/api/tours?tripId=${encodeURIComponent(selectedTripId)}`, { headers }),
        ]);
        if ([tripRes, flightsRes, lodgingsRes, toursRes].some((res) => res.status === 401 || res.status === 403)) {
          onRequireLogin();
          return;
        }
        if (!tripRes.ok) {
          const data = await tripRes.json().catch(() => ({}));
          throw new Error(data.error || 'Unable to load followed trip');
        }
        const [trip, flights, lodgings, tours, itinerariesRaw] = await Promise.all([
          tripRes.json().catch(() => null),
          flightsRes.ok ? flightsRes.json().catch(() => []) : [],
          lodgingsRes.ok ? lodgingsRes.json().catch(() => []) : [],
          toursRes.ok ? toursRes.json().catch(() => []) : [],
          fetch(`${backendUrl}/api/itineraries`, { headers })
            .then((res) => (res.ok ? res.json().catch(() => []) : []))
            .catch(() => []),
        ]);
        const itineraries = Array.isArray(itinerariesRaw)
          ? itinerariesRaw.filter((item: any) => String(item?.tripId ?? '') === selectedTripId)
          : [];
        const itineraryDetailsById: Record<string, any[]> = {};
        await Promise.all(
          itineraries.map(async (itinerary: any) => {
            const id = String(itinerary?.id ?? '').trim();
            if (!id) return;
            const res = await fetch(`${backendUrl}/api/itineraries/${encodeURIComponent(id)}/details`, { headers });
            if (!res.ok) {
              itineraryDetailsById[id] = [];
              return;
            }
            const details = await res.json().catch(() => []);
            itineraryDetailsById[id] = Array.isArray(details) ? details : [];
          })
        );
        if (!active) return;
        setDetail({
          trip,
          flights: Array.isArray(flights) ? flights : [],
          lodgings: Array.isArray(lodgings) ? lodgings : [],
          tours: Array.isArray(tours) ? tours : [],
          itineraries,
          itineraryDetailsById,
        });
      } catch (err) {
        if (!active) return;
        setDetail(null);
        setError((err as Error).message || 'Unable to load followed trip');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [selectedTripId, backendUrl, headers, onRequireLogin]);

  const selectedTrip = useMemo(
    () => followedTrips.find((trip) => trip.tripId === selectedTripId) ?? null,
    [followedTrips, selectedTripId]
  );

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Following Trips</Text>
        {!followedTrips.length ? (
          <Text style={styles.helperText}>You are not following any trips yet.</Text>
        ) : (
          followedTrips.map((trip) => (
            <TouchableOpacity
              key={trip.tripId}
              style={[
                styles.followTripItem,
                selectedTripId === trip.tripId ? { borderColor: '#2563eb', borderWidth: 1 } : null,
              ]}
              activeOpacity={0.85}
              onPress={() => onSelectTrip(trip.tripId)}
            >
              <Text style={styles.flightTitle}>{trip.tripName}</Text>
              <Text style={styles.helperText}>
                {(trip.destination ? `${trip.destination}  · ` : '') +
                  (trip.inviterName ? `Invited by ${trip.inviterName}` : 'Shared')}
              </Text>
              <View style={[styles.row, { marginTop: 6 }]}>
                <TouchableOpacity
                  style={[styles.button, styles.smallButton, styles.dangerButton]}
                  onPress={async () => {
                    setUnfollowingTripId(trip.tripId);
                    try {
                      await onUnfollowTrip(trip.tripId);
                    } finally {
                      setUnfollowingTripId(null);
                    }
                  }}
                  disabled={unfollowingTripId === trip.tripId}
                >
                  <Text style={styles.buttonText}>
                    {unfollowingTripId === trip.tripId ? 'Unfollowing...' : 'Unfollow'}
                  </Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>

      {selectedTripId ? (
        <ScrollView style={styles.card} contentContainerStyle={{ gap: 10 }}>
          <Text style={styles.sectionTitle}>Trip Information</Text>
          {loading ? <Text style={styles.helperText}>Loading trip details...</Text> : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {!loading && !error ? (
            <>
              <Text style={styles.flightTitle}>{detail?.trip?.name ?? selectedTrip?.tripName ?? 'Trip'}</Text>
              <Text style={styles.helperText}>Read-only shared view</Text>
              {detail?.trip?.destination ? (
                <Text style={styles.bodyText}>Destination: {detail.trip.destination}</Text>
              ) : null}
              {(detail?.trip?.startDate || detail?.trip?.endDate) ? (
                <Text style={styles.bodyText}>
                  Dates: {detail?.trip?.startDate ?? 'Start'} - {detail?.trip?.endDate ?? 'End'}
                </Text>
              ) : null}
              <View style={styles.divider} />
              <Text style={styles.headerText}>Flights ({detail?.flights.length ?? 0})</Text>
              {(detail?.flights ?? []).slice(0, 8).map((f: any) => (
                <Text key={f.id ?? `${f.departureDate}-${f.departureTime}`} style={styles.bodyText}>
                  {`${f.departureDate ?? ''} ${f.departureTime ?? ''}  ${f.departureLocation ?? f.departure_airport_code ?? ''} -> ${f.arrivalLocation ?? f.arrival_airport_code ?? ''}`}
                </Text>
              ))}
              {detail?.flights?.length ? null : <Text style={styles.helperText}>No flights shared yet.</Text>}
              <View style={styles.divider} />
              <Text style={styles.headerText}>Lodging ({detail?.lodgings.length ?? 0})</Text>
              {(detail?.lodgings ?? []).slice(0, 8).map((l: any) => (
                <Text key={l.id ?? `${l.name}-${l.checkInDate ?? l.check_in_date}`} style={styles.bodyText}>
                  {`${l.name ?? 'Lodging'}  ${l.checkInDate ?? l.check_in_date ?? ''} - ${l.checkOutDate ?? l.check_out_date ?? ''}`}
                </Text>
              ))}
              {detail?.lodgings?.length ? null : <Text style={styles.helperText}>No lodging shared yet.</Text>}
              <View style={styles.divider} />
              <Text style={styles.headerText}>Tours ({detail?.tours.length ?? 0})</Text>
              {(detail?.tours ?? []).slice(0, 8).map((t: any) => (
                <Text key={t.id ?? `${t.date}-${t.name}`} style={styles.bodyText}>
                  {`${t.date ?? ''}  ${t.name ?? 'Tour'}${t.startTime ? ` at ${t.startTime}` : ''}`}
                </Text>
              ))}
              {detail?.tours?.length ? null : <Text style={styles.helperText}>No tours shared yet.</Text>}
              <View style={styles.divider} />
              <Text style={styles.headerText}>Itinerary ({detail?.itineraries.length ?? 0})</Text>
              {(detail?.itineraries ?? []).length ? (
                (detail?.itineraries ?? []).map((itinerary: any) => {
                  const itineraryId = String(itinerary?.id ?? '');
                  const details = (detail?.itineraryDetailsById?.[itineraryId] ?? [])
                    .slice()
                    .sort((a: any, b: any) => {
                      const dayA = Number(a?.day ?? 0);
                      const dayB = Number(b?.day ?? 0);
                      if (dayA !== dayB) return dayA - dayB;
                      return String(a?.time ?? '').localeCompare(String(b?.time ?? ''));
                    });
                  return (
                    <View key={itineraryId || itinerary.destination} style={{ marginTop: 6 }}>
                      <Text style={[styles.bodyText, { fontWeight: '700' }]}>
                        {`${itinerary?.destination ?? 'Itinerary'} · ${itinerary?.days ?? '?'} day(s)`}
                      </Text>
                      {details.length ? (
                        details.slice(0, 20).map((item: any) => (
                          <Text
                            key={item?.id ?? `${itineraryId}-${item?.day}-${item?.activity}`}
                            style={styles.bodyText}
                          >
                            {`Day ${item?.day ?? '?'}${item?.time ? ` ${item.time}` : ''} · ${item?.activity ?? ''}`}
                          </Text>
                        ))
                      ) : (
                        <Text style={styles.helperText}>No day-by-day items shared yet.</Text>
                      )}
                    </View>
                  );
                })
              ) : (
                <Text style={styles.helperText}>No itinerary shared yet.</Text>
              )}
            </>
          ) : null}
        </ScrollView>
      ) : null}
    </>
  );
};

export default FollowingTab;
