import React, { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
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
  comments: Array<{
    id: string;
    actorUserId?: string | null;
    body: string;
    createdAt: string;
    authorName?: string | null;
    authorEmail?: string | null;
  }>;
  activity: Array<{
    id: string;
    kind?: 'group' | 'event';
    type: string;
    title: string;
    summary: string;
    createdAt: string;
    startAt?: string;
    endAt?: string;
    count?: number;
    itemsPreview?: Array<{ id: string; title: string; summary: string; metadata?: Record<string, any>; createdAt: string }>;
    itemsTotal?: number;
    actorUserId?: string | null;
    metadata?: Record<string, any>;
  }>;
};

const EVENT_ICON: Record<string, string> = {
  TRIP_CREATED: '🧭',
  FOLLOW_ADDED: '👀',
  FOLLOW_REMOVED: '👋',
  ITINERARY_ITEM_ADDED: '🗓️',
  ITINERARY_ITEM_UPDATED: '✏️',
  ITINERARY_ITEM_DELETED: '🗑️',
  FLIGHT_ADDED: '✈️',
  LODGING_ADDED: '🏨',
  TOUR_ADDED: '🎟️',
  NOTE_ADDED: '📝',
};

const RELATIVE_TIME = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const getEventTimestamp = (event: any): string => {
  if (event?.kind === 'group') return String(event?.endAt ?? event?.startAt ?? '');
  return String(event?.createdAt ?? '');
};

