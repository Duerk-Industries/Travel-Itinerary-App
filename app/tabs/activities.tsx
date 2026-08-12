import React, { useMemo, useState } from 'react';
import { Alert, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import HorizontalTableScroll from '../components/HorizontalTableScroll';
import { formatDateLong } from '../utils/formatDateLong';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { toWebStyle } from '../utils/webStyle';
import { formatMemberDisplayName } from '../utils/memberDisplay';
import type { AppTheme } from '../theme/theme';
import { formatNetVotes, shouldShowRatingButtons, shouldShowVoteButtons } from '../utils/votes';
import GetYourGuideCta from '../components/GetYourGuideCta';
import EditableDataGrid, { type GridCellError, type GridColumn } from '../components/EditableDataGrid';
import TripItemDetailsDialog from '../components/TripItemDetailsDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import { resolveMemberClipboardValue } from '../utils/clipboardGrid';
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

type ActivitySort = {
  key: string | null;
  direction: 'asc' | 'desc';
};

const activitySortValue = (tour: Tour, key: string): string | number => {
  const value = tour[key as keyof Tour];
  if (Array.isArray(value)) return value.join('; ');
  if (value === null || value === undefined) return '';
  if (key === 'netRating' || key === 'userRating' || key === 'netVotes' || key === 'cost') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : '';
  }
  if (key === 'status') return normalizeItineraryStatus(String(value), LEGACY_ITINERARY_STATUS);
  return String(value);
};

