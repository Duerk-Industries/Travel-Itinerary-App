import React from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { decodeInviteCode, encodeInviteCode, InvitePayload } from '../utils/inviteCodes';

export type FollowedTrip = {
  tripId: string;
  tripName: string;
  inviterName?: string;
  destination?: string;
  todayDetails: Array<{ id?: string; day?: number; time?: string | null; activity: string }>;
};

export const followCodesKey = 'stp.followCodes';
export const followPayloadsKey = 'stp.followPayloads';

export const loadFollowCodes = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(followCodesKey);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
};

export const saveFollowCodes = (codes: Record<string, string>) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(followCodesKey, JSON.stringify(codes));
};

export const loadFollowPayloads = (): Record<string, InvitePayload> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(followPayloadsKey);
    return raw ? (JSON.parse(raw) as Record<string, InvitePayload>) : {};
  } catch {
    return {};
  }
};

export const saveFollowPayloads = (payloads: Record<string, InvitePayload>) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(followPayloadsKey, JSON.stringify(payloads));
};

export const fetchFollowedTripsApi = async (backendUrl: string, headers: Record<string, string>): Promise<FollowedTrip[]> => {
  const res = await fetch(`${backendUrl}/api/trips/followed`, { headers });
  if (res.status === 401 || res.status === 403) {
    const err = new Error('Unauthorized');
    (err as any).code = 'UNAUTHORIZED';
    throw err;
  }
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  if (!Array.isArray(data)) return [];
  return data
    .map((item: any) => ({
      tripId: item.tripId ?? item.id ?? '',
      tripName: item.tripName ?? item.name ?? 'Trip',
      inviterName: item.inviterName ?? item.invitedBy,
      destination: item.destination,
      todayDetails: Array.isArray(item.todayDetails) ? item.todayDetails : [],
    }))
    .filter((t) => t.tripId);
};

type FollowTabProps = {
  backendUrl: string;
  userToken: string | null;
  trips: Array<{ id: string; name: string; groupName?: string }>;
  headers: Record<string, string>;
  followInviteCode: string;
  setFollowInviteCode: React.Dispatch<React.SetStateAction<string>>;
  followLoading: boolean;
  setFollowLoading: React.Dispatch<React.SetStateAction<boolean>>;
  followError: string;
  setFollowError: React.Dispatch<React.SetStateAction<string>>;
  followedTrips: FollowedTrip[];
  setFollowedTrips: React.Dispatch<React.SetStateAction<FollowedTrip[]>>;
  followCodes: Record<string, string>;
  setFollowCodes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  followCodeLoading: Record<string, boolean>;
  setFollowCodeLoading: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  followCodeError: string | null;
  setFollowCodeError: React.Dispatch<React.SetStateAction<string | null>>;
  followCodePayloads: Record<string, InvitePayload>;
  setFollowCodePayloads: React.Dispatch<React.SetStateAction<Record<string, InvitePayload>>>;
  styles: any;
  logout: () => void;
};