const getDateHeader = (date: Date): string => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((todayStart.getTime() - targetStart.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return targetStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const getRelativeTime = (value: string): string => {
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return '';
  const diffMs = ts - Date.now();
  const abs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < hour) return RELATIVE_TIME.format(Math.round(diffMs / minute), 'minute');
  if (abs < day) return RELATIVE_TIME.format(Math.round(diffMs / hour), 'hour');
  return RELATIVE_TIME.format(Math.round(diffMs / day), 'day');
};

const getPrimaryText = (event: any): string => {
  if (event?.kind === 'group') {
    const count = Number(event?.count ?? event?.itemsTotal ?? 0);
    const label = String(event?.type ?? '').replace(/_/g, ' ').toLowerCase();
    return `${count} ${label}`;
  }
  return event?.title || String(event?.type ?? 'Update').replace(/_/g, ' ');
};

const getSecondaryText = (event: any): string => {
  if (event?.kind === 'group') {
    const preview = Array.isArray(event?.itemsPreview) ? event.itemsPreview : [];
    const summary = preview
      .map((item: any) => String(item?.summary ?? item?.title ?? '').trim())
      .filter(Boolean)
      .slice(0, 2)
      .join('  ·  ');
    if (!summary) return '';
    const remaining = Math.max(0, Number(event?.itemsTotal ?? preview.length) - 2);
    return remaining > 0 ? `${summary}  +${remaining} more` : summary;
  }
  return String(event?.summary ?? '').trim();
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
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [commentError, setCommentError] = useState('');

  useEffect(() => {
    if (!selectedTripId) {
      setDetail(null);
      setError('');
      return;
    }
    let active = true;
    setNewComment('');
    setCommentError('');
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [tripRes, flightsRes, lodgingsRes, toursRes, activityRes, commentsRes] = await Promise.all([
          fetch(`${backendUrl}/api/trips/${selectedTripId}`, { headers }),
          fetch(`${backendUrl}/api/transfers?tripId=${encodeURIComponent(selectedTripId)}`, { headers }),
          fetch(`${backendUrl}/api/lodgings?tripId=${encodeURIComponent(selectedTripId)}`, { headers }),
          fetch(`${backendUrl}/api/activities?tripId=${encodeURIComponent(selectedTripId)}`, { headers }),
          fetch(`${backendUrl}/api/trips/${selectedTripId}/activity?limit=30&group=true`, { headers }),
          fetch(`${backendUrl}/api/trips/${selectedTripId}/comments`, { headers }),
        ]);
        if ([tripRes, flightsRes, lodgingsRes, toursRes, activityRes, commentsRes].some((res) => res.status === 401)) {
          onRequireLogin();
          return;
        }
        if (!tripRes.ok) {
          const data = await tripRes.json().catch(() => ({}));
          throw new Error(data.error || 'Unable to load followed trip');
        }
        const [trip, flights, lodgings, tours, itinerariesRaw, activityRaw, commentsRaw] = await Promise.all([
          tripRes.json().catch(() => null),
          flightsRes.ok ? flightsRes.json().catch(() => []) : [],
          lodgingsRes.ok ? lodgingsRes.json().catch(() => []) : [],
          toursRes.ok ? toursRes.json().catch(() => []) : [],
          fetch(`${backendUrl}/api/itineraries`, { headers })
            .then((res) => (res.ok ? res.json().catch(() => []) : []))
            .catch(() => []),
          activityRes.ok ? activityRes.json().catch(() => ({ events: [] })) : { events: [] },
          commentsRes.ok ? commentsRes.json().catch(() => ({ comments: [] })) : { comments: [] },
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
          comments: Array.isArray(commentsRaw?.comments) ? commentsRaw.comments : [],
          activity: Array.isArray(activityRaw?.events) ? activityRaw.events : [],
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

  const groupedActivityByDate = useMemo(() => {
    const groups: Array<{ label: string; items: any[] }> = [];
    const byLabel = new Map<string, any[]>();
    for (const event of detail?.activity ?? []) {
      const raw = getEventTimestamp(event);
      const date = new Date(raw);
      if (!Number.isFinite(date.getTime())) continue;
      const label = getDateHeader(date);
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label)!.push(event);
    }
    for (const [label, items] of byLabel.entries()) {
      groups.push({ label, items });
    }
    return groups;
  }, [detail?.activity]);

  const postComment = async () => {
    if (!selectedTripId) return;
    const body = newComment.trim();
    if (!body) return;
    setPostingComment(true);
    setCommentError('');
    try {
      const res = await fetch(`${backendUrl}/api/trips/${selectedTripId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ body }),
      });
      if (res.status === 401) {
        onRequireLogin();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCommentError(data.error || 'Unable to post comment');
        return;
      }
      setDetail((prev) => {
        if (!prev) return prev;
        return { ...prev, comments: [...(prev.comments ?? []), data] };
      });
      setNewComment('');
    } catch (err) {
      setCommentError((err as Error).message || 'Unable to post comment');
    } finally {
      setPostingComment(false);
    }
  };

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
                  <Text style={styles.dangerButtonText}>
                    {unfollowingTripId === trip.tripId ? 'Unfollowing...' : 'Unfollow'}
                  </Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>

      {selectedTripId ? (
        <View style={styles.card}>
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
              <Text style={styles.headerText}>Activity Feed ({detail?.activity?.length ?? 0})</Text>
              {groupedActivityByDate.map((dateGroup) => (
                <View key={dateGroup.label} style={{ marginTop: 6 }}>
                  <Text style={[styles.helperText, { fontWeight: '700', marginBottom: 4 }]}>{dateGroup.label}</Text>
                  {dateGroup.items.map((event: any) => {
                    const timestamp = getEventTimestamp(event);
                    const secondary = getSecondaryText(event);
                    return (
                      <View
                        key={event?.id ?? `${timestamp}-${event?.type}`}
                        style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#e5e7eb' }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                          <View style={{ flexDirection: 'row', flex: 1, gap: 8 }}>
                            <Text style={{ width: 20, fontSize: 14 }}>{EVENT_ICON[event?.type] ?? '•'}</Text>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.bodyText, { fontWeight: '700' }]}>{getPrimaryText(event)}</Text>
                              {secondary ? <Text style={styles.helperText}>{secondary}</Text> : null}
                            </View>
                          </View>
                          <Text style={[styles.helperText, { minWidth: 56, textAlign: 'right' }]}>{getRelativeTime(timestamp)}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))}
              {groupedActivityByDate.length ? null : <Text style={styles.helperText}>No activity yet.</Text>}
              <View style={styles.divider} />
              <Text style={styles.headerText}>Discussion ({detail?.comments?.length ?? 0})</Text>
              {(detail?.comments ?? []).map((comment: any) => (
                <View key={comment?.id} style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#e5e7eb' }}>
                  <Text style={[styles.bodyText, { fontWeight: '700' }]}>{comment?.authorName || comment?.authorEmail || 'Traveler'}</Text>
                  <Text style={styles.bodyText}>{comment?.body ?? ''}</Text>
                  <Text style={styles.helperText}>{comment?.createdAt ? new Date(comment.createdAt).toLocaleString() : ''}</Text>
                </View>
              ))}
              {detail?.comments?.length ? null : <Text style={styles.helperText}>No comments yet. Start the discussion.</Text>}
              <View style={{ marginTop: 8 }}>
                <TextInput
                  style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
                  placeholder="Write a comment..."
                  multiline
                  value={newComment}
                  onChangeText={setNewComment}
                />
                {commentError ? <Text style={styles.errorText}>{commentError}</Text> : null}
                <TouchableOpacity style={[styles.button, { marginTop: 6 }]} onPress={postComment} disabled={postingComment || !newComment.trim()}>
                  <Text style={styles.buttonText}>{postingComment ? 'Posting...' : 'Post Comment'}</Text>
                </TouchableOpacity>
              </View>
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
              <Text style={styles.headerText}>Activities ({detail?.tours.length ?? 0})</Text>
              {(detail?.tours ?? []).slice(0, 8).map((t: any) => (
                <Text key={t.id ?? `${t.date}-${t.name}`} style={styles.bodyText}>
                  {`${t.date ?? ''}  ${t.name ?? 'Activity'}${t.startTime ? ` at ${t.startTime}` : ''}`}
                </Text>
              ))}
              {detail?.tours?.length ? null : <Text style={styles.helperText}>No activities shared yet.</Text>}
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
        </View>
      ) : null}
    </>
  );
};

export default FollowingTab;

