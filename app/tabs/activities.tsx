import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import { singlePayerIds } from '../utils/payerSelection';
import AddToCalendarButton from '../components/AddToCalendarButton';
import { activityCalendarEvent } from '../utils/calendarEvents';
import type { Activity, PlanningCoordinates } from '../../server/src/types';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Modal from '../components/KeyboardAwareModal';
import HorizontalTableScroll from '../components/HorizontalTableScroll';
import { startItemSaveTask } from '../utils/analytics/track';
import { formatDateLong } from '../utils/formatDateLong';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { formatMemberDisplayName } from '../utils/memberDisplay';

import { formatNetVotes, shouldShowRatingButtons } from '../utils/votes';
import GetYourGuideCta from '../components/GetYourGuideCta';
import EditableDataGrid, { type GridCellError, type GridColumn } from '../components/EditableDataGrid';
import TripItemDetailsDialog from '../components/TripItemDetailsDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import CsvTransferControls from '../components/CsvTransferControls';
import ActivityEditForm, { type ActivityFormLodging } from '../components/ActivityEditForm';
import { resolveMemberClipboardValue } from '../utils/clipboardGrid';
import { fixedTableColumn } from '../utils/tableColumns';
import {
  DEFAULT_NEW_ITINERARY_STATUS,
  LEGACY_ITINERARY_STATUS,
  type ItineraryStatus,
  normalizeItineraryStatus,
  shouldRelaxRequiredFields,
  ITINERARY_STATUSES,
} from '../utils/itineraryStatus';

// A row's flex columns must resolve to the exact same pixel widths as every
// other row (including the header) for the columns to actually line up.
// `flex: 1` with only a `minWidth` floor doesn't guarantee that: if one
// row's cell content is wider than its minWidth (e.g. a long activity name
// plus its GetYourGuideCta link), that row's flex-basis grows, and the
// leftover space every OTHER row's `flex: 1` columns divide up shifts by a
// different amount per row -- producing exactly the ragged, row-by-row
// column drift this was reported for. A literal fixed `width` with growth
// and shrink both disabled makes every row's columns identical regardless
// of what's inside any one cell.
const fixedColumnStyle = fixedTableColumn;

import { ACTIVITY_TYPES, type ActivityType } from '../utils/activityTypes';
export { ACTIVITY_TYPES, type ActivityType } from '../utils/activityTypes';

