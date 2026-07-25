import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Modal } from 'react-native';
import HorizontalTableScroll from '../components/HorizontalTableScroll';
import DropdownOptionButton from '../components/DropdownOptionButton';
import { formatDateLong } from '../utils/formatDateLong';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { normalizeDateString } from '../utils/normalizeDateString';
import { FlightEditingForm } from '../components/TransferEditingForm';
import { toWebStyle } from '../utils/webStyle';
import { buildMemberDisplayLookup, formatTravelerListDisplay } from '../utils/memberDisplay';
import { normalizeTimeInput } from '../utils/normalizeTimeInput';
import { formatNetVotes, shouldShowRatingButtons, shouldShowVoteButtons } from '../utils/votes';
import {
  DEFAULT_NEW_ITINERARY_STATUS,
  LEGACY_ITINERARY_STATUS,
  type ItineraryStatus,
  normalizeItineraryStatus,
  shouldRelaxRequiredFields,
} from '../utils/itineraryStatus';

type NativeDateTimePickerType = typeof import('@react-native-community/datetimepicker').default;
let NativeDateTimePicker: NativeDateTimePickerType | null = null;
if (Platform.OS !== 'web') {
  try {
    const mod = require('@react-native-community/datetimepicker');
    NativeDateTimePicker = (mod?.default ?? mod) as NativeDateTimePickerType;
  } catch {
    NativeDateTimePicker = null;
  }
}

export interface Flight {
  id: string;
  status?: ItineraryStatus;
  transfer_type?: TransferType;
  transferType?: TransferType;
  netVotes?: number;
  userVote?: -1 | 1 | null;
  netRating?: number;
  userRating?: -1 | 1 | null;
  passenger_name: string;
  passenger_ids?: string[];
  arrival_date?: string | null;
  trip_id: string;
  departure_date: string;
  departure_location?: string;
  departure_airport_code?: string;
  departure_time: string;
  arrival_location?: string;
  arrival_airport_code?: string;
  layover_location?: string;
  layover_location_code?: string;
  layover_duration?: string;
  arrival_time: string;
  cost: number;
  carrier: string;
  flight_number: string;
  booking_reference: string;
  paid_by?: string[];
  paidBy?: string[];
  passengerInGroup?: boolean;
  departure_airport_label?: string;
  arrival_airport_label?: string;
  layover_airport_label?: string;
  departureAirportLabel?: string;
  arrivalAirportLabel?: string;
  layoverAirportLabel?: string;
}

export type TransferType = 'Flight' | 'Train' | 'Bus' | 'Private' | 'Ferry' | 'Other';
export const TRANSFER_TYPES: TransferType[] = ['Flight', 'Train', 'Bus', 'Private', 'Ferry', 'Other'];

export type FlightDraft = {
  status: ItineraryStatus;
  transferType: TransferType;
  passengerName: string;
  passengerIds: string[];
  departureDate: string;
  arrivalDate: string;
  departureLocation: string;
  departureAirportCode: string;
  departureTime: string;
  arrivalLocation: string;
  arrivalAirportCode: string;
  layoverLocation: string;
  layoverLocationCode: string;
  layoverDuration: string;
  arrivalTime: string;
  cost: string;
  carrier: string;
  flightNumber: string;
  bookingReference: string;
  paidBy: string[];
};

export type FlightEditDraft = {
  status: ItineraryStatus;
  transferType: TransferType;
  passengerName: string;
  passengerIds: string[];
  departureDate: string;
  arrivalDate: string;
  departureLocation: string;
  departureAirportCode: string;
  departureTime: string;
  arrivalLocation: string;
  arrivalAirportCode: string;
  layoverLocation: string;
  layoverLocationCode: string;
  layoverDuration: string;
  arrivalTime: string;
  cost: string;
  carrier: string;
  flightNumber: string;
  bookingReference: string;
  paidBy: string[];
};

export type FlightCreateDraft = {
  status: ItineraryStatus;
  transferType: TransferType;
  passengerName: string;
  passengerIds: string[];
  departureLocation?: string;
  departureDate: string;
  arrivalDate: string;
  arrivalLocation?: string;
  departureAirportCode: string;
  departureTime: string;
  arrivalAirportCode: string;
  arrivalTime: string;
  layoverLocation: string;
  layoverLocationCode: string;
  layoverDuration: string;
  cost: string;
  carrier: string;
  flightNumber: string;
  bookingReference: string;
};

export const filterAirportOptionLabels = (options: string[], query: string): string[] => {
  const airportSuggestionLimit = 20;
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return options.slice(0, airportSuggestionLimit);
  return options.filter((opt) => opt.toLowerCase().includes(normalizedQuery)).slice(0, airportSuggestionLimit);
};

const isValidTime = (value: string): boolean => {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60;
};

export const createInitialFlightCreateDraft = (): FlightCreateDraft => ({
  status: DEFAULT_NEW_ITINERARY_STATUS,
  transferType: 'Flight',
  passengerName: '',
  passengerIds: [],
  departureDate: new Date().toISOString().slice(0, 10),
  arrivalDate: new Date().toISOString().slice(0, 10),
  departureAirportCode: '',
  departureTime: '',
  arrivalAirportCode: '',
  arrivalTime: '',
  layoverLocation: '',
  layoverLocationCode: '',
  layoverDuration: '',
  cost: '',
  carrier: '',
  flightNumber: '',
  bookingReference: '',
});

export type GroupMemberOption = {
  id: string;
  userId?: string | null;
  guestName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
   status?: 'active' | 'pending' | 'removed';
   removedAt?: string | null;
};

export type Trip = {
  id: string;
  groupId: string;
  groupName: string;
  name: string;
  description?: string | null;
  destination?: string | null;
  locationIds?: string[];
  mustSeeAttractions?: string[];
  departureCity?: string | null;
  departureLocation?: string | null;
  departureAirport?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  startMonth?: number | null;
  startYear?: number | null;
  durationDays?: number | null;
  currency?: string | null;
  createdAt: string;
};

export const createInitialFlightState = (): FlightDraft => ({
  status: DEFAULT_NEW_ITINERARY_STATUS,
  transferType: 'Flight',
  passengerName: '',
  passengerIds: [],
  departureDate: new Date().toISOString().slice(0, 10),
  arrivalDate: new Date().toISOString().slice(0, 10),
  departureLocation: '',
  departureAirportCode: '',
  departureTime: '08:00',
  arrivalLocation: '',
  arrivalAirportCode: '',
  layoverLocation: '',
  layoverLocationCode: '',
  layoverDuration: '',
  arrivalTime: '10:00',
  cost: '',
  carrier: '',
  flightNumber: '',
  bookingReference: '',
  paidBy: [],
});

export const canonicalizeMemberSelectionIds = (
  ids: string[] | null | undefined,
  members: Array<Pick<GroupMemberOption, 'id' | 'userId'>>
): string[] => {
  if (!Array.isArray(ids) || !ids.length) return [];
  const memberById = new Map(members.map((member) => [String(member.id), String(member.id)]));
  const memberByUserId = new Map(
    members
      .filter((member) => member.userId)
      .map((member) => [String(member.userId), String(member.id)])
  );
  return Array.from(
    new Set(
      ids
        .map((id) => String(id))
        .map((id) => memberById.get(id) ?? memberByUserId.get(id) ?? id)
        .filter((id) => memberById.has(id))
    )
  );
};

const getDefaultFlightDates = (trip?: Trip): { departureDate: string; arrivalDate: string } | null => {
  if (!trip) return null;
  const normalizedStart = normalizeDateString(trip.startDate ?? '');
  if (normalizedStart) {
    return { departureDate: normalizedStart, arrivalDate: normalizedStart };
  }
  if (trip.startYear && trip.startMonth) {
    const month = String(trip.startMonth).padStart(2, '0');
    const date = `${trip.startYear}-${month}-01`;
    return { departureDate: date, arrivalDate: date };
  }
  return null;
};

const getDefaultFlightDepartureLocation = (trip?: Trip): string | null => {
  if (!trip) return null;
  const raw =
    (trip as Trip)?.departureCity ??
    (trip as Trip)?.departureLocation ??
    (trip as Trip)?.departureAirport ??
    '';
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
};

export const createFlightDraftForTrip = (trip?: Trip, defaultPayerId?: string | null): FlightEditDraft => {
  const draft = createInitialFlightState() as FlightEditDraft;
  const dateDefaults = getDefaultFlightDates(trip);
  if (dateDefaults) {
    draft.departureDate = dateDefaults.departureDate;
    draft.arrivalDate = dateDefaults.arrivalDate;
  }
  const locationDefault = getDefaultFlightDepartureLocation(trip);
  if (locationDefault) {
    draft.departureLocation = locationDefault;
  }
  if (defaultPayerId) {
    draft.paidBy = [defaultPayerId];
  }
  return draft;
};

