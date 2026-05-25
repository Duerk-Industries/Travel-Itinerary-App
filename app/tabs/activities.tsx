import React, { useMemo, useState } from 'react';
import { Alert, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { formatDateLong } from '../utils/formatDateLong';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { toWebStyle } from '../utils/webStyle';
import { formatMemberDisplayName } from '../utils/memberDisplay';
import type { AppTheme } from '../theme/theme';
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
  notes: string;
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
  notes: string;
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

const resolveInitialActivityDate = (preferredDate?: string | null): string => {
  const trimmed = String(preferredDate ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : new Date().toISOString().slice(0, 10);
};

// Build a blank activity draft with the trip's first date, when known, otherwise today.
export const createInitialActivityState = (preferredDate?: string | null): TourDraft => ({
  status: DEFAULT_NEW_ITINERARY_STATUS,
  activityType: 'Tour',
  date: resolveInitialActivityDate(preferredDate),
  name: '',
  startLocation: '',
  startTime: '',
  duration: '',
  cost: '0',
  freeCancelBy: new Date().toISOString().slice(0, 10),
  bookedOn: '',
  reference: '',
  notes: '',
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
    notes: t.notes ?? '',
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
  theme?: AppTheme;
  nativeDateTimePicker: NativeDateTimePickerType | null;
  fetchTours: (token?: string) => Promise<void>;
  onDataChanged?: () => void;
  mode?: 'live' | 'wizard';
  readOnly?: boolean;
  defaultActivityDate?: string | null;
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
  theme,
  nativeDateTimePicker,
  fetchTours,
  onDataChanged,
  mode = 'live',
  readOnly = false,
  defaultActivityDate = null,
}) => {
  const [editingTour, setEditingTour] = useState<TourDraft | null>(null);
  const [editingTourId, setEditingTourId] = useState<string | null>(null);
  const [selectedTourId, setSelectedTourId] = useState<string | null>(null);
  const [tourDateField, setTourDateField] = useState<'date' | 'bookedOn' | 'freeCancel' | 'startTime' | null>(null);
  const [tourDateValue, setTourDateValue] = useState<Date>(new Date());
  const DateTimePickerComponent = nativeDateTimePicker;
  const activeMembers = useMemo(
    () => groupMembers.filter((m) => m.status !== 'removed' && !m.removedAt),
    [groupMembers]
  );
  const memberLabelById = useMemo(() => {
    const labels = new Map<string, string>();
    activeMembers.forEach((member) => labels.set(member.id, formatMemberDisplayName(member)));
    return labels;
  }, [activeMembers]);

  const resolveTravelerLabel = (member: GroupMemberOption) => {
    return formatMemberDisplayName(member);
  };

  const formatPeopleList = (ids?: string[]) => {
    if (!ids?.length) return '-';
    return ids.map((id) => memberLabelById.get(id) ?? payerName(id) ?? id).join(', ');
  };

  const toggleBaseStyle = styles.toggleOption ?? {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme?.colors.border ?? '#111',
    backgroundColor: theme?.colors.surface ?? '#fff',
  };
  const toggleSelectedStyle = styles.toggleOptionSelected ?? {
    backgroundColor: theme ? (theme.mode === 'dark' ? '#1A3A50' : '#DDE8F0') : '#e5e7eb',
    borderColor: theme?.colors.link ?? '#111',
  };
  const toggleTextStyle = styles.toggleOptionText ?? { color: theme?.colors.text ?? '#111', fontWeight: '600' };
  const toggleTextSelectedStyle = styles.toggleOptionTextSelected ?? { color: theme?.colors.text ?? '#111' };

  const openTourEditor = (tour?: Tour) => {
    if (readOnly) return;
    if (mode !== 'wizard' && !activeTripId) {
      Alert.alert('Select an active trip before adding an activity.');
      return;
    }
    const base = tour
      ? { ...tour, travelerIds: tour.travelerIds ?? (tour as any).travelerIds ?? [] }
      : createInitialActivityState(defaultActivityDate);
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
    if (readOnly) return;
    if (!editingTour) return;
    const status = normalizeItineraryStatus(editingTour.status, DEFAULT_NEW_ITINERARY_STATUS);
    if (!shouldRelaxRequiredFields(status) && !editingTour.name.trim()) {
      Alert.alert('Please enter an activity name.');
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
      Alert.alert('Select an active trip before saving an activity.');
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
        Alert.alert(err.message || 'Unable to save activity');
      }
    })();
  };

  const removeTour = (id: string) => {
    if (readOnly) return;
    setSelectedTourId((current) => (current === id ? null : current));
    if (mode === 'wizard') {
      setTours((prev) => prev.filter((t) => t.id !== id));
      return;
    }
    removeActivityApi(backendUrl, jsonHeaders, id)
      .then((result) => {
        if (!result.ok) throw new Error(result.error || 'Unable to delete activity');
        onDataChanged ? onDataChanged() : fetchTours();
      })
      .catch((err) => Alert.alert(err.message));
  };

  const voteOnTour = async (id: string, value: 1 | -1) => {
    if (readOnly) return;
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
      Alert.alert(err?.message || 'Unable to submit vote');
    }
  };

  const rateTour = async (id: string, value: 1 | -1) => {
    if (readOnly) return;
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
      Alert.alert(err?.message || 'Unable to submit rating');
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
  const selectedTour = useMemo(
    () => (selectedTourId ? tours.find((tour) => tour.id === selectedTourId) ?? null : null),
    [selectedTourId, tours]
  );

  const renderDetailRow = (label: string, value: React.ReactNode) => (
    <View style={[styles.modalRow, { alignItems: 'flex-start' }]} key={label}>
      <Text style={[styles.cellText, { minWidth: 140, flexShrink: 0, fontWeight: '600' }]}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={[styles.cellText, { flex: 1 }]}>{value || '-'}</Text>
      ) : (
        value
      )}
    </View>
  );

  return (
    <View style={styles.card}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Activities</Text>
        {!readOnly ? (
          <TouchableOpacity style={[styles.button, styles.roundButton]} onPress={() => openTourEditor()} testID="activity-add">
            <Text style={styles.buttonText}>+</Text>
          </TouchableOpacity>
        ) : null}
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
          <View style={[styles.tableRow, styles.tableHeader]} testID="activity-table-header">
            {[
              { label: 'Date', width: 140 },
              { label: 'Type', width: 180 },
              { label: 'Activity', width: 220 },
              { label: 'Start Time', width: 120 },
              { label: 'Duration', width: 120 },
              { label: 'Status', width: 130 },
              { label: 'Rating', width: 120 },
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
              <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                <Text style={styles.cellText}>{t.activityType || 'Tour'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 220, flex: 1 }]}>
                <TouchableOpacity onPress={() => setSelectedTourId(t.id)} testID={`activity-details-${t.id}`}>
                  <Text style={[styles.cellText, styles.linkText]}>{t.name || '-'}</Text>
                </TouchableOpacity>
              </View>
              <View style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                <Text style={styles.cellText}>{t.startTime || '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                <Text style={styles.cellText}>{t.duration || '-'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 130, flex: 1 }]}>
                <Text style={styles.cellText}>{normalizeItineraryStatus(t.status, LEGACY_ITINERARY_STATUS)}</Text>
              </View>
              <View style={[styles.cell, styles.lastCell, { minWidth: 120, flex: 1 }]}>
                {normalizeItineraryStatus(t.status, LEGACY_ITINERARY_STATUS) === 'Completed' ? (
                  <Text style={styles.cellText}>{formatNetVotes(t.netRating ?? 0)}</Text>
                ) : (
                  <Text style={styles.cellText}>-</Text>
                )}
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
      {selectedTour ? (
        <Modal transparent visible={Boolean(selectedTour)} animationType="fade" onRequestClose={() => setSelectedTourId(null)}>
          <View style={styles.modalOverlay} testID="activity-details-modal">
            <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={() => setSelectedTourId(null)} />
            <View style={[styles.modalCard, { marginTop: 0 }]}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Activity Details</Text>
              </View>
              <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingRight: 12 }}>
                {renderDetailRow('Date', formatDateLong(selectedTour.date))}
                {renderDetailRow('Type', selectedTour.activityType || 'Tour')}
                {renderDetailRow('Activity', selectedTour.name || '-')}
                {renderDetailRow('Start Location', selectedTour.startLocation || '-')}
                {renderDetailRow('Start Time', selectedTour.startTime || '-')}
                {renderDetailRow('Duration', selectedTour.duration || '-')}
                {renderDetailRow('Status', normalizeItineraryStatus(selectedTour.status, LEGACY_ITINERARY_STATUS))}
                {renderDetailRow(
                  'Rating',
                  !readOnly && shouldShowRatingButtons(selectedTour.status, selectedTour.userRating) ? (
                    <View style={styles.actionCell}>
                      <Text style={styles.cellText}>{formatNetVotes(selectedTour.netRating ?? 0)}</Text>
                      <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => rateTour(selectedTour.id, 1)}>
                        <Text style={styles.buttonText}>👍</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => rateTour(selectedTour.id, -1)}>
                        <Text style={styles.buttonText}>👎</Text>
                      </TouchableOpacity>
                    </View>
                  ) : normalizeItineraryStatus(selectedTour.status, LEGACY_ITINERARY_STATUS) === 'Completed' ? (
                    formatNetVotes(selectedTour.netRating ?? 0)
                  ) : (
                    '-'
                  )
                )}
                {renderDetailRow('Cost', selectedTour.cost ? `$${selectedTour.cost}` : '-')}
                {renderDetailRow('Platform Booked On', selectedTour.bookedOn || '-')}
                {renderDetailRow('Free Cancel By', selectedTour.freeCancelBy ? formatDateLong(selectedTour.freeCancelBy) : '-')}
                {renderDetailRow('Reference', selectedTour.reference || '-')}
                {renderDetailRow('Description', selectedTour.notes || '-')}
                {renderDetailRow('Paid by', formatPeopleList(selectedTour.paidBy))}
                {renderDetailRow('Attendees', formatPeopleList(selectedTour.travelerIds))}
                {renderDetailRow(
                  'Votes',
                  !readOnly && shouldShowVoteButtons(selectedTour.status, selectedTour.userVote) ? (
                    <View style={styles.actionCell}>
                      <Text style={styles.cellText}>{formatNetVotes(selectedTour.netVotes ?? 0)}</Text>
                      <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => voteOnTour(selectedTour.id, 1)}>
                        <Text style={styles.buttonText}>👍</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => voteOnTour(selectedTour.id, -1)}>
                        <Text style={styles.buttonText}>👎</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    formatNetVotes(selectedTour.netVotes ?? 0)
                  )
                )}
                <Text style={styles.modalLabel}>Actions</Text>
                <View style={styles.actionCell}>
                  <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => setSelectedTourId(null)}>
                    <Text style={styles.buttonText}>Close</Text>
                  </TouchableOpacity>
                  {!readOnly ? (
                    <>
                    <TouchableOpacity
                      style={[styles.button, styles.smallButton]}
                      onPress={() => {
                        openTourEditor(selectedTour);
                        setSelectedTourId(null);
                      }}
                      testID={`activity-details-edit-${selectedTour.id}`}
                    >
                      <Text style={styles.buttonText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, styles.smallButton, styles.dangerButton]}
                      onPress={() => removeTour(selectedTour.id)}
                      testID={`activity-details-delete-${selectedTour.id}`}
                    >
                      <Text style={styles.dangerButtonText}>Delete</Text>
                    </TouchableOpacity>
                    </>
                  ) : (
                    <Text style={styles.cellText}>View only</Text>
                  )}
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
      {!readOnly && editingTour ? (
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
              <Text style={styles.modalLabel}>Description</Text>
              <TextInput
                style={[styles.input, { minHeight: 96, textAlignVertical: 'top' }]}
                placeholder="Description"
                value={editingTour.notes}
                onChangeText={(text: string) => setEditingTour((p) => (p ? { ...p, notes: text } : p))}
                multiline
              />
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
                <Text style={styles.dangerButtonText}>Cancel</Text>
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

