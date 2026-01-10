import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, Text, TextInput, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';
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
  buildFlightPayloadForCreate,
  createInitialFlightCreateDraft,
  createInitialFlightState,
  createFlightForTrip,
  type Flight,
  type FlightCreateDraft,
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
import { buildRentalDraftFromRow, buildTourDraftFromRow } from '../utils/overviewEditing';
import { FlightEditingForm } from '../components/FlightEditingForm';

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
  onRefreshFlights: () => void;
  onRefreshLodgings: () => void;
  onRefreshTours: () => void;
  onAddCarRental: (rental: CarRental) => void;
  openFlightInFlightsTab: (flightId: string) => void;
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
  onRefreshFlights,
  onRefreshLodgings,
  onRefreshTours,
  onAddCarRental,
  openFlightInFlightsTab: _openFlightInFlightsTab,
}) => {
  const [itineraryDetails, setItineraryDetails] = useState<ItineraryDetail[]>([]);
  const [itineraryLoading, setItineraryLoading] = useState(false);
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
  const [showAddTraveler, setShowAddTraveler] = useState(false);
  const [travelerDraft, setTravelerDraft] = useState({ firstName: '', lastName: '', email: '' });
  const [showAddFlight, setShowAddFlight] = useState(false);
  const [showAddLodging, setShowAddLodging] = useState(false);
  const [showAddTour, setShowAddTour] = useState(false);
  const [showAddRental, setShowAddRental] = useState(false);
  const [flightDraft, setFlightDraft] = useState<FlightCreateDraft>(createInitialFlightCreateDraft());
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
  const startDateRef = useRef<HTMLInputElement | null>(null);
  const endDateRef = useRef<HTMLInputElement | null>(null);
  const editDepLocationRef = useRef<TextInput | null>(null);
  const editArrLocationRef = useRef<TextInput | null>(null);
  const editLayoverLocationRef = useRef<TextInput | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const [modalDateField, setModalDateField] = useState<ModalDateField | null>(null);
  const [modalDateValue, setModalDateValue] = useState<Date>(new Date());

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
    const loadItinerary = async () => {
      if (!trip?.id) {
        setItineraryDetails([]);
        return;
      }
      setItineraryLoading(true);
      try {
        const res = await fetch(`${backendUrl}/api/itineraries`, { headers });
        if (!res.ok) {
          setItineraryDetails([]);
          return;
        }
        const data = await res.json();
        const records = (Array.isArray(data) ? data : []).filter((i) => i.tripId === trip.id);
        if (!records.length) {
          setItineraryDetails([]);
          return;
        }
        const latest = records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        const detailsRes = await fetch(`${backendUrl}/api/itineraries/${latest.id}/details`, { headers });
        if (!detailsRes.ok) {
          setItineraryDetails([]);
          return;
        }
        const details = await detailsRes.json();
        setItineraryDetails(Array.isArray(details) ? details : []);
      } catch {
        setItineraryDetails([]);
      } finally {
        setItineraryLoading(false);
      }
    };
    loadItinerary();
  }, [backendUrl, headers, trip?.id]);

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
    () => groupMembers.filter((m) => !m.guestName && m.status !== 'pending' && m.status !== 'removed'),
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

  const saveOverviewEdits = async () => {
    if (!trip?.id) return;
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
    setIsEditing(false);
    onRefreshTrips();
  };

  const removeTraveler = async (memberId: string) => {
    if (!isEditing || !group?.id) return;
    const res = await fetch(`${backendUrl}/api/groups/${group.id}/members/${memberId}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to remove member');
      return;
    }
    onRefreshGroups();
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
    const payload = email ? { email } : { guestName: `${first} ${last}`.trim() };
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
    setTravelerDraft({ firstName: '', lastName: '', email: '' });
    setShowAddTraveler(false);
    onRefreshGroups();
  };

  const saveFlight = async () => {
    if (editingFlightId) {
      if (!trip?.id) {
        alert('Select an active trip before editing a flight.');
        return;
      }
      const { payload, error } = buildFlightPayloadForCreate(flightDraft, trip.id, defaultPayerId);
      if (error || !payload) {
        alert(error || 'Unable to update flight');
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
      closeFlightModal();
      onRefreshFlights();
      return;
    }
    const result = await createFlightForTrip({
      backendUrl,
      headers,
      draft: flightDraft,
      tripId: trip?.id ?? null,
      defaultPayerId,
    });
    if (!result.ok) {
      alert(result.error || 'Unable to save flight');
      return;
    }
    closeFlightModal();
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

  const saveFlightEdit = async () => {
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
    setShowFlightEditor(false);
    setEditingFlightDraft(null);
    setEditingFlightId(null);
    onRefreshFlights();
  };

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
      setCarRentals((prev) =>
        prev.map((item) =>
          item.id === editingRentalId
            ? {
                ...item,
                ...rentalDraft,
              }
            : item
        )
      );
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

  const closeFlightModal = () => {
    setShowAddFlight(false);
    setEditingFlightId(null);
    setFlightDraft(createInitialFlightCreateDraft());
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
      closeFlightModal();
      closeFlightEditor();
      closeLodgingModal();
      closeTourModal();
      closeRentalModal();
    }
  }, [isEditing]);

  const openFlightEditor = (flight: Flight) => {
    if (!isEditing) {
      setSelectedFlight(flight);
      return;
    }
    setSelectedFlight(null);
    setShowAddFlight(false);
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
    setTourDraft(buildTourDraftFromRow(tour));
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

  if (!trip) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Overview</Text>
        <Text style={styles.helperText}>Select a trip to view its overview.</Text>
      </View>
    );
  }

  const startLabel = formatFriendlyDate(displayStartDate);
  const endLabel = formatFriendlyDate(displayEndDate);
  const dateRange = startLabel || endLabel ? `${startLabel ?? 'Start'} - ${endLabel ?? 'End'}` : null;
  const dayColStyle = { minWidth: 90, width: 90 };
  const dateColStyle = { minWidth: 200, width: 200 };
  const attendeeLabel = (member: OverviewTabProps['attendees'][number]) => {
    const first = member.firstName?.trim() ?? '';
    const last = member.lastName?.trim() ?? '';
    const combined = `${first} ${last}`.trim();
    return combined || member.guestName?.trim() || 'Traveler';
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.card}
      contentContainerStyle={{ gap: 12 }}
      onScroll={(e) => setScrollY(e.nativeEvent.contentOffset.y)}
      scrollEventThrottle={16}
    >
      <View style={styles.row}>
        <Text style={styles.sectionTitle}>Overview</Text>
        {!isEditing ? (
          <TouchableOpacity style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]} onPress={() => setIsEditing(true)}>
            <Text style={styles.buttonText}>Edit</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={[styles.button, { marginLeft: 'auto' }]} onPress={saveOverviewEdits}>
              <Text style={styles.buttonText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.dangerButton]}
              onPress={() => {
                resetDrafts();
                setIsEditing(false);
              }}
            >
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
          </>
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
              <View style={styles.dateInputWrap}>
                {Platform.OS === 'web' ? (
                  <input
                    ref={startDateRef as any}
                    type="date"
                    value={dateDraft.startDate}
                    onChange={(e) =>
                      setDateDraft((prev) => ({ ...prev, startDate: normalizeDateString(e.target.value) }))
                    }
                    style={styles.input as any}
                  />
                ) : (
                  <TouchableOpacity style={[styles.input, styles.dateTouchable]} onPress={() => openDatePicker('start')}>
                    <Text style={styles.cellText}>{dateDraft.startDate || 'YYYY-MM-DD'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.dateIcon} onPress={() => openDatePicker('start')}>
                  <Text style={styles.selectCaret}>v</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.dateInputWrap}>
                {Platform.OS === 'web' ? (
                  <input
                    ref={endDateRef as any}
                    type="date"
                    value={dateDraft.endDate}
                    onChange={(e) =>
                      setDateDraft((prev) => ({ ...prev, endDate: normalizeDateString(e.target.value) }))
                    }
                    style={styles.input as any}
                  />
                ) : (
                  <TouchableOpacity style={[styles.input, styles.dateTouchable]} onPress={() => openDatePicker('end')}>
                    <Text style={styles.cellText}>{dateDraft.endDate || 'YYYY-MM-DD'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.dateIcon} onPress={() => openDatePicker('end')}>
                  <Text style={styles.selectCaret}>v</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Month (1-12)"
                  keyboardType="numeric"
                  value={dateDraft.startMonth}
                  onChangeText={(text) => setDateDraft((prev) => ({ ...prev, startMonth: text }))}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Year (YYYY)"
                  keyboardType="numeric"
                  value={dateDraft.startYear}
                  onChangeText={(text) => setDateDraft((prev) => ({ ...prev, startYear: text }))}
                />
              </View>
              <TextInput
                style={styles.input}
                placeholder="Number of days"
                keyboardType="numeric"
                value={dateDraft.durationDays}
                onChangeText={(text) => setDateDraft((prev) => ({ ...prev, durationDays: text }))}
              />
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
        {(attendees ?? []).map((m) => {
          const label = attendeeLabel(m);
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
                {isEditing ? <Text style={styles.removeText}> x</Text> : null}
              </Text>
              {badge}
            </View>
          );
          return isEditing ? (
            <TouchableOpacity key={m.id} style={[styles.button, styles.smallButton]} onPress={() => removeTraveler(m.id)}>
              {content}
            </TouchableOpacity>
          ) : (
            <View key={m.id} style={[styles.button, styles.smallButton]}>
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
              onPress={() => {
                closeFlightModal();
                setShowAddFlight(true);
              }}
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
      <Text style={styles.headerText}>Itinerary</Text>
      {itineraryLoading ? <Text style={styles.helperText}>Loading itinerary...</Text> : null}
      {!itineraryLoading && !rows.length ? <Text style={styles.helperText}>No itinerary items yet.</Text> : null}
      {rows.length ? (
        <View>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <View style={[styles.cell, dayColStyle]}>
              <Text style={styles.headerText}>Day</Text>
            </View>
            <View style={[styles.cell, dateColStyle]}>
              <Text style={styles.headerText}>Date</Text>
            </View>
            <View style={[styles.cell, { flex: 1 }]}>
              <Text style={styles.headerText}>Description</Text>
            </View>
          </View>
          {(() => {
            let dayCounter = 0;
            return rows.map((row, idx) => {
              const prev = rows[idx - 1];
              const showDay = !prev || prev.dayLabel !== row.dayLabel || prev.dateLabel !== row.dateLabel;
              if (showDay) dayCounter += 1;
              const renderedDate = formatFriendlyDate(row.dateLabel, row.time) ?? row.dateLabel;
              const renderDescription = (content: React.ReactNode, onPress?: () => void) =>
                onPress ? (
                  <TouchableOpacity onPress={onPress}>
                    <Text style={styles.linkText}>{content}</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.cellText}>{content}</Text>
                );
              let onPress: (() => void) | undefined;
              if (row.type === 'flight') onPress = () => openFlightEditor(row.meta as Flight);
              if (row.type === 'lodging') onPress = () => openLodgingEditor(row.meta as Lodging);
              if (row.type === 'tour') onPress = () => openTourEditor(row.meta as Tour);
              if (row.type === 'rental') onPress = () => openRentalEditor(row.meta as CarRental);
              return (
                <View
                  key={`${row.type}-${row.label}-${idx}`}
                  style={styles.tableRow}
                  onLayout={(e: LayoutChangeEvent) => {
                    if (row.type === 'flight' && (row.meta as Flight)?.id) {
                      setFlightRowOffsets((prev) => ({
                        ...prev,
                        [(row.meta as Flight).id]: e.nativeEvent.layout.y,
                      }));
                    }
                  }}
                >
                  <View style={[styles.cell, dayColStyle]}>{showDay ? <Text style={styles.cellText}>{dayCounter}</Text> : null}</View>
                  <View style={[styles.cell, dateColStyle]}>{showDay ? <Text style={styles.cellText}>{renderedDate}</Text> : null}</View>
                  <View style={[styles.cell, { flex: 1 }]}>{renderDescription(row.label, onPress)}</View>
                </View>
              );
            });
          })()}
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
      {showAddFlight ? (
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <Text style={styles.sectionTitle}>{editingFlightId ? 'Edit Flight' : 'Add Flight'}</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.modalLabel}>Passenger</Text>
              <TextInput
                style={styles.input}
                placeholder="Passenger name"
                value={flightDraft.passengerName}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, passengerName: text }))}
              />
              <Text style={styles.modalLabel}>Departure date</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={flightDraft.departureDate}
                  onChange={(e) =>
                    setFlightDraft((prev) => ({ ...prev, departureDate: normalizeDateString(e.target.value) }))
                  }
                  style={styles.input as any}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('flightDeparture', flightDraft.departureDate)}>
                  <Text style={styles.cellText}>{flightDraft.departureDate || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Departure airport code</Text>
              <TextInput
                style={styles.input}
                placeholder="JFK"
                value={flightDraft.departureAirportCode}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, departureAirportCode: text }))}
              />
              <Text style={styles.modalLabel}>Departure time</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="time"
                  value={flightDraft.departureTime}
                  onChange={(e) => setFlightDraft((prev) => ({ ...prev, departureTime: e.target.value }))}
                  style={styles.input as any}
                />
              ) : (
                <TextInput
                  style={styles.input}
                  placeholder="HH:MM"
                  value={flightDraft.departureTime}
                  onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, departureTime: text }))}
                />
              )}
              <Text style={styles.modalLabel}>Arrival airport code</Text>
              <TextInput
                style={styles.input}
                placeholder="LAX"
                value={flightDraft.arrivalAirportCode}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, arrivalAirportCode: text }))}
              />
              <Text style={styles.modalLabel}>Arrival time</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="time"
                  value={flightDraft.arrivalTime}
                  onChange={(e) => setFlightDraft((prev) => ({ ...prev, arrivalTime: e.target.value }))}
                  style={styles.input as any}
                />
              ) : (
                <TextInput
                  style={styles.input}
                  placeholder="HH:MM"
                  value={flightDraft.arrivalTime}
                  onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, arrivalTime: text }))}
                />
              )}
              <Text style={styles.modalLabel}>Carrier</Text>
              <TextInput
                style={styles.input}
                placeholder="Delta"
                value={flightDraft.carrier}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, carrier: text }))}
              />
              <Text style={styles.modalLabel}>Flight number</Text>
              <TextInput
                style={styles.input}
                placeholder="DL123"
                value={flightDraft.flightNumber}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, flightNumber: text }))}
              />
              <Text style={styles.modalLabel}>Booking reference</Text>
              <TextInput
                style={styles.input}
                placeholder="ABC123"
                value={flightDraft.bookingReference}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, bookingReference: text }))}
              />
              <Text style={styles.modalLabel}>Layover location</Text>
              <TextInput
                style={styles.input}
                placeholder="Chicago"
                value={flightDraft.layoverLocation}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, layoverLocation: text }))}
              />
              <Text style={styles.modalLabel}>Layover airport code</Text>
              <TextInput
                style={styles.input}
                placeholder="ORD"
                value={flightDraft.layoverLocationCode}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, layoverLocationCode: text }))}
              />
              <Text style={styles.modalLabel}>Layover duration</Text>
              <TextInput
                style={styles.input}
                placeholder="1h 20m"
                value={flightDraft.layoverDuration}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, layoverDuration: text }))}
              />
              <Text style={styles.modalLabel}>Cost</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                keyboardType="numeric"
                value={flightDraft.cost}
                onChangeText={(text) => setFlightDraft((prev) => ({ ...prev, cost: text }))}
              />
            </ScrollView>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={closeFlightModal}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={saveFlight}>
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
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
                  onChange={(e) => setTourDraft((prev) => ({ ...prev, startTime: e.target.value }))}
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
                  onChange={(e) =>
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
                  onChange={(e) =>
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
                  onChange={(e) =>
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
                  onChange={(e) =>
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
              setFlightDraft((prev) => ({ ...prev, departureDate: iso }));
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