export const buildFlightPayload = (flight: FlightEditDraft, tripId?: string | null, defaultPayerId?: string | null) => {
  const trim = (v: string | null | undefined) => (v ?? '').trim();
  const departureDate = normalizeDateString(trim(flight.departureDate)) || new Date().toISOString().slice(0, 10);
  const arrivalDate = normalizeDateString(trim((flight as any).arrivalDate)) || departureDate;
  const departureTime = normalizeTimeInput(flight.departureTime);
  const arrivalTime = normalizeTimeInput(flight.arrivalTime);
  const departureLocation = trim(flight.departureLocation) || trim(flight.departureAirportCode);
  const arrivalLocation = trim(flight.arrivalLocation) || trim(flight.arrivalAirportCode);
  const layoverLocation = trim(flight.layoverLocation);
  const layoverLocationCode = trim(flight.layoverLocationCode);
  const passengerIds = Array.isArray(flight.passengerIds) ? flight.passengerIds.filter(Boolean) : [];
  return {
    status: normalizeItineraryStatus(flight.status, DEFAULT_NEW_ITINERARY_STATUS),
    transferType: TRANSFER_TYPES.includes(flight.transferType) ? flight.transferType : 'Flight',
    passengerName: trim(flight.passengerName) || 'Traveler',
    passengerIds,
    departureDate,
    departureLocation,
    departureAirportCode: trim(flight.departureAirportCode) || departureLocation,
    departureTime: departureTime || '00:00',
    arrivalLocation,
    arrivalAirportCode: trim(flight.arrivalAirportCode) || arrivalLocation,
    layoverLocation,
    layoverLocationCode,
    layoverDuration: trim(flight.layoverDuration),
    arrivalDate,
    arrivalTime: arrivalTime || '00:00',
    cost: Number(sanitizeCostInput(flight.cost)) || 0,
    carrier: trim(flight.carrier),
    flightNumber: trim(flight.flightNumber),
    bookingReference: trim(flight.bookingReference),
    paidBy: flight.paidBy?.length ? flight.paidBy : defaultPayerId ? [defaultPayerId] : [],
    ...(tripId ? { tripId } : {}),
  };
};

export const buildFlightPayloadForCreate = (
  draft: FlightCreateDraft | FlightEditDraft,
  tripId?: string | null,
  defaultPayerId?: string | null
): { payload?: any; error?: string } => {
  if (!tripId) return { error: 'Select an active trip before adding a transfer.' };
  const status = normalizeItineraryStatus((draft as FlightEditDraft).status, DEFAULT_NEW_ITINERARY_STATUS);
  const departureDate = (draft as FlightEditDraft).departureDate?.trim();
  const departureTime = normalizeTimeInput((draft as FlightEditDraft).departureTime);
  const arrivalTime = normalizeTimeInput((draft as FlightEditDraft).arrivalTime);
  const relaxed = shouldRelaxRequiredFields(status);
  if (!relaxed && !departureDate) return { error: 'Departure date is required.' };
  if (!relaxed && (!departureTime || !arrivalTime)) return { error: 'Departure and arrival times are required.' };
  if ((departureTime && !isValidTime(departureTime)) || (arrivalTime && !isValidTime(arrivalTime))) {
    return { error: 'Enter valid departure and arrival times (HH:MM).' };
  }
  if (!relaxed && (!Array.isArray(draft.passengerIds) || draft.passengerIds.filter(Boolean).length === 0)) {
    return { error: 'Select at least one passenger' };
  }
  const payload = buildFlightPayload(draft as FlightEditDraft, tripId, defaultPayerId);
  return { payload };
};

export const createFlightForTrip = async (params: {
  backendUrl: string;
  headers: Record<string, string>;
  draft: FlightCreateDraft;
  tripId: string | null;
  defaultPayerId?: string | null;
}): Promise<{ ok: boolean; error?: string }> => {
  const { backendUrl, headers, draft, tripId, defaultPayerId } = params;
  const { payload, error } = buildFlightPayloadForCreate(draft, tripId, defaultPayerId);
  if (error || !payload) return { ok: false, error };
  const res = await fetch(`${backendUrl}/api/transfers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || 'Unable to save flight' };
  return { ok: true };
};

export const removeFlightApi = async (
  backendUrl: string,
  headers: Record<string, string>,
  id: string
): Promise<{ ok: boolean; error?: string }> => {
  const res = await fetch(`${backendUrl}/api/transfers/${id}`, { method: 'DELETE', headers });
  if (!res.ok) {
    let data: any = {};
    try {
      data = await res.json();
    } catch {
      // ignore
    }
    return { ok: false, error: data.error || 'Unable to delete flight' };
  }
  return { ok: true };
};

export const normalizeFlightFromApi = (f: any): Flight => ({
  ...f,
  status: normalizeItineraryStatus(f.status, LEGACY_ITINERARY_STATUS),
  transfer_type: TRANSFER_TYPES.includes(f.transfer_type)
    ? f.transfer_type
    : TRANSFER_TYPES.includes(f.transferType)
      ? f.transferType
      : 'Flight',
  transferType: TRANSFER_TYPES.includes(f.transferType)
    ? f.transferType
    : TRANSFER_TYPES.includes(f.transfer_type)
      ? f.transfer_type
      : 'Flight',
  netVotes: Number(f.netVotes ?? 0) || 0,
  userVote: f.userVote === 1 || f.userVote === -1 ? f.userVote : null,
  netRating: Number(f.netRating ?? 0) || 0,
  userRating: f.userRating === 1 || f.userRating === -1 ? f.userRating : null,
  passenger_name: f.passenger_name ?? f.passengerName ?? '',
  passenger_ids: Array.isArray(f.passenger_ids)
    ? f.passenger_ids
    : Array.isArray(f.passengerIds)
      ? f.passengerIds
      : [],
  departure_date: f.departure_date ?? f.departureDate ?? '',
  arrival_date: f.arrival_date ?? f.arrivalDate ?? null,
  departure_location: f.departure_location ?? f.departureLocation ?? '',
  arrival_location: f.arrival_location ?? f.arrivalLocation ?? '',
  layover_location: f.layover_location ?? f.layoverLocation ?? '',
  layover_location_code: f.layover_location_code ?? f.layoverLocationCode ?? '',
  departure_airport_code: f.departure_airport_code ?? f.departureAirportCode ?? '',
  arrival_airport_code: f.arrival_airport_code ?? f.arrivalAirportCode ?? '',
  layover_airport_code: f.layover_airport_code ?? f.layoverAirportCode ?? '',
  departure_time: normalizeTimeInput(f.departure_time ?? f.departureTime, String(f.departure_time ?? f.departureTime ?? '')),
  arrival_time: normalizeTimeInput(f.arrival_time ?? f.arrivalTime, String(f.arrival_time ?? f.arrivalTime ?? '')),
  carrier: f.carrier ?? '',
  flight_number: f.flight_number ?? f.flightNumber ?? '',
  booking_reference: f.booking_reference ?? f.bookingReference ?? '',
  paidBy: Array.isArray(f.paidBy)
    ? f.paidBy
    : Array.isArray(f.paid_by)
      ? f.paid_by
      : [],
  paid_by: Array.isArray(f.paid_by)
    ? f.paid_by
    : Array.isArray(f.paidBy)
      ? f.paidBy
      : [],
  arrivalDate: f.arrival_date ?? f.arrivalDate ?? null,
});

export const fetchFlightsForTrip = async ({
  backendUrl,
  activeTripId,
  token,
}: {
  backendUrl: string;
  activeTripId: string | null;
  token?: string | null;
}): Promise<Flight[]> => {
  if (!activeTripId || !token) return [];
  try {
    const res = await fetch(`${backendUrl}/api/transfers?tripId=${activeTripId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data as any[]).map((f) => normalizeFlightFromApi(f));
  } catch (err) {
    console.error('Failed to fetch flights', err);
    return [];
  }
};

type FlightsTabProps = {
  backendUrl: string;
  userToken: string | null;
  activeTripId: string | null;
  flights: Flight[];
  setFlights: React.Dispatch<React.SetStateAction<Flight[]>>;
  groupMembers: GroupMemberOption[];
  defaultPayerId: string | null;
  formatMemberName: (member: GroupMemberOption) => string;
  payerName: (id: string) => string;
  headers: Record<string, string>;
  jsonHeaders: Record<string, string>;
  findActiveTrip: () => Trip | undefined;
  fetchGroupMembersForActiveTrip: () => Promise<void>;
  styles: Record<string, any>;
  airportOptions: string[];
  onSearchAirports: (q: string) => Promise<void> | void;
  externalEditFlightId?: string | null;
  onExternalEditHandled?: () => void;
  onDataChanged?: () => void;
  showList?: boolean;
  mode?: 'live' | 'wizard';
  readOnly?: boolean; // Prop added for read-only viewing of followed trips
  modalOverlayStyle?: Record<string, any>;
  modalCardStyle?: Record<string, any>;
};

type Airport = {
  name: string;
  city?: string;
  country?: string;
  iata_code?: string;
};

const AIRPORT_SUGGESTION_LIMIT = 20;