export type Tour = PlanningCoordinates & Pick<Activity, 'nearLodgingId'> & {
  dayPosition?: number | null;
  catalogId?: string | null;
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

export type TourDraft = Pick<Activity, 'nearLodgingId'> & {
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

const sortActivityRows = (rows: Tour[], sort: ActivitySort, lodgings: ActivityFormLodging[] = []): Tour[] => {
  const key = sort.key ?? 'date';
  const direction = sort.direction === 'asc' ? 1 : -1;
  const hotelEndDates = new Map(lodgings.map((hotel) => [hotel.id, hotel.checkOutDate?.slice(0, 10) ?? '']));
  const activityDate = (tour: Tour): string => {
    if (tour.date) return tour.date;
    const checkout = tour.nearLodgingId ? hotelEndDates.get(tour.nearLodgingId) : '';
    return checkout && /^\d{4}-\d{2}-\d{2}$/.test(checkout) ? checkout : '';
  };
  return [...rows].sort((left, right) => {
    const leftValue = key === 'date' ? activityDate(left) : activitySortValue(left, key);
    const rightValue = key === 'date' ? activityDate(right) : activitySortValue(right, key);
    const leftEmpty = leftValue === '';
    const rightEmpty = rightValue === '';
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      if (leftValue !== rightValue) return (leftValue - rightValue) * direction;
    } else {
      const comparison = String(leftValue).localeCompare(String(rightValue), undefined, { sensitivity: 'base', numeric: true });
      if (comparison !== 0) return comparison * direction;
    }
    // Optional choices follow every scheduled activity on the hotel's checkout day.
    if (key === 'date' && Boolean(left.date) !== Boolean(right.date)) return left.date ? -1 : 1;
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
  let payload: TourDraft = { ...draft, activityType, status, cost: cleanCost, paidBy: singlePayerIds(draft.paidBy, defaultPayerId) };
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
  const res = await startItemSaveTask('activities', false, activeTripId).request(`${backendUrl}/api/activities`, {
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

// Status changes otherwise only ever ride inside a full-record save
// (saveTour) or the grid editor's bulk-PATCH (saveGridEdit) -- this is a
// small, standalone status-only helper following createActivityForTrip's
// exact convention above, added for the AI assistant's updateItineraryStatus
// tool (see app/utils/assistantTools.ts), which only ever has an id + a new
// status, not a full draft to save.
export const updateActivityStatus = async (params: {
  backendUrl: string;
  jsonHeaders: Record<string, string>;
  activeTripId: string | null;
  activityId: string;
  status: ItineraryStatus;
}): Promise<{ ok: boolean; error?: string }> => {
  const { backendUrl, jsonHeaders, activeTripId, activityId, status } = params;
  if (!activeTripId) return { ok: false, error: 'Select an active trip before updating status.' };
  const res = await fetch(`${backendUrl}/api/activities/bulk`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ tripId: activeTripId, updates: [{ id: activityId, fields: { status } }], deletes: [] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || 'Unable to update status' };
  // The bulk endpoint can 200 with a per-row failure -- check the specific
  // row's own `ok`, not just `res.ok` (same handling saveGridEdit already
  // does for its own bulk-PATCH calls above).
  const result = (data.updates ?? []).find((u: any) => String(u.id) === activityId);
  if (result && !result.ok) return { ok: false, error: result.error || 'Unable to update status' };
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
  if (!res.ok) throw new Error('Unable to load trip details');
  const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Invalid trip details response');
  return (data as any[]).map(normalizeActivityFromApi);
};

/** A template activity that fits a city and day of this trip, offered until the traveler adds it. */
export type ActivitySuggestion = {
  key: string;
  name: string;
  city: string;
  activityType: string;
  startTime: string;
  duration: string;
  startLocation: string;
  description: string;
  image: { url: string; credit: string } | null;
  bookAhead: boolean;
  dates: string[];
};

// Suggestions are a nicety: any failure, or the templates switched off, just means none are shown.
export const fetchActivitySuggestions = async ({
  backendUrl,
  activeTripId,
  token,
}: {
  backendUrl: string;
  activeTripId: string | null;
  token?: string | null;
}): Promise<{ suggestions: ActivitySuggestion[]; dismissedCount: number }> => {
  const none = { suggestions: [], dismissedCount: 0 };
  if (!activeTripId || !token) return none;
  try {
    const res = await fetch(`${backendUrl}/api/trip-templates/trips/${activeTripId}/activity-suggestions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return none;
    const data = await res.json();
    return Array.isArray(data?.suggestions) ? { suggestions: data.suggestions, dismissedCount: Number(data.dismissedCount) || 0 } : none;
  } catch {
    return none;
  }
};

// A dismissal is saved for this traveler on the trip; restoring brings back everything they dismissed.
const sendSuggestionDismissal = async (backendUrl: string, token: string | null, tripId: string, key?: string): Promise<boolean> => {
  try {
    const res = await fetch(`${backendUrl}/api/trip-templates/trips/${tripId}/activity-suggestions/dismissals`, {
      method: key ? 'POST' : 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(key ? { body: JSON.stringify({ key }) } : {}),
    });
    return res.ok;
  } catch {
    return false;
  }
};

const SUGGESTIONS_COLLAPSED = 4;

export const normalizeActivityFromApi = (t: any): Tour => ({
    ...t,
    date: t.date ?? '',
    nearLodgingId: t.nearLodgingId ?? null,
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
  });

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
  fetchTours: (token?: string) => Promise<void>;
  onDataChanged?: () => void;
  mode?: 'live' | 'wizard';
  readOnly?: boolean;
  defaultActivityDate?: string | null;
  lodgings?: ActivityFormLodging[];
  tripEndDate?: string | null;
  destination?: string | null;
  featureGridEditing?: boolean;
  featureGridEditingClipboard?: boolean;
  featureActivityLodgingCsvImport?: boolean;
  featureActivityLodgingCsvExport?: boolean;
  featureStandardizedItemDialogs?: boolean;
  externalEditTourId?: string | null;
  onExternalEditHandled?: () => void;
  showList?: boolean;
  // Kill switch for row-tap-to-edit + sticky identity/actions columns
  // (implementation-plan-ux-remediation.md, Initiative A). Defaults to `true`.
  featureTapToEditTables?: boolean;
  featureActivityRecap?: boolean;
  onOpenActivityRecap?: (activity: Tour) => void;
  /** Offer template activities that fit the days and cities of this trip. Off unless the page asks for it. */
  showSuggestions?: boolean;
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
  theme: _providedTheme,
  fetchTours,
  onDataChanged,
  mode = 'live',
  readOnly = false,
  defaultActivityDate = null,
  lodgings = [],
  tripEndDate = null,
  destination = null,
  featureGridEditing = false,
  featureGridEditingClipboard = false,
  featureActivityLodgingCsvImport = false,
  featureActivityLodgingCsvExport = false,
  featureStandardizedItemDialogs = false,
  externalEditTourId,
  onExternalEditHandled,
  showList = true,
  featureTapToEditTables = true,
  featureActivityRecap = false,
  onOpenActivityRecap,
  showSuggestions = false,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
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
  const activeMembers = useMemo(
    () => groupMembers.filter((m) => m.status !== 'removed' && !m.removedAt),
    [groupMembers]
  );
  const memberLabelById = useMemo(() => {
    const labels = new Map<string, string>();
    activeMembers.forEach((member) => labels.set(member.id, formatMemberDisplayName(member)));
    return labels;
  }, [activeMembers]);

  const formatPeopleList = (ids?: string[]) => {
    if (!ids?.length) return '-';
    return ids.map((id) => memberLabelById.get(id) ?? payerName(id) ?? id).join(', ');
  };

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
  };

  // `lodgings` defaults to a fresh array each render, so the effect watches a signature of it instead.
  const lodgingSignature = lodgings.map((l) => `${l.id}:${l.checkInDate ?? ''}:${l.checkOutDate ?? ''}`).join('|');
  const tourSignature = tours.map((t) => `${t.id}:${t.name}:${t.date}`).join('|');
  const [suggestions, setSuggestions] = useState<ActivitySuggestion[]>([]);
  const [dismissedCount, setDismissedCount] = useState(0);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  useEffect(() => {
    if (!showSuggestions || mode === 'wizard' || readOnly || !showList) {
      setSuggestions([]);
      setDismissedCount(0);
      return undefined;
    }
    let cancelled = false;
    fetchActivitySuggestions({ backendUrl, activeTripId, token: userToken }).then((found) => {
      if (cancelled) return;
      setSuggestions(found.suggestions);
      setDismissedCount(found.dismissedCount);
    });
    // Lodgings place the traveler and activities take suggestions off the list, so refresh when either changes.
    return () => { cancelled = true; };
  }, [backendUrl, activeTripId, userToken, mode, readOnly, showList, showSuggestions, tourSignature, lodgingSignature]);
  const visibleSuggestions = suggestions;
  const dismissSuggestion = async (key: string) => {
    if (!activeTripId) return;
    if (!(await sendSuggestionDismissal(backendUrl, userToken, activeTripId, key))) {
      Alert.alert('Unable to dismiss this suggestion. Please try again.');
      return;
    }
    setSuggestions((current) => current.filter((s) => s.key !== key));
    setDismissedCount((count) => count + 1);
  };
  const restoreSuggestions = async () => {
    if (!activeTripId || !(await sendSuggestionDismissal(backendUrl, userToken, activeTripId))) return;
    const found = await fetchActivitySuggestions({ backendUrl, activeTripId, token: userToken });
    setSuggestions(found.suggestions);
    setDismissedCount(found.dismissedCount);
  };

  // Adding a suggestion goes through the normal editor, so the traveler confirms the details before it is saved.
  const openSuggestionEditor = (suggestion: ActivitySuggestion, date: string) => {
    if (readOnly || !activeTripId) return;
    const base: TourDraft = {
      ...createInitialActivityState(date || defaultActivityDate),
      date,
      status: suggestion.bookAhead ? 'Needs Booking' : 'Proposed',
      activityType: ACTIVITY_TYPES.includes(suggestion.activityType as ActivityType) ? (suggestion.activityType as ActivityType) : 'Tour',
      name: suggestion.name,
      startLocation: suggestion.startLocation,
      startTime: suggestion.startTime,
      duration: suggestion.duration,
      notes: suggestion.description,
      travelerIds: activeMembers.map((m) => m.id),
    };
    if (defaultPayerId) base.paidBy = [defaultPayerId];
    setEditingTour(base);
    setEditingTourId(null);
  };

  const closeTourEditor = () => {
    setEditingTour(null);
    setEditingTourId(null);
    onExternalEditHandled?.();
  };

  useEffect(() => {
    if (!externalEditTourId) return;
    const target = tours.find((tour) => tour.id === externalEditTourId);
    if (target) {
      openTourEditor(target);
    } else {
      onExternalEditHandled?.();
    }
  }, [externalEditTourId, tours]);

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
      paidBy: singlePayerIds(editingTour.paidBy, defaultPayerId),
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
    const saveTask = startItemSaveTask('activities', Boolean(editingTourId), activeTripId);
    (async () => {
      try {
        const res = await saveTask.request(url, {
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
  const sortedTours = useMemo(() => sortActivityRows(tours, activitySort, lodgings), [tours, activitySort, lodgings]);
  const sortedGridRows = useMemo(() => sortActivityRows(gridRows, activitySort, lodgings), [gridRows, activitySort, lodgings]);
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
        editor: 'singleSelect',
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
    if (column.editor === 'multiSelect' || column.editor === 'singleSelect') {
      const resolved = resolveMemberClipboardValue(rawValue, activeMembers.map((member) => ({ id: member.id, label: formatMemberDisplayName(member), email: member.email })));
      if (!resolved.ok) {
        setGridError(rowId, columnKey, resolved.error);
        return;
      }
      if (column.editor === 'singleSelect' && resolved.value.length > 1) {
        setGridError(rowId, columnKey, 'Select only one payer.');
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
      if (column.editor === 'multiSelect' || column.editor === 'singleSelect') {
        const resolved = resolveMemberClipboardValue(change.value, activeMembers.map((member) => ({ id: member.id, label: formatMemberDisplayName(member), email: member.email })));
        if (!resolved.ok) {
          nextErrors.push({ rowId: change.rowId, columnKey: change.columnKey, message: resolved.error });
          continue;
        }
        if (column.editor === 'singleSelect' && resolved.value.length > 1) {
          nextErrors.push({ rowId: change.rowId, columnKey: change.columnKey, message: 'Select only one payer.' });
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
    // One edit task per grid save (deletes alone are not edits).
    const gridTask = operations.some((operation) => operation.kind === 'update') ? startItemSaveTask('activities', true, activeTripId) : null;
    const succeededUpdateIds = new Set<string>();
    const succeededDeleteIds = new Set<string>();
    const failures: GridCellError[] = [];
    for (let index = 0; index < operations.length; index += 50) {
      const chunk = operations.slice(index, index + 50);
      const bulkRequest = { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({
          tripId: activeTripId,
          updates: chunk.filter((operation) => operation.kind === 'update').map((operation) => ({ id: operation.id, fields: operation.fields })),
          deletes: chunk.filter((operation) => operation.kind === 'delete').map((operation) => operation.id),
        }),
      };
      const bulkUrl = `${backendUrl}/api/activities/bulk`;
      const response = gridTask ? await gridTask.request(bulkUrl, bulkRequest) : await fetch(bulkUrl, bulkRequest);
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
    <View style={[styles.modalRow, themeStyle('tabs_activities_1', {  }, (theme ?? _styleTheme))]} key={label}>
      <Text style={[styles.cellText, themeStyle('tabs_activities_2', {  }, (theme ?? _styleTheme))]}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={[styles.cellText, themeStyle('tabs_activities_3', {  }, (theme ?? _styleTheme))]}>{value || '-'}</Text>
      ) : (
        value
      )}
    </View>
  );

  return (
    <View style={showList ? styles.card : undefined}>
      {showList ? (
        <>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Activities</Text>
        {!readOnly ? (
          <View style={themeStyle('tabs_activities_4', {  }, (theme ?? _styleTheme))}>
            {featureGridEditing && !tableEditing ? (
              <TouchableOpacity style={styles.button} onPress={beginGridEdit} testID="activity-table-edit">
                <Text style={styles.buttonText}>Edit table</Text>
              </TouchableOpacity>
            ) : null}
            {!tableEditing ? <CsvTransferControls entity="activities" backendUrl={backendUrl} headers={jsonHeaders} tripId={activeTripId} tripStart={defaultActivityDate} tripEnd={tripEndDate} rows={tours} styles={styles} theme={theme} enabledImport={featureActivityLodgingCsvImport} enabledExport={featureActivityLodgingCsvExport} readOnly={readOnly} onImported={onDataChanged ?? fetchTours} /> : null}
            {tableEditing ? (
              <>
                <TouchableOpacity
                  disabled={gridSaving}
                  style={[styles.button, styles.dangerButton, gridSaving && themeStyle('tabs_activities_5', {  }, (theme ?? _styleTheme))]}
                  onPress={cancelGridEdit}
                  testID="activity-table-cancel"
                >
                  <Text style={styles.dangerButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={gridSaving}
                  style={[styles.button, gridSaving && themeStyle('tabs_activities_6', {  }, (theme ?? _styleTheme))]}
                  onPress={saveGridEdit}
                  testID="activity-table-save"
                >
                  <Text style={styles.buttonText}>{gridSaving ? 'Saving…' : 'Save changes'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={gridSaving || gridHistory.length === 0}
                  style={[styles.button, themeStyle('tabs_activities_7', {  }, (theme ?? _styleTheme)), (gridSaving || gridHistory.length === 0) && themeStyle('tabs_activities_8', {  }, (theme ?? _styleTheme))]}
                  onPress={undoGridChange}
                  accessibilityLabel="Undo activity table change"
                  testID="activity-table-undo"
                >
                  <Text style={styles.buttonText}>↶</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={gridSaving || gridRedo.length === 0}
                  style={[styles.button, themeStyle('tabs_activities_9', {  }, (theme ?? _styleTheme)), (gridSaving || gridRedo.length === 0) && themeStyle('tabs_activities_10', {  }, (theme ?? _styleTheme))]}
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
                style={[styles.cell, fixedColumnStyle(col.width), col.key === 'name' && Platform.OS === 'web' && featureTapToEditTables && (themeStyle('tabs_activities_11', { theme: theme }, (theme ?? _styleTheme)) as any), idx === arr.length - 1 && styles.lastCell]}
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
            <TouchableOpacity key={t.id} style={styles.tableRow} testID={`activity-row-${t.id}`} onPress={() => { if (!readOnly && featureTapToEditTables) openTourEditor(t); }} activeOpacity={0.8}>
              <View style={[styles.cell, fixedColumnStyle(140)]}>
                <Text style={styles.cellText}>{t.date ? formatDateLong(t.date) : 'Optional'}</Text>
              </View>
              <View style={[styles.cell, fixedColumnStyle(180)]}>
                <Text style={styles.cellText}>{t.activityType || 'Tour'}</Text>
              </View>
              <View style={[styles.cell, fixedColumnStyle(220), Platform.OS === 'web' && featureTapToEditTables && (themeStyle('tabs_activities_12', { theme: theme }, (theme ?? _styleTheme)) as any)]}>
                <TouchableOpacity onPress={(event: any) => { event?.stopPropagation?.(); setSelectedTourId(t.id); }} testID={`activity-details-${t.id}`}>
                  <Text numberOfLines={1} style={[styles.cellText, styles.linkText]}>{t.name || '-'}</Text>
                </TouchableOpacity>
                {!readOnly && featureActivityRecap && normalizeItineraryStatus(t.status, LEGACY_ITINERARY_STATUS) === 'Completed' ? (
                  <TouchableOpacity onPress={(event: any) => { event?.stopPropagation?.(); onOpenActivityRecap?.(t); }} testID={`activity-recap-${t.id}`} style={themeStyle('tabs_activities_13', {  }, (theme ?? _styleTheme))}>
                    <Text style={[styles.linkText, themeStyle('tabs_activities_14', {  }, (theme ?? _styleTheme))]}>Recap</Text>
                  </TouchableOpacity>
                ) : null}
                {mode !== 'wizard' ? (
                  <GetYourGuideCta
                    backendUrl={backendUrl}
                    headers={jsonHeaders}
                    activity={t}
                    destination={destination}
                    theme={theme}
                    numberOfLines={1}
                  />
                ) : null}
              </View>
              <View style={[styles.cell, fixedColumnStyle(120)]}>
                <Text style={styles.cellText}>{t.startTime || '-'}</Text>
              </View>
              <View style={[styles.cell, fixedColumnStyle(120)]}>
                <Text style={styles.cellText}>{t.duration || '-'}</Text>
              </View>
              <View style={[styles.cell, fixedColumnStyle(130)]}>
                <Text style={styles.cellText}>{normalizeItineraryStatus(t.status, LEGACY_ITINERARY_STATUS)}</Text>
              </View>
              <View style={[styles.cell, styles.lastCell, fixedColumnStyle(120)]}>
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
      {mode !== 'wizard' && !readOnly && (visibleSuggestions.length || dismissedCount) ? (
        <View testID="activity-suggestions" style={themeStyle('tabs_activities_20', {  }, (theme ?? _styleTheme))}>
          <Text style={styles.sectionTitle}>Suggestions</Text>
          <Text style={styles.helperText}>Ideas for the places you will be, from the example itineraries. Add one to keep it, or dismiss it.</Text>
          {dismissedCount ? (
            <TouchableOpacity onPress={restoreSuggestions} testID="activity-suggestions-restore">
              <Text style={styles.linkText}>{`Bring back ${dismissedCount} dismissed`}</Text>
            </TouchableOpacity>
          ) : null}
          {(showAllSuggestions ? visibleSuggestions : visibleSuggestions.slice(0, SUGGESTIONS_COLLAPSED)).map((s) => (
            <View key={s.key} testID={`activity-suggestion-${s.key}`} style={themeStyle('tabs_activities_21', {  }, (theme ?? _styleTheme))}>
              {s.image ? <Image source={{ uri: s.image.url }} accessibilityIgnoresInvertColors accessibilityLabel={s.name} style={themeStyle('components_TripTemplatePicker_16', {  }, (theme ?? _styleTheme))} /> : null}
              <View style={themeStyle('tabs_activities_22', {  }, (theme ?? _styleTheme))}>
                <Text style={styles.cellText}>{s.name}</Text>
                <Text style={styles.helperText}>
                  {[s.city, s.dates.slice(0, 3).map((d) => formatDateLong(d)).join(', ') + (s.dates.length > 3 ? ` +${s.dates.length - 3} more` : ''), s.duration, s.bookAhead ? 'Book ahead' : ''].filter(Boolean).join(' · ')}
                </Text>
                {s.description ? <Text numberOfLines={3} style={styles.helperText}>{s.description}</Text> : null}
                {s.image ? <Text style={[styles.helperText, themeStyle('components_TripTemplatePicker_15', {  }, (theme ?? _styleTheme))]}>Photo: {s.image.credit}</Text> : null}
                <View style={themeStyle('tabs_activities_23', {  }, (theme ?? _styleTheme))}>
                  <TouchableOpacity style={styles.button} onPress={() => openSuggestionEditor(s, s.dates[0])} testID={`activity-suggestion-add-${s.key}`}>
                    <Text style={styles.buttonText}>{`Add to ${formatDateLong(s.dates[0])}`}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.button} onPress={() => openSuggestionEditor(s, '')} testID={`activity-suggestion-optional-${s.key}`}>
                    <Text style={styles.buttonText}>Add as optional</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={() => dismissSuggestion(s.key)} testID={`activity-suggestion-dismiss-${s.key}`}>
                    <Text style={styles.dangerButtonText}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
          {visibleSuggestions.length > SUGGESTIONS_COLLAPSED ? (
            <TouchableOpacity onPress={() => setShowAllSuggestions((current) => !current)} testID="activity-suggestions-toggle">
              <Text style={styles.linkText}>{showAllSuggestions ? 'Show fewer' : `Show all ${visibleSuggestions.length}`}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      <View style={themeStyle('tabs_activities_15', {  }, (theme ?? _styleTheme))}>
            <Text style={styles.flightTitle}>Total activity cost: ${toursTotal.toFixed(2)}</Text>
        {payerTotalsList.length ? (
          <View style={themeStyle('tabs_activities_16', {  }, (theme ?? _styleTheme))}>
            {payerTotalsList.map(([id, total]) => (
              <Text key={id} style={styles.helperText}>
                {payerName(id)}: ${total.toFixed(2)}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
        </>
      ) : null}
      {selectedTour && !featureStandardizedItemDialogs ? (
        <Modal transparent visible={Boolean(selectedTour)} animationType="fade" onRequestClose={() => setSelectedTourId(null)}>
          <View style={styles.modalOverlay} testID="activity-details-modal">
            <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={() => setSelectedTourId(null)} />
            <View style={[styles.modalCard, themeStyle('tabs_activities_17', {  }, (theme ?? _styleTheme))]}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Activity Details</Text>
              </View>
              <ScrollView style={themeStyle('tabs_activities_18', {  }, (theme ?? _styleTheme))} contentContainerStyle={themeStyle('tabs_activities_19', {  }, (theme ?? _styleTheme))}>
                <AddToCalendarButton event={activityCalendarEvent(selectedTour)} styles={styles} />
                {renderDetailRow('Date', selectedTour.date ? formatDateLong(selectedTour.date) : 'Optional')}
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
                        <Text style={styles.dangerButtonText}>👎</Text>
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
                <Text style={styles.modalLabel}>Actions</Text>
                <View style={styles.actionCell}>
                  {!readOnly && featureActivityRecap && normalizeItineraryStatus(selectedTour.status, LEGACY_ITINERARY_STATUS) === 'Completed' ? (
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => { onOpenActivityRecap?.(selectedTour); setSelectedTourId(null); }} testID={`activity-recap-${selectedTour.id}`}>
                      <Text style={styles.buttonText}>Recap</Text>
                    </TouchableOpacity>
                  ) : null}
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
          calendarEvent={activityCalendarEvent(selectedTour)}
          title={selectedTour.name || 'Activity'}
          subtitle={formatPeopleList(selectedTour.travelerIds)}
          status={normalizeItineraryStatus(selectedTour.status, LEGACY_ITINERARY_STATUS)}
          styles={styles}
          readOnly={readOnly}
          rows={[
            { label: 'Date', value: selectedTour.date ? formatDateLong(selectedTour.date) : 'Optional' },
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
          ]}
          theme={theme}
          onClose={() => setSelectedTourId(null)}
          onEdit={() => { openTourEditor(selectedTour); setSelectedTourId(null); }}
          onDelete={() => setTourToDelete(selectedTour)}
          secondaryAction={!readOnly && featureActivityRecap && normalizeItineraryStatus(selectedTour.status, LEGACY_ITINERARY_STATUS) === 'Completed'
            ? { label: 'Recap', testID: `activity-recap-${selectedTour.id}`, onPress: () => { onOpenActivityRecap?.(selectedTour); setSelectedTourId(null); } }
            : null}
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
        <ActivityEditForm
          lodgings={lodgings}
          draft={editingTour}
          onChange={(updater) => setEditingTour((prev) => (prev ? updater(prev) : prev))}
          onSave={saveTour}
          onCancel={closeTourEditor}
          isNew={!editingTourId}
          members={groupMembers}
          styles={styles}
          theme={theme}
        />
      ) : null}
    </View>
  );
};
