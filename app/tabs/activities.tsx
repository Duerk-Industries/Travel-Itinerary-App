import React, { useMemo, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { formatDateLong } from '../utils/formatDateLong';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { toWebStyle } from '../utils/webStyle';
import { formatNetVotes, shouldShowRatingButtons, shouldShowVoteButtons } from '../utils/votes';
import {
  DEFAULT_NEW_ITINERARY_STATUS,
  LEGACY_ITINERARY_STATUS,
  type ItineraryStatus,
  normalizeItineraryStatus,
  shouldRelaxRequiredFields,
  ITINERARY_STATUSES,
} from '../utils/itineraryStatus';

export type ActivityType =
  | 'Class'
  | 'Concert/Show'
  | 'Day Trip'
  | 'Event'
  | 'Food & Drink'
  | 'Fun & Games'
  | 'Hike'
  | 'Nightlife'
  | 'Open Access'
  | 'Outdoor Activity'
  | 'Reservation'
  | 'Shopping'
  | 'Sights & Landmarks'
  | 'Spa/Wellness'
  | 'Ticketed Attraction'
  | 'Tour';
const ACTIVITY_TYPES: ActivityType[] = [
  'Class',
  'Concert/Show',
  'Day Trip',
  'Event',
  'Food & Drink',
  'Fun & Games',
  'Hike',
  'Nightlife',
  'Open Access',
  'Outdoor Activity',
  'Reservation',
  'Shopping',
  'Sights & Landmarks',
  'Spa/Wellness',
  'Ticketed Attraction',
  'Tour',
];

export type Tour = {
  id: string;
  status: ItineraryStatus;
  activityType: ActivityType;
  netVotes?: number;
  userVote?: -1 | 1 | null;
  netRating?: number;
  userRating?: -1 | 1 | null;
  date: string;
  name: string;
  startLocation: string;
  startTime: string;
  duration: string;
  cost: string;
  freeCancelBy: string;
  bookedOn: string;
  reference: string;
  paidBy: string[];
  travelerIds?: string[];
};

export type TourDraft = {
  status: ItineraryStatus;
  activityType: ActivityType;
  date: string;
  name: string;
  startLocation: string;
  startTime: string;
  duration: string;
  cost: string;
  freeCancelBy: string;
  bookedOn: string;
  reference: string;
  paidBy: string[];
  travelerIds: string[];
};

export type GroupMemberOption = {
  id: string;
  guestName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  status?: 'active' | 'pending' | 'removed';
  removedAt?: string | null;
};

// Build a blank activity draft with today's date and zero cost.
export const createInitialActivityState = (): TourDraft => ({
  status: DEFAULT_NEW_ITINERARY_STATUS,
  activityType: 'Tour',
  date: new Date().toISOString().slice(0, 10),
  name: '',
  startLocation: '',
  startTime: '',
  duration: '',
  cost: '0',
  freeCancelBy: new Date().toISOString().slice(0, 10),
  bookedOn: '',
  reference: '',
  paidBy: [],
  travelerIds: [],
});

export const buildActivityPayload = (draft: TourDraft, defaultPayerId?: string | null): { payload?: TourDraft; error?: string } => {
  const status = normalizeItineraryStatus(draft.status, DEFAULT_NEW_ITINERARY_STATUS);
  const activityType = ACTIVITY_TYPES.includes(draft.activityType) ? draft.activityType : 'Tour';
  if (!shouldRelaxRequiredFields(status) && !draft.name.trim()) return { error: 'Please enter an activity name.' };
  const cleanCost = sanitizeCostInput(draft.cost || '');
  let payload: TourDraft = { ...draft, activityType, status, cost: cleanCost };
  if ((!payload.paidBy || payload.paidBy.length === 0) && defaultPayerId) {
    payload = { ...payload, paidBy: [defaultPayerId] };
  }
  return { payload };
};

export const createActivityForTrip = async (params: {
  backendUrl: string;
  jsonHeaders: Record<string, string>;
  draft: TourDraft;
  activeTripId: string | null;
  defaultPayerId?: string | null;
}): Promise<{ ok: boolean; error?: string }> => {
  const { backendUrl, jsonHeaders, draft, activeTripId, defaultPayerId } = params;
  if (!activeTripId) return { ok: false, error: 'Select an active trip before saving an activity.' };
  const { payload, error } = buildActivityPayload(draft, defaultPayerId);
  if (error || !payload) return { ok: false, error };
  const res = await fetch(`${backendUrl}/api/activities`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      ...payload,
      tripId: activeTripId,
      freeCancelBy: payload.freeCancelBy?.trim() || null,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || 'Unable to save activity' };
  return { ok: true };
};

export const removeActivityApi = async (
  backendUrl: string,
  jsonHeaders: Record<string, string>,
  id: string
): Promise<{ ok: boolean; error?: string }> => {
  const res = await fetch(`${backendUrl}/api/activities/${id}`, { method: 'DELETE', headers: jsonHeaders });
  if (!res.ok) {
    let data: any = {};
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    return { ok: false, error: data.error || 'Unable to delete activity' };
  }
  return { ok: true };
};

export const fetchActivitiesForTrip = async ({
  backendUrl,
  activeTripId,
  token,
}: {
  backendUrl: string;
  activeTripId: string | null;
  token?: string | null;
}): Promise<Tour[]> => {
  if (!activeTripId || !token) return [];
  const res = await fetch(`${backendUrl}/api/activities?tripId=${activeTripId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data as any[]).map((t) => ({
    ...t,
    activityType: ACTIVITY_TYPES.includes(t.activityType) ? t.activityType : 'Tour',
    status: normalizeItineraryStatus(t.status, LEGACY_ITINERARY_STATUS),
    netVotes: Number(t.netVotes ?? 0) || 0,
    userVote: t.userVote === 1 || t.userVote === -1 ? t.userVote : null,
    netRating: Number(t.netRating ?? 0) || 0,
    userRating: t.userRating === 1 || t.userRating === -1 ? t.userRating : null,
    cost: String(t.cost ?? ''),
    paidBy: Array.isArray(t.paidBy) ? t.paidBy : [],
    travelerIds: Array.isArray(t.travelerIds) ? t.travelerIds : [],
    bookedOn: t.bookedOn ?? '',
    freeCancelBy: t.freeCancelBy ?? '',
  }));
};

type NativeDateTimePickerType = typeof import('@react-native-community/datetimepicker').default;

type TourTabProps = {
  backendUrl: string;
  userToken: string | null;
  activeTripId: string | null;
  tours: Tour[];
  setTours: React.Dispatch<React.SetStateAction<Tour[]>>;
  defaultPayerId: string | null;
  payerName: (id: string) => string;
  formatMemberName: (member: GroupMemberOption) => string;
  groupMembers: GroupMemberOption[];
  jsonHeaders: Record<string, string>;
  payerTotals: Record<string, number>;
  toursTotal: number;
  styles: ReturnType<typeof StyleSheet.create>;
  nativeDateTimePicker: NativeDateTimePickerType | null;
  fetchTours: (token?: string) => Promise<void>;
  onDataChanged?: () => void;
  mode?: 'live' | 'wizard';
};

export const ActivityTab: React.FC<TourTabProps> = ({
  backendUrl,
  userToken,
  activeTripId,
  tours,
  setTours,
  defaultPayerId,
  payerName,
  formatMemberName,
  groupMembers,
  jsonHeaders,
  payerTotals,
  toursTotal,
  styles,
  nativeDateTimePicker,
  fetchTours,
  onDataChanged,
  mode = 'live',
}) => {
  const [editingTour, setEditingTour] = useState<TourDraft | null>(null);
  const [editingTourId, setEditingTourId] = useState<string | null>(null);
  const [tourDateField, setTourDateField] = useState<'date' | 'bookedOn' | 'freeCancel' | 'startTime' | null>(null);
  const [tourDateValue, setTourDateValue] = useState<Date>(new Date());
  const DateTimePickerComponent = nativeDateTimePicker;
  const activeMembers = useMemo(
    () => groupMembers.filter((m) => m.status !== 'removed' && !m.removedAt),
    [groupMembers]
  );

  const resolveTravelerLabel = (member: GroupMemberOption) => {
    const first = member.firstName?.trim() ?? '';
    const last = member.lastName?.trim() ?? '';
    if (first || last) return `${first} ${last}`.trim();
    const guest = member.guestName?.trim() ?? '';
    if (guest) return guest;
    const email = (member.email ?? '').trim();
    if (email) return email;
    return 'Traveler';
  };

  const toggleBaseStyle = styles.toggleOption ?? {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#111',
    backgroundColor: '#fff',
  };
  const toggleSelectedStyle = styles.toggleOptionSelected ?? {
    backgroundColor: '#e5e7eb',
    borderColor: '#111',
  };
  const toggleTextStyle = styles.toggleOptionText ?? { color: '#111', fontWeight: '600' };
  const toggleTextSelectedStyle = styles.toggleOptionTextSelected ?? { color: '#111' };

  const openTourEditor = (tour?: Tour) => {
    if (mode !== 'wizard' && !activeTripId) {
      alert('Select an active trip before adding an activity.');
      return;
    }
    const base = tour ? { ...tour, travelerIds: tour.travelerIds ?? (tour as any).travelerIds ?? [] } : createInitialActivityState();
    if (!base.travelerIds?.length) {
      base.travelerIds = activeMembers.map((m) => m.id);
    }
    if (!tour && defaultPayerId && !base.paidBy.includes(defaultPayerId)) {
      base.paidBy = [...base.paidBy, defaultPayerId];
    }
    setEditingTour(base);
    setEditingTourId(tour?.id ?? null);
    const baseDate = tour?.date ?? new Date().toISOString().slice(0, 10);
    setTourDateValue(baseDate ? new Date(baseDate) : new Date());
  };

  const closeTourEditor = () => {
    setEditingTour(null);
    setEditingTourId(null);
    setTourDateField(null);
  };

  const openTourDatePicker = (field: 'date' | 'bookedOn' | 'freeCancel' | 'startTime') => {
    setTourDateField(field);
    if (!editingTour) return;
    const current =
      field === 'date'
        ? editingTour.date
        : field === 'bookedOn'
          ? editingTour.bookedOn
          : field === 'freeCancel'
            ? editingTour.freeCancelBy
            : editingTour.startTime;
    if (field === 'startTime') {
      const base = new Date();
      if (current && /^\d{1,2}:\d{2}/.test(current)) {
        const [h, m] = current.split(':').map(Number);
        if (!Number.isNaN(h) && !Number.isNaN(m)) {
          base.setHours(h, m, 0, 0);
        }
      }
      setTourDateValue(base);
    } else {
      setTourDateValue(current ? new Date(current) : new Date());
    }
  };

  const saveTour = () => {
    if (!editingTour) return;
    const status = normalizeItineraryStatus(editingTour.status, DEFAULT_NEW_ITINERARY_STATUS);
    if (!shouldRelaxRequiredFields(status) && !editingTour.name.trim()) {
      alert('Please enter an activity name.');
      return;
    }
    const cleanCost = (editingTour.cost || '').replace(/[^0-9.]/g, '');
    let payload: TourDraft = {
      ...editingTour,
      activityType: ACTIVITY_TYPES.includes(editingTour.activityType) ? editingTour.activityType : 'Tour',
      status,
      cost: cleanCost,
    };
    if ((!payload.paidBy || payload.paidBy.length === 0) && defaultPayerId) {
      payload = { ...payload, paidBy: [defaultPayerId] };
    }
    if (mode === 'wizard') {
      setTours((prev) => {
        const next: Tour = {
          id: editingTourId ?? `wizard-tour-${Date.now()}-${Math.round(Math.random() * 10000)}`,
          ...payload,
        };
        if (editingTourId) {
          return prev.map((t) => (t.id === editingTourId ? next : t));
        }
        return [...prev, next];
      });
      closeTourEditor();
      return;
    }
    if (!activeTripId) {
      alert('Select an active trip before saving an activity.');
      return;
    }
    const method = editingTourId ? 'PUT' : 'POST';
    const url = editingTourId ? `${backendUrl}/api/activities/${editingTourId}` : `${backendUrl}/api/activities`;
    (async () => {
      try {
        const res = await fetch(url, {
          method,
          headers: jsonHeaders,
          body: JSON.stringify({
            ...payload,
            tripId: activeTripId,
            freeCancelBy: payload.freeCancelBy?.trim() || null,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Unable to save activity (status ${res.status})`);
        }
        onDataChanged ? onDataChanged() : await fetchTours();
        closeTourEditor();
      } catch (err: any) {
        console.error('saveActivity failed', err);
        alert(err.message || 'Unable to save activity');
      }
    })();
  };

  const removeTour = (id: string) => {
    if (mode === 'wizard') {
      setTours((prev) => prev.filter((t) => t.id !== id));
      return;
    }
    removeActivityApi(backendUrl, jsonHeaders, id)
      .then((result) => {
        if (!result.ok) throw new Error(result.error || 'Unable to delete activity');
        onDataChanged ? onDataChanged() : fetchTours();
      })
      .catch((err) => alert(err.message));
  };

  const voteOnTour = async (id: string, value: 1 | -1) => {
    try {
      const res = await fetch(`${backendUrl}/api/activities/${id}/vote`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to submit vote');
      }
      onDataChanged ? onDataChanged() : await fetchTours();
    } catch (err: any) {
      alert(err?.message || 'Unable to submit vote');
    }
  };

  const rateTour = async (id: string, value: 1 | -1) => {
    try {
      const res = await fetch(`${backendUrl}/api/activities/${id}/rating`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to submit rating');
      }
      onDataChanged ? onDataChanged() : await fetchTours();
    } catch (err: any) {
      alert(err?.message || 'Unable to submit rating');
    }
  };

  const payerTotalsList = useMemo(() => Object.entries(payerTotals), [payerTotals]);
  const sortedTours = useMemo(() => {
    const safeDate = (value?: string | null) => {
      const text = String(value ?? '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '9999-12-31';
    };
    const safeTime = (value?: string | null) => {
      const text = String(value ?? '').trim();
      return /^\d{2}:\d{2}$/.test(text) ? text : '23:59';
    };
    return [...tours].sort((a, b) => {
      const byDate = safeDate(a.date).localeCompare(safeDate(b.date));
      if (byDate !== 0) return byDate;
      const byTime = safeTime(a.startTime).localeCompare(safeTime(b.startTime));
      if (byTime !== 0) return byTime;
      return String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' });
    });
  }, [tours]);

  return (
    <View style={styles.card}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Activities</Text>
        <TouchableOpacity style={[styles.button, styles.roundButton]} onPress={() => openTourEditor()} testID="activity-add">
          <Text style={styles.buttonText}>+</Text>
        </TouchableOpacity>
      </View>
      {Platform.OS !== 'web' && tourDateField && editingTour && DateTimePickerComponent ? (
        <DateTimePickerComponent
          value={tourDateValue}
          mode={tourDateField === 'startTime' ? 'time' : 'date'}
          onChange={(_, date) => {
            if (!date) {
              setTourDateField(null);
              return;
            }
            const iso = date.toISOString().slice(0, 10);
            setEditingTour((prev) => {
              if (!prev) return prev;
              if (tourDateField === 'startTime') {
                const hours = String(date.getHours()).padStart(2, '0');
                const mins = String(date.getMinutes()).padStart(2, '0');
                return { ...prev, startTime: `${hours}:${mins}` };
              }
              if (tourDateField === 'date') return { ...prev, date: iso };
              if (tourDateField === 'bookedOn') return { ...prev, bookedOn: iso };
              return { ...prev, freeCancelBy: iso };
            });
            setTourDateField(null);
          }}
        />
      ) : null}
      <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            {[
              { label: 'Date', width: 140 },
              { label: 'Status', width: 130 },
              { label: 'Votes', width: 120 },
              { label: 'Rating', width: 120 },
              { label: 'Activity', width: 180 },
              { label: 'Type', width: 180 },
              { label: 'Start Location', width: 180 },
              { label: 'Start Time', width: 120 },
              { label: 'Duration', width: 120 },
              { label: 'Cost', width: 120 },
              { label: 'Free Cancel By', width: 160 },
              { label: 'Platform Booked On', width: 140 },
              { label: 'Reference', width: 140 },
              { label: 'Paid By', width: 180 },
              { label: 'Actions', width: 160 },
            ].map((col, idx, arr) => (
              <View key={col.label} style={[styles.cell, { minWidth: col.width, flex: 1 }, idx === arr.length - 1 && styles.lastCell]}>
                <Text style={styles.headerText}>{col.label}</Text>
              </View>
            ))}
          </View>
          {sortedTours.map((t) => (
            <View key={t.id} style={styles.tableRow} testID={`activity-row-${t.id}`}>
              <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                <Text style={styles.cellText}>{formatDateLong(t.date)}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 130, flex: 1 }]}>
                <Text style={styles.cellText}>{normalizeItineraryStatus(t.status, LEGACY_ITINERARY_STATUS)}</Text>
              </View>
              <View style={[styles.cell, styles.actionCell, { minWidth: 120, flex: 1 }]}>
                {shouldShowVoteButtons(t.status, t.userVote) ? (
                  <>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => voteOnTour(t.id, 1)}>
                      <Text style={styles.buttonText}>👍</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => voteOnTour(t.id, -1)}>
                      <Text style={styles.buttonText}>👎</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <Text style={styles.cellText}>{formatNetVotes(t.netVotes ?? 0)}</Text>
                )}
              </View>
              <View style={[styles.cell, styles.actionCell, { minWidth: 120, flex: 1 }]}>
                {shouldShowRatingButtons(t.status, t.userRating) ? (
                  <>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => rateTour(t.id, 1)}>
                      <Text style={styles.buttonText}>👍</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => rateTour(t.id, -1)}>
                      <Text style={styles.buttonText}>👎</Text>
                    </TouchableOpacity>
                  </>
                ) : normalizeItineraryStatus(t.status, LEGACY_ITINERARY_STATUS) === 'Completed' ? (
                  <Text style={styles.cellText}>{formatNetVotes(t.netRating ?? 0)}</Text>
                ) : (
                  <Text style={styles.cellText}>-</Text>
                )}
              </View>
              <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                <Text style={styles.cellText}>{t.name || '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                <Text style={styles.cellText}>{t.activityType || 'Tour'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                <Text style={styles.cellText}>{t.startLocation || '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                <Text style={styles.cellText}>{t.startTime || '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                <Text style={styles.cellText}>{t.duration || '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                <Text style={styles.cellText}>{t.cost ? `$${t.cost}` : '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 160, flex: 1 }]}>
                <Text style={styles.cellText}>{t.freeCancelBy ? formatDateLong(t.freeCancelBy) : '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                <Text style={styles.cellText}>{t.bookedOn || '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                <Text style={styles.cellText}>{t.reference || '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                <Text style={styles.cellText}>{t.paidBy.length ? t.paidBy.map(payerName).join(', ') : '-'}</Text>
              </View>
              <View style={[styles.cell, styles.actionCell, styles.lastCell, { minWidth: 160, flex: 1 }]}>
                <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => openTourEditor(t)} testID={`activity-edit-${t.id}`}>
                  <Text style={styles.buttonText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => removeTour(t.id)} testID={`activity-delete-${t.id}`}>
                  <Text style={styles.buttonText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={{ marginTop: 8 }}>
            <Text style={styles.flightTitle}>Total activity cost: ${toursTotal.toFixed(2)}</Text>
        {payerTotalsList.length ? (
          <View style={{ marginTop: 4 }}>
            {payerTotalsList.map(([id, total]) => (
              <Text key={id} style={styles.helperText}>
                {payerName(id)}: ${total.toFixed(2)}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      {editingTour ? (
        <Modal transparent visible={Boolean(editingTour)} animationType="fade" onRequestClose={closeTourEditor}>
          <View style={styles.modalOverlay} testID="activity-form-modal">
            <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={closeTourEditor} />
            <View style={[styles.modalCard, { marginTop: 0 }]}>
            <Text style={styles.sectionTitle}>{editingTourId ? 'Edit Activity' : 'Add Activity'}</Text>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingRight: 12 }}>
              <Text style={styles.modalLabel}>Date</Text>
              {Platform.OS === 'web' ? (
                <input
                  style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                  type="date"
                  title="Activity date"
                  value={editingTour.date}
                  onChange={(e) => setEditingTour((p) => (p ? { ...p, date: e.target.value } : p))}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openTourDatePicker('date')}>
                  <Text style={styles.cellText}>{formatDateLong(editingTour.date)}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Status</Text>
              {Platform.OS === 'web' ? (
                <select
                  value={normalizeItineraryStatus(editingTour.status, DEFAULT_NEW_ITINERARY_STATUS)}
                  onChange={(e) => setEditingTour((p) => (p ? { ...p, status: normalizeItineraryStatus(e.target.value, DEFAULT_NEW_ITINERARY_STATUS) } : p))}
                  style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                >
                  {ITINERARY_STATUSES.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <View style={styles.payerChips}>
                  {ITINERARY_STATUSES.map((opt) => {
                    const selected = normalizeItineraryStatus(editingTour.status, DEFAULT_NEW_ITINERARY_STATUS) === opt;
                    return (
                      <TouchableOpacity
                        key={`tour-status-${opt}`}
                        style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                        onPress={() => setEditingTour((p) => (p ? { ...p, status: opt } : p))}
                      >
                        <Text style={[toggleTextStyle, selected && toggleTextSelectedStyle]}>{opt}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              <Text style={styles.modalLabel}>Activity Type</Text>
              {Platform.OS === 'web' ? (
                <select
                  value={editingTour.activityType || 'Tour'}
                  onChange={(e) =>
                    setEditingTour((p) =>
                      p
                        ? {
                            ...p,
                            activityType: ACTIVITY_TYPES.includes(e.target.value as ActivityType)
                              ? (e.target.value as ActivityType)
                              : 'Tour',
                          }
                        : p
                    )
                  }
                  style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                >
                  {ACTIVITY_TYPES.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <View style={styles.payerChips}>
                  {ACTIVITY_TYPES.map((opt) => {
                    const selected = (editingTour.activityType || 'Tour') === opt;
                    return (
                      <TouchableOpacity
                        key={`activity-type-${opt}`}
                        style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                        onPress={() => setEditingTour((p) => (p ? { ...p, activityType: opt } : p))}
                      >
                        <Text style={[toggleTextStyle, selected && toggleTextSelectedStyle]}>{opt}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              <Text style={styles.modalLabel}>Activity</Text>
              <TextInput
                style={styles.input}
                placeholder="Activity name"
                value={editingTour.name}
                onChangeText={(text: string) => setEditingTour((p) => (p ? { ...p, name: text } : p))}
              />
              <Text style={styles.modalLabel}>Start location</Text>
              <TextInput
                style={styles.input}
                placeholder="Start location"
                value={editingTour.startLocation}
                onChangeText={(text: string) => setEditingTour((p) => (p ? { ...p, startLocation: text } : p))}
              />
              <Text style={styles.modalLabel}>Start time</Text>
              {Platform.OS === 'web' ? (
                <input
                  style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                  type="time"
                  title="Start time"
                  value={editingTour.startTime}
                  onChange={(e) => setEditingTour((p) => (p ? { ...p, startTime: e.target.value } : p))}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openTourDatePicker('startTime')}>
                  <Text style={styles.cellText}>{editingTour.startTime || 'Select time'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Duration</Text>
              <TextInput
                style={styles.input}
                placeholder="Duration"
                value={editingTour.duration}
                onChangeText={(text: string) => setEditingTour((p) => (p ? { ...p, duration: text } : p))}
              />
              <Text style={styles.modalLabel}>Cost</Text>
              <TextInput
                style={styles.input}
                placeholder="Cost"
                keyboardType="numeric"
                value={editingTour.cost}
                onChangeText={(text: string) => setEditingTour((p) => (p ? { ...p, cost: sanitizeCostInput(text) } : p))}
              />
              <View style={styles.modalRow}>
                <Text style={styles.modalLabel}>Free cancellation by</Text>
                <TouchableOpacity onPress={() => setEditingTour((p) => (p ? { ...p, freeCancelBy: '' } : p))}>
                  <Text style={styles.linkText}>Clear</Text>
                </TouchableOpacity>
              </View>
              {Platform.OS === 'web' ? (
                <input
                  style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                  type="date"
                  title="Free cancellation by date"
                  value={editingTour.freeCancelBy}
                  onChange={(e) => setEditingTour((p) => (p ? { ...p, freeCancelBy: e.target.value } : p))}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openTourDatePicker('freeCancel')}>
                  <Text style={styles.cellText}>{editingTour.freeCancelBy ? formatDateLong(editingTour.freeCancelBy) : 'Select date'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Platform Booked On</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <TextInput
                  style={[styles.input, { flex: 1, minWidth: 220 }]}
                  placeholder="Viator, Get Your Guide, Klook, etc."
                  value={editingTour.bookedOn}
                  onChangeText={(text: string) => setEditingTour((p) => (p ? { ...p, bookedOn: text } : p))}
                />
                <TextInput
                  style={[styles.input, { flex: 1, minWidth: 220 }]}
                  placeholder="Reference"
                  value={editingTour.reference}
                  onChangeText={(text: string) => setEditingTour((p) => (p ? { ...p, reference: text } : p))}
                />
              </View>
              <Text style={styles.modalLabel}>Participants</Text>
              <View style={styles.payerChips}>
                {activeMembers.map((m) => {
                  const selected = editingTour.travelerIds.includes(m.id);
                  const name = resolveTravelerLabel(m);
                  return (
                    <TouchableOpacity
                      key={`tour-participant-${m.id}`}
                      style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                      onPress={() => {
                        const next = selected
                          ? editingTour.travelerIds.filter((id) => id !== m.id)
                          : [...editingTour.travelerIds, m.id];
                        setEditingTour((p) => (p ? { ...p, travelerIds: next } : p));
                      }}
                    >
                      <Text style={[toggleTextStyle, selected && toggleTextSelectedStyle]}>{name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.modalLabel}>Paid by</Text>
              <View style={styles.payerChips}>
                {activeMembers.map((m) => {
                  const selected = editingTour.paidBy.includes(m.id);
                  const name = resolveTravelerLabel(m);
                  return (
                    <TouchableOpacity
                      key={`tour-payer-${m.id}`}
                      style={[toggleBaseStyle, selected && toggleSelectedStyle]}
                      onPress={() => {
                        const next = selected
                          ? editingTour.paidBy.filter((id) => id !== m.id)
                          : [...editingTour.paidBy, m.id];
                        setEditingTour((p) => (p ? { ...p, paidBy: next } : p));
                      }}
                    >
                      <Text style={[toggleTextStyle, selected && toggleTextSelectedStyle]}>{name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
            <View style={[styles.tableFooter, { justifyContent: 'space-between' }]}>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={closeTourEditor} testID="activity-cancel">
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={saveTour} testID="activity-save">
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
};