const fallbackAirports: Airport[] = [
  { name: 'John F. Kennedy International', city: 'New York', country: 'USA', iata_code: 'JFK' },
  { name: 'Los Angeles International', city: 'Los Angeles', country: 'USA', iata_code: 'LAX' },
  { name: 'Chicago O Hare International', city: 'Chicago', country: 'USA', iata_code: 'ORD' },
  { name: 'London Heathrow', city: 'London', country: 'UK', iata_code: 'LHR' },
  { name: 'Paris Charles de Gaulle', city: 'Paris', country: 'France', iata_code: 'CDG' },
  { name: 'Frankfurt Airport', city: 'Frankfurt', country: 'Germany', iata_code: 'FRA' },
  { name: 'Tokyo Haneda', city: 'Tokyo', country: 'Japan', iata_code: 'HND' },
  { name: 'Dubai International', city: 'Dubai', country: 'UAE', iata_code: 'DXB' },
];

const columns: { key: keyof Flight | 'actions' | 'costPerPerson' | 'votes' | 'rating'; label: string; minWidth?: number }[] = [
  { key: 'passenger_name', label: 'Passenger', minWidth: 130 },
  { key: 'status', label: 'Status', minWidth: 120 },
  { key: 'transfer_type', label: 'Type', minWidth: 120 },
  { key: 'votes', label: 'Votes', minWidth: 120 },
  { key: 'rating', label: 'Rating', minWidth: 120 },
  { key: 'departure_date', label: 'Departure Date' },
  { key: 'departure_location', label: 'Departure Location' },
  { key: 'departure_time', label: 'Departure Time' },
  { key: 'arrival_date', label: 'Arrival Date' },
  { key: 'arrival_location', label: 'Arrival Location' },
  { key: 'arrival_time', label: 'Arrival Time' },
  { key: 'layover_duration', label: 'Layover' },
  { key: 'cost', label: 'Cost' },
  { key: 'costPerPerson', label: 'Cost / Person', minWidth: 140 },
  { key: 'carrier', label: 'Carrier' },
  { key: 'flight_number', label: 'Flight #' },
  { key: 'booking_reference', label: 'Booking Ref' },
  { key: 'paidBy', label: 'Paid by' },
  { key: 'actions', label: 'Actions', minWidth: 180 },
];


