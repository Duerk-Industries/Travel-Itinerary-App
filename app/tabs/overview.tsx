// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, Text, TextInput, TouchableOpacity, View, Image, type LayoutChangeEvent } from 'react-native';
import { computeTripDays, validateTripDates } from '../utils/createTripWizard';
import { renderRichTextBlocks } from '../utils/richText';
import {
  buildOverviewRows,
  type DetailItem,
  formatFlightDetails,
  formatLodgingDetails,
  formatTourDetails,
  type OverviewRow,
} from '../utils/overviewBuilder';
import { type MapApp } from '../utils/mapLinks';
import {
  adjustStartDateForEarliest,
  formatMonthYear,
  getEarliestTripEventDate,
} from '../utils/tripDates';
import { normalizeDateString } from '../utils/normalizeDateString';
import {
  buildFlightPayload,
  createFlightDraftForTrip,
  createInitialFlightState,
  type Flight,
  type FlightEditDraft,
  type GroupMemberOption,
} from '../tabs/flights';
import {
  buildLodgingPayload,
  createInitialLodgingState,
  createLodgingForTrip,
  saveLodgingApi,
  toLodgingDraft,
  type LodgingDraft,
} from '../tabs/lodging';
import {
  buildTourPayload,
  createInitialTourState,
  createTourForTrip,
  type TourDraft,
} from '../tabs/tours';
import {
  buildCarRentalFromDraft,
  createInitialCarRentalDraft,
  type CarRental,
  type CarRentalDraft,
} from '../tabs/carRentals';
import { buildRentalDraftFromRow, buildTourDraftFromRow, getOverviewSaveFlags } from '../utils/overviewEditing';
import { FlightEditingForm } from '../components/FlightEditingForm';
import AsyncStorage from '@react-native-async-storage/async-storage';

type NativeDateTimePickerType = typeof import('@react-native-community/datetimepicker').default;
let NativeDateTimePicker: NativeDateTimePickerType | null = null;
if (Platform.OS !== 'web') {
  try {
    const mod = require('@react-native-community/datetimepicker');
    NativeDateTimePicker = (mod?.default ?? mod) as NativeDateTimePickerType;
  } catch (err) {
    console.warn('DateTimePicker unavailable, falling back to text inputs');
    NativeDateTimePicker = null;
  }
}

type Trip = {
  id: string;
  groupId: string;
  name: string;
  description?: string | null;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  startMonth?: number | null;
  startYear?: number | null;
  durationDays?: number | null;
  createdAt: string;
};

type GroupView = {
  id: string;
  name: string;
  members: Array<{ id: string; userEmail?: string; email?: string; guestName?: string }>;
};

type Lodging = {
  id: string;
  name: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: string;
  refundBy: string;
  totalCost: string;
  costPerNight: string;
  address: string;
};

type Tour = {
  id: string;
  date: string;
  name: string;
  startLocation: string;
  startTime: string;
  duration: string;
  cost: string;
  freeCancelBy: string;
  bookedOn: string;
  reference: string;
};

type ItineraryDetail = {
  id: string;
  day: number;
  time?: string | null;
  activity: string;
  cost?: number | null;
};

type OverviewTabProps = {
  backendUrl: string;
  headers: Record<string, string>;
  jsonHeaders: Record<string, string>;
  trip: Trip | null;
  group: GroupView | null;
  attendees: Array<{
    id: string;
    guestName?: string;
    email?: string;
    userEmail?: string;
    firstName?: string;
    lastName?: string;
    status?: 'active' | 'pending' | 'removed';
    removedAt?: string | null;
  }>;
  flights: Flight[];
  lodgings: Lodging[];
  tours: Tour[];
  carRentals: CarRental[];
  defaultPayerId: string | null;
  styles: Record<string, any>;
  mapApp: MapApp;
  onOpenAddress: (address: string) => void;
  onRefreshTrips: () => void;
  onRefreshGroups: () => void;
  onRefreshGroupMembers: () => void;
  onRefreshFlights: () => void;
  onRefreshLodgings: () => void;
  onRefreshTours: () => void;
  onAddCarRental: (rental: CarRental) => void;
  openFlightInFlightsTab: (flightId: string) => void;
};

type DayCard = {
  date: string;
  label: string;
  items: string[];
  location?: string | null;
  title?: string;
  summary?: string;
};

type DetailSection = {
  title?: string;
  subtitle?: string;
  items: DetailItem[];
};

type ModalDateField =
  | 'flightDeparture'
  | 'lodgingCheckIn'
  | 'lodgingCheckOut'
  | 'lodgingRefundBy'
  | 'tourDate'
  | 'tourFreeCancel'
  | 'tourBookedOn'
  | 'rentalPickup'
  | 'rentalDropoff';

export const dedupeAttendees = (
  attendees: OverviewTabProps['attendees']
): OverviewTabProps['attendees'] => {
  const byKey = new Map<string, OverviewTabProps['attendees'][number]>();
  const makeKey = (member: OverviewTabProps['attendees'][number]) => {
    const rawEmail = (member.email ?? member.userEmail ?? '').trim().toLowerCase();
    return rawEmail || member.id;
  };
  const merge = (base: OverviewTabProps['attendees'][number], incoming: OverviewTabProps['attendees'][number]) => {
    const preferIncoming =
      (base.status === 'pending' && incoming.status !== 'pending') ||
      (base.status === 'removed' && incoming.status !== 'removed');
    const keep = preferIncoming ? incoming : base;
    const mergeFrom = preferIncoming ? base : incoming;
    return {
      ...keep,
      firstName: keep.firstName ?? mergeFrom.firstName,
      lastName: keep.lastName ?? mergeFrom.lastName,
      email: keep.email ?? mergeFrom.email ?? keep.userEmail ?? mergeFrom.userEmail,
      userEmail: keep.userEmail ?? mergeFrom.userEmail,
      guestName: keep.guestName ?? mergeFrom.guestName,
      status: keep.status ?? mergeFrom.status,
      removedAt: keep.removedAt ?? mergeFrom.removedAt,
    };
  };
  for (const member of attendees ?? []) {
    const key = makeKey(member);
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, merge(existing, member));
    } else {
      byKey.set(key, member);
    }
  }
  const deduped = Array.from(byKey.values());
  if ((attendees?.length ?? 0) !== deduped.length) {
    // TEMP DEBUG: remove after confirming attendee de-duplication.
    console.info('[DEBUG][overview] deduped attendees', {
      before: attendees?.length ?? 0,
      after: deduped.length,
    });
  }
  return deduped;
};

export const formatAttendeeLabel = (member: OverviewTabProps['attendees'][number]) => {
  const first = member.firstName?.trim() ?? '';
  const last = member.lastName?.trim() ?? '';
  const combined = `${first} ${last}`.trim();
  const email = member.email?.trim() || member.userEmail?.trim() || '';
  const base = combined || member.guestName?.trim() || email || 'Traveler';
  return email && base.toLowerCase() !== email.toLowerCase() ? `${base} (${email})` : base;
};