const sortActivityRows = (rows: Tour[], sort: ActivitySort): Tour[] => {
  const key = sort.key ?? 'date';
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftValue = activitySortValue(left, key);
    const rightValue = activitySortValue(right, key);
    const leftEmpty = leftValue === '';
    const rightEmpty = rightValue === '';
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      if (leftValue !== rightValue) return (leftValue - rightValue) * direction;
    } else {
      const comparison = String(leftValue).localeCompare(String(rightValue), undefined, { sensitivity: 'base', numeric: true });
      if (comparison !== 0) return comparison * direction;
    }
    if (sort.key === null && key === 'date') {
      const timeComparison = String(left.startTime ?? '').localeCompare(String(right.startTime ?? ''), undefined, { numeric: true });
      if (timeComparison !== 0) return timeComparison;
      return String(left.name ?? '').localeCompare(String(right.name ?? ''), undefined, { sensitivity: 'base', numeric: true });
    }
    return 0;
  });
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
  destination?: string | null;
  featureGridEditing?: boolean;
  featureGridEditingClipboard?: boolean;
  featureStandardizedItemDialogs?: boolean;
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
  destination = null,
  featureGridEditing = false,
  featureGridEditingClipboard = false,
  featureStandardizedItemDialogs = false,
}) => {
  const [editingTour, setEditingTour] = useState<TourDraft | null>(null);
  const [editingTourId, setEditingTourId] = useState<string | null>(null);
  const [selectedTourId, setSelectedTourId] = useState<string | null>(null);
  const [tableEditing, setTableEditing] = useState(false);
  const [gridRows, setGridRows] = useState<Tour[]>([]);
  const [gridOriginalRows, setGridOriginalRows] = useState<Tour[]>([]);
  const [gridDeleteIds, setGridDeleteIds] = useState<Set<string>>(new Set());
  const [gridHistory, setGridHistory] = useState<Array<{ rows: Tour[]; deleteIds: string[] }>>([]);
  const [gridRedo, setGridRedo] = useState<Array<{ rows: Tour[]; deleteIds: string[] }>>([]);
  const [gridErrors, setGridErrors] = useState<GridCellError[]>([]);
  // Separate from gridErrors (client-side validation, which blocks Save until fixed):
  // these are server-reported per-row failures from a previous partial-failure bulk
  // save. They're shown as row highlights/messages too, but must NOT block retrying
  // Save — since their columnKey ('actions') isn't a real editable field, they could
  // otherwise never be cleared and would permanently deadlock the editing session.
  const [gridServerErrors, setGridServerErrors] = useState<GridCellError[]>([]);
  const [gridMessage, setGridMessage] = useState<string | null>(null);
  const [gridSaving, setGridSaving] = useState(false);
  const [activitySort, setActivitySort] = useState<ActivitySort>({ key: null, direction: 'asc' });
  const [tourToDelete, setTourToDelete] = useState<Tour | null>(null);
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
    // Close the editor immediately on Save — the request below runs in the
    // background so the dialog never appears to hang while it's in flight.
    closeTourEditor();
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
  const sortedTours = useMemo(() => sortActivityRows(tours, activitySort), [tours, activitySort]);
  const sortedGridRows = useMemo(() => sortActivityRows(gridRows, activitySort), [gridRows, activitySort]);
  const sortActivityTable = (key: string) => {
    setActivitySort((current) => current.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' });
  };
  const selectedTour = useMemo(
    () => (selectedTourId ? tours.find((tour) => tour.id === selectedTourId) ?? null : null),
    [selectedTourId, tours]
  );

  const gridColumns = useMemo<GridColumn<Tour>[]>(() => {
    const people = (ids?: string[]) => (ids ?? []).map((id) => memberLabelById.get(id) ?? payerName(id) ?? id).join('; ');
    return [
      { key: 'date', label: 'Date', width: 140, editor: 'date', getValue: (row) => row.date },
      { key: 'activityType', label: 'Type', width: 180, editor: 'select', options: ACTIVITY_TYPES, getValue: (row) => row.activityType || 'Tour' },
      { key: 'name', label: 'Activity', width: 220, editor: 'text', sticky: 'left', getValue: (row) => row.name || '' },
      { key: 'startLocation', label: 'Start Location', width: 190, editor: 'text', getValue: (row) => row.startLocation || '' },
      { key: 'startTime', label: 'Start Time', width: 120, editor: 'time', getValue: (row) => row.startTime || '' },
      { key: 'duration', label: 'Duration', width: 130, editor: 'text', getValue: (row) => row.duration || '' },
      { key: 'status', label: 'Status', width: 135, editor: 'select', options: ITINERARY_STATUSES, getValue: (row) => normalizeItineraryStatus(row.status, LEGACY_ITINERARY_STATUS) },
      { key: 'cost', label: 'Cost', width: 110, editor: 'decimal', getValue: (row) => String(row.cost ?? '') },
      { key: 'freeCancelBy', label: 'Free Cancel By', width: 150, editor: 'date', getValue: (row) => row.freeCancelBy || '' },
      { key: 'bookedOn', label: 'Booked On', width: 170, editor: 'text', getValue: (row) => row.bookedOn || '' },
      { key: 'reference', label: 'Reference', width: 170, editor: 'text', getValue: (row) => row.reference || '' },
      { key: 'notes', label: 'Notes', width: 240, editor: 'textarea', getValue: (row) => row.notes || '' },
      {
        key: 'paidBy',
        label: 'Paid By',
        width: 210,
        editor: 'multiSelect',
        getValue: (row) => people(row.paidBy),
        getSelectedIds: (row) => row.paidBy ?? [],
        pickerOptions: activeMembers.map((member) => ({ id: member.id, label: formatMemberDisplayName(member) })),
      },
      {
        key: 'travelerIds',
        label: 'Travelers',
        width: 210,
        editor: 'multiSelect',
        getValue: (row) => people(row.travelerIds),
        getSelectedIds: (row) => row.travelerIds ?? [],
        pickerOptions: activeMembers.map((member) => ({ id: member.id, label: formatMemberDisplayName(member) })),
      },
      { key: 'netRating', label: 'Rating', width: 110, editor: 'readonly', editable: false, getValue: (row) => String(row.netRating ?? 0) },
      { key: 'userRating', label: 'Your Rating', width: 120, editor: 'readonly', editable: false, getValue: (row) => row.userRating ? String(row.userRating) : '-' },
      { key: 'netVotes', label: 'Votes', width: 100, editor: 'readonly', editable: false, getValue: (row) => String(row.netVotes ?? 0) },
      { key: 'suggestions', label: 'Suggestions', width: 140, editor: 'readonly', editable: false, getValue: () => 'See details' },
      { key: 'actions', label: 'Actions', width: 110, editor: 'action', sticky: 'right', editable: false, sortable: false, getValue: () => '' },
    ];
  }, [memberLabelById, payerName, activeMembers]);

  const beginGridEdit = () => {
    if (readOnly || !featureGridEditing) return;
    const snapshot = tours.map((tour) => ({ ...tour, paidBy: [...tour.paidBy], travelerIds: [...(tour.travelerIds ?? [])] }));
    setGridRows(snapshot);
    setGridOriginalRows(snapshot);
    setGridDeleteIds(new Set());
    setGridHistory([]);
    setGridRedo([]);
    setGridErrors([]);
    setGridServerErrors([]);
    setGridMessage(null);
    setTableEditing(true);
  };

  const cancelGridEdit = () => {
    setTableEditing(false);
    setGridRows([]);
    setGridOriginalRows([]);
    setGridDeleteIds(new Set());
    setGridHistory([]);
    setGridRedo([]);
    setGridErrors([]);
    setGridServerErrors([]);
    setGridMessage(null);
  };

  const recordGridChange = (nextRows: Tour[], nextDeleteIds: Set<string>, changedRowIds: string[] = []) => {
    setGridHistory((previous) => [...previous.slice(-99), { rows: gridRows, deleteIds: Array.from(gridDeleteIds) }]);
    setGridRedo([]);
    setGridRows(nextRows);
    setGridDeleteIds(nextDeleteIds);
    // The user is actively changing this row again (editing a field, or staging/
    // un-staging its deletion) — clear any stale server-reported failure for it so a
    // prior partial-failure Save doesn't permanently block retrying.
    if (changedRowIds.length) {
      setGridServerErrors((errors) => errors.filter((error) => !changedRowIds.includes(error.rowId)));
    }
  };

  const undoGridChange = () => {
    const previous = gridHistory[gridHistory.length - 1];
    if (!previous) return;
    setGridHistory((items) => items.slice(0, -1));
    setGridRedo((items) => [...items, { rows: gridRows, deleteIds: Array.from(gridDeleteIds) }]);
    setGridRows(previous.rows);
    setGridDeleteIds(new Set(previous.deleteIds));
  };

  const redoGridChange = () => {
    const next = gridRedo[gridRedo.length - 1];
    if (!next) return;
    setGridRedo((items) => items.slice(0, -1));
    setGridHistory((items) => [...items, { rows: gridRows, deleteIds: Array.from(gridDeleteIds) }]);
    setGridRows(next.rows);
    setGridDeleteIds(new Set(next.deleteIds));
  };

  const setGridError = (rowId: string, columnKey: string, message?: string) => {
    setGridErrors((errors) => {
      const remaining = errors.filter((error) => !(error.rowId === rowId && error.columnKey === columnKey));
      return message ? [...remaining, { rowId, columnKey, message }] : remaining;
    });
  };

  const changeGridCell = (rowId: string, columnKey: string, rawValue: string) => {
    const row = gridRows.find((item) => item.id === rowId);
    const column = gridColumns.find((item) => item.key === columnKey);
    if (!row || !column || column.editor === 'readonly' || column.editor === 'action') return;
    let value: unknown = rawValue;
    if ((column.editor === 'date' || column.editor === 'time') && rawValue && !((column.editor === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(rawValue)) || (column.editor === 'time' && /^\d{2}:\d{2}$/.test(rawValue)))) {
      setGridError(rowId, columnKey, column.editor === 'date' ? 'Use YYYY-MM-DD.' : 'Use HH:mm.');
      return;
    }
    if (column.editor === 'decimal') {
      value = sanitizeCostInput(rawValue);
      if (rawValue && !/^\d*(\.\d*)?$/.test(String(value))) {
        setGridError(rowId, columnKey, 'Enter a non-negative decimal.');
        return;
      }
    }
    if (column.editor === 'select' && !(column.options ?? []).includes(rawValue)) {
      setGridError(rowId, columnKey, 'Select a supported option.');
      return;
    }
    if (column.editor === 'multiSelect') {
      const resolved = resolveMemberClipboardValue(rawValue, activeMembers.map((member) => ({ id: member.id, label: formatMemberDisplayName(member), email: member.email })));
      if (!resolved.ok) {
        setGridError(rowId, columnKey, resolved.error);
        return;
      }
      value = resolved.value;
    }
    setGridError(rowId, columnKey);
    const nextRows = gridRows.map((item) => item.id === rowId ? { ...item, [columnKey]: value } as Tour : item);
    recordGridChange(nextRows, new Set(gridDeleteIds), [rowId]);
  };

  const changeGridCells = (changes: Array<{ rowId: string; columnKey: string; value: string }>) => {
    let nextRows = gridRows;
    const nextErrors = [...gridErrors];
    const clearError = (rowId: string, columnKey: string) => {
      for (let index = nextErrors.length - 1; index >= 0; index -= 1) {
        if (nextErrors[index].rowId === rowId && nextErrors[index].columnKey === columnKey) nextErrors.splice(index, 1);
      }
    };
    for (const change of changes) {
      const row = nextRows.find((item) => item.id === change.rowId);
      const column = gridColumns.find((item) => item.key === change.columnKey);
      if (!row || !column || column.editor === 'readonly' || column.editor === 'action') continue;
      let value: unknown = change.value;
      const validDateOrTime = column.editor === 'date'
        ? !change.value || /^\d{4}-\d{2}-\d{2}$/.test(change.value)
        : column.editor === 'time'
          ? !change.value || /^\d{2}:\d{2}$/.test(change.value)
          : true;
      if (!validDateOrTime) {
        nextErrors.push({ rowId: change.rowId, columnKey: change.columnKey, message: column.editor === 'date' ? 'Use YYYY-MM-DD.' : 'Use HH:mm.' });
        continue;
      }
      if (column.editor === 'decimal') {
        value = sanitizeCostInput(change.value);
        if (change.value && !/^\d*(\.\d*)?$/.test(String(value))) {
          nextErrors.push({ rowId: change.rowId, columnKey: change.columnKey, message: 'Enter a non-negative decimal.' });
          continue;
        }
      }
      if (column.editor === 'select' && !(column.options ?? []).includes(change.value)) {
        nextErrors.push({ rowId: change.rowId, columnKey: change.columnKey, message: 'Select a supported option.' });
        continue;
      }
      if (column.editor === 'multiSelect') {
        const resolved = resolveMemberClipboardValue(change.value, activeMembers.map((member) => ({ id: member.id, label: formatMemberDisplayName(member), email: member.email })));
        if (!resolved.ok) {
          nextErrors.push({ rowId: change.rowId, columnKey: change.columnKey, message: resolved.error });
          continue;
        }
        value = resolved.value;
      }
      clearError(change.rowId, change.columnKey);
      nextRows = nextRows.map((item) => item.id === change.rowId ? { ...item, [change.columnKey]: value } as Tour : item);
    }
    setGridErrors(nextErrors);
    if (nextRows !== gridRows) recordGridChange(nextRows, new Set(gridDeleteIds), Array.from(new Set(changes.map((change) => change.rowId))));
  };

  const toggleGridDelete = (rowId: string) => {
    const next = new Set(gridDeleteIds);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    recordGridChange(gridRows, next, [rowId]);
  };

  const saveGridEdit = async () => {
    if (!tableEditing || gridSaving) return;
    const originalById = new Map(gridOriginalRows.map((row) => [row.id, row]));
    const editableKeys = gridColumns.filter((column) => column.editable !== false && column.editor !== 'action' && column.editor !== 'readonly').map((column) => column.key as keyof Tour);
    const operations: Array<{ kind: 'update' | 'delete'; id: string; fields?: Record<string, unknown> }> = [];
    for (const row of gridRows) {
      if (gridDeleteIds.has(row.id)) {
        operations.push({ kind: 'delete', id: row.id });
        continue;
      }
      const original = originalById.get(row.id);
      if (!original) continue;
      const fields: Record<string, unknown> = {};
      editableKeys.forEach((key) => {
        const before = original[key];
        const after = row[key];
        if (JSON.stringify(before) !== JSON.stringify(after)) fields[String(key)] = String(key) === 'freeCancelBy' && after === '' ? null : after;
      });
      if (Object.keys(fields).length) operations.push({ kind: 'update', id: row.id, fields });
    }
    if (operations.length > 200) {
      setGridMessage('Save up to 200 changed rows per editing session.');
      return;
    }
    const validationErrors = gridRows
      .filter((row) => !gridDeleteIds.has(row.id))
      .map((row) => ({ row, validation: buildActivityPayload(row as TourDraft, defaultPayerId) }))
      .filter(({ validation }) => Boolean(validation.error));
    if (validationErrors.length) {
      validationErrors.forEach(({ row, validation }) => setGridError(row.id, 'name', validation.error));
      setGridMessage('Fix the highlighted cells before saving.');
      return;
    }
    if (gridErrors.length) {
      setGridMessage('Fix the highlighted cells before saving.');
      return;
    }
    if (mode === 'wizard') {
      setTours((current) => current.filter((item) => !gridDeleteIds.has(item.id)).map((item) => gridRows.find((row) => row.id === item.id) ?? item));
      cancelGridEdit();
      return;
    }
    if (!activeTripId) {
      setGridMessage('Select an active trip before saving.');
      return;
    }
    setGridSaving(true);
    const succeededUpdateIds = new Set<string>();
    const succeededDeleteIds = new Set<string>();
    const failures: GridCellError[] = [];
    for (let index = 0; index < operations.length; index += 50) {
      const chunk = operations.slice(index, index + 50);
      const response = await fetch(`${backendUrl}/api/activities/bulk`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({
          tripId: activeTripId,
          updates: chunk.filter((operation) => operation.kind === 'update').map((operation) => ({ id: operation.id, fields: operation.fields })),
          deletes: chunk.filter((operation) => operation.kind === 'delete').map((operation) => operation.id),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setGridMessage(payload.error || 'Unable to save activity changes.');
        setGridSaving(false);
        return;
      }
      for (const result of payload.updates ?? []) {
        if (result.ok) succeededUpdateIds.add(String(result.id));
        else failures.push({ rowId: String(result.id), columnKey: 'actions', message: String(result.error || 'Unable to save row') });
      }
      for (const result of payload.deletes ?? []) {
        if (result.ok) succeededDeleteIds.add(String(result.id));
        else failures.push({ rowId: String(result.id), columnKey: 'actions', message: String(result.error || 'Unable to delete row') });
      }
    }
    if (failures.length) {
      // Partial failure: reconcile the rows/deletes that DID succeed into the local
      // baseline so a retry only resubmits what's actually still outstanding, and
      // doesn't re-attempt an already-deleted row (which would otherwise come back
      // from the server as a confusing "not found" failure on the next try).
      if (succeededUpdateIds.size || succeededDeleteIds.size) {
        setGridOriginalRows((current) =>
          current
            .filter((row) => !succeededDeleteIds.has(row.id))
            .map((row) => {
              if (!succeededUpdateIds.has(row.id)) return row;
              const latest = gridRows.find((candidate) => candidate.id === row.id);
              return latest ?? row;
            })
        );
        if (succeededDeleteIds.size) {
          setGridRows((current) => current.filter((row) => !succeededDeleteIds.has(row.id)));
          setGridDeleteIds((current) => {
            const next = new Set(current);
            succeededDeleteIds.forEach((id) => next.delete(id));
            return next;
          });
        }
      }
      setGridServerErrors(failures);
      setGridMessage('Some rows could not be saved. Review the highlighted rows and try again.');
      setGridSaving(false);
      return;
    }
    onDataChanged ? onDataChanged() : await fetchTours();
    setGridSaving(false);
    cancelGridEdit();
  };

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
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {featureGridEditing && !tableEditing ? (
              <TouchableOpacity style={styles.button} onPress={beginGridEdit} testID="activity-table-edit">
                <Text style={styles.buttonText}>Edit table</Text>
              </TouchableOpacity>
            ) : null}
            {tableEditing ? (
              <>
                <TouchableOpacity
                  disabled={gridSaving}
                  style={[styles.button, styles.dangerButton, gridSaving && { opacity: 0.45 }]}
                  onPress={cancelGridEdit}
                  testID="activity-table-cancel"
                >
                  <Text style={styles.dangerButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={gridSaving}
                  style={[styles.button, gridSaving && { opacity: 0.45 }]}
                  onPress={saveGridEdit}
                  testID="activity-table-save"
                >
                  <Text style={styles.buttonText}>{gridSaving ? 'Saving…' : 'Save changes'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={gridSaving || gridHistory.length === 0}
                  style={[styles.button, { width: 36, height: 36, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, (gridSaving || gridHistory.length === 0) && { opacity: 0.45 }]}
                  onPress={undoGridChange}
                  accessibilityLabel="Undo activity table change"
                  testID="activity-table-undo"
                >
                  <Text style={styles.buttonText}>↶</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={gridSaving || gridRedo.length === 0}
                  style={[styles.button, { width: 36, height: 36, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, (gridSaving || gridRedo.length === 0) && { opacity: 0.45 }]}
                  onPress={redoGridChange}
                  accessibilityLabel="Redo activity table change"
                  testID="activity-table-redo"
                >
                  <Text style={styles.buttonText}>↷</Text>
                </TouchableOpacity>
              </>
            ) : null}
            {!tableEditing ? (
              <TouchableOpacity style={[styles.button, styles.roundButton]} onPress={() => openTourEditor()} testID="activity-add">
                <Text style={styles.buttonText}>+</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
      {gridMessage ? <Text style={styles.helperText}>{gridMessage}</Text> : null}
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
      {tableEditing ? (
        <>
          <HorizontalTableScroll style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
          <EditableDataGrid
            rows={sortedGridRows}
            columns={gridColumns}
            clipboardEnabled={Platform.OS === 'web' && featureGridEditingClipboard}
            disabled={gridSaving}
            cellErrors={gridServerErrors.length ? [...gridErrors, ...gridServerErrors] : gridErrors}
            stagedDeleteIds={gridDeleteIds}
            onCellChange={changeGridCell}
            onCellsChange={changeGridCells}
            onDeleteRow={toggleGridDelete}
            onUndo={undoGridChange}
            onRedo={redoGridChange}
            sortKey={activitySort.key}
            sortDirection={activitySort.direction}
            onSort={sortActivityTable}
            onError={setGridMessage}
            styles={styles}
            theme={theme}
            nativeDateTimePicker={DateTimePickerComponent}
          />
          </HorizontalTableScroll>
        </>
      ) : null}
      {!tableEditing ? <>
        <HorizontalTableScroll
          style={styles.tableScroll}
          contentContainerStyle={styles.tableScrollContent}
        >
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]} testID="activity-table-header">
            {[
              { key: 'date', label: 'Date', width: 140 },
              { key: 'activityType', label: 'Type', width: 180 },
              { key: 'name', label: 'Activity', width: 220 },
              { key: 'startTime', label: 'Start Time', width: 120 },
              { key: 'duration', label: 'Duration', width: 120 },
              { key: 'status', label: 'Status', width: 130 },
              { key: 'netRating', label: 'Rating', width: 120 },
            ].map((col, idx, arr) => (
              <TouchableOpacity
                key={col.key}
                style={[styles.cell, { minWidth: col.width, flex: 1 }, col.key === 'name' && Platform.OS === 'web' && ({ position: 'sticky', left: 0, zIndex: 4, backgroundColor: theme?.colors.surface } as any), idx === arr.length - 1 && styles.lastCell]}
                onPress={() => sortActivityTable(col.key)}
                accessibilityRole="button"
                accessibilityLabel={`Sort by ${col.label}`}
                testID={`activity-sort-${col.key}`}
              >
                <Text style={styles.headerText}>{`${col.label}${activitySort.key === col.key ? (activitySort.direction === 'asc' ? ' ▲' : ' ▼') : ''}`}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {sortedTours.map((t) => (
            <TouchableOpacity key={t.id} style={styles.tableRow} testID={`activity-row-${t.id}`} onPress={() => { if (!readOnly) openTourEditor(t); }} activeOpacity={0.8}>
              <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                <Text style={styles.cellText}>{formatDateLong(t.date)}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                <Text style={styles.cellText}>{t.activityType || 'Tour'}</Text>
              </View>
              <View style={[styles.cell, { minWidth: 220, flex: 1 }, Platform.OS === 'web' && ({ position: 'sticky', left: 0, zIndex: 3, backgroundColor: theme?.colors.surface } as any)]}>
                <TouchableOpacity onPress={(event: any) => { event?.stopPropagation?.(); setSelectedTourId(t.id); }} testID={`activity-details-${t.id}`}>
                  <Text style={[styles.cellText, styles.linkText]}>{t.name || '-'}</Text>
                </TouchableOpacity>
                {mode !== 'wizard' ? (
                  <GetYourGuideCta
                    backendUrl={backendUrl}
                    headers={jsonHeaders}
                    activity={t}
                    destination={destination}
                  />
                ) : null}
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
            </TouchableOpacity>
          ))}
        </View>
        </HorizontalTableScroll>
      </> : null}
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
      {selectedTour && !featureStandardizedItemDialogs ? (
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
      {selectedTour && featureStandardizedItemDialogs ? (
        <TripItemDetailsDialog
          visible={Boolean(selectedTour)}
          kind="activity"
          title={selectedTour.name || 'Activity'}
          subtitle={formatPeopleList(selectedTour.travelerIds)}
          status={normalizeItineraryStatus(selectedTour.status, LEGACY_ITINERARY_STATUS)}
          styles={styles}
          readOnly={readOnly}
          rows={[
            { label: 'Date', value: formatDateLong(selectedTour.date) },
            { label: 'Type', value: selectedTour.activityType || 'Tour' },
            { label: 'Start Location', value: selectedTour.startLocation || '-' },
            { label: 'Start Time', value: selectedTour.startTime || '-' },
            { label: 'Duration', value: selectedTour.duration || '-' },
            { label: 'Cost', value: selectedTour.cost ? `$${selectedTour.cost}` : '-' },
            { label: 'Platform Booked On', value: selectedTour.bookedOn || '-' },
            { label: 'Free Cancel By', value: selectedTour.freeCancelBy ? formatDateLong(selectedTour.freeCancelBy) : '-' },
            { label: 'Reference', value: selectedTour.reference || '-' },
            { label: 'Description', value: selectedTour.notes || '-' },
            { label: 'Paid by', value: formatPeopleList(selectedTour.paidBy) },
            { label: 'Attendees', value: formatPeopleList(selectedTour.travelerIds) },
            { label: 'Rating', value: formatNetVotes(selectedTour.netRating ?? 0) },
            { label: 'Votes', value: formatNetVotes(selectedTour.netVotes ?? 0) },
          ]}
          theme={theme}
          onClose={() => setSelectedTourId(null)}
          onEdit={() => { openTourEditor(selectedTour); setSelectedTourId(null); }}
          onDelete={() => setTourToDelete(selectedTour)}
          testID="activity-details-modal"
        />
      ) : null}
      {tourToDelete ? (
        <ConfirmDialog
          visible
          title="Delete Activity"
          message={`Delete ${tourToDelete.name || 'this activity'}? This will be applied when the current action is confirmed.`}
          onConfirm={() => { const id = tourToDelete.id; setTourToDelete(null); removeTour(id); }}
          onCancel={() => setTourToDelete(null)}
          styles={styles}
        />
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