export const FlightsTab: React.FC<FlightsTabProps> = ({
  backendUrl,
  userToken,
  activeTripId,
  flights,
  setFlights,
  groupMembers,
  defaultPayerId,
  formatMemberName,
  payerName,
  headers,
  jsonHeaders,
  findActiveTrip,
  fetchGroupMembersForActiveTrip,
  styles,
  airportOptions,
  onSearchAirports,
  externalEditFlightId,
  onExternalEditHandled,
  onDataChanged,
  showList = true,
  mode = 'live',
  readOnly = false,
  modalOverlayStyle,
  modalCardStyle,
}) => {
  const isWizard = mode === 'wizard';
  const containerRef = useRef<React.ElementRef<typeof View> | null>(null);
  const memberNames = useMemo(() => {
    return buildMemberDisplayLookup(groupMembers);
  }, [groupMembers]);
  const sortedFlights = useMemo(() => {
    const safeDate = (value?: string | null) => {
      const text = String(value ?? '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '9999-12-31';
    };
    const safeTime = (value?: string | null) => {
      const text = String(value ?? '').trim();
      return /^\d{2}:\d{2}$/.test(text) ? text : '23:59';
    };
    const passengerLabel = (flight: Flight): string => {
      const ids = Array.isArray(flight.passenger_ids) ? flight.passenger_ids : [];
      return formatTravelerListDisplay(ids, flight.passenger_name, groupMembers);
    };
    return [...flights].sort((a, b) => {
      const byDate = safeDate(a.departure_date).localeCompare(safeDate(b.departure_date));
      if (byDate !== 0) return byDate;
      const byTime = safeTime(a.departure_time).localeCompare(safeTime(b.departure_time));
      if (byTime !== 0) return byTime;
      return passengerLabel(a).localeCompare(passengerLabel(b), undefined, { sensitivity: 'base' });
    });
  }, [flights, memberNames]);

  const buildPassengerName = (ids: string[]) => {
    const names = ids.map((id) => memberNames.get(id) ?? memberNames.get(String(id).toLowerCase())).filter(Boolean) as string[];
    return names.join(', ');
  };

  const [newFlight, setNewFlight] = useState<FlightDraft>(createInitialFlightState());
  const [showPassengerDropdown, setShowPassengerDropdown] = useState(false);
  const [passengerAnchor, setPassengerAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [editingFlightId, setEditingFlightId] = useState<string | null>(null);
  const [editingFlight, setEditingFlight] = useState<FlightEditDraft | null>(null);
  const [airports, setAirports] = useState<Airport[]>([]);
  const [airportSuggestions, setAirportSuggestions] = useState<Airport[]>([]);
  const [airportAnchor, setAirportAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [airportAnchorInWindow, setAirportAnchorInWindow] = useState(false);
  const [airportTarget, setAirportTarget] = useState<'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover' | null>(null);
  const [airportQuery, setAirportQuery] = useState('');
  const airportSelectInProgressRef = useRef(false);
  const airportQueryRef = useRef('');
  const airportTargetRef = useRef<'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover' | null>(null);
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([]);
  const [locationTarget, setLocationTarget] = useState<'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover' | null>(null);
  const [showLocationOverlay, setShowLocationOverlay] = useState(false);
  const [locationFieldTarget, setLocationFieldTarget] = useState<'dep' | 'arr' | null>(null);
  const [locationSearch, setLocationSearch] = useState('');
  const locationSelectInProgressRef = useRef(false);
  const locationSearchRef = useRef('');
  const [isAddingRow] = useState(false);
  const passengerDropdownRef = useRef<React.ElementRef<typeof TouchableOpacity> | null>(null);
  const modalDepLocationRef = useRef<React.ElementRef<typeof TextInput> | null>(null);
  const modalArrLocationRef = useRef<React.ElementRef<typeof TextInput> | null>(null);
  const modalLayoverLocationRef = useRef<React.ElementRef<typeof TextInput> | null>(null);
  const [containerOffset, setContainerOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [timePickerTarget, setTimePickerTarget] = useState<'edit-dep' | 'edit-arr' | 'new-dep' | 'new-arr' | null>(null);
  const [timePickerValue, setTimePickerValue] = useState<Date>(new Date());
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [isParsing, setIsParsing] = useState(false);

  const normalizePassengerName = (name: string): string => {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    const parts = trimmed.toLowerCase().split(' ').filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]} ${parts[parts.length - 1]}`;
    }
    return trimmed.toLowerCase();
  };

  const buildLocalFlight = (draft: FlightEditDraft, id?: string): Flight => {
    const localId = id ?? `wizard-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const departureDate = normalizeDateString(draft.departureDate) || new Date().toISOString().slice(0, 10);
    const arrivalDate = normalizeDateString(draft.arrivalDate) || departureDate;
    return {
      id: localId,
      status: normalizeItineraryStatus(draft.status, DEFAULT_NEW_ITINERARY_STATUS),
      transfer_type: TRANSFER_TYPES.includes(draft.transferType) ? draft.transferType : 'Flight',
      transferType: TRANSFER_TYPES.includes(draft.transferType) ? draft.transferType : 'Flight',
      passenger_name: draft.passengerName || 'Traveler',
      passenger_ids: draft.passengerIds ?? [],
      trip_id: activeTripId ?? 'wizard',
      departure_date: departureDate,
      departure_location: draft.departureLocation || '',
      departure_airport_code: draft.departureAirportCode || '',
      departure_time: draft.departureTime || '00:00',
      arrival_date: arrivalDate,
      arrival_location: draft.arrivalLocation || '',
      arrival_airport_code: draft.arrivalAirportCode || '',
      layover_location: draft.layoverLocation || '',
      layover_location_code: draft.layoverLocationCode || '',
      layover_duration: draft.layoverDuration || '',
      arrival_time: draft.arrivalTime || '00:00',
      cost: Number(draft.cost) || 0,
      carrier: draft.carrier || 'UNKNOWN',
      flight_number: draft.flightNumber || 'UNKNOWN',
      booking_reference: draft.bookingReference || 'UNKNOWN',
      paidBy: Array.isArray(draft.paidBy) ? draft.paidBy : [],
      paid_by: Array.isArray(draft.paidBy) ? draft.paidBy : [],
      passengerInGroup: true,
    };
  };

  const flightsTotal = useMemo(() => flights.reduce((sum, f) => sum + (Number(f.cost) || 0), 0), [flights]);

  const userMembers = useMemo(
    () => groupMembers.filter((m) => !m.guestName && m.status !== 'removed'),
    [groupMembers]
  );

  const filterAirports = (query: string): Airport[] => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    return airports
      .filter((a) => a.iata_code && a.iata_code.length === 3)
      .filter((a) => {
        const target = `${a.name ?? ''} ${a.city ?? ''} ${a.iata_code ?? ''}`.toLowerCase();
        return target.includes(q);
      })
      .slice(0, AIRPORT_SUGGESTION_LIMIT);
  };

  const parseAirportLabel = (label: string): Airport => {
    const codeMatch = label.match(/\(([A-Za-z0-9]{3,4})\)/);
    const code = codeMatch ? codeMatch[1].toUpperCase() : '';
    const city = label.replace(/\([^)]+\)/, '').trim() || label;
    return { name: label, city, country: undefined, iata_code: code };
  };

  const buildAirportSuggestions = (query: string): Airport[] => {
    const q = query.trim().toLowerCase();
    if (!q) {
      if (airportOptions.length) {
        return airportOptions.map(parseAirportLabel).slice(0, AIRPORT_SUGGESTION_LIMIT);
      }
      if (airports.length) return airports.slice(0, AIRPORT_SUGGESTION_LIMIT);
      return fallbackAirports;
    }
    if (airportOptions.length) {
      const parsed = filterAirportOptionLabels(airportOptions, query).map(parseAirportLabel);
      const filtered = parsed.filter((a) => `${a.name ?? ''} ${a.city ?? ''} ${a.iata_code ?? ''}`.toLowerCase().includes(q));
      return (filtered.length ? filtered : parsed).slice(0, AIRPORT_SUGGESTION_LIMIT);
    }
    return filterAirports(query);
  };

  const fetchAirportLabels = async (query: string): Promise<string[]> => {
    const trimmed = query.trim();
    if (!trimmed || !userToken || isWizard) return [];
    try {
      const res = await fetch(`${backendUrl}/api/transfers/locations?q=${encodeURIComponent(trimmed)}`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as string[];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  };

  const measureContainerOffset = () => {
    const node = containerRef.current as any;
    if (!node) return;
    if (node.measureInWindow) {
      node.measureInWindow((x: number, y: number) => setContainerOffset({ x, y }));
    } else if (typeof node.getBoundingClientRect === 'function') {
      const rect = node.getBoundingClientRect();
      setContainerOffset({
        x: rect.left + (typeof window !== 'undefined' ? window.scrollX : 0),
        y: rect.top + (typeof window !== 'undefined' ? window.scrollY : 0),
      });
    }
  };

  const formatAirportLabel = (a: Airport): string => {
    const city = a.city || a.name;
    const code = a.iata_code ? ` (${a.iata_code})` : '';
    return `${city}${code}`;
  };

  const parseLayoverDuration = (value: string | null | undefined): { hours: string; minutes: string } => {
    const safe = value ?? '';
    const hoursMatch = safe.match(/(\d+)\s*h/i);
    const minutesMatch = safe.match(/(\d+)\s*m/i);
    const hours = hoursMatch ? hoursMatch[1] : '';
    const minutes = minutesMatch ? minutesMatch[1] : '';
    return { hours, minutes };
  };

  const formatLocationDisplay = (code?: string | null, label?: string | null): string => {
    if (label && label.trim().length) return label;
    const normalized = code ? code.toUpperCase() : '';
    if (!normalized) return '-';
    const match = airports.find((a) => (a.iata_code ?? '').toUpperCase() === normalized);
    if (match) return formatAirportLabel(match);
    return normalized;
  };

  const getLocationInputValue = (
    rawValue: string,
    activeTarget: 'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover' | null,
    currentTarget: typeof locationTarget | typeof airportTarget
  ): string => {
    if (currentTarget === activeTarget) {
      return rawValue;
    }
    return formatLocationDisplay(rawValue);
  };

  const setNewFlightPassengers = (ids: string[]) => {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    setNewFlight((prev) => ({
      ...prev,
      passengerIds: unique,
      passengerName: buildPassengerName(unique),
    }));
  };

  const setEditingFlightPassengers = (ids: string[]) => {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    setEditingFlight((prev) =>
      prev ? { ...prev, passengerIds: unique, passengerName: buildPassengerName(unique) } : prev
    );
  };


  const fetchFlights = async (token?: string) => {
    if (isWizard) return;
    if (!userToken || !activeTripId) {
      setFlights([]);
      return;
    }
    const list = await fetchFlightsForTrip({ backendUrl, activeTripId, token: token ?? userToken });
    setFlights(list);
  };


  const fetchLocationSuggestions = async (
    target: 'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover',
    text: string
  ) => {
    setLocationTarget(target);
    setLocationSearch(text);
    locationSearchRef.current = text.trim();
    if (!userToken && !isWizard) {
      setLocationSuggestions([]);
      return;
    }
    const q = text.trim();
    if (!q) {
      setLocationSuggestions([]);
      return;
    }
    if (isWizard && !userToken) {
      const suggestions = buildAirportSuggestions(q).map((a) => formatAirportLabel(a));
      setLocationSuggestions(suggestions);
      return;
    }
    try {
      void onSearchAirports(q);
    } catch {
      // Ignore background cache-warming errors.
    }
    const remote = await fetchAirportLabels(q);
    if (locationSearchRef.current !== q) return;
    if (remote.length) {
      setLocationSuggestions(remote);
      return;
    }
    const filtered = filterAirportOptionLabels(airportOptions, q);
    if (filtered.length) {
      setLocationSuggestions(filtered);
      return;
    }
    setLocationSuggestions(filterAirports(q).map((a) => formatAirportLabel(a)));
  };

  const togglePassengerDropdown = () => {
    if (showPassengerDropdown) {
      setShowPassengerDropdown(false);
      return;
    }
    const node = passengerDropdownRef.current as any;
    if (node?.measureInWindow) {
      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        setPassengerAnchor({ x, y, width, height });
        setShowPassengerDropdown(true);
      });
    } else {
      setShowPassengerDropdown(true);
    }
  };

  const showAirportDropdown = (target: 'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover', node: any, query: string) => {
    setAirportTarget(target);
    setAirportQuery(query);
    airportTargetRef.current = target;
    airportQueryRef.current = query.trim();
    setAirportSuggestions(buildAirportSuggestions(query));
    const inWindow = target.startsWith('modal-');
    setAirportAnchorInWindow(inWindow);
    if (!inWindow) {
      measureContainerOffset();
    }
    if (query.trim()) {
      try {
        void onSearchAirports(query);
      } catch {
        // ignore background errors
      }
      void (async () => {
        const remote = await fetchAirportLabels(query);
        if (!remote.length) return;
        if (airportTargetRef.current !== target || airportQueryRef.current !== query.trim()) return;
        setAirportSuggestions(remote.map(parseAirportLabel).slice(0, AIRPORT_SUGGESTION_LIMIT));
      })();
    }
    let nextAnchor = { x: 16, y: 120, width: 260, height: 40 };
    if (node?.measureInWindow) {
      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        if (inWindow) {
          setAirportAnchor({ x, y, width, height });
        } else {
          setAirportAnchor({ x: x - containerOffset.x, y: y - containerOffset.y, width, height });
        }
      });
    } else if (typeof node?.getBoundingClientRect === 'function') {
      const rect = node.getBoundingClientRect();
      const containerRect = (containerRef.current as any)?.getBoundingClientRect?.();
      const containerLeft = (containerRect?.left ?? 0) + (typeof window !== 'undefined' ? window.scrollX : 0);
      const containerTop = (containerRect?.top ?? 0) + (typeof window !== 'undefined' ? window.scrollY : 0);
      nextAnchor = {
        x: rect.left + (typeof window !== 'undefined' ? window.scrollX : 0) - (inWindow ? 0 : containerLeft),
        y: rect.top + (typeof window !== 'undefined' ? window.scrollY : 0) - (inWindow ? 0 : containerTop),
        width: rect.width,
        height: rect.height,
      };
    }
    setAirportAnchor(nextAnchor);
  };

  const hideAirportDropdown = () => {
    setAirportTarget(null);
    airportTargetRef.current = null;
    setAirportAnchor(null);
    setAirportAnchorInWindow(false);
    setAirportSuggestions([]);
    setAirportQuery('');
    airportQueryRef.current = '';
  };

  const applyTopAirportSuggestion = (
    target: 'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover',
    value: string
  ) => {
    if (airportSelectInProgressRef.current) {
      airportSelectInProgressRef.current = false;
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      if ((target === 'dep' || target === 'modal-dep') && editingFlight) {
        setEditingFlight((prev) => (prev ? { ...prev, departureLocation: '', departureAirportCode: '' } : prev));
      } else if ((target === 'arr' || target === 'modal-arr') && editingFlight) {
        setEditingFlight((prev) => (prev ? { ...prev, arrivalLocation: '', arrivalAirportCode: '' } : prev));
      } else if (target === 'modal-layover' && editingFlight) {
        setEditingFlight((prev) => (prev ? { ...prev, layoverLocation: '', layoverLocationCode: '' } : prev));
      }
      hideAirportDropdown();
      return;
    }
    const suggestions = airportSuggestions.length ? airportSuggestions : buildAirportSuggestions(trimmed);
    if (!suggestions.length) {
      hideAirportDropdown();
      return;
    }
    selectAirport(target, suggestions[0]);
  };

  const commitLocationOverlay = () => {
    if (locationSelectInProgressRef.current) {
      locationSelectInProgressRef.current = false;
      return;
    }
    const trimmed = locationSearch.trim();
    if (!trimmed) {
      closeLocationOverlay();
      return;
    }
    const top = locationSuggestions[0];
    if (!top) {
      closeLocationOverlay();
      return;
    }
    const codeMatch = top.match(/\(([A-Za-z]{3})\)/i);
    const code = codeMatch ? codeMatch[1].toUpperCase() : top;
    if (locationFieldTarget === 'dep') {
      setNewFlight((prev) => ({ ...prev, departureLocation: code, departureAirportCode: code }));
    } else if (locationFieldTarget === 'arr') {
      setNewFlight((prev) => ({ ...prev, arrivalLocation: code, arrivalAirportCode: code }));
    }
    closeLocationOverlay();
  };

  const selectAirport = (target: 'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover', airport: Airport) => {
    const code = airport.iata_code ?? '';
    if ((target === 'dep' || target === 'modal-dep') && editingFlight) {
      setEditingFlight((prev) => (prev ? { ...prev, departureLocation: code, departureAirportCode: code } : prev));
    } else if ((target === 'arr' || target === 'modal-arr') && editingFlight) {
      setEditingFlight((prev) => (prev ? { ...prev, arrivalLocation: code, arrivalAirportCode: code } : prev));
    } else if (target === 'modal-layover' && editingFlight) {
      setEditingFlight((prev) => (prev ? { ...prev, layoverLocation: code, layoverLocationCode: code } : prev));
    }
    hideAirportDropdown();
  };

  const openTimePicker = (target: 'edit-dep' | 'edit-arr' | 'new-dep' | 'new-arr', current: string) => {
    if (Platform.OS !== 'web' && NativeDateTimePicker) {
      const base = new Date();
      const match = current.match(/(\d{1,2}):(\d{2})/);
      if (match) {
        base.setHours(Number(match[1]), Number(match[2]), 0, 0);
      } else {
        base.setHours(0, 0, 0, 0);
      }
      setTimePickerValue(base);
      setTimePickerTarget(target);
    }
  };

  const openFlightDetails = (flight: Flight) => {
    if (readOnly) return;
    const normalizedPassengerIds = canonicalizeMemberSelectionIds(
      Array.isArray(flight.passenger_ids) ? flight.passenger_ids : Array.isArray((flight as any).passengerIds) ? (flight as any).passengerIds : [],
      groupMembers
    );
    const normalizedPaidBy = canonicalizeMemberSelectionIds(
      Array.isArray(flight.paidBy) ? flight.paidBy : Array.isArray(flight.paid_by) ? flight.paid_by : [],
      groupMembers
    );
    setEditingFlightId(flight.id);
    const base: FlightEditDraft = {
      status: normalizeItineraryStatus((flight as any).status, LEGACY_ITINERARY_STATUS),
      transferType: TRANSFER_TYPES.includes((flight as any).transferType)
        ? (flight as any).transferType
        : TRANSFER_TYPES.includes((flight as any).transfer_type)
          ? (flight as any).transfer_type
          : 'Flight',
      passengerName: flight.passenger_name,
      passengerIds: normalizedPassengerIds,
      departureDate: normalizeDateString(flight.departure_date),
      arrivalDate: normalizeDateString(flight.arrival_date || (flight as any).arrivalDate || flight.departure_date),
      departureLocation: flight.departure_location ?? '',
      departureAirportCode: flight.departure_airport_code ?? '',
      departureTime: normalizeTimeInput(flight.departure_time, flight.departure_time),
      arrivalLocation: flight.arrival_location ?? '',
      arrivalAirportCode: flight.arrival_airport_code ?? '',
      layoverLocation: flight.layover_location ?? '',
      layoverLocationCode: flight.layover_location_code ?? '',
      layoverDuration: flight.layover_duration ?? '',
      arrivalTime: normalizeTimeInput(flight.arrival_time, flight.arrival_time),
      cost: String(flight.cost ?? ''),
      carrier: flight.carrier,
      flightNumber: flight.flight_number,
      bookingReference: flight.booking_reference,
      paidBy: normalizedPaidBy,
    };
    if (base.paidBy.length === 0 && defaultPayerId) {
      base.paidBy = [defaultPayerId];
    }
    if (base.passengerIds.length) {
      base.passengerName = buildPassengerName(base.passengerIds) || base.passengerName;
    }
    setEditingFlight(base);
  };

  const closeFlightDetails = () => {
    setEditingFlightId(null);
    setEditingFlight(null);
    onExternalEditHandled?.();
  };

  useEffect(() => {
    if (!externalEditFlightId) return;
    const target = flights.find((f) => f.id === externalEditFlightId);
    if (target) {
      openFlightDetails(target);
    }
  }, [externalEditFlightId, flights]);

  const saveFlightDetails = async () => {
    if (readOnly) return;
    if (!editingFlightId || !editingFlight) return;
    const relaxed = shouldRelaxRequiredFields(editingFlight.status);
    if (
      (editingFlight.departureTime && !isValidTime(editingFlight.departureTime)) ||
      (editingFlight.arrivalTime && !isValidTime(editingFlight.arrivalTime))
    ) {
      Alert.alert('Enter valid departure and arrival times (HH:MM).');
      return;
    }
    if (!relaxed && !editingFlight.passengerIds.length) {
      Alert.alert('Select at least one passenger');
      return;
    }
    if (editingFlightId === 'new' && !activeTripId && !isWizard) {
      Alert.alert('Select an active trip before adding a transfer.');
      return;
    }
    if (isWizard) {
      const localFlight = buildLocalFlight(
        { ...editingFlight, passengerName: buildPassengerName(editingFlight.passengerIds) || editingFlight.passengerName },
        editingFlightId === 'new' ? undefined : editingFlightId
      );
      setFlights((prev) => {
        if (editingFlightId === 'new') return [...prev, localFlight];
        return prev.map((flight) => (flight.id === editingFlightId ? { ...flight, ...localFlight } : flight));
      });
      closeFlightDetails();
      return;
    }
    if (!userToken) return;
    let res: Response;
    if (editingFlightId === 'new') {
      const { payload, error } = buildFlightPayloadForCreate(
        { ...editingFlight, passengerName: buildPassengerName(editingFlight.passengerIds) || editingFlight.passengerName },
        activeTripId ?? null,
        defaultPayerId
      );
      if (error || !payload) {
        Alert.alert(error || 'Unable to add flight');
        return;
      }
      res = await fetch(`${backendUrl}/api/transfers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
    } else {
      const payload = buildFlightPayload(
        { ...editingFlight, passengerName: buildPassengerName(editingFlight.passengerIds) || editingFlight.passengerName },
        undefined,
        defaultPayerId
      );
      res = await fetch(`${backendUrl}/api/transfers/${editingFlightId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      Alert.alert(data.error || 'Unable to update flight');
      return;
    }
    closeFlightDetails();
    onDataChanged ? onDataChanged() : fetchFlights();
  };


  const addFlight = async () => {
    if (readOnly) return false;
    if (!userToken) return false;
    if (!activeTripId) {
      Alert.alert('Select an active trip before adding a transfer.');
      return false;
    }

    if (!shouldRelaxRequiredFields(newFlight.status) && !newFlight.passengerIds.length) {
      Alert.alert('Select at least one passenger');
      return false;
    }
    const payload = buildFlightPayload(
      { ...newFlight, passengerName: buildPassengerName(newFlight.passengerIds) || newFlight.passengerName },
      activeTripId,
      defaultPayerId
    );
    const res = await fetch(`${backendUrl}/api/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        ...payload,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      Alert.alert(data.error || 'Unable to save flight');
      return false;
    }

    setNewFlight(createInitialFlightState());
    await fetchFlights();
    return true;
  };

  const removeFlight = async (id: string) => {
    if (readOnly) return;
    if (isWizard) {
      setFlights((prev) => prev.filter((flight) => flight.id !== id));
      return;
    }
    if (!userToken) return;
    const result = await removeFlightApi(backendUrl, headers, id);
    if (!result.ok) {
      Alert.alert(result.error || 'Unable to delete flight');
      return;
    }
    onDataChanged ? onDataChanged() : fetchFlights();
  };

  const voteOnFlight = async (id: string, value: 1 | -1) => {
    if (readOnly) return;
    try {
      const res = await fetch(`${backendUrl}/api/transfers/${id}/vote`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to submit vote');
      }
      onDataChanged ? onDataChanged() : fetchFlights();
    } catch (err: any) {
      Alert.alert(err?.message || 'Unable to submit vote');
    }
  };

  const rateFlight = async (id: string, value: 1 | -1) => {
    if (readOnly) return;
    try {
      const res = await fetch(`${backendUrl}/api/transfers/${id}/rating`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to submit rating');
      }
      onDataChanged ? onDataChanged() : await fetchFlights();
    } catch (err: any) {
      Alert.alert(err?.message || 'Unable to submit rating');
    }
  };

  const openLocationOverlay = (target: 'dep' | 'arr', initialValue: string) => {
    setLocationFieldTarget(target);
    setLocationTarget(target);
    setLocationSearch(initialValue || '');
    setShowLocationOverlay(true);
    fetchLocationSuggestions(target, initialValue || '');
  };

  const closeLocationOverlay = () => {
    setShowLocationOverlay(false);
    setLocationSuggestions([]);
    setLocationTarget(null);
    setLocationFieldTarget(null);
    setLocationSearch('');
  };

  const handlePasteAndParse = async () => {
    if (readOnly) return;
    if (!userToken) return;
    if (!activeTripId && !isWizard) {
      Alert.alert('Select an active trip before adding a transfer.');
      return;
    }
    const textToParse = pasteText.trim();
    if (!textToParse) {
      Alert.alert('Please paste some text first.');
      return;
    }

    setIsParsing(true);
    try {
      const res = await fetch(`${backendUrl}/api/transfers/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ text: textToParse }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to parse');
      }

      // Convert parsed data into our flight draft
      const primary = data.primary || {};
      const init = createFlightDraftForTrip(findActiveTrip(), defaultPayerId);
      
      init.carrier = primary.carrier || '';
      init.flightNumber = primary.flightNumber || '';
      init.bookingReference = primary.bookingReference || '';
      init.departureDate = primary.departureDate || init.departureDate;
      init.departureLocation = primary.departureLocation || '';
      init.departureAirportCode = primary.departureAirportCode || '';
      init.departureTime = primary.departureTime || init.departureTime;
      init.arrivalDate = primary.arrivalDate || init.arrivalDate;
      init.arrivalLocation = primary.arrivalLocation || '';
      init.arrivalAirportCode = primary.arrivalAirportCode || '';
      init.arrivalTime = primary.arrivalTime || init.arrivalTime;
      init.layoverLocation = primary.layoverLocation || '';
      init.layoverLocationCode = primary.layoverLocationCode || '';
      init.layoverDuration = primary.layoverDuration || '';
      init.cost = primary.cost || '';
      
      if (groupMembers.length && primary.passengerName) {
        // Try to match passenger name to group members
        const lowerName = primary.passengerName.toLowerCase();
        const matchedMembers = groupMembers.filter(m => {
          const first = m.firstName?.toLowerCase() || '';
          const last = m.lastName?.toLowerCase() || '';
          const guest = m.guestName?.toLowerCase() || '';
          return (first && lowerName.includes(first)) || 
                 (last && lowerName.includes(last)) || 
                 (guest && lowerName.includes(guest));
        });
        if (matchedMembers.length > 0) {
          init.passengerIds = matchedMembers.map(m => m.id);
          init.passengerName = buildPassengerName(init.passengerIds) || primary.passengerName;
        } else {
          init.passengerName = primary.passengerName;
        }
      } else {
        init.passengerName = primary.passengerName || '';
      }

      setEditingFlightId('new');
      setEditingFlight(init);
      setShowPasteModal(false);
      setPasteText('');
    } catch (err: any) {
      Alert.alert(err.message || 'Unable to parse text');
    } finally {
      setIsParsing(false);
    }
  };

  const handleAddPress = () => {
    if (readOnly) return;
    if (!activeTripId && !isWizard) {
      Alert.alert('Select an active trip before adding a transfer.');
      return;
    }
    setEditingFlightId('new');
    const init = createFlightDraftForTrip(findActiveTrip(), defaultPayerId);
    if (groupMembers.length) {
      const allIds = groupMembers.map((m) => m.id);
      init.passengerIds = allIds;
      init.passengerName = buildPassengerName(allIds) || init.passengerName;
    }
    setEditingFlight(init);
    setAirportTarget(null);
    setAirportAnchor(null);
    setAirportSuggestions([]);
    setLocationTarget(null);
    setLocationSuggestions([]);
  };

  useEffect(() => {
    if (defaultPayerId && editingFlight && editingFlight.paidBy.length === 0) {
      setEditingFlight((p) => (p ? { ...p, paidBy: [defaultPayerId] } : p));
    }
  }, [defaultPayerId, editingFlight]);

  useEffect(() => {
    if (airportOptions.length) {
      setAirports(airportOptions.map(parseAirportLabel));
    } else {
      setAirports(fallbackAirports);
    }
    measureContainerOffset();
  }, [airportOptions]);

  useEffect(() => {
    if (!locationTarget || !locationSearch.trim()) return;
    if (airportOptions.length) {
      const filtered = filterAirportOptionLabels(airportOptions, locationSearch);
      if (filtered.length) setLocationSuggestions(filtered);
    }
  }, [airportOptions, locationTarget, locationSearch]);

  useEffect(() => {
    if (!airportTarget) return;
    setAirportSuggestions(buildAirportSuggestions(airportQuery));
  }, [airportOptions, airportQuery, airportTarget]);

  useEffect(() => {
    fetchFlights();
  }, [activeTripId, userToken]);


  const containerStyle = showList
    ? [styles.card, styles.flightsSection]
    : [
        styles.flightsSection,
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          padding: 0,
          margin: 0,
          zIndex: 50000,
          elevation: 50,
        },
      ];

  return (
    <View
      style={[containerStyle, { pointerEvents: showList ? 'auto' : 'box-none' }]}
      ref={containerRef as any}
    >
      {showList ? (
        <>
      <View style={styles.row}>
        <Text style={styles.sectionTitle}>Transfers</Text>
        {!readOnly ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={[styles.button, styles.outlineButton, { marginRight: 8 }]} onPress={() => setShowPasteModal(true)} testID="transfer-paste">
              <Text style={styles.buttonText}>Paste Info</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.roundButton]} onPress={handleAddPress} testID="transfer-add">
              <Text style={styles.buttonText}>+</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
      <HorizontalTableScroll
        style={styles.tableScroll}
        contentContainerStyle={styles.tableScrollContent}
      >
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            {columns.map((col, idx) => (
              <View
                key={col.key}
                style={[
                  styles.cell,
                  { minWidth: col.minWidth ?? 120, flex: 1 },
                  idx === columns.length - 1 && styles.lastCell,
                ]}
              >
                <Text style={styles.headerText}>{col.label}</Text>
              </View>
            ))}
          </View>
          {sortedFlights.map((item) => (
            <View key={item.id} style={styles.tableRow} testID={`transfer-row-${item.id}`}>
              {columns.map((col, idx) => {
                const isLast = idx === columns.length - 1;
                if (col.key === 'actions') {
                  return (
                    <View
                      key={`${item.id}-${col.key}`}
                      style={[
                        styles.cell,
                        styles.actionCell,
                        { minWidth: col.minWidth ?? 120, flex: 1 },
                        isLast && styles.lastCell,
                      ]}
                    >
                      {!item.passengerInGroup ? <Text style={styles.warningText}>Passenger not in trip group</Text> : null}
                      <View style={styles.actionCell}>
                        {!readOnly ? (
                          <>
                            <TouchableOpacity style={[styles.tableActionButton, styles.tableActionButtonPrimary]} onPress={() => openFlightDetails(item)} testID={`transfer-edit-${item.id}`}>
                              <Text style={styles.buttonText}>Edit</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.tableActionButton, styles.tableActionButtonDanger]} onPress={() => removeFlight(item.id)} testID={`transfer-delete-${item.id}`}>
                              <Text style={styles.buttonText}>Delete</Text>
                            </TouchableOpacity>
                          </>
                        ) : (
                          <Text style={styles.cellText}>View only</Text>
                        )}
                      </View>
                    </View>
                  );
                }
                if (col.key === 'votes') {
                  const showButtons = shouldShowVoteButtons(
                    normalizeItineraryStatus(item.status, LEGACY_ITINERARY_STATUS),
                    item.userVote
                  );
                  return (
                    <View
                      key={`${item.id}-${col.key}`}
                      style={[
                        styles.cell,
                        styles.actionCell,
                        { minWidth: col.minWidth ?? 120, flex: 1 },
                        isLast && styles.lastCell,
                      ]}
                    >
                      {!readOnly && showButtons ? (
                        <>
                          <TouchableOpacity
                            style={[styles.button, styles.smallButton]}
                            onPress={() => voteOnFlight(item.id, 1)}
                            testID={`flight-vote-up-${item.id}`}
                          >
                            <Text style={styles.buttonText}>👍</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.button, styles.smallButton, styles.dangerButton]}
                            onPress={() => voteOnFlight(item.id, -1)}
                            testID={`flight-vote-down-${item.id}`}
                          >
                            <Text style={styles.buttonText}>👎</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <Text style={styles.cellText}>{formatNetVotes(item.netVotes ?? 0)}</Text>
                      )}
                    </View>
                  );
                }
                if (col.key === 'rating') {
                  const showButtons = shouldShowRatingButtons(
                    normalizeItineraryStatus(item.status, LEGACY_ITINERARY_STATUS),
                    item.userRating
                  );
                  return (
                    <View
                      key={`${item.id}-${col.key}`}
                      style={[
                        styles.cell,
                        { minWidth: col.minWidth ?? 120, flex: 1 },
                        isLast && styles.lastCell,
                      ]}
                    >
                      {!readOnly && showButtons ? (
                        <View style={styles.actionCell}>
                          <TouchableOpacity
                            style={[styles.button, styles.smallButton]}
                            onPress={() => rateFlight(item.id, 1)}
                          >
                            <Text style={styles.buttonText}>👍</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.button, styles.smallButton, styles.dangerButton]}
                            onPress={() => rateFlight(item.id, -1)}
                          >
                            <Text style={styles.buttonText}>👎</Text>
                          </TouchableOpacity>
                        </View>
                      ) : normalizeItineraryStatus(item.status, LEGACY_ITINERARY_STATUS) === 'Completed' ? (
                        <Text style={styles.cellText}>{formatNetVotes(item.netRating ?? 0)}</Text>
                      ) : (
                        <Text style={styles.cellText}>-</Text>
                      )}
                    </View>
                  );
                }
                const value = item[col.key as keyof Flight];
                const baseDisplay = value != null ? String(value) : '-';
                const display =
                  col.key === 'passenger_name'
                    ? (() => {
                        const ids = Array.isArray(item.passenger_ids) ? item.passenger_ids : [];
                        return formatTravelerListDisplay(ids, baseDisplay, groupMembers) || baseDisplay;
                      })()
                    : col.key === 'cost'
                      ? `$${value}`
                      : col.key === 'costPerPerson'
                        ? (() => {
                            const count = Array.isArray(item.passenger_ids) ? item.passenger_ids.length : 0;
                            const per = count ? (Number(item.cost) || 0) / count : Number(item.cost) || 0;
                            return `$${per.toFixed(2)}`;
                          })()
                        : col.key === 'booking_reference'
                          ? baseDisplay.toUpperCase()
                          : col.key === 'paidBy'
                            ? Array.isArray(item.paidBy) && item.paidBy.length ? item.paidBy.map(payerName).join(', ') : '-'
                            : col.key === 'departure_date'
                              ? formatDateLong(baseDisplay)
                              : col.key === 'departure_location'
                                ? formatLocationDisplay(item.departure_location, item.departure_airport_label || item.departureAirportLabel)
                                : col.key === 'arrival_location'
                                  ? formatLocationDisplay(item.arrival_location, item.arrival_airport_label || item.arrivalAirportLabel)
                                  : baseDisplay;
                return (
                  <View
                    key={`${item.id}-${col.key}`}
                    style={[
                      styles.cell,
                      { minWidth: col.minWidth ?? 120, flex: 1 },
                      isLast && styles.lastCell,
                    ]}
                  >
                    <Text style={styles.cellText}>{display as string}</Text>
                  </View>
                );
              })}
            </View>
          ))}
          {isAddingRow ? (
            <View style={[styles.tableRow, styles.inputRow]}>
              {columns.map((col, idx) => {
                const isLast = idx === columns.length - 1;
                if (col.key === 'actions') {
                  return (
                    <View
                      key={`input-${col.key}`}
                      style={[
                        styles.cell,
                        styles.actionCell,
                        { minWidth: col.minWidth ?? 120, flex: 1 },
                        isLast && styles.lastCell,
                      ]}
                    >
                      <Text style={styles.helperText}>Tap OK below to save</Text>
                    </View>
                  );
                }
                if (col.key === 'costPerPerson') {
                  const count = newFlight.passengerIds.length || 1;
                  const per = (Number(newFlight.cost) || 0) / count;
                  return (
                    <View
                      key={`input-${col.key}`}
                      style={[
                        styles.cell,
                        { minWidth: col.minWidth ?? 120, flex: 1 },
                        isLast && styles.lastCell,
                      ]}
                    >
                      <Text style={styles.cellText}>{`$${per.toFixed(2)}`}</Text>
                    </View>
                  );
                }
                if (col.key === 'votes' || col.key === 'rating') {
                  return (
                    <View
                      key={`input-${col.key}`}
                      style={[
                        styles.cell,
                        { minWidth: col.minWidth ?? 120, flex: 1 },
                        isLast && styles.lastCell,
                      ]}
                    >
                      <Text style={styles.cellText}>-</Text>
                    </View>
                  );
                }
                const valueMap: Record<string, string> = {
                  passenger_name: buildPassengerName(newFlight.passengerIds) || 'Select passengers',
                  status: normalizeItineraryStatus(newFlight.status, DEFAULT_NEW_ITINERARY_STATUS),
                  transfer_type: TRANSFER_TYPES.includes(newFlight.transferType) ? newFlight.transferType : 'Flight',
                  departure_date: newFlight.departureDate,
                  departure_location: newFlight.departureLocation,
                  departure_time: newFlight.departureTime,
                  arrival_location: newFlight.arrivalLocation,
                  arrival_date: newFlight.arrivalDate,
                  arrival_time: newFlight.arrivalTime,
                  layover_duration: newFlight.layoverDuration,
                  cost: newFlight.cost,
                  carrier: newFlight.carrier,
                  flight_number: newFlight.flightNumber,
                  booking_reference: newFlight.bookingReference,
                };

                const setters: Record<string, (text: string) => void> = {
                  status: (text) => setNewFlight((prev) => ({ ...prev, status: normalizeItineraryStatus(text, DEFAULT_NEW_ITINERARY_STATUS) })),
                  transfer_type: (text) =>
                    setNewFlight((prev) => ({
                      ...prev,
                      transferType: TRANSFER_TYPES.includes(text as TransferType) ? (text as TransferType) : 'Flight',
                    })),
                  departure_date: (text) =>
                    setNewFlight((prev) => {
                      const nextArrival = !prev.arrivalDate || prev.arrivalDate === prev.departureDate ? text : prev.arrivalDate;
                      return { ...prev, departureDate: text, arrivalDate: nextArrival };
                    }),
                  departure_location: (text) => setNewFlight((prev) => ({ ...prev, departureLocation: text })),
                  departure_time: (text) => setNewFlight((prev) => ({ ...prev, departureTime: text })),
                  arrival_location: (text) => setNewFlight((prev) => ({ ...prev, arrivalLocation: text })),
                  arrival_date: (text) => setNewFlight((prev) => ({ ...prev, arrivalDate: text })),
                  arrival_time: (text) => setNewFlight((prev) => ({ ...prev, arrivalTime: text })),
                  layover_duration: (text) => setNewFlight((prev) => ({ ...prev, layoverDuration: text })),
                  cost: (text) => setNewFlight((prev) => ({ ...prev, cost: sanitizeCostInput(text) })),
                  carrier: (text) => setNewFlight((prev) => ({ ...prev, carrier: text })),
                  flight_number: (text) => setNewFlight((prev) => ({ ...prev, flightNumber: text })),
                  booking_reference: (text) => setNewFlight((prev) => ({ ...prev, bookingReference: text.toUpperCase() })),
                };

                if (col.key === 'passenger_name') {
                  const displayName = valueMap.passenger_name || 'Select passengers';
                  return (
                    <View
                      key={`input-${col.key}`}
                      style={[
                        styles.cell,
                        { minWidth: col.minWidth ?? 120, flex: 1 },
                        isLast && styles.lastCell,
                      ]}
                    >
                      <TouchableOpacity
                        style={[styles.input, styles.inlineInput, styles.dropdown, styles.passengerDropdown]}
                        onPress={togglePassengerDropdown}
                        ref={passengerDropdownRef}
                      >
                        <Text style={styles.cellText}>{displayName}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                }

                if (col.key === 'status') {
                  return (
                    <View
                      key={`input-${col.key}`}
                      style={[
                        styles.cell,
                        { minWidth: col.minWidth ?? 120, flex: 1 },
                        isLast && styles.lastCell,
                      ]}
                    >
                      {Platform.OS === 'web' ? (
                        <select
                          value={valueMap.status}
                          onChange={(e) => setters.status(e.target.value)}
                          style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                        >
                          {['Needed', 'Proposed', 'Booked', 'Cancelled', 'Completed'].map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Text style={styles.cellText}>{valueMap.status}</Text>
                      )}
                    </View>
                  );
                }
                if (col.key === 'transfer_type') {
                  return (
                    <View
                      key={`input-${col.key}`}
                      style={[
                        styles.cell,
                        { minWidth: col.minWidth ?? 120, flex: 1 },
                        isLast && styles.lastCell,
                      ]}
                    >
                      {Platform.OS === 'web' ? (
                        <select
                          value={valueMap.transfer_type}
                          onChange={(e) => setters.transfer_type(e.target.value)}
                          style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                        >
                          {TRANSFER_TYPES.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Text style={styles.cellText}>{valueMap.transfer_type}</Text>
                      )}
                    </View>
                  );
                }

                if (col.key === 'departure_location' || col.key === 'arrival_location') {
                  const isDeparture = col.key === 'departure_location';
                  const rawValue = valueMap[col.key];
                  const label = rawValue || (isDeparture ? 'Departure location' : 'Arrival location');
                  const displayValue = getLocationInputValue(rawValue, isDeparture ? 'dep' : 'arr', locationTarget);
                  return (
                    <View
                      key={`input-${col.key}`}
                      style={[
                        styles.cell,
                        styles.locationField,
                        { minWidth: col.minWidth ?? 120, flex: 1, position: 'relative' },
                        isLast && styles.lastCell,
                      ]}
                    >
                      <TouchableOpacity
                        style={[styles.input, { justifyContent: 'center' }]}
                        onPress={() => openLocationOverlay(isDeparture ? 'dep' : 'arr', rawValue)}
                      >
                        <Text style={[styles.cellText, !displayValue ? { color: '#9ca3af' } : null]}>
                          {displayValue || (isDeparture ? 'Select departure airport' : 'Select arrival airport')}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                }

                if (col.key === 'departure_time' || col.key === 'arrival_time') {
                  const display = valueMap[col.key] || 'HH:MM';
                  const target = col.key === 'departure_time' ? 'new-dep' : 'new-arr';
                  if (Platform.OS === 'web') {
                    return (
                      <View
                        key={`input-${col.key}`}
                        style={[
                          styles.cell,
                          { minWidth: col.minWidth ?? 120, flex: 1 },
                          isLast && styles.lastCell,
                        ]}
                      >
                        <input
                          type="time"
                          value={valueMap[col.key]}
                          onChange={(e) => setters[col.key](e.target.value)}
                          style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                        />
                      </View>
                    );
                  }
                  return (
                    <View
                      key={`input-${col.key}`}
                      style={[
                        styles.cell,
                        { minWidth: col.minWidth ?? 120, flex: 1 },
                        isLast && styles.lastCell,
                      ]}
                    >
                      <TouchableOpacity
                        style={[styles.input, { justifyContent: 'center' }]}
                        onPress={() => openTimePicker(target, valueMap[col.key])}
                      >
                        <Text style={styles.cellText}>{display}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                }

                return (
                  <View
                    key={`input-${col.key}`}
                    style={[
                      styles.cell,
                      { minWidth: col.minWidth ?? 120, flex: 1 },
                      isLast && styles.lastCell,
                    ]}
                  >
                    <TextInput
                      placeholder={col.label}
                      style={styles.cellInput}
                      value={valueMap[col.key]}
                      keyboardType={col.key === 'cost' ? 'numeric' : 'default'}
                      onChangeText={setters[col.key]}
                    />
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      </HorizontalTableScroll>
      <View style={styles.totalRow}>
        <Text style={styles.flightTitle}>Total flight cost: ${flightsTotal.toFixed(2)}</Text>
      </View>
        </>
      ) : null}

      {showLocationOverlay ? (
        <View style={styles.dropdownOverlay}>
          <TouchableOpacity style={styles.dropdownBackdrop} onPress={closeLocationOverlay} />
          <View style={styles.dropdownPortal}>
            <TextInput
              style={[styles.input, styles.inlineInput]}
              placeholder="Search airports or cities"
              value={locationSearch}
              onChangeText={(text: string) => {
                setLocationSearch(text);
                if (locationFieldTarget) fetchLocationSuggestions(locationFieldTarget, text);
              }}
              onBlur={() => commitLocationOverlay()}
              onKeyPress={(e: any) => {
                if (e?.nativeEvent?.key === 'Enter' || e?.nativeEvent?.key === 'Tab') {
                  commitLocationOverlay();
                }
              }}
              autoFocus
            />
            <ScrollView style={styles.dropdownScroll}>
              {locationSuggestions.map((loc) => (
                <DropdownOptionButton
                  key={`overlay-${loc}`}
                  styles={styles}
                  onPressIn={() => {
                    locationSelectInProgressRef.current = true;
                  }}
                  onPress={() => {
                    const codeMatch = loc.match(/\(([A-Za-z]{3})\)/i);
                    const code = codeMatch ? codeMatch[1].toUpperCase() : loc;
                    if (locationFieldTarget === 'dep') {
                      setNewFlight((prev) => ({ ...prev, departureLocation: code, departureAirportCode: code }));
                    } else if (locationFieldTarget === 'arr') {
                      setNewFlight((prev) => ({ ...prev, arrivalLocation: code, arrivalAirportCode: code }));
                    }
                    closeLocationOverlay();
                  }}
                >
                  <Text style={styles.cellText}>{loc}</Text>
                </DropdownOptionButton>
              ))}
              {!locationSuggestions.length ? <Text style={styles.helperText}>Type to search airports</Text> : null}
            </ScrollView>
          </View>
        </View>
      ) : null}

      {showPassengerDropdown && passengerAnchor ? (
        <View style={styles.passengerOverlay}>
          <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={() => setShowPassengerDropdown(false)} />
          <View
            style={[
              styles.passengerOverlayList,
              {
                left: passengerAnchor.x,
                top: passengerAnchor.y + passengerAnchor.height,
                width: passengerAnchor.width,
              },
            ]}
          >
            {groupMembers.map((member) => {
              const name = formatMemberName(member);
              const selected = newFlight.passengerIds.includes(member.id);
              return (
                <DropdownOptionButton
                  key={member.id}
                  styles={styles}
                  onPress={() => {
                    const next = selected
                      ? newFlight.passengerIds.filter((id) => id !== member.id)
                      : [...newFlight.passengerIds, member.id];
                    setNewFlightPassengers(next);
                  }}
                >
                  <Text style={styles.cellText}>{`${selected ? '[x] ' : ''}${name}`}</Text>
                </DropdownOptionButton>
              );
            })}
          </View>
        </View>
      ) : null}
      {airportTarget && airportAnchor && !airportTarget.startsWith('modal-') ? (
        <View
          style={[
            styles.passengerOverlay,
            { backgroundColor: 'transparent', zIndex: 52000, elevation: 80 },
          ]}
        >
          <TouchableOpacity style={[styles.passengerOverlayBackdrop, { backgroundColor: 'transparent' }]} onPress={hideAirportDropdown} />
          <View
            style={[
              styles.passengerOverlayList,
              {
                zIndex: 53000,
                elevation: 84,
                left: airportAnchor.x,
                top: airportAnchor.y + airportAnchor.height,
                width: airportAnchor.width || 280,
              },
            ]}
          >
            {airportSuggestions.map((airport) => (
              <DropdownOptionButton
                key={`${airport.iata_code}-${airport.name}`}
                styles={styles}
                onPressIn={() => {
                  airportSelectInProgressRef.current = true;
                }}
                onPress={() => {
                  selectAirport(airportTarget, airport);
                  airportSelectInProgressRef.current = false;
                }}
              >
                <Text style={styles.cellText}>{formatAirportLabel(airport)}</Text>
              </DropdownOptionButton>
            ))}
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
              setEditingFlight((prev) => (prev ? { ...prev, departureTime: value } : prev));
            } else if (timePickerTarget === 'edit-arr') {
              setEditingFlight((prev) => (prev ? { ...prev, arrivalTime: value } : prev));
            } else if (timePickerTarget === 'new-dep') {
              setNewFlight((prev) => ({ ...prev, departureTime: value }));
            } else if (timePickerTarget === 'new-arr') {
              setNewFlight((prev) => ({ ...prev, arrivalTime: value }));
            }
            setTimePickerTarget(null);
          }}
        />
      ) : null}
      {!readOnly && showPasteModal ? (
        <Modal transparent visible={showPasteModal} animationType="fade" onRequestClose={() => setShowPasteModal(false)}>
          <View style={[styles.passengerOverlay, { backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'center', alignItems: 'center', padding: 16 }]}>
            <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={() => setShowPasteModal(false)} />
            <View style={[styles.modalCard, { width: '100%', maxWidth: 500, maxHeight: '90%' }]}>
              <Text style={styles.sectionTitle}>Paste Booking Info</Text>
              <Text style={styles.helperText}>Paste your flight confirmation email or text below, and our AI will extract the details.</Text>
              <TextInput
                style={[styles.input, { height: 150, textAlignVertical: 'top', marginTop: 12, marginBottom: 16 }]}
                multiline
                placeholder="Paste email text or itinerary here..."
                value={pasteText}
                onChangeText={setPasteText}
                editable={!isParsing}
              />
              <View style={styles.row}>
                <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={() => { setShowPasteModal(false); setPasteText(''); }} disabled={isParsing}>
                  <Text style={styles.buttonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, isParsing && { opacity: 0.5 }]} onPress={handlePasteAndParse} disabled={isParsing}>
                  <Text style={styles.buttonText}>{isParsing ? 'Parsing...' : 'Parse & Add'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
      <FlightEditingForm
        visible={!readOnly && Boolean(editingFlight && editingFlightId)}
        flightId={editingFlightId}
        flight={editingFlight}
        overlayStyle={modalOverlayStyle}
        cardStyle={modalCardStyle}
        airportAnchor={airportAnchorInWindow ? airportAnchor : null}
        airportTarget={airportAnchorInWindow ? airportTarget : null}
        airportSuggestions={airportAnchorInWindow ? airportSuggestions : []}
        formatAirportLabel={formatAirportLabel}
        onHideAirportDropdown={hideAirportDropdown}
        onSelectAirport={selectAirport}
        groupMembers={groupMembers}
        userMembers={userMembers}
        styles={styles}
        formatMemberName={formatMemberName}
        payerName={payerName}
        getLocationInputValue={getLocationInputValue}
        showAirportDropdown={showAirportDropdown}
        parseLayoverDuration={parseLayoverDuration}
        openTimePicker={openTimePicker}
        onAirportEnter={applyTopAirportSuggestion}
        setFlight={setEditingFlight}
        setPassengerIds={setEditingFlightPassengers}
        modalDepLocationRef={modalDepLocationRef}
        modalArrLocationRef={modalArrLocationRef}
        modalLayoverLocationRef={modalLayoverLocationRef}
        onClose={closeFlightDetails}
        onSave={saveFlightDetails}
      />
    </View>
  );
};

export const mergeFlightsFromApi = (list: Flight[]): Flight[] =>
  list.map((f) => normalizeFlightFromApi(f));