const OverviewTab: React.FC<OverviewTabProps> = ({
  backendUrl,
  headers,
  jsonHeaders,
  trip,
  group,
  attendees,
  flights,
  lodgings,
  tours,
  carRentals,
  defaultPayerId,
  styles,
  mapApp,
  onOpenAddress,
  onRefreshTrips,
  onRefreshGroups,
  onRefreshGroupMembers,
  onRefreshFlights,
  onRefreshLodgings,
  onRefreshTours,
  onAddCarRental,
  openFlightInFlightsTab: _openFlightInFlightsTab,
}) => {
  const [itineraryDetails, setItineraryDetails] = useState<ItineraryDetail[]>([]);
  const [itineraryLoading, setItineraryLoading] = useState(false);
  const [itineraryId, setItineraryId] = useState<string | null>(null);
  const [editingDetailId, setEditingDetailId] = useState<string | null>(null);
  const [detailDraft, setDetailDraft] = useState({ day: '1', time: '', activity: '', cost: '' });
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [dateDraft, setDateDraft] = useState({
    mode: 'range' as 'range' | 'month',
    startDate: '',
    endDate: '',
    startMonth: '',
    startYear: '',
    durationDays: '',
  });
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const [selectedLodging, setSelectedLodging] = useState<Lodging | null>(null);
  const [selectedTour, setSelectedTour] = useState<Tour | null>(null);
  const [detailModal, setDetailModal] = useState<{ title: string; sections: DetailSection[] } | null>(null);
  const [showAddTraveler, setShowAddTraveler] = useState(false);
  const [travelerDraft, setTravelerDraft] = useState({ firstName: '', lastName: '', email: '' });
  const [pendingRemovalIds, setPendingRemovalIds] = useState<string[]>([]);
  const [showAddLodging, setShowAddLodging] = useState(false);
  const [showAddTour, setShowAddTour] = useState(false);
  const [showAddRental, setShowAddRental] = useState(false);
  const [lodgingDraft, setLodgingDraft] = useState<LodgingDraft>(createInitialLodgingState());
  const [tourDraft, setTourDraft] = useState<TourDraft>(createInitialTourState());
  const [rentalDraft, setRentalDraft] = useState<CarRentalDraft>(createInitialCarRentalDraft());
  const [editingFlightId, setEditingFlightId] = useState<string | null>(null);
  const [editingFlightDraft, setEditingFlightDraft] = useState<FlightEditDraft | null>(null);
  const [showFlightEditor, setShowFlightEditor] = useState(false);
  const [flightEditorAnchor, setFlightEditorAnchor] = useState(0);
  const [editingLodgingId, setEditingLodgingId] = useState<string | null>(null);
  const [editingTourId, setEditingTourId] = useState<string | null>(null);
  const [editingRentalId, setEditingRentalId] = useState<string | null>(null);
  const autoAdjustedRef = useRef<string | null>(null);
  const [dateField, setDateField] = useState<'start' | 'end' | null>(null);
  const [dateValue, setDateValue] = useState<Date>(new Date());
  const [timePickerTarget, setTimePickerTarget] = useState<'edit-dep' | 'edit-arr' | null>(null);
  const [timePickerValue, setTimePickerValue] = useState<Date>(new Date());
  const [scrollY, setScrollY] = useState(0);
  const [flightRowOffsets, setFlightRowOffsets] = useState<Record<string, number>>({});
  const startDateRef = useRef<any>(null);
  const endDateRef = useRef<any>(null);
  const editDepLocationRef = useRef<any>(null);
  const editArrLocationRef = useRef<any>(null);
  const editLayoverLocationRef = useRef<any>(null);
  const scrollRef = useRef<any>(null);
  const [modalDateField, setModalDateField] = useState<ModalDateField | null>(null);
  const [modalDateValue, setModalDateValue] = useState<Date>(new Date());
  const [dayCards, setDayCards] = useState<DayCard[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayImages, setDayImages] = useState<Record<string, string>>({});

  const formatFriendlyDate = (dateStr?: string | null, timeStr?: string | null): string | null =>
    require('../utils/overviewBuilder').formatFriendlyDate(dateStr, timeStr);

  const resetDrafts = () => {
    if (!trip) return;
    setDescriptionDraft(trip.description ?? '');
    if (trip.startDate || trip.endDate) {
      setDateDraft({
        mode: 'range',
        startDate: trip.startDate ?? '',
        endDate: trip.endDate ?? '',
        startMonth: '',
        startYear: '',
        durationDays: '',
      });
      return;
    }
    setDateDraft({
      mode: 'month',
      startDate: '',
      endDate: '',
      startMonth: trip.startMonth ? String(trip.startMonth) : '',
      startYear: trip.startYear ? String(trip.startYear) : '',
      durationDays: trip.durationDays ? String(trip.durationDays) : '',
    });
  };

  useEffect(() => {
    if (!trip) return;
    resetDrafts();
  }, [trip]);

  useEffect(() => {
    setSelectedDay(null);
  }, [trip?.id]);

  useEffect(() => {
    if (!selectedDay) {
      setDetailModal(null);
    }
  }, [selectedDay]);


  useEffect(() => {
    const loadItinerary = async () => {
      if (!trip?.id) {
        setItineraryDetails([]);
        setItineraryId(null);
        return;
      }
      setItineraryLoading(true);
      try {
        const res = await fetch(`${backendUrl}/api/itineraries`, { headers });
        if (!res.ok) {
          setItineraryDetails([]);
          setItineraryId(null);
          return;
        }
        const data = await res.json();
        const records = (Array.isArray(data) ? data : []).filter((i) => i.tripId === trip.id);
        if (!records.length) {
          setItineraryDetails([]);
          setItineraryId(null);
          return;
        }
        const latest = records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        setItineraryId(latest.id ?? null);
        const detailsRes = await fetch(`${backendUrl}/api/itineraries/${latest.id}/details`, { headers });
        if (!detailsRes.ok) {
          setItineraryDetails([]);
          return;
        }
        const details = await detailsRes.json();
        setItineraryDetails(Array.isArray(details) ? details : []);
      } catch {
        setItineraryDetails([]);
        setItineraryId(null);
      } finally {
        setItineraryLoading(false);
      }
    };
    loadItinerary();
  }, [backendUrl, headers, trip?.id]);

  const sortedItineraryDetails = useMemo(
    () =>
      [...itineraryDetails].sort((a, b) => {
        const dayA = Number(a.day) || 0;
        const dayB = Number(b.day) || 0;
        if (dayA !== dayB) return dayA - dayB;
        const timeA = (a.time ?? '').toString();
        const timeB = (b.time ?? '').toString();
        if (timeA && timeB) return timeA.localeCompare(timeB);
        if (timeA) return -1;
        if (timeB) return 1;
        return 0;
      }),
    [itineraryDetails]
  );

  const refreshItineraryDetails = async () => {
    if (!itineraryId) return;
    const detailsRes = await fetch(`${backendUrl}/api/itineraries/${itineraryId}/details`, { headers });
    if (!detailsRes.ok) return;
    const details = await detailsRes.json();
    setItineraryDetails(Array.isArray(details) ? details : []);
  };

  const saveItineraryDetail = async () => {
    if (!itineraryId) return;
    if (!detailDraft.activity.trim()) {
      alert('Activity is required.');
      return;
    }
    const payload = {
      day: detailDraft.day,
      time: detailDraft.time || null,
      activity: detailDraft.activity,
      cost: detailDraft.cost ? Number(detailDraft.cost) : null,
    };
    if (editingDetailId) {
      const res = await fetch(`${backendUrl}/api/itineraries/details/${editingDetailId}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify(payload),
      });
      if (!res.ok) return;
    } else {
      const res = await fetch(`${backendUrl}/api/itineraries/${itineraryId}/details`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(payload),
      });
      if (!res.ok) return;
    }
    setEditingDetailId(null);
    setDetailDraft({ day: '1', time: '', activity: '', cost: '' });
    refreshItineraryDetails();
  };

  const earliestEventDate = useMemo(
    () =>
      getEarliestTripEventDate([
        ...flights.map((f) => f.departure_date),
        ...lodgings.map((l) => l.checkInDate),
        ...tours.map((t) => t.date),
      ]),
    [flights, lodgings, tours]
  );

  const effectiveRangeDates = useMemo(
    () => adjustStartDateForEarliest({ startDate: trip?.startDate ?? null, endDate: trip?.endDate ?? null, earliestDate: earliestEventDate }),
    [trip?.startDate, trip?.endDate, earliestEventDate]
  );

  const formatMemberName = (member: GroupMemberOption) => {
    const full = `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim();
    if (full) return full;
    if (member.guestName) return member.guestName;
    if (member.email) return member.email;
    // @ts-expect-error legacy field
    if (member.userEmail) return member.userEmail as string;
    return 'Traveler';
  };

  const groupMembers: GroupMemberOption[] = useMemo(
    () => attendees.map((a) => ({ ...a })),
    [attendees]
  );

  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    groupMembers.forEach((m) => map.set(m.id, formatMemberName(m)));
    return map;
  }, [groupMembers]);

  const buildPassengerName = (ids: string[]) => ids.map((id) => memberNames.get(id)).filter(Boolean).join(', ');

  const userMembers = useMemo(
    () => groupMembers.filter((m) => !m.guestName && m.status !== 'removed'),
    [groupMembers]
  );

  const payerName = (id: string) => memberNames.get(id) ?? 'Unknown';

  const parseLayoverDuration = (value: string | null | undefined): { hours: string; minutes: string } => {
    const safe = value ?? '';
    const hoursMatch = safe.match(/(\d+)\s*h/i);
    const minutesMatch = safe.match(/(\d+)\s*m/i);
    const hours = hoursMatch ? hoursMatch[1] : '';
    const minutes = minutesMatch ? minutesMatch[1] : '';
    return { hours, minutes };
  };

  const getLocationInputValue = (
    rawValue: string,
    _activeTarget: 'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover' | null,
    _currentTarget: 'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover' | null
  ): string => {
    return rawValue;
  };

  const showAirportDropdown = (
    _target: 'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover',
    _node: any,
    _query: string
  ) => undefined;

  const displayStartDate = effectiveRangeDates.startDate ?? trip?.startDate ?? null;
  const displayEndDate = effectiveRangeDates.endDate ?? trip?.endDate ?? null;
  const monthLabel = useMemo(
    () => formatMonthYear(trip?.startMonth ?? null, trip?.startYear ?? null),
    [trip?.startMonth, trip?.startYear]
  );

  const tripLength = useMemo(() => {
    if (trip?.startDate || trip?.endDate) {
      return computeTripDays(displayStartDate ?? null, displayEndDate ?? null);
    }
    return trip?.durationDays ?? null;
  }, [trip, displayStartDate, displayEndDate]);

  const rows = useMemo<OverviewRow[]>(
    () =>
      buildOverviewRows({
        tripStartDate: effectiveRangeDates.startDate ?? trip?.startDate ?? null,
        tripMonthLabel: monthLabel,
        itineraryDetails,
        flights,
        lodgings,
        tours,
        rentals: carRentals,
      }),
    [effectiveRangeDates.startDate, trip?.startDate, monthLabel, itineraryDetails, flights, lodgings, tours, carRentals]
  );

  const allDates = useMemo(() => {
    const dates: string[] = [];
    const start = displayStartDate || effectiveRangeDates.startDate;
    const end = displayEndDate || effectiveRangeDates.endDate;
    if (start && end) {
      const s = new Date(start);
      const e = new Date(end);
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().slice(0, 10));
      }
    } else if (flights.length || lodgings.length) {
      const all = [
        ...flights.map((f) => f.departure_date),
        ...lodgings.map((l) => l.checkInDate),
        ...lodgings.map((l) => l.checkOutDate),
      ]
        .filter(Boolean)
        .map((d) => new Date(d as string).getTime());
      if (all.length) {
        const min = new Date(Math.min(...all));
        const max = new Date(Math.max(...all));
        for (let d = new Date(min); d <= max; d.setDate(d.getDate() + 1)) {
          dates.push(d.toISOString().slice(0, 10));
        }
      }
    }
    if (!dates.length) {
      dates.push(new Date().toISOString().slice(0, 10));
    }
    return dates;
  }, [displayStartDate, displayEndDate, effectiveRangeDates.startDate, effectiveRangeDates.endDate, flights, lodgings]);

  useEffect(() => {
    const buildDayCards = () => {
      const cards: DayCard[] = allDates.map((date, idx) => {
        const items: string[] = [];
        const flightsForDay = flights.filter((f) => f.departure_date === date || f.arrival_date === date);
        flightsForDay.forEach((f) =>
          items.push(`Flight ${f.departure_location || f.departure_airport_code || 'DEP'} -> ${f.arrival_location || f.arrival_airport_code || 'ARR'} dep ${f.departure_time || '?'} arr ${f.arrival_time || '?'}`)
        );
        const lodgingsForDay = lodgings.filter((l) => {
          const ci = l.checkInDate;
          const co = l.checkOutDate;
          if (!ci || !co) return false;
          const d = new Date(date).getTime();
          return d >= new Date(ci).getTime() && d <= new Date(co).getTime();
        });
        lodgingsForDay.forEach((l) => items.push(`Lodging at ${l.name} (${l.checkInDate} - ${l.checkOutDate})`));
        const toursForDay = tours.filter((t) => t.date === date);
        toursForDay.forEach((t) => items.push(`Tour: ${t.name} at ${t.startTime || 'time TBD'}`));
        const rentalsForDay = carRentals.filter((r) => r.pickupDate === date || r.dropoffDate === date);
        rentalsForDay.forEach((r) => items.push(`Rental car (${r.vendor || 'vendor'}) ${r.pickupDate} -> ${r.dropoffDate}`));
        const label = `Day ${idx + 1}`;
        if (!items.length) items.push('Free Day');
        return { date, label, items, location: trip?.destination ?? null };
      });
      setDayCards(cards);
      setSelectedDay((prev) => (prev && cards.some((card) => card.date === prev) ? prev : null));
    };
    buildDayCards();
  }, [allDates, flights, lodgings, tours, carRentals, trip?.destination]);

  useEffect(() => {
    const cache = async () => {
      if (!trip?.id || !dayCards.length) return;
      await AsyncStorage.setItem(`overview.cache.${trip.id}`, JSON.stringify(dayCards));
    };
    cache().catch(() => undefined);
  }, [dayCards, trip?.id]);

  useEffect(() => {
    const loadCache = async () => {
      if (!trip?.id) return;
      if (dayCards.length) return;
      try {
        const raw = await AsyncStorage.getItem(`overview.cache.${trip.id}`);
        if (raw) {
          const parsed = JSON.parse(raw) as DayCard[];
          if (Array.isArray(parsed) && parsed.length) {
            setDayCards(parsed);
            setSelectedDay((prev) => (prev && parsed.some((card) => card.date === prev) ? prev : null));
          }
        }
      } catch {
        // ignore
      }
    };
    loadCache().catch(() => undefined);
  }, [trip?.id, dayCards.length]);

  useEffect(() => {
    const fetchImages = async () => {
      if (!dayCards.length) return;
      const next: Record<string, string> = {};
      for (const card of dayCards) {
        try {
          const res = await fetch(
            `${backendUrl}/api/itinerary/images?location=${encodeURIComponent(card.location || trip?.destination || 'travel')}&day=${encodeURIComponent(card.date)}`,
            { headers }
          );
          const data = await res.json().catch(() => ({}));
          if (data?.url) {
            next[card.date] = data.url;
          }
        } catch {
          // ignore
        }
      }
      if (Object.keys(next).length) setDayImages(next);
    };
    fetchImages().catch(() => undefined);
  }, [backendUrl, headers, dayCards, trip?.destination]);

  useEffect(() => {
    if (!trip?.id || !trip.startDate) return;
    if (autoAdjustedRef.current === trip.id) return;
    if (!effectiveRangeDates.startDate || effectiveRangeDates.startDate === trip.startDate) return;
    const run = async () => {
      const res = await fetch(`${backendUrl}/api/trips/${trip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          dateMode: 'range',
          startDate: effectiveRangeDates.startDate,
          endDate: effectiveRangeDates.endDate ?? null,
        }),
      });
      if (res.ok) {
        autoAdjustedRef.current = trip.id;
        onRefreshTrips();
      }
    };
    run().catch(() => undefined);
  }, [backendUrl, headers, trip?.id, trip?.startDate, effectiveRangeDates.startDate, effectiveRangeDates.endDate, onRefreshTrips]);

  const openDatePicker = (field: 'start' | 'end') => {
    if (Platform.OS !== 'web' && NativeDateTimePicker) {
      const base = field === 'start' ? dateDraft.startDate : dateDraft.endDate;
      const date = base ? new Date(base) : new Date();
      setDateValue(date);
      setDateField(field);
      return;
    }
    const ref = field === 'start' ? startDateRef.current : endDateRef.current;
    if ((ref as any)?.showPicker) {
      (ref as any).showPicker();
      return;
    }
    if (typeof ref?.click === 'function') {
      ref.click();
      return;
    }
    ref?.focus();
  };

  const openModalDatePicker = (field: ModalDateField, current?: string) => {
    if (Platform.OS !== 'web' && NativeDateTimePicker) {
      const base = current?.trim() ? new Date(current) : new Date();
      setModalDateValue(base);
      setModalDateField(field);
    }
  };

  const openTimePicker = (target: 'edit-dep' | 'edit-arr' | 'new-dep' | 'new-arr', current: string) => {
    if (Platform.OS !== 'web' && NativeDateTimePicker) {
      const base = new Date();
      const match = current?.match(/(\d{1,2}):(\d{2})/);
      if (match) {
        base.setHours(Number(match[1]), Number(match[2]), 0, 0);
      } else {
        base.setHours(0, 0, 0, 0);
      }
      setTimePickerValue(base);
      if (target === 'edit-dep' || target === 'edit-arr') {
        setTimePickerTarget(target);
      }
    }
  };

  const monthOptions = useMemo(
    () =>
      Array.from({ length: 12 }).map((_, idx) => ({
        label: new Date(2000, idx, 1).toLocaleString('default', { month: 'long' }),
        value: String(idx + 1).padStart(2, '0'),
      })),
    []
  );

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 12 }).map((_, idx) => String(current - 1 + idx));
  }, []);

  const dayOptions = useMemo(() => Array.from({ length: 31 }).map((_, idx) => String(idx + 1).padStart(2, '0')), []);
  const durationOptions = useMemo(() => Array.from({ length: 365 }).map((_, idx) => String(idx + 1)), []);

  const parseDateParts = (value: string | null | undefined) => {
    const safe = (value ?? '').trim();
    const [year, month, day] = safe.split('-');
    return { year: year || '', month: month || '', day: day || '' };
  };

  const setDatePart = (which: 'start' | 'end', part: 'year' | 'month' | 'day', value: string) => {
    setDateDraft((prev) => {
      const current = which === 'start' ? prev.startDate : prev.endDate;
      const parts = parseDateParts(current);
      const next = { ...parts, [part]: value };
      const year = (next.year || '').padStart(4, '0');
      const month = (next.month || '').padStart(2, '0');
      const day = (next.day || '').padStart(2, '0');
      const formatted = year && month && day ? `${year}-${month}-${day}` : '';
      return which === 'start' ? { ...prev, startDate: formatted } : { ...prev, endDate: formatted };
    });
  };

  const saveOverviewEdits = async () => {
    if (!trip?.id) return;
    setEditingDetailId(null);
    const { shouldSkipTripSave } = getOverviewSaveFlags(trip, descriptionDraft, dateDraft, pendingRemovalIds);
    if (shouldSkipTripSave) {
      setIsEditing(false);
      await refreshItineraryDetails();
      return;
    }
    const validationError = validateTripDates({
      mode: dateDraft.mode,
      startDate: dateDraft.startDate,
      endDate: dateDraft.endDate,
      startMonth: dateDraft.startMonth,
      startYear: dateDraft.startYear,
      durationDays: dateDraft.durationDays,
    });
    if (validationError) {
      alert(validationError);
      return;
    }
    const payload: any = {
      description: descriptionDraft,
      dateMode: dateDraft.mode,
    };
    if (dateDraft.mode === 'range') {
      const adjusted = adjustStartDateForEarliest({
        startDate: dateDraft.startDate || null,
        endDate: dateDraft.endDate || null,
        earliestDate: earliestEventDate,
      });
      payload.startDate = adjusted.startDate ?? null;
      payload.endDate = adjusted.endDate ?? null;
    } else {
      payload.startMonth = Number(dateDraft.startMonth) || null;
      payload.startYear = Number(dateDraft.startYear) || null;
      payload.durationDays = Number(dateDraft.durationDays) || null;
    }
    const res = await fetch(`${backendUrl}/api/trips/${trip.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to update trip');
      return;
    }
    if (pendingRemovalIds.length && trip?.id) {
      const removalGroupId = group?.id ?? trip.groupId;
      if (!removalGroupId) {
        alert('Unable to remove member: missing group id');
        return;
      }
      for (const memberId of pendingRemovalIds) {
        const removeRes = await fetch(`${backendUrl}/api/groups/${removalGroupId}/members/${memberId}`, {
          method: 'DELETE',
          headers,
        });
        if (!removeRes.ok) {
          const removeData = await removeRes.json().catch(() => ({}));
          alert(removeData.error || 'Unable to remove member');
          return;
        }
      }
      setPendingRemovalIds([]);
      onRefreshGroups();
      onRefreshGroupMembers();
      onRefreshFlights();
      onRefreshLodgings();
      onRefreshTours();
    }
    setIsEditing(false);
    await refreshItineraryDetails();
    onRefreshTrips();
  };

  const cancelOverviewEdits = () => {
    resetDrafts();
    setPendingRemovalIds([]);
    setShowAddTraveler(false);
    setTravelerDraft({ firstName: '', lastName: '', email: '' });
    setEditingDetailId(null);
    setIsEditing(false);
  };

  const removeTraveler = (memberId: string) => {
    if (!isEditing) return;
    setPendingRemovalIds((prev) => (prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]));
  };

  const addTraveler = async () => {
    if (!group?.id) return;
    const first = travelerDraft.firstName.trim();
    const last = travelerDraft.lastName.trim();
    const email = travelerDraft.email.trim();
    if (!first || !last) {
      alert('Enter first and last name');
      return;
    }
    const guestName = `${first} ${last}`.trim();
    const payload = email ? { email, firstName: first, lastName: last, guestName } : { guestName };
    // TEMP DEBUG: remove after confirming single attendee entry.
    console.info('[DEBUG][overview] add traveler payload', payload);
    const res = await fetch(`${backendUrl}/api/groups/${group.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to add member');
      return;
    }
    // TEMP DEBUG: remove after confirming single attendee entry.
    console.info('[DEBUG][overview] add traveler response', data);
    onRefreshGroupMembers();
    setTravelerDraft({ firstName: '', lastName: '', email: '' });
    setShowAddTraveler(false);
    onRefreshGroups();
  };

  const saveFlightDetails = async () => {
    if (!editingFlightId || !editingFlightDraft) return;
    if (!trip?.id) {
      alert('Select an active trip before editing a flight.');
      return;
    }
    if (!editingFlightDraft.passengerIds.length) {
      alert('Select at least one passenger');
      return;
    }
    const payload = buildFlightPayload(
      { ...editingFlightDraft, passengerName: buildPassengerName(editingFlightDraft.passengerIds) || editingFlightDraft.passengerName },
      trip.id,
      defaultPayerId
    );
    if (editingFlightId === 'new') {
      const res = await fetch(`${backendUrl}/api/flights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Unable to save flight');
        return;
      }
      closeFlightEditor();
      onRefreshFlights();
      return;
    }
    const res = await fetch(`${backendUrl}/api/flights/${editingFlightId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to update flight');
      return;
    }
    closeFlightEditor();
    onRefreshFlights();
  };

  const toFlightEditDraft = (flight: Flight): FlightEditDraft => {
    const base = createInitialFlightState();
    const draft: FlightEditDraft = {
      ...base,
      passengerName: (flight as any).passenger_name || (flight as any).passengerName || base.passengerName,
      passengerIds: Array.isArray((flight as any).passenger_ids) ? (flight as any).passenger_ids : [],
      departureDate: normalizeDateString(flight.departure_date),
      arrivalDate: normalizeDateString((flight as any).arrival_date || (flight as any).arrivalDate || flight.departure_date),
      departureLocation: (flight as any).departure_location ?? '',
      departureAirportCode: flight.departure_airport_code ?? (flight as any).departureAirportCode ?? '',
      departureTime: flight.departure_time,
      arrivalLocation: (flight as any).arrival_location ?? '',
      arrivalAirportCode: flight.arrival_airport_code ?? (flight as any).arrivalAirportCode ?? '',
      layoverLocation: flight.layover_location ?? '',
      layoverLocationCode: flight.layover_location_code ?? '',
      layoverDuration: flight.layover_duration ?? '',
      arrivalTime: flight.arrival_time,
      cost: String((flight as any).cost ?? ''),
      carrier: flight.carrier,
      flightNumber: flight.flight_number,
      bookingReference: flight.booking_reference,
      paidBy: Array.isArray((flight as any).paidBy) ? (flight as any).paidBy : Array.isArray((flight as any).paid_by) ? (flight as any).paid_by : [],
    };
    if (!draft.passengerIds.length && groupMembers.length) {
      draft.passengerIds = [groupMembers[0].id];
    }
    if (!draft.paidBy.length && defaultPayerId) {
      draft.paidBy = [defaultPayerId];
    }
    if (draft.passengerIds.length) {
      draft.passengerName = buildPassengerName(draft.passengerIds) || draft.passengerName;
    }
    return draft;
  };

  const setEditingFlightPassengers = (ids: string[]) => {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    setEditingFlightDraft((prev) => (prev ? { ...prev, passengerIds: unique, passengerName: buildPassengerName(unique) } : prev));
  };

  const saveFlightEdit = saveFlightDetails;

  const saveLodging = async () => {
    if (!trip?.id) {
      alert('Select an active trip before saving lodging.');
      return;
    }
    const { payload, error } = buildLodgingPayload(lodgingDraft, trip.id, defaultPayerId);
    if (error || !payload) {
      alert(error || 'Unable to save lodging');
      return;
    }
    if (editingLodgingId) {
      const result = await saveLodgingApi(backendUrl, jsonHeaders, payload, editingLodgingId);
      if (!result.ok) {
        alert(result.error || 'Unable to save lodging');
        return;
      }
      closeLodgingModal();
      onRefreshLodgings();
      return;
    }
    const result = await createLodgingForTrip({
      backendUrl,
      jsonHeaders,
      draft: lodgingDraft,
      activeTripId: trip.id,
      defaultPayerId,
    });
    if (!result.ok) {
      alert(result.error || 'Unable to save lodging');
      return;
    }
    closeLodgingModal();
    onRefreshLodgings();
  };

  const saveTour = async () => {
    if (editingTourId) {
      const { payload, error } = buildTourPayload(tourDraft, defaultPayerId);
      if (error || !payload) {
        alert(error || 'Unable to save tour');
        return;
      }
      const res = await fetch(`${backendUrl}/api/tours/${editingTourId}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ ...payload, tripId: trip?.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Unable to save tour');
        return;
      }
      closeTourModal();
      onRefreshTours();
      return;
    }
    const result = await createTourForTrip({
      backendUrl,
      jsonHeaders,
      draft: tourDraft,
      activeTripId: trip?.id ?? null,
      defaultPayerId,
    });
    if (!result.ok) {
      alert(result.error || 'Unable to save tour');
      return;
    }
    closeTourModal();
    onRefreshTours();
  };

  const saveRental = () => {
    if (editingRentalId) {
      // Editing rentals is not supported in this view; just close.
      closeRentalModal();
      return;
    }
    const result = buildCarRentalFromDraft(rentalDraft, defaultPayerId);
    if (!result.rental || result.error) {
      alert(result.error || 'Unable to save rental car');
      return;
    }
    onAddCarRental(result.rental);
    closeRentalModal();
  };

  const closeFlightEditor = () => {
    setShowFlightEditor(false);
    setEditingFlightId(null);
    setEditingFlightDraft(null);
    setTimePickerTarget(null);
    setFlightEditorAnchor(0);
  };

  const closeLodgingModal = () => {
    setShowAddLodging(false);
    setEditingLodgingId(null);
    setLodgingDraft(createInitialLodgingState());
  };

  const closeTourModal = () => {
    setShowAddTour(false);
    setEditingTourId(null);
    setTourDraft(createInitialTourState());
  };

  const closeRentalModal = () => {
    setShowAddRental(false);
    setEditingRentalId(null);
    setRentalDraft(createInitialCarRentalDraft());
  };

  useEffect(() => {
    if (!isEditing) {
      closeFlightEditor();
      closeLodgingModal();
      closeTourModal();
      closeRentalModal();
      setPendingRemovalIds([]);
    }
  }, [isEditing]);

  const openFlightEditor = (flight: Flight) => {
    if (!isEditing) {
      setSelectedFlight(flight);
      return;
    }
    setSelectedFlight(null);
    setEditingFlightId(flight.id);
    setEditingFlightDraft(toFlightEditDraft(flight));
    const anchor = flightRowOffsets[flight.id];
    if (typeof anchor === 'number') {
      setFlightEditorAnchor(anchor);
      scrollRef.current?.scrollTo({ y: Math.max(anchor - 60, 0), animated: true });
    } else {
      setFlightEditorAnchor(scrollY + 80);
      scrollRef.current?.scrollTo({ y: Math.max(scrollY - 40, 0), animated: true });
    }
    setShowFlightEditor(true);
  };

  const openFlightAdd = () => {
    if (!isEditing) return;
    setSelectedFlight(null);
    setEditingFlightId('new');
    const tripForFlights = trip
      ? ({
          ...trip,
          groupName: (group as any)?.name ?? (trip as any).groupName ?? 'Group',
        } as any)
      : undefined;
    const draft = createFlightDraftForTrip(tripForFlights, defaultPayerId);
    if (groupMembers.length) {
      draft.passengerIds = groupMembers.map((m) => m.id);
      draft.passengerName = buildPassengerName(draft.passengerIds) || draft.passengerName;
    }
    setEditingFlightDraft(draft);
    setFlightEditorAnchor(scrollY + 80);
    setShowFlightEditor(true);
  };

  const openLodgingEditor = (lodging: Lodging) => {
    if (!isEditing) {
      setSelectedLodging(lodging);
      return;
    }
    setEditingLodgingId(lodging.id);
    setLodgingDraft(toLodgingDraft(lodging, { normalize: normalizeDateString, defaultPayerId }));
    setShowAddLodging(true);
  };

  const openTourEditor = (tour: Tour) => {
    if (!isEditing) {
      setSelectedTour(tour);
      return;
    }
    setEditingTourId(tour.id);
    setTourDraft(buildTourDraftFromRow({ ...tour, paidBy: (tour as any).paidBy ?? [] } as any));
    setShowAddTour(true);
  };

  const openRentalEditor = (rental: CarRental) => {
    if (!isEditing) {
      return;
    }
    setEditingRentalId(rental.id);
    setRentalDraft(buildRentalDraftFromRow(rental));
    setShowAddRental(true);
  };

  const openDetailLink = (url?: string | null) => {
    if (!url) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  const formatRentalDetails = (rental: CarRental): DetailItem[] => [
    { label: 'Pickup Location', value: rental.pickupLocation || 'N/A' },
    { label: 'Pickup Date', value: formatFriendlyDate(rental.pickupDate) || rental.pickupDate || 'N/A' },
    { label: 'Dropoff Location', value: rental.dropoffLocation || 'N/A' },
    { label: 'Dropoff Date', value: formatFriendlyDate(rental.dropoffDate) || rental.dropoffDate || 'N/A' },
    { label: 'Vendor', value: rental.vendor || 'N/A' },
    { label: 'Model', value: rental.model || 'N/A' },
    { label: 'Reference', value: rental.reference || 'N/A' },
    { label: 'Prepaid', value: rental.prepaid || 'N/A' },
    { label: 'Cost', value: rental.cost ? `$${rental.cost}` : 'N/A' },
    { label: 'Notes', value: rental.notes || 'N/A' },
  ];

  const renderDetailModal = (title: string, items: DetailItem[], onClose: () => void) => (
    <View style={styles.modalOverlay}>
      <View style={styles.confirmModal}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {items.map((item) => {
          const handler = item.onPress ?? (item.linkUrl ? () => openDetailLink(item.linkUrl) : undefined);
          const content = handler ? (
            <TouchableOpacity onPress={handler}>
              <Text style={styles.linkText ?? styles.buttonText}>{item.value}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.bodyText, { marginLeft: 6 }]}>{item.value}</Text>
          );
          return (
            <View key={item.label} style={[styles.row, { alignItems: 'center' }]}>
              <Text style={styles.headerText}>{item.label}:</Text>
              <View style={{ marginLeft: 6, flex: 1 }}>{content}</View>
            </View>
          );
        })}
        <TouchableOpacity style={styles.button} onPress={onClose}>
          <Text style={styles.buttonText}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderDetailSectionsModal = (modal: { title: string; sections: DetailSection[] }) => (
    <View style={styles.modalOverlay}>
      <View style={[styles.confirmModal, styles.detailModal]}>
        <ScrollView style={styles.detailModalScroll}>
          <Text style={styles.sectionTitle}>{modal.title}</Text>
          {modal.sections.map((section, idx) => (
            <View key={`${section.title ?? 'section'}-${idx}`} style={styles.detailSection}>
              {section.title ? <Text style={styles.headerText}>{section.title}</Text> : null}
              {section.subtitle ? <Text style={styles.helperText}>{section.subtitle}</Text> : null}
              {section.items.map((item) => {
                const handler = item.onPress ?? (item.linkUrl ? () => openDetailLink(item.linkUrl) : undefined);
                const content = handler ? (
                  <TouchableOpacity onPress={handler}>
                    <Text style={styles.linkText ?? styles.buttonText}>{item.value}</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={[styles.bodyText, { marginLeft: 6 }]}>{item.value}</Text>
                );
                return (
                  <View key={`${section.title ?? 'section'}-${item.label}`} style={[styles.row, { alignItems: 'center' }]}>
                    <Text style={styles.headerText}>{item.label}:</Text>
                    <View style={{ marginLeft: 6, flex: 1 }}>{content}</View>
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.button} onPress={() => setDetailModal(null)}>
          <Text style={styles.buttonText}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const startLabel = formatFriendlyDate(displayStartDate);
  const endLabel = formatFriendlyDate(displayEndDate);
  const dateRange = startLabel || endLabel ? `${startLabel ?? 'Start'} - ${endLabel ?? 'End'}` : null;
  const dayColStyle = { minWidth: 90, width: 90 };
  const dateColStyle = { minWidth: 200, width: 200 };
  const normalizedAttendees = useMemo(() => dedupeAttendees(attendees), [attendees]);
  const attendeeLabel = (member: OverviewTabProps['attendees'][number]) => formatAttendeeLabel(member);
  const attendeeTestId = (member: OverviewTabProps['attendees'][number]) => {
    const email = member.email?.trim() || member.userEmail?.trim() || '';
    const safeEmail = email ? email.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : 'no-email';
    return `attendee-chip-${safeEmail}`;
  };

  const formatShortDayLabel = (dateStr: string): string => {
    const parts = dateStr.split('-').map((v) => Number(v));
    const date = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(dateStr);
    if (Number.isNaN(date.valueOf())) return dateStr;
    const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
    const weekdayLabel = weekday.endsWith('.') ? weekday : `${weekday}.`;
    return `${weekdayLabel} ${date.getDate()}`;
  };

  const allMemberIds = useMemo(() => groupMembers.map((m) => m.id), [groupMembers]);

  const dayDataByDate = useMemo(() => {
    const map = new Map<
      string,
      {
        index: number;
        date: string;
        flights: Flight[];
        lodgings: Lodging[];
        tours: Tour[];
        rentals: CarRental[];
        details: ItineraryDetail[];
      }
    >();
    dayCards.forEach((card, idx) => {
      const dayNumber = idx + 1;
      const flightsForDay = flights.filter((f) => f.departure_date === card.date || f.arrival_date === card.date);
      const lodgingsForDay = lodgings.filter((l) => {
        const ci = l.checkInDate;
        const co = l.checkOutDate;
        if (!ci || !co) return false;
        const d = new Date(card.date).getTime();
        return d >= new Date(ci).getTime() && d <= new Date(co).getTime();
      });
      const toursForDay = tours.filter((t) => t.date === card.date);
      const rentalsForDay = carRentals.filter((r) => r.pickupDate === card.date || r.dropoffDate === card.date);
      const detailsForDay = sortedItineraryDetails.filter((d) => Number(d.day) === dayNumber);
      map.set(card.date, {
        index: dayNumber,
        date: card.date,
        flights: flightsForDay,
        lodgings: lodgingsForDay,
        tours: toursForDay,
        rentals: rentalsForDay,
        details: detailsForDay,
      });
    });
    return map;
  }, [dayCards, flights, lodgings, tours, carRentals, sortedItineraryDetails]);

  const formatTravelerNames = (ids: string[]) =>
    ids
      .map((id) => memberNames.get(id))
      .filter(Boolean)
      .join(', ');

  const buildDayStartLocation = (info?: { flights: Flight[]; lodgings: Lodging[]; tours: Tour[]; rentals: CarRental[] }) => {
    if (!info) return trip?.destination || 'Trip Day';
    const flight = info.flights[0];
    if (flight) return flight.departure_location || flight.departure_airport_code || trip?.destination || 'Trip Day';
    const lodging = info.lodgings[0];
    if (lodging) return lodging.name || trip?.destination || 'Trip Day';
    const tour = info.tours[0];
    if (tour) return tour.startLocation || tour.name || trip?.destination || 'Trip Day';
    const rental = info.rentals[0];
    if (rental) return rental.pickupLocation || rental.vendor || trip?.destination || 'Trip Day';
    return trip?.destination || 'Trip Day';
  };

  const buildDaySummary = (info?: { flights: Flight[]; lodgings: Lodging[]; tours: Tour[]; rentals: CarRental[]; details: ItineraryDetail[] }) => {
    if (!info) return 'Free day';
    if (info.details.length) return info.details[0].activity;
    if (info.tours.length) return info.tours[0].name || 'Tour day';
    if (info.flights.length) return 'Travel day';
    if (info.lodgings.length) return `Stay at ${info.lodgings[0].name || 'lodging'}`;
    if (info.rentals.length) return 'Drive day';
    return 'Free day';
  };

  const buildDayNarrative = (info?: { details: ItineraryDetail[]; flights: Flight[]; tours: Tour[]; lodgings: Lodging[]; rentals: CarRental[] }) => {
    if (!info) return ['No itinerary details yet.'];
    if (info.details.length) {
      return info.details.map((d) => (d.time ? `${d.time} · ${d.activity}` : d.activity));
    }
    if (info.flights.length) {
      return info.flights.map((f) => {
        const dep = f.departure_location || f.departure_airport_code || 'Departure';
        const arr = f.arrival_location || f.arrival_airport_code || 'Arrival';
        return `Flight from ${dep} to ${arr}.`;
      });
    }
    if (info.tours.length) {
      return info.tours.map((t) => `${t.name}${t.startTime ? ` at ${t.startTime}` : ''}`);
    }
    if (info.lodgings.length) {
      return info.lodgings.map((l) => `Check-in at ${l.name}.`);
    }
    if (info.rentals.length) {
      return info.rentals.map((r) => `Pick up rental car from ${r.pickupLocation || r.vendor}.`);
    }
    return ['No itinerary details yet.'];
  };

  const renderDayBar = (activeDate: string | null) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
      <TouchableOpacity
        testID="overview-day-pill-overview"
        style={[styles.dayPill, !activeDate && styles.dayPillActive]}
        onPress={() => setSelectedDay(null)}
      >
        <Text style={[styles.dayPillText, !activeDate && styles.dayPillActiveText]}>Overview</Text>
      </TouchableOpacity>
      {dayCards.map((card, idx) => {
        const isActive = activeDate === card.date;
        return (
          <TouchableOpacity
            key={card.date}
            testID={`overview-day-pill-${idx + 1}`}
            style={[styles.dayPill, isActive && styles.dayPillActive]}
            onPress={() => setSelectedDay(card.date)}
          >
            <Text style={[styles.dayPillNumber, isActive && styles.dayPillActiveText]}>{idx + 1}</Text>
            <Text style={[styles.dayPillDate, isActive && styles.dayPillActiveText]}>{formatShortDayLabel(card.date)}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  if (!trip) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Overview</Text>
        <Text style={styles.helperText}>Select a trip to view its overview.</Text>
      </View>
    );
  }

  if (!isEditing) {
    const activeDayInfo = selectedDay ? dayDataByDate.get(selectedDay) : null;
    const activeDayCard = selectedDay ? dayCards.find((card) => card.date === selectedDay) : null;
    const activeDayIndex = activeDayInfo?.index ?? (activeDayCard ? dayCards.findIndex((card) => card.date === activeDayCard.date) + 1 : null);
    const nextDayCard = activeDayIndex && activeDayIndex < dayCards.length ? dayCards[activeDayIndex] : null;

    const renderHeroCard = (card: DayCard, title: string, showAction: boolean, onPress?: () => void, testID?: string) => {
      const img = dayImages[card.date];
      return (
        <TouchableOpacity
          testID={testID}
          style={styles.dayHeroCard}
          onPress={onPress}
          disabled={!onPress}
        >
          {img ? <Image style={styles.dayHeroImage} source={{ uri: img }} /> : <View style={styles.dayHeroImageFallback} />}
          <View style={styles.dayHeroOverlay} />
          <View style={styles.dayHeroBadge}>
            <Text style={styles.dayHeroBadgeText}>{card.label.toUpperCase()}</Text>
          </View>
          <View style={styles.dayHeroTextWrap}>
            <Text style={styles.dayHeroTitle}>{title}</Text>
            {showAction ? <Text style={styles.dayHeroAction}>View details</Text> : null}
          </View>
        </TouchableOpacity>
      );
    };

    if (selectedDay && activeDayCard && activeDayInfo) {
      const startLocation = buildDayStartLocation(activeDayInfo);
      const summary = buildDaySummary(activeDayInfo);
      const heroTitle = [startLocation, summary].filter(Boolean).join(' - ');
      const narrativeLines = buildDayNarrative(activeDayInfo);
      const flightsForDay = activeDayInfo.flights;
      const toursForDay = activeDayInfo.tours;
      const lodgingsForDay = activeDayInfo.lodgings;
      const rentalsForDay = activeDayInfo.rentals;

      const flightParticipantKeys = flightsForDay.map((f) => {
        const ids = Array.isArray(f.passenger_ids) && f.passenger_ids.length ? f.passenger_ids : [];
        return ids.slice().sort().join('|');
      });
      const showFlightNames = new Set(flightParticipantKeys).size > 1;

      const tourParticipantKeys = toursForDay.map((t) => {
        const ids = Array.isArray(t.paidBy) && t.paidBy.length ? t.paidBy : allMemberIds;
        return ids.slice().sort().join('|');
      });
      const showTourNames = new Set(tourParticipantKeys).size > 1;

      const lodgingParticipantKeys = lodgingsForDay.map((l) => {
        const ids = Array.isArray(l.paidBy) && l.paidBy.length ? l.paidBy : allMemberIds;
        return ids.slice().sort().join('|');
      });
      const showLodgingNames = new Set(lodgingParticipantKeys).size > 1;

      return (
        <View style={[styles.card, { position: 'relative' }]}>
          <TouchableOpacity
            testID="day-details-back"
            style={styles.dayDetailsBackButton}
            onPress={() => setSelectedDay(null)}
          >
            <Text style={styles.dayDetailsBackText}>← Back</Text>
          </TouchableOpacity>
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: 16, paddingTop: 56 }}
            onScroll={(e: any) => setScrollY(e.nativeEvent.contentOffset.y)}
            scrollEventThrottle={16}
          >
            <Text style={styles.sectionTitle}>My itinerary</Text>
            <Text style={styles.flightTitle}>{trip.name}</Text>
            {trip.destination ? <Text style={styles.helperText}>{trip.destination}</Text> : null}
            {renderDayBar(selectedDay)}
            {renderHeroCard(activeDayCard, heroTitle, false, undefined, 'day-details-hero')}
            <View style={styles.dayNarrativeBox}>
              {narrativeLines.map((line, idx) => (
                <Text key={`${activeDayCard.date}-narrative-${idx}`} style={styles.bodyText}>
                  {line}
                </Text>
              ))}
            </View>

            {flightsForDay.length ? (
              <View style={styles.dayInfoCard}>
                <Text style={styles.sectionTitle}>Your flight</Text>
                {flightsForDay.map((flight) => {
                  const dep = flight.departure_location || flight.departure_airport_code || 'DEP';
                  const arr = flight.arrival_location || flight.arrival_airport_code || 'ARR';
                  const passengers =
                    Array.isArray(flight.passenger_ids) && flight.passenger_ids.length
                      ? formatTravelerNames(flight.passenger_ids)
                      : flight.passenger_name || '';
                  return (
                    <View key={flight.id} style={styles.dayInfoRow}>
                      <Text style={styles.dayInfoRoute}>{`${dep} → ${arr}`}</Text>
                      <Text style={styles.helperText}>{`${flight.departure_time || '--:--'} / ${flight.arrival_time || '--:--'}`}</Text>
                      {showFlightNames && passengers ? (
                        <Text style={styles.helperText}>Travelers: {passengers}</Text>
                      ) : null}
                    </View>
                  );
                })}
                <TouchableOpacity
                  testID="day-details-flight-details"
                  style={styles.dayInfoButton}
                  onPress={() => {
                    const sections: DetailSection[] = flightsForDay.map((flight, idx) => {
                      const dep = flight.departure_location || flight.departure_airport_code || 'DEP';
                      const arr = flight.arrival_location || flight.arrival_airport_code || 'ARR';
                      const passengers =
                        Array.isArray(flight.passenger_ids) && flight.passenger_ids.length
                          ? formatTravelerNames(flight.passenger_ids)
                          : flight.passenger_name || '';
                      return {
                        title: flightsForDay.length > 1 ? `Flight ${idx + 1} · ${dep} → ${arr}` : undefined,
                        subtitle: showFlightNames && passengers ? `Travelers: ${passengers}` : undefined,
                        items: formatFlightDetails(flight),
                      };
                    });
                    setDetailModal({ title: 'Flight Details', sections });
                  }}
                >
                  <Text style={styles.dayInfoButtonText}>See flight details →</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {rentalsForDay.length ? (
              <View style={styles.dayInfoCard}>
                <Text style={styles.sectionTitle}>Rental car</Text>
                {rentalsForDay.map((rental) => (
                  <View key={rental.id} style={styles.dayInfoRow}>
                    <Text style={styles.dayInfoRoute}>{`${rental.vendor || 'Rental car'} · ${rental.model || 'Vehicle'}`}</Text>
                    <Text style={styles.helperText}>
                      {`${rental.pickupLocation || 'Pickup'} → ${rental.dropoffLocation || 'Dropoff'}`}
                    </Text>
                  </View>
                ))}
                <TouchableOpacity
                  testID="day-details-rental-details"
                  style={styles.dayInfoButton}
                  onPress={() => {
                    const sections: DetailSection[] = rentalsForDay.map((rental, idx) => ({
                      title: rentalsForDay.length > 1 ? `Rental ${idx + 1}` : undefined,
                      items: formatRentalDetails(rental),
                    }));
                    setDetailModal({ title: 'Rental Car Details', sections });
                  }}
                >
                  <Text style={styles.dayInfoButtonText}>See rental car details →</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {toursForDay.length ? (
              <View style={styles.dayInfoCard}>
                <Text style={styles.sectionTitle}>Tours</Text>
                {toursForDay.map((tour) => {
                  const participants = Array.isArray(tour.paidBy) && tour.paidBy.length ? formatTravelerNames(tour.paidBy) : formatTravelerNames(allMemberIds);
                  return (
                    <View key={tour.id} style={styles.dayInfoRow}>
                      <Text style={styles.dayInfoRoute}>{tour.name}</Text>
                      <Text style={styles.helperText}>{`${tour.startTime || 'Time TBD'} · ${tour.startLocation || 'Location TBD'}`}</Text>
                      {showTourNames && participants ? <Text style={styles.helperText}>Travelers: {participants}</Text> : null}
                    </View>
                  );
                })}
                <TouchableOpacity
                  testID="day-details-tour-details"
                  style={styles.dayInfoButton}
                  onPress={() => {
                    const sections: DetailSection[] = toursForDay.map((tour, idx) => {
                      const participants = Array.isArray(tour.paidBy) && tour.paidBy.length ? formatTravelerNames(tour.paidBy) : formatTravelerNames(allMemberIds);
                      return {
                        title: toursForDay.length > 1 ? `Tour ${idx + 1}` : undefined,
                        subtitle: showTourNames && participants ? `Travelers: ${participants}` : undefined,
                        items: formatTourDetails(tour),
                      };
                    });
                    setDetailModal({ title: 'Tour Details', sections });
                  }}
                >
                  <Text style={styles.dayInfoButtonText}>See tour details →</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {lodgingsForDay.length ? (
              <View style={styles.dayInfoCard}>
                <Text style={styles.sectionTitle}>Accommodation</Text>
                {lodgingsForDay.map((lodging) => {
                  const participants = Array.isArray(lodging.paidBy) && lodging.paidBy.length ? formatTravelerNames(lodging.paidBy) : formatTravelerNames(allMemberIds);
                  return (
                    <TouchableOpacity
                      key={lodging.id}
                      testID={`day-details-lodging-${lodging.id}`}
                      style={styles.dayInfoRow}
                      onPress={() => {
                        setDetailModal({
                          title: 'Lodging Details',
                          sections: [
                            {
                              subtitle: showLodgingNames && participants ? `Travelers: ${participants}` : undefined,
                              items: formatLodgingDetails(lodging, mapApp).map((item) =>
                                item.label === 'Address' && lodging.address
                                  ? { ...item, onPress: () => onOpenAddress(lodging.address) }
                                  : item
                              ),
                            },
                          ],
                        });
                      }}
                    >
                      <Text style={styles.dayInfoRoute}>{lodging.name}</Text>
                      <Text style={styles.helperText}>{`${lodging.checkInDate} → ${lodging.checkOutDate}`}</Text>
                      {showLodgingNames && participants ? <Text style={styles.helperText}>Travelers: {participants}</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            {nextDayCard ? (
              <TouchableOpacity
                testID="day-details-next"
                style={styles.dayNextButton}
                onPress={() => setSelectedDay(nextDayCard.date)}
              >
                <Text style={styles.helperText}>Next day</Text>
                <Text style={styles.headerText}>{`${nextDayCard.label} · ${formatShortDayLabel(nextDayCard.date)}`}</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
          {detailModal ? renderDetailSectionsModal(detailModal) : null}
        </View>
      );
    }

    return (
      <ScrollView
        ref={scrollRef}
        style={styles.card}
        contentContainerStyle={{ gap: 12 }}
        onScroll={(e: any) => setScrollY(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
      >
        <View style={styles.row}>
          <Text style={styles.sectionTitle}>Overview</Text>
          <TouchableOpacity style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]} onPress={() => setIsEditing(true)}>
            <Text style={styles.buttonText}>Edit</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.flightTitle}>{trip.name}</Text>
        {trip.destination ? <Text style={styles.helperText}>Destination: {trip.destination}</Text> : null}
        {dateRange ? <Text style={styles.helperText}>Dates: {dateRange}</Text> : null}
        {!dateRange && monthLabel && trip.durationDays ? (
          <Text style={styles.helperText}>
            Dates: {monthLabel} - {trip.durationDays} day(s)
          </Text>
        ) : null}
        {tripLength ? <Text style={styles.helperText}>Trip length: {tripLength} day(s)</Text> : null}

        {renderDayBar(null)}

        <View style={{ gap: 12 }}>
          {dayCards.map((card, idx) => {
            const info = dayDataByDate.get(card.date);
            const startLocation = buildDayStartLocation(info);
            const summary = buildDaySummary(info);
            const heroTitle = [startLocation, summary].filter(Boolean).join(' - ');
            return (
              <View key={card.date}>
                {renderHeroCard(card, heroTitle, true, () => setSelectedDay(card.date), `overview-day-card-${idx + 1}`)}
              </View>
            );
          })}
        </View>
      </ScrollView>
    );
  }

  return (
      <ScrollView
        ref={scrollRef}
        style={styles.card}
        contentContainerStyle={{ gap: 12 }}
        onScroll={(e: any) => setScrollY(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
      >
      <View style={styles.row}>
        <Text style={styles.sectionTitle}>Overview</Text>
        {isEditing ? (
          <View style={[styles.row, { marginLeft: 'auto', gap: 8 }]}>
            <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={saveOverviewEdits}>
              <Text style={styles.buttonText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={cancelOverviewEdits}>
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]} onPress={() => setIsEditing(true)}>
            <Text style={styles.buttonText}>Edit</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={styles.flightTitle}>{trip.name}</Text>
      {trip.destination ? <Text style={styles.helperText}>Destination: {trip.destination}</Text> : null}
      {dateRange ? <Text style={styles.helperText}>Dates: {dateRange}</Text> : null}
      {!dateRange && monthLabel && trip.durationDays ? (
        <Text style={styles.helperText}>
          Dates: {monthLabel} - {trip.durationDays} day(s)
        </Text>
      ) : null}
      {tripLength ? <Text style={styles.helperText}>Trip length: {tripLength} day(s)</Text> : null}

      <View style={[styles.row, { alignItems: 'flex-start' }]}>
        <Text style={styles.headerText}>Trip Dates</Text>
      </View>
      {isEditing ? (
        <View>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.button, dateDraft.mode === 'range' && styles.toggleActive, styles.smallButton]}
              onPress={() => setDateDraft((prev) => ({ ...prev, mode: 'range' }))}
            >
              <Text style={styles.buttonText}>Start + End</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, dateDraft.mode === 'month' && styles.toggleActive, styles.smallButton]}
              onPress={() => setDateDraft((prev) => ({ ...prev, mode: 'month' }))}
            >
              <Text style={styles.buttonText}>Month + Days</Text>
            </TouchableOpacity>
          </View>
          {dateDraft.mode === 'range' ? (
            <>
              <View style={[styles.row, { gap: 8 }]}>
                {Platform.OS === 'web' ? (
                  <>
                    <select
                      value={parseDateParts(dateDraft.startDate).month}
                      onChange={(e) => setDatePart('start', 'month', e.target.value)}
                      style={{ minWidth: 140, maxWidth: 160, padding: 8, borderRadius: 6, borderColor: '#ccc', borderWidth: 1 }}
                    >
                      <option value="">Month</option>
                      {monthOptions.map((m) => (
                        <option key={`start-${m.value}`} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={parseDateParts(dateDraft.startDate).day}
                      onChange={(e) => setDatePart('start', 'day', e.target.value)}
                      style={{ minWidth: 120, maxWidth: 140, padding: 8, borderRadius: 6, borderColor: '#ccc', borderWidth: 1 }}
                    >
                      <option value="">Day</option>
                      {dayOptions.map((d) => (
                        <option key={`start-day-${d}`} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <select
                      value={parseDateParts(dateDraft.startDate).year}
                      onChange={(e) => setDatePart('start', 'year', e.target.value)}
                      style={{ minWidth: 140, maxWidth: 160, padding: 8, borderRadius: 6, borderColor: '#ccc', borderWidth: 1 }}
                    >
                      <option value="">Year</option>
                      {yearOptions.map((y) => (
                        <option key={`start-year-${y}`} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <>
                    <TouchableOpacity style={[styles.input, styles.dateTouchable, { maxWidth: 200 }]} onPress={() => openDatePicker('start')}>
                      <Text style={styles.cellText}>{dateDraft.startDate || 'YYYY-MM-DD'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.dateIcon} onPress={() => openDatePicker('start')}>
                      <Text style={styles.selectCaret}>v</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
              <View style={[styles.row, { gap: 8 }]}>
                {Platform.OS === 'web' ? (
                  <>
                    <select
                      value={parseDateParts(dateDraft.endDate).month}
                      onChange={(e) => setDatePart('end', 'month', e.target.value)}
                      style={{ minWidth: 140, maxWidth: 160, padding: 8, borderRadius: 6, borderColor: '#ccc', borderWidth: 1 }}
                    >
                      <option value="">Month</option>
                      {monthOptions.map((m) => (
                        <option key={`end-${m.value}`} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={parseDateParts(dateDraft.endDate).day}
                      onChange={(e) => setDatePart('end', 'day', e.target.value)}
                      style={{ minWidth: 120, maxWidth: 140, padding: 8, borderRadius: 6, borderColor: '#ccc', borderWidth: 1 }}
                    >
                      <option value="">Day</option>
                      {dayOptions.map((d) => (
                        <option key={`end-day-${d}`} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <select
                      value={parseDateParts(dateDraft.endDate).year}
                      onChange={(e) => setDatePart('end', 'year', e.target.value)}
                      style={{ minWidth: 140, maxWidth: 160, padding: 8, borderRadius: 6, borderColor: '#ccc', borderWidth: 1 }}
                    >
                      <option value="">Year</option>
                      {yearOptions.map((y) => (
                        <option key={`end-year-${y}`} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <>
                    <TouchableOpacity style={[styles.input, styles.dateTouchable, { maxWidth: 200 }]} onPress={() => openDatePicker('end')}>
                      <Text style={styles.cellText}>{dateDraft.endDate || 'YYYY-MM-DD'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.dateIcon} onPress={() => openDatePicker('end')}>
                      <Text style={styles.selectCaret}>v</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </>
          ) : (
            <>
              {Platform.OS === 'web' ? (
                <>
                  <View style={[styles.row, { gap: 8 }]}>
                    <select
                      value={dateDraft.startMonth}
                      onChange={(e) => setDateDraft((prev) => ({ ...prev, startMonth: e.target.value }))}
                      style={{ minWidth: 160, maxWidth: 180, padding: 8, borderRadius: 6, borderColor: '#ccc', borderWidth: 1 }}
                    >
                      <option value="">Select month</option>
                      {monthOptions.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={dateDraft.startYear}
                      onChange={(e) => setDateDraft((prev) => ({ ...prev, startYear: e.target.value }))}
                      style={{ minWidth: 140, maxWidth: 160, padding: 8, borderRadius: 6, borderColor: '#ccc', borderWidth: 1 }}
                    >
                      <option value="">Year</option>
                      {yearOptions.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </View>
                  <select
                    value={dateDraft.durationDays}
                    onChange={(e) => setDateDraft((prev) => ({ ...prev, durationDays: e.target.value }))}
                    style={{ minWidth: 180, maxWidth: 220, padding: 8, borderRadius: 6, borderColor: '#ccc', borderWidth: 1, marginTop: 8 }}
                  >
                    <option value="">Number of days</option>
                    {durationOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <View style={styles.row}>
                    <TextInput
                      style={[styles.input, { flex: 1, maxWidth: 160 }]}
                      placeholder="Month (1-12)"
                      keyboardType="numeric"
                      value={dateDraft.startMonth}
                      onChangeText={(text) => setDateDraft((prev) => ({ ...prev, startMonth: text }))}
                    />
                    <TextInput
                      style={[styles.input, { flex: 1, maxWidth: 160 }]}
                      placeholder="Year (YYYY)"
                      keyboardType="numeric"
                      value={dateDraft.startYear}
                      onChangeText={(text) => setDateDraft((prev) => ({ ...prev, startYear: text }))}
                    />
                  </View>
                  <TextInput
                    style={[styles.input, { maxWidth: 200 }]}
                    placeholder="Number of days"
                    keyboardType="numeric"
                    value={dateDraft.durationDays}
                    onChangeText={(text) => setDateDraft((prev) => ({ ...prev, durationDays: text }))}
                  />
                </>
              )}
            </>
          )}
        </View>
      ) : null}

      <View style={[styles.row, { alignItems: 'flex-start' }]}>
        <Text style={styles.headerText}>Description</Text>
      </View>
      {!isEditing ? (
        trip.description ? (
          <View>
            {renderRichTextBlocks(trip.description, {
              base: styles.bodyText,
              bold: styles.headerText,
              italic: styles.helperText,
              link: styles.linkText ?? styles.buttonText,
              listItem: styles.helperText,
            })}
          </View>
        ) : (
          <Text style={styles.helperText}>No description yet.</Text>
        )
      ) : (
        <View>
          <TextInput
            style={[styles.input, { minHeight: 120 }]}
            multiline
            value={descriptionDraft}
            onChangeText={setDescriptionDraft}
          />
        </View>
      )}

      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={styles.headerText}>Attendees</Text>
        {isEditing ? (
          <TouchableOpacity style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]} onPress={() => setShowAddTraveler((prev) => !prev)}>
            <Text style={styles.buttonText}>Add Traveler</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
        {normalizedAttendees.map((m) => {
          const label = attendeeLabel(m);
          const pendingRemoval = pendingRemovalIds.includes(m.id);
          const badge =
            m.status === 'pending' || m.status === 'removed' ? (
              <View
                style={[
                  styles.badge,
                  m.status === 'pending' ? styles.badgePending : styles.badgeRemoved,
                ]}
              >
                <Text style={styles.badgeText}>{m.status === 'pending' ? 'Pending' : 'Removed'}</Text>
              </View>
            ) : null;
          const content = (
            <View style={styles.attendeeChipContent}>
              <Text style={styles.buttonText}>
                {label}
                {pendingRemoval ? <Text style={styles.removeText}> (removes on save)</Text> : null}
                {isEditing ? <Text style={styles.removeText}> x</Text> : null}
              </Text>
              {badge}
            </View>
          );
          return isEditing ? (
            <TouchableOpacity
              key={m.id}
              style={[styles.button, styles.smallButton]}
              onPress={() => removeTraveler(m.id)}
              testID={attendeeTestId(m)}
            >
              {content}
            </TouchableOpacity>
          ) : (
            <View key={m.id} style={[styles.button, styles.smallButton]} testID={attendeeTestId(m)}>
              {content}
            </View>
          );
        })}
      </View>
      {isEditing && showAddTraveler ? (
        <View style={{ marginTop: 8 }}>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="First name"
              value={travelerDraft.firstName}
              onChangeText={(text) => setTravelerDraft((prev) => ({ ...prev, firstName: text }))}
            />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Last name"
              value={travelerDraft.lastName}
              onChangeText={(text) => setTravelerDraft((prev) => ({ ...prev, lastName: text }))}
            />
          </View>
          <TextInput
            style={styles.input}
            placeholder="Email (optional)"
            autoCapitalize="none"
            value={travelerDraft.email}
            onChangeText={(text) => setTravelerDraft((prev) => ({ ...prev, email: text }))}
          />
          <View style={styles.row}>
            <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={addTraveler}>
              <Text style={styles.buttonText}>Add</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.dangerButton, { flex: 1 }]}
              onPress={() => {
                setShowAddTraveler(false);
                setTravelerDraft({ firstName: '', lastName: '', email: '' });
              }}
            >
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {isEditing ? (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.headerText}>Add Trip Items</Text>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            <TouchableOpacity
              style={[styles.button, styles.smallButton]}
              onPress={openFlightAdd}
            >
              <Text style={styles.buttonText}>Add Flight</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.smallButton]}
              onPress={() => {
                closeLodgingModal();
                setShowAddLodging(true);
              }}
            >
              <Text style={styles.buttonText}>Add Lodging</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.smallButton]}
              onPress={() => {
                closeRentalModal();
                setShowAddRental(true);
              }}
            >
              <Text style={styles.buttonText}>Add Rental Car</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.smallButton]}
              onPress={() => {
                closeTourModal();
                setShowAddTour(true);
              }}
            >
              <Text style={styles.buttonText}>Add Tour</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={styles.divider} />
      {!isEditing ? (
        <>
          <Text style={styles.headerText}>Itinerary</Text>
          {itineraryLoading ? <Text style={styles.helperText}>Loading itinerary...</Text> : null}
          {!itineraryLoading && !sortedItineraryDetails.length ? (
            <Text style={styles.helperText}>No itinerary items yet.</Text>
          ) : null}
          {sortedItineraryDetails.length ? (
            <View>
              <View style={[styles.tableRow, styles.tableHeader]}>
                <View style={[styles.cell, dayColStyle]}>
                  <Text style={styles.headerText}>Day</Text>
                </View>
                <View style={[styles.cell, { flex: 1 }]}>
                  <Text style={styles.headerText}>Time</Text>
                </View>
                <View style={[styles.cell, { flex: 2 }]}>
                  <Text style={styles.headerText}>Activity</Text>
                </View>
                <View style={[styles.cell, { flex: 1 }]}>
                  <Text style={styles.headerText}>Cost</Text>
                </View>
              </View>
              {sortedItineraryDetails.map((d) => (
                <View key={d.id} style={styles.tableRow}>
                  <View style={[styles.cell, dayColStyle]}>
                    <Text style={styles.cellText}>{d.day}</Text>
                  </View>
                  <View style={[styles.cell, { flex: 1 }]}>
                    <Text style={styles.cellText}>{d.time || '-'}</Text>
                  </View>
                  <View style={[styles.cell, { flex: 2 }]}>
                    <Text style={styles.cellText}>{d.activity}</Text>
                  </View>
                  <View style={[styles.cell, { flex: 1 }]}>
                    <Text style={styles.cellText}>{d.cost != null ? `$${d.cost}` : '-'}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      {isEditing ? (
        <View style={[styles.card, { marginTop: 12 }]}>
          <Text style={styles.sectionTitle}>Edit Itinerary Items</Text>
          {!itineraryId ? (
            <Text style={styles.helperText}>No itinerary found for this trip yet.</Text>
          ) : (
            <>
              {sortedItineraryDetails.length ? (
                sortedItineraryDetails.map((d) => (
                  <View key={d.id} style={styles.tableRow}>
                    <View style={[styles.cell, dayColStyle]}>
                      {editingDetailId === d.id ? (
                        <TextInput
                          style={styles.input}
                          placeholder="Day"
                          keyboardType="numeric"
                          value={detailDraft.day}
                          onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, day: text }))}
                        />
                      ) : (
                        <Text style={styles.cellText}>{d.day}</Text>
                      )}
                    </View>
                    <View style={[styles.cell, { flex: 1 }]}>
                      {editingDetailId === d.id ? (
                        <TextInput
                          style={styles.input}
                          placeholder="Time"
                          value={detailDraft.time}
                          onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, time: text }))}
                        />
                      ) : (
                        <Text style={styles.cellText}>{d.time || '-'}</Text>
                      )}
                    </View>
                    <View style={[styles.cell, { flex: 2 }]}>
                      {editingDetailId === d.id ? (
                        <TextInput
                          style={styles.input}
                          placeholder="Activity"
                          value={detailDraft.activity}
                          onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, activity: text }))}
                        />
                      ) : (
                        <Text style={styles.cellText}>{d.activity}</Text>
                      )}
                    </View>
                    <View style={[styles.cell, { flex: 1 }]}>
                      {editingDetailId === d.id ? (
                        <TextInput
                          style={styles.input}
                          placeholder="Cost"
                          keyboardType="numeric"
                          value={detailDraft.cost}
                          onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, cost: text }))}
                        />
                      ) : (
                        <Text style={styles.cellText}>{d.cost != null ? `$${d.cost}` : '-'}</Text>
                      )}
                    </View>
                    <View style={[styles.cell, styles.actionCell, { flex: 1 }]}>
                      {editingDetailId === d.id ? (
                        <>
                          <TouchableOpacity
                            style={[styles.button, styles.smallButton]}
                            onPress={async () => {
                              await saveItineraryDetail();
                            }}
                          >
                            <Text style={styles.buttonText}>Save</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.button, styles.smallButton, styles.dangerButton]}
                            onPress={() => {
                              setEditingDetailId(null);
                              setDetailDraft({ day: '1', time: '', activity: '', cost: '' });
                            }}
                          >
                            <Text style={styles.buttonText}>Cancel</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <>
                          <TouchableOpacity
                            style={[styles.button, styles.smallButton]}
                            onPress={() => {
                              setEditingDetailId(d.id);
                              setDetailDraft({
                                day: String(d.day ?? '1'),
                                time: d.time ?? '',
                                activity: d.activity ?? '',
                                cost: d.cost != null ? String(d.cost) : '',
                              });
                            }}
                          >
                            <Text style={styles.buttonText}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.button, styles.smallButton, styles.dangerButton]}
                            onPress={async () => {
                              await fetch(`${backendUrl}/api/itineraries/details/${d.id}`, {
                                method: 'DELETE',
                                headers,
                              });
                              if (editingDetailId === d.id) setEditingDetailId(null);
                              refreshItineraryDetails();
                            }}
                          >
                            <Text style={styles.buttonText}>Delete</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.helperText}>No itinerary items yet.</Text>
              )}
              {!editingDetailId ? (
                <View style={[styles.tableRow, styles.inputRow]}>
                  <View style={[styles.cell, dayColStyle]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Day"
                      keyboardType="numeric"
                      value={detailDraft.day}
                      onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, day: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { flex: 1 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Time"
                      value={detailDraft.time}
                      onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, time: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { flex: 2 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Activity"
                      value={detailDraft.activity}
                      onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, activity: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { flex: 1 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Cost"
                      keyboardType="numeric"
                      value={detailDraft.cost}
                      onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, cost: text }))}
                    />
                  </View>
                  <View style={[styles.cell, styles.actionCell, { flex: 1 }]}>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={saveItineraryDetail}>
                      <Text style={styles.buttonText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </>
          )}
        </View>
      ) : null}

      {selectedFlight
        ? renderDetailModal('Flight Details', formatFlightDetails(selectedFlight), () => setSelectedFlight(null))
        : null}
      {selectedLodging
        ? renderDetailModal(
            'Lodging Details',
            formatLodgingDetails(selectedLodging, mapApp).map((item) =>
              item.label === 'Address' && selectedLodging.address
                ? { ...item, onPress: () => onOpenAddress(selectedLodging.address) }
                : item
            ),
            () => setSelectedLodging(null)
          )
        : null}
      {selectedTour ? renderDetailModal('Tour Details', formatTourDetails(selectedTour), () => setSelectedTour(null)) : null}
      {detailModal ? renderDetailSectionsModal(detailModal) : null}
      <FlightEditingForm
        visible={showFlightEditor && Boolean(editingFlightDraft && editingFlightId)}
        flightId={editingFlightId}
        flight={editingFlightDraft}
        overlayStyle={{
          justifyContent: 'flex-start',
          paddingTop: Math.max(16, flightEditorAnchor - scrollY + 12),
        }}
        groupMembers={groupMembers}
        userMembers={userMembers}
        styles={styles}
        formatMemberName={formatMemberName}
        payerName={payerName}
        airportTarget={null}
        getLocationInputValue={getLocationInputValue}
        showAirportDropdown={showAirportDropdown}
        parseLayoverDuration={parseLayoverDuration}
        openTimePicker={openTimePicker}
        setFlight={setEditingFlightDraft}
        setPassengerIds={setEditingFlightPassengers}
        modalDepLocationRef={editDepLocationRef}
        modalArrLocationRef={editArrLocationRef}
        modalLayoverLocationRef={editLayoverLocationRef}
        onClose={closeFlightEditor}
        onSave={saveFlightEdit}
      />
      {showAddLodging ? (
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <Text style={styles.sectionTitle}>{editingLodgingId ? 'Edit Lodging' : 'Add Lodging'}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.modalLabel}>Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Hotel name"
                value={lodgingDraft.name}
                onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, name: text }))}
              />
              <Text style={styles.modalLabel}>Check-in date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={lodgingDraft.checkInDate}
                  onChange={(e) =>
                    setLodgingDraft((prev) => ({ ...prev, checkInDate: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('lodgingCheckIn', lodgingDraft.checkInDate)}>
                  <Text style={styles.cellText}>{lodgingDraft.checkInDate || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Check-out date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={lodgingDraft.checkOutDate}
                  onChange={(e) =>
                    setLodgingDraft((prev) => ({ ...prev, checkOutDate: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('lodgingCheckOut', lodgingDraft.checkOutDate)}>
                  <Text style={styles.cellText}>{lodgingDraft.checkOutDate || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <View style={styles.modalRow}>
                <Text style={styles.modalLabel}>Refund by</Text>
                <TouchableOpacity onPress={() => setLodgingDraft((prev) => ({ ...prev, refundBy: '' }))}>
                  <Text style={styles.linkText}>Clear</Text>
                </TouchableOpacity>
              </View>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={lodgingDraft.refundBy}
                  onChange={(e) =>
                    setLodgingDraft((prev) => ({ ...prev, refundBy: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('lodgingRefundBy', lodgingDraft.refundBy)}>
                  <Text style={styles.cellText}>{lodgingDraft.refundBy || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Rooms</Text>
              <TextInput
                style={styles.input}
                placeholder="1"
                keyboardType="numeric"
                value={lodgingDraft.rooms}
                onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, rooms: text }))}
              />
              <Text style={styles.modalLabel}>Total cost</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="numeric"
                value={lodgingDraft.totalCost}
                onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, totalCost: text }))}
              />
              <Text style={styles.modalLabel}>Address</Text>
              <TextInput
                style={styles.input}
                placeholder="Address"
                value={lodgingDraft.address}
                onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, address: text }))}
              />
            </ScrollView>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={closeLodgingModal}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={saveLodging}>
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
      {showAddTour ? (
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <Text style={styles.sectionTitle}>{editingTourId ? 'Edit Tour' : 'Add Tour'}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.modalLabel}>Date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={tourDraft.date}
                  onChange={(e) =>
                    setTourDraft((prev) => ({ ...prev, date: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('tourDate', tourDraft.date)}>
                  <Text style={styles.cellText}>{tourDraft.date || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Tour name</Text>
              <TextInput
                style={styles.input}
                placeholder="Tour name"
                value={tourDraft.name}
                onChangeText={(text) => setTourDraft((prev) => ({ ...prev, name: text }))}
              />
              <Text style={styles.modalLabel}>Start location</Text>
              <TextInput
                style={styles.input}
                placeholder="Start location"
                value={tourDraft.startLocation}
                onChangeText={(text) => setTourDraft((prev) => ({ ...prev, startLocation: text }))}
              />
              <Text style={styles.modalLabel}>Start time</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="time"
                  value={tourDraft.startTime}
                  onChange={(e: any) => setTourDraft((prev) => ({ ...prev, startTime: e.target.value }))}
                  style={styles.input as any}
                />
              ) : (
                <TextInput
                  style={styles.input}
                  placeholder="HH:MM"
                  value={tourDraft.startTime}
                  onChangeText={(text) => setTourDraft((prev) => ({ ...prev, startTime: text }))}
                />
              )}
              <Text style={styles.modalLabel}>Duration</Text>
              <TextInput
                style={styles.input}
                placeholder="2 hours"
                value={tourDraft.duration}
                onChangeText={(text) => setTourDraft((prev) => ({ ...prev, duration: text }))}
              />
              <Text style={styles.modalLabel}>Cost</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="numeric"
                value={tourDraft.cost}
                onChangeText={(text) => setTourDraft((prev) => ({ ...prev, cost: text }))}
              />
              <View style={styles.modalRow}>
                <Text style={styles.modalLabel}>Free cancel by</Text>
                <TouchableOpacity onPress={() => setTourDraft((prev) => ({ ...prev, freeCancelBy: '' }))}>
                  <Text style={styles.linkText}>Clear</Text>
                </TouchableOpacity>
              </View>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={tourDraft.freeCancelBy}
                  onChange={(e: any) =>
                    setTourDraft((prev) => ({ ...prev, freeCancelBy: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('tourFreeCancel', tourDraft.freeCancelBy)}>
                  <Text style={styles.cellText}>{tourDraft.freeCancelBy || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <View style={styles.modalRow}>
                <Text style={styles.modalLabel}>Booked on</Text>
                <TouchableOpacity onPress={() => setTourDraft((prev) => ({ ...prev, bookedOn: '' }))}>
                  <Text style={styles.linkText}>Clear</Text>
                </TouchableOpacity>
              </View>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={tourDraft.bookedOn}
                  onChange={(e: any) =>
                    setTourDraft((prev) => ({ ...prev, bookedOn: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('tourBookedOn', tourDraft.bookedOn)}>
                  <Text style={styles.cellText}>{tourDraft.bookedOn || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Reference</Text>
              <TextInput
                style={styles.input}
                placeholder="Reference"
                value={tourDraft.reference}
                onChangeText={(text) => setTourDraft((prev) => ({ ...prev, reference: text }))}
              />
            </ScrollView>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={closeTourModal}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={saveTour}>
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
      {showAddRental ? (
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <Text style={styles.sectionTitle}>{editingRentalId ? 'Edit Rental Car' : 'Add Rental Car'}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.modalLabel}>Pickup location</Text>
              <TextInput
                style={styles.input}
                placeholder="Pickup location"
                value={rentalDraft.pickupLocation}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, pickupLocation: text }))}
              />
              <Text style={styles.modalLabel}>Pickup date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={rentalDraft.pickupDate}
                  onChange={(e: any) =>
                    setRentalDraft((prev) => ({ ...prev, pickupDate: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('rentalPickup', rentalDraft.pickupDate)}>
                  <Text style={styles.cellText}>{rentalDraft.pickupDate || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Dropoff location</Text>
              <TextInput
                style={styles.input}
                placeholder="Dropoff location"
                value={rentalDraft.dropoffLocation}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, dropoffLocation: text }))}
              />
              <Text style={styles.modalLabel}>Dropoff date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={rentalDraft.dropoffDate}
                  onChange={(e: any) =>
                    setRentalDraft((prev) => ({ ...prev, dropoffDate: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('rentalDropoff', rentalDraft.dropoffDate)}>
                  <Text style={styles.cellText}>{rentalDraft.dropoffDate || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Vendor</Text>
              <TextInput
                style={styles.input}
                placeholder="Vendor"
                value={rentalDraft.vendor}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, vendor: text }))}
              />
              <Text style={styles.modalLabel}>Car model</Text>
              <TextInput
                style={styles.input}
                placeholder="SUV"
                value={rentalDraft.model}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, model: text }))}
              />
              <Text style={styles.modalLabel}>Reference</Text>
              <TextInput
                style={styles.input}
                placeholder="Reference"
                value={rentalDraft.reference}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, reference: text }))}
              />
              <Text style={styles.modalLabel}>Prepaid</Text>
              <TextInput
                style={styles.input}
                placeholder="Yes/No"
                value={rentalDraft.prepaid}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, prepaid: text }))}
              />
              <Text style={styles.modalLabel}>Cost</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="numeric"
                value={rentalDraft.cost}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, cost: text }))}
              />
              <Text style={styles.modalLabel}>Notes</Text>
              <TextInput
                style={styles.input}
                placeholder="Notes"
                value={rentalDraft.notes}
                onChangeText={(text) => setRentalDraft((prev) => ({ ...prev, notes: text }))}
                multiline
              />
            </ScrollView>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={closeRentalModal}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={saveRental}>
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
      {Platform.OS !== 'web' && timePickerTarget && NativeDateTimePicker ? (
        <NativeDateTimePicker
          value={timePickerValue}
          mode="time"
          display="spinner"
          onChange={(event, date) => {
            if (event?.type === 'dismissed') {
              setTimePickerTarget(null);
              return;
            }
            if (!date) return;
            const hh = String(date.getHours()).padStart(2, '0');
            const mm = String(date.getMinutes()).padStart(2, '0');
            const value = `${hh}:${mm}`;
            if (timePickerTarget === 'edit-dep') {
              setEditingFlightDraft((prev) => (prev ? { ...prev, departureTime: value } : prev));
            } else if (timePickerTarget === 'edit-arr') {
              setEditingFlightDraft((prev) => (prev ? { ...prev, arrivalTime: value } : prev));
            }
            setTimePickerTarget(null);
          }}
        />
      ) : null}
      {Platform.OS !== 'web' && dateField && NativeDateTimePicker ? (
        <NativeDateTimePicker
          value={dateValue}
          mode="date"
          onChange={(_, date) => {
            if (!date) {
              setDateField(null);
              return;
            }
            const iso = date.toISOString().slice(0, 10);
            if (dateField === 'start') {
              setDateDraft((prev) => ({ ...prev, startDate: iso }));
            } else {
              setDateDraft((prev) => ({ ...prev, endDate: iso }));
            }
            setDateField(null);
          }}
        />
      ) : null}
      {Platform.OS !== 'web' && modalDateField && NativeDateTimePicker ? (
        <NativeDateTimePicker
          value={modalDateValue}
          mode="date"
          onChange={(_, date) => {
            if (!date) {
              setModalDateField(null);
              return;
            }
            const iso = date.toISOString().slice(0, 10);
            if (modalDateField === 'flightDeparture') {
              setEditingFlightDraft((prev) => (prev ? { ...prev, departureDate: iso } : prev));
            } else if (modalDateField === 'lodgingCheckIn') {
              setLodgingDraft((prev) => ({ ...prev, checkInDate: iso }));
            } else if (modalDateField === 'lodgingCheckOut') {
              setLodgingDraft((prev) => ({ ...prev, checkOutDate: iso }));
            } else if (modalDateField === 'lodgingRefundBy') {
              setLodgingDraft((prev) => ({ ...prev, refundBy: iso }));
            } else if (modalDateField === 'tourDate') {
              setTourDraft((prev) => ({ ...prev, date: iso }));
            } else if (modalDateField === 'tourFreeCancel') {
              setTourDraft((prev) => ({ ...prev, freeCancelBy: iso }));
            } else if (modalDateField === 'tourBookedOn') {
              setTourDraft((prev) => ({ ...prev, bookedOn: iso }));
            } else if (modalDateField === 'rentalPickup') {
              setRentalDraft((prev) => ({ ...prev, pickupDate: iso }));
            } else if (modalDateField === 'rentalDropoff') {
              setRentalDraft((prev) => ({ ...prev, dropoffDate: iso }));
            }
            setModalDateField(null);
          }}
        />
      ) : null}
    </ScrollView>
  );
};

export default OverviewTab;