export const FollowTab: React.FC<FollowTabProps> = ({
  backendUrl,
  userToken,
  trips,
  headers,
  followInviteCode,
  setFollowInviteCode,
  followLoading,
  setFollowLoading,
  followError,
  setFollowError,
  followedTrips,
  setFollowedTrips,
  followCodes,
  setFollowCodes,
  followCodeLoading,
  setFollowCodeLoading,
  followCodeError,
  setFollowCodeError,
  followCodePayloads,
  setFollowCodePayloads,
  styles,
  logout,
}) => {
  const followTripByInvite = async () => {
    if (!userToken) return;
    const code = followInviteCode.trim();
    if (!code) {
      setFollowError('Enter an invite code');
      return;
    }
    const decoded = decodeInviteCode(code);
    const payload = followCodePayloads[code] ?? decoded ?? null;
    const resolvedTripId = payload?.tripId ?? null;
    const resolvedName = payload?.tripName ?? trips.find((t) => t.id === resolvedTripId)?.name ?? 'Trip';
    if (resolvedTripId) {
      setFollowedTrips((prev) => {
        const filtered = prev.filter((t) => t.tripId !== resolvedTripId);
        return [
          ...filtered,
          {
            tripId: resolvedTripId,
            tripName: resolvedName,
            destination: payload?.destination,
            inviterName: payload ? 'Shared' : 'You',
            todayDetails: [],
          },
        ];
      });
      if (payload && payload.tripId) {
        setFollowCodes((prev) => {
          const next = { ...prev, [payload.tripId]: code };
          saveFollowCodes(next);
          return next;
        });
        setFollowCodePayloads((prev) => {
          const next = { ...prev, [code]: payload };
          saveFollowPayloads(next);
          return next;
        });
      }
      setFollowInviteCode('');
      setFollowError('');
      return;
    }
    setFollowLoading(true);
    setFollowError('');
    try {
      const res = await fetch(`${backendUrl}/api/trips/follow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ inviteCode: code }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        logout();
        return;
      }
      if (!res.ok) {
        setFollowError(data.error || 'Unable to follow trip');
        return;
      }
      const tripData = data.trip ?? data;
      const todayDetailsRaw = Array.isArray(data.todayDetails)
        ? data.todayDetails
        : Array.isArray(data.details)
          ? data.details
          : [];
      const normalizeDetails = todayDetailsRaw
        .filter((d: any) => d && d.activity)
        .map((d: any, idx: number) => ({
          id: d.id ?? `${tripData.id ?? code}-${idx}`,
          day: d.day,
          time: d.time,
          activity: d.activity,
        }));
      const tripId = tripData.id ?? tripData.tripId ?? code;
      if (!tripId) {
        setFollowError('Missing trip id from invite');
        return;
      }
      const tripName = tripData.name ?? tripData.tripName ?? 'Trip';
      setFollowedTrips((prev) => {
        const filtered = prev.filter((t) => t.tripId !== tripId);
        return [
          ...filtered,
          {
            tripId,
            tripName,
            inviterName: data.inviterName ?? tripData.inviterName,
            destination: tripData.destination,
            todayDetails: normalizeDetails,
          },
        ];
      });
      setFollowInviteCode('');
    } catch (err) {
      setFollowError((err as Error).message);
    } finally {
      setFollowLoading(false);
    }
  };

  const fetchFollowCode = async (tripId: string) => {
    if (!userToken) return;
    setFollowCodeError(null);
    setFollowCodeLoading((prev) => ({ ...prev, [tripId]: true }));
    const extractCode = (data: any, text?: string) => {
      return (
        data?.inviteCode ?? data?.invite_code ?? data?.code ?? data?.followCode ?? (typeof text === 'string' && text.trim() ? text.trim() : '')
      );
    };
    const attempts: Array<{ url: string; method: 'GET'; body?: any }> = [
      { url: `${backendUrl}/api/trips/${tripId}/invite-code`, method: 'GET' },
      { url: `${backendUrl}/api/trips/${tripId}/invite`, method: 'GET' },
      { url: `${backendUrl}/api/trips/${tripId}/follow-code`, method: 'GET' },
    ];
    try {
      let code: string | null = null;
      let lastError: Error | null = null;
      for (const att of attempts) {
        try {
          const res = await fetch(att.url, { headers });
          const text = await res.text();
          let data: any = {};
          try {
            data = JSON.parse(text);
          } catch {
            data = {};
          }
          if (res.status === 401 || res.status === 403) {
            logout();
            throw new Error('Unauthorized');
          }
          if (!res.ok) {
            throw new Error(data.error || text || 'Unable to fetch invite code');
          }
          const extracted = extractCode(data, text) || (typeof text === 'string' ? (text.match(/[A-Z0-9]{6,}/)?.[0] ?? '') : '');
          if (!extracted) {
            throw new Error('No invite code returned');
          }
          code = extracted;
          break;
        } catch (err) {
          lastError = err as Error;
          continue;
        }
      }
      if (code) {
        setFollowCodes((prev) => ({ ...prev, [tripId]: code }));
      } else {
        throw lastError ?? new Error('Invite codes are not enabled for this server.');
      }
    } catch (err) {
      const msg = (err as Error).message;
      setFollowCodeError(msg);
    } finally {
      setFollowCodeLoading((prev) => ({ ...prev, [tripId]: false }));
    }
  };

  const generateLocalFollowCode = (tripId: string, tripName: string) => {
    const destination = trips.find((t) => t.id === tripId)?.name;
    const payload: InvitePayload = { tripId, tripName, destination };
    const code = encodeInviteCode(payload);
    setFollowCodeError(null);
    setFollowCodes((prev) => {
      const next = { ...prev, [tripId]: code };
      saveFollowCodes(next);
      return next;
    });
    setFollowCodePayloads((prev) => {
      const next = { ...prev, [code]: payload };
      saveFollowPayloads(next);
      return next;
    });
    return code;
  };

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Follow a trip</Text>
        <Text style={styles.helperText}>Enter an invite code to view a shared trip and today's itinerary.</Text>
        <TextInput style={styles.input} placeholder="Invite code" value={followInviteCode} onChangeText={setFollowInviteCode} autoCapitalize="none" />
        {followError ? <Text style={styles.errorText}>{followError}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={followTripByInvite} disabled={followLoading}>
          <Text style={styles.buttonText}>{followLoading ? 'Following...' : 'Follow Trip'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Followed Trips</Text>
        {!followedTrips.length ? (
          <Text style={styles.helperText}>No followed trips yet.</Text>
        ) : (
          followedTrips.map((f) => (
            <View key={f.tripId} style={styles.followTripItem}>
              <Text style={styles.flightTitle}>{f.tripName}</Text>
              <Text style={styles.helperText}>
                {(f.destination ? `${f.destination}  · ` : '') + (f.inviterName ? `Invited by ${f.inviterName}` : 'Shared')}
              </Text>
              <Text style={[styles.bodyText, { fontWeight: '700', marginTop: 6 }]}>Today's itinerary</Text>
              {f.todayDetails && f.todayDetails.length ? (
                f.todayDetails.map((d) => (
                  <View key={d.id ?? `${f.tripId}-${d.activity}`} style={{ marginTop: 4 }}>
                    <Text style={styles.bodyText}>
                      {d.time ? `${d.time}  · ` : ''}
                      {d.activity}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.helperText}>No shared activities for today.</Text>
              )}
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Share your trips</Text>
        <Text style={styles.helperText}>Grab an invite code to share so others can follow along.</Text>
        {followCodeError ? <Text style={styles.errorText}>{followCodeError}</Text> : null}
        {!trips.length ? (
          <Text style={styles.helperText}>No trips available. Create one first.</Text>
        ) : (
          trips.map((trip) => {
            const code = followCodes[trip.id];
            const loading = followCodeLoading[trip.id];
            return (
              <View key={trip.id} style={styles.followTripItem}>
                <Text style={styles.flightTitle}>{trip.name}</Text>
                <Text style={styles.helperText}>Group: {trip.groupName || 'N/A'}</Text>
                <View style={{ marginTop: 6, gap: 6 }}>
                  {code ? (
                    <View style={[styles.codeRow]}>
                      <Text style={[styles.bodyText, { fontWeight: '700' }]}>Code: {code}</Text>
                      <TouchableOpacity
                        style={[styles.button, styles.smallButton]}
                        onPress={() => {
                          const text = code;
                          if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                            navigator.clipboard.writeText(text).catch(() => undefined);
                          }
                        }}
                      >
                        <Text style={styles.buttonText}>Copy</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => generateLocalFollowCode(trip.id, trip.name)} disabled={loading}>
                    <Text style={styles.buttonText}>Get invite code</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => fetchFollowCode(trip.id)} disabled={loading}>
                    <Text style={styles.buttonText}>{loading ? 'Fetching...' : 'Fetch server invite code'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </View>
    </>
  );
};

