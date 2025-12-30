/**
 * Main client app for Shared Trip Planner.
 *
 * This single-file implementation manages:
 * - Auth/session bootstrap and persistence
 * - Fetching and editing flights, lodgings, tours, traits, itineraries, groups, trips
 * - Cost sharing logic (per-user totals) and rendering the sectioned UI
 * - Web/mobile specific inputs (date/time pickers) and file parsing helpers
 *
 * State is grouped near the top; data fetchers and helpers are defined next;
 * then UI sections render conditionally based on the active page.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import { formatDateLong } from './utils/formatDateLong';
import { parseFlightText, type ParsedFlight } from './utils/flightParser';

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

interface Flight {
  id: string;
  passenger_name: string;
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
  sharedWith?: string[];
  passengerInGroup?: boolean;
  departure_airport_label?: string;
  arrival_airport_label?: string;
  layover_airport_label?: string;
  departureAirportLabel?: string;
  arrivalAirportLabel?: string;
  layoverAirportLabel?: string;
}

interface GroupInvite {
  id: string;
  groupId: string;
  groupName: string;
  inviterEmail: string;
  createdAt: string;
}

interface GroupMemberView {
  id: string;
  userId?: string;
  userEmail?: string;
  guestName?: string;
}

interface GroupView {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  members: GroupMemberView[];
  invites: { id: string; inviteeEmail: string; status: string }[];
}

interface Trip {
  id: string;
  groupId: string;
  groupName: string;
  name: string;
  createdAt: string;
}

interface GroupMemberOption {
  id: string;
  guestName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

interface Trait {
  id: string;
  name: string;
  level: number;
  notes?: string | null;
  createdAt: string;
}

interface ItineraryRecord {
  id: string;
  tripId: string;
  tripName: string;
  destination: string;
  days: number;
  budget?: number | null;
  createdAt: string;
}

interface ItineraryDetailRecord {
  id: string;
  itineraryId: string;
  day: number;
  time?: string | null;
  activity: string;
  cost?: number | null;
}

type Page = 'menu' | 'flights' | 'lodging' | 'tours' | 'groups' | 'trips' | 'traits' | 'itinerary' | 'cost' | 'account';

type FlightDraft = {
  passengerName: string;
  departureDate: string;
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

type FlightEditDraft = {
  passengerName: string;
  departureDate: string;
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

type Lodging = {
  id: string;
  tripId?: string;
  name: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: string;
  refundBy: string;
  totalCost: string;
  costPerNight: string;
  address: string;
  paidBy?: string[];
};

type LodgingDraft = {
  name: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: string;
  refundBy: string;
  totalCost: string;
  costPerNight: string;
  address: string;
  paidBy: string[];
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
  paidBy: string[];
};

type TourDraft = {
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
};

// Build a blank flight draft with sensible defaults (current date, empty strings).
const createInitialFlightState = (): FlightDraft => ({
  passengerName: '',
  departureDate: new Date().toISOString().slice(0, 10),
  departureLocation: '',
  departureAirportCode: '',
  departureTime: '',
  arrivalLocation: '',
  arrivalAirportCode: '',
  layoverLocation: '',
  layoverLocationCode: '',
  layoverDuration: '',
  arrivalTime: '',
  cost: '',
  carrier: '',
  flightNumber: '',
  bookingReference: '',
  paidBy: [],
});

// Build a blank lodging draft with today's dates and default room count.
const createInitialLodgingState = (): LodgingDraft => ({
  name: '',
  checkInDate: new Date().toISOString().slice(0, 10),
  checkOutDate: new Date().toISOString().slice(0, 10),
  rooms: '1',
  refundBy: '',
  totalCost: '',
  costPerNight: '',
  address: '',
  paidBy: [],
});

// Build a blank tour draft with today's date and zero cost.
const createInitialTourState = (): TourDraft => ({
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
});


interface Airport {
  name: string;
  city?: string;
  country?: string;
  iata_code?: string;
}

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

const backendUrl = Constants.expoConfig?.extra?.backendUrl ?? 'http://localhost:4000';
const sessionKey = 'stp.session';
const sessionDurationMs = 12 * 60 * 60 * 1000;

const loadSession = (): { token: string; name: string; email?: string; page?: string } | null => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(sessionKey);
    if (!raw) return null;
    const data = JSON.parse(raw) as { token: string; name: string; email?: string; expiresAt: number; page?: string };
    if (!data?.token || !data?.name || !data?.expiresAt) return null;
    if (Date.now() > data.expiresAt) {
      window.localStorage.removeItem(sessionKey);
      return null;
    }
    return { token: data.token, name: data.name, email: data.email, page: data.page };
  } catch {
    return null;
  }
};

const saveSession = (token: string, name: string, page?: string, email?: string | null) => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const payload = {
    token,
    name,
    email: email ?? undefined,
    page,
    expiresAt: Date.now() + sessionDurationMs,
  };
  window.localStorage.setItem(sessionKey, JSON.stringify(payload));
};

const clearSession = () => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.localStorage.removeItem(sessionKey);
};

const App: React.FC = () => {
  const [userToken, setUserToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [userName, setUserName] = useState<string | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [newFlight, setNewFlight] = useState<FlightDraft>(createInitialFlightState());
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupUserEmails, setGroupUserEmails] = useState('');
  const [groupGuestNames, setGroupGuestNames] = useState('');
  const [groupAddEmail, setGroupAddEmail] = useState<Record<string, string>>({});
  const [groupAddGuest, setGroupAddGuest] = useState<Record<string, string>>({});
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [groupSort, setGroupSort] = useState<'created' | 'name'>('created');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [newTripName, setNewTripName] = useState('');
  const [newTripGroupId, setNewTripGroupId] = useState<string | null>(null);
  const [showTripGroupDropdown, setShowTripGroupDropdown] = useState(false);
  const [tripDropdownOpenId, setTripDropdownOpenId] = useState<string | null>(null);
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showActiveTripDropdown, setShowActiveTripDropdown] = useState(false);
  const [groupMembers, setGroupMembers] = useState<GroupMemberOption[]>([]);
  const [showPassengerDropdown, setShowPassengerDropdown] = useState(false);
  const [passengerAnchor, setPassengerAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [editingFlightId, setEditingFlightId] = useState<string | null>(null);
  const [editingFlight, setEditingFlight] = useState<FlightEditDraft | null>(null);
  const [lodgings, setLodgings] = useState<Lodging[]>([]);
  const [lodgingDraft, setLodgingDraft] = useState<LodgingDraft>(createInitialLodgingState());
  const [editingLodgingId, setEditingLodgingId] = useState<string | null>(null);
  const [editingLodging, setEditingLodging] = useState<LodgingDraft | null>(null);
  const [lodgingDateField, setLodgingDateField] = useState<'checkIn' | 'checkOut' | 'refund' | null>(null);
  const [lodgingDateValue, setLodgingDateValue] = useState<Date>(new Date());

  const [tours, setTours] = useState<Tour[]>([]);
  const [editingTour, setEditingTour] = useState<TourDraft | null>(null);
  const [editingTourId, setEditingTourId] = useState<string | null>(null);
  const [tourDateField, setTourDateField] = useState<'date' | 'bookedOn' | 'freeCancel' | 'startTime' | null>(null);
  const [tourDateValue, setTourDateValue] = useState<Date>(new Date());
  const [airports, setAirports] = useState<Airport[]>([]);
  const [airportSuggestions, setAirportSuggestions] = useState<Airport[]>([]);
  const [airportAnchor, setAirportAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [airportTarget, setAirportTarget] = useState<'dep' | 'arr' | 'modal-dep' | 'modal-arr' | null>(null);
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([]);
  const [locationTarget, setLocationTarget] = useState<'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover' | null>(null);
  const [traits, setTraits] = useState<Trait[]>([]);
  const [traitDrafts, setTraitDrafts] = useState<Record<string, { level: string; notes: string }>>({});
  const [newTraitName, setNewTraitName] = useState('');
  const [newTraitLevel, setNewTraitLevel] = useState('3');
  const [newTraitNotes, setNewTraitNotes] = useState('');
  const [selectedTraitNames, setSelectedTraitNames] = useState<Set<string>>(new Set());
  const [activePage, setActivePage] = useState<Page>('menu');
  const [itineraryCountry, setItineraryCountry] = useState('');
  const [itineraryDays, setItineraryDays] = useState('5');
  const [budgetMin, setBudgetMin] = useState(500);
  const [budgetMax, setBudgetMax] = useState(2500);
  const [itineraryAirport, setItineraryAirport] = useState('');
  const [itineraryAirportOptions, setItineraryAirportOptions] = useState<string[]>([]);
  const [showItineraryAirportDropdown, setShowItineraryAirportDropdown] = useState(false);
  const [itineraryPlan, setItineraryPlan] = useState('');
  const [itineraryTripStyle, setItineraryTripStyle] = useState('');
  const [itineraryLoading, setItineraryLoading] = useState(false);
  const [itineraryError, setItineraryError] = useState('');
  const [itineraryRecords, setItineraryRecords] = useState<ItineraryRecord[]>([]);
  const [itineraryDetails, setItineraryDetails] = useState<Record<string, ItineraryDetailRecord[]>>({});
  const [selectedItineraryId, setSelectedItineraryId] = useState<string | null>(null);
  const [editingItineraryId, setEditingItineraryId] = useState<string | null>(null);
  const [editingDetailId, setEditingDetailId] = useState<string | null>(null);
  const [detailDraft, setDetailDraft] = useState({ day: '1', time: '', activity: '', cost: '' });
  const [traitAge, setTraitAge] = useState('');
  const [traitGender, setTraitGender] = useState<'female' | 'male' | 'nonbinary' | 'prefer-not'>('prefer-not');
  const [showGenderDropdown, setShowGenderDropdown] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });
  const [accountProfile, setAccountProfile] = useState({ firstName: '', lastName: '', email: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [isAddingRow, setIsAddingRow] = useState(false);
  const passengerDropdownRef = useRef<TouchableOpacity | null>(null);
  const depLocationRef = useRef<TextInput | null>(null);
  const arrLocationRef = useRef<TextInput | null>(null);
  const modalDepLocationRef = useRef<TextInput | null>(null);
  const modalArrLocationRef = useRef<TextInput | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isParsingPdf, setIsParsingPdf] = useState(false);
  const [pdfParseMessage, setPdfParseMessage] = useState<string | null>(null);
  const [parsedFlights, setParsedFlights] = useState<FlightEditDraft[]>([]);
  const [isSavingParsedFlights, setIsSavingParsedFlights] = useState(false);
  const normalizePassengerName = (name: string): string => {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    const parts = trimmed.toLowerCase().split(' ').filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]} ${parts[parts.length - 1]}`;
    }
    return trimmed.toLowerCase();
  };

  const formatMemberName = (member: GroupMemberOption): string => {
    if (member.guestName) return member.guestName;
    const first = member.firstName?.trim();
    const last = member.lastName?.trim();
    if (first || last) return `${first ?? ''} ${last ?? ''}`.trim();
    if (member.email) {
      const local = member.email.split('@')[0] ?? '';
      const parts = local.split(/[._-]+/).filter(Boolean);
      if (parts.length >= 2) return `${parts[0]} ${parts.slice(1).join(' ')}`.trim();
      return member.email;
    }
    return 'Member';
  };

// Normalize a date-ish string to YYYY-MM-DD if possible.
const normalizeDateString = (value: string): string => {
  if (!value) return value;
  if (value.includes('-') && value.length === 10) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10);
};

// Normalize and backfill flight fields before sending to the backend.
const buildFlightPayload = (flight: FlightEditDraft, tripId?: string, defaultPayerId?: string) => {
  const trim = (v: string | null | undefined) => (v ?? '').trim();
  const departureDate = normalizeDateString(trim(flight.departureDate)) || new Date().toISOString().slice(0, 10);
  const departureLocation = trim(flight.departureLocation) || trim(flight.departureAirportCode);
  const arrivalLocation = trim(flight.arrivalLocation) || trim(flight.arrivalAirportCode);
  const layoverLocation = trim(flight.layoverLocation);
  const layoverLocationCode = trim(flight.layoverLocationCode);
  return {
    passengerName: trim(flight.passengerName) || 'Traveler',
    departureDate,
    departureLocation,
    departureAirportCode: trim(flight.departureAirportCode) || departureLocation,
    departureTime: trim(flight.departureTime) || '00:00',
    arrivalLocation,
    arrivalAirportCode: trim(flight.arrivalAirportCode) || arrivalLocation,
    layoverLocation,
    layoverLocationCode,
    layoverDuration: trim(flight.layoverDuration),
    arrivalTime: trim(flight.arrivalTime) || '00:00',
    cost: Number(flight.cost) || 0,
    carrier: trim(flight.carrier) || 'UNKNOWN',
    flightNumber: trim(flight.flightNumber) || 'UNKNOWN',
    bookingReference: trim(flight.bookingReference) || 'UNKNOWN',
    paidBy: flight.paidBy?.length ? flight.paidBy : defaultPayerId ? [defaultPayerId] : [],
    ...(tripId ? { tripId } : {}),
  };
};

// Calculate whole-night stay length; returns 0 if invalid or checkout <= checkin.
const calculateNights = (checkIn: string, checkOut: string): number => {
    const start = new Date(checkIn).getTime();
    const end = new Date(checkOut).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
    return Math.round((end - start) / (1000 * 60 * 60 * 24));
  };

  const flightsTotal = useMemo(
    () => flights.reduce((sum, f) => sum + (Number(f.cost) || 0), 0),
    [flights]
  );

  const lodgingTotal = useMemo(
    () => lodgings.reduce((sum, l) => sum + (Number(l.totalCost) || 0), 0),
    [lodgings]
  );

  const toursTotal = useMemo(() => tours.reduce((sum, t) => sum + (Number(t.cost) || 0), 0), [tours]);

  const overallCost = useMemo(() => flightsTotal + lodgingTotal + toursTotal, [flightsTotal, lodgingTotal, toursTotal]);

  const findExistingItinerary = (
    tripId: string,
    destination: string,
    days: number,
    excludeId?: string | null,
    budget?: number | null
  ) => {
    const dest = destination.trim().toLowerCase();
    const normalizedBudget = budget != null ? Number(budget) : null;
    return itineraryRecords.find(
      (i) =>
        i.id !== excludeId &&
        i.tripId === tripId &&
        i.destination.trim().toLowerCase() === dest &&
        i.days === days &&
        (i.budget ?? null) === (normalizedBudget ?? null)
    );
  };

  const beginEditItinerary = (it: ItineraryRecord) => {
    setEditingItineraryId(it.id);
    setSelectedItineraryId(it.id);
    setActiveTripId(it.tripId);
    setItineraryCountry(it.destination);
    setItineraryDays(String(it.days));
    if (it.budget != null) setBudgetMax(Number(it.budget));
    fetchItineraryDetails(it.id);
  };

  const openMaps = (address: string) => {
    if (!address) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  // Resolve a member id to a human-friendly name for payer chips.
  const payerName = (id: string): string => {
    const member = groupMembers.find((m) => m.id === id);
    return member ? formatMemberName(member) : 'Unknown';
  };

  const userMembers = useMemo(() => groupMembers.filter((m) => !m.guestName), [groupMembers]);

  /**
   * Shared payer accumulator:
   * - Zeros out every user's total each run so removals clear prior shares
   * - Splits cost evenly across payers (or falls back to provided defaults)
   * - Applies any rounding remainder to the first payer to keep sums aligned
   */
  const computePayerTotals = <T,>(
    items: T[],
    getCost: (item: T) => number,
    getPayers: (item: T) => string[] | undefined,
    fallbackPayers: string[],
    options?: { fallbackOnEmpty?: boolean }
  ): Record<string, number> => {
    // Start with every user's total at 0 so removed payers don't retain old shares.
    const totals: Record<string, number> = {};
    fallbackPayers.forEach((id) => {
      totals[id] = 0;
    });

    // For each item, figure out who pays and how to split.
    items.forEach((item) => {
      const cost = getCost(item);
      const payersRaw = getPayers(item);
      const payers = (payersRaw ?? []).filter(Boolean);

      // If the item explicitly has an empty payer list, we do NOT fall back to everyone.
      // Only when payers are truly missing/undefined (legacy data) do we fall back.
      const shouldFallback = options?.fallbackOnEmpty ? payers.length === 0 : payersRaw == null;
      const effective = payers.length ? payers : shouldFallback ? fallbackPayers : [];
      if (!cost || !effective.length) return;

      // Split evenly across effective payers.
      const share = cost / effective.length;
      effective.forEach((id) => {
        totals[id] = (totals[id] ?? 0) + share;
      });

      // Push any rounding residue onto the first payer to keep sums aligned with the item cost.
      const remainder = cost - share * effective.length;
      if (Math.abs(remainder) > 1e-6 && effective[0]) {
        totals[effective[0]] = (totals[effective[0]] ?? 0) + remainder;
      }
    });
    return totals;
  };

  // Per-user tour totals via shared helper. Note: if a tour has an explicit empty payer list,
  // we leave it unsplit (no cost assigned) so non-payers stay at $0.
  const payerTotals = useMemo(
    () =>
      computePayerTotals(
        tours,
        (t) => Number(t.cost) || 0,
        (t) => (Array.isArray(t.paidBy) ? t.paidBy : []),
        userMembers.map((m) => m.id),
        { fallbackOnEmpty: false }
      ),
    [tours, userMembers]
  );

  const currentUserMemberId = useMemo(() => {
    if (!userEmail) return null;
    const match = userMembers.find((m) => m.email && m.email.toLowerCase() === userEmail.toLowerCase());
    return match?.id ?? null;
  }, [userMembers, userEmail]);

  const defaultPayerId = useMemo(() => {
    if (currentUserMemberId) return currentUserMemberId;
    if (userMembers.length) return userMembers[0].id;
    return null;
  }, [currentUserMemberId, userMembers]);

  // Per-user flight totals via shared helper. Explicitly empty paidBy means no split, so removed users go to $0.
  const flightsPayerTotals = useMemo(
    () =>
      computePayerTotals(
        flights,
        (f) => Number((f as any).cost) || 0,
        (f) => {
          const paidBy = (f as any).paidBy ?? (f as any).paid_by;
          return Array.isArray(paidBy) ? paidBy : [];
        },
        userMembers.map((m) => m.id),
        { fallbackOnEmpty: false }
      ),
    [flights, userMembers]
  );

  // Per-user lodging totals via shared helper. Explicitly empty paidBy means no split, so removed users go to $0.
  const lodgingPayerTotals = useMemo(
    () =>
      computePayerTotals(
        lodgings,
        (l) => Number(l.totalCost) || 0,
        (l) => (Array.isArray(l.paidBy) ? l.paidBy : []),
        userMembers.map((m) => m.id),
        { fallbackOnEmpty: false }
      ),
    [lodgings, userMembers]
  );

  useEffect(() => {
    if (defaultPayerId && (!lodgingDraft.paidBy || lodgingDraft.paidBy.length === 0)) {
      setLodgingDraft((p) => ({ ...p, paidBy: [defaultPayerId] }));
    }
    if (defaultPayerId && (!editingFlight || editingFlight.paidBy?.length)) {
      // no-op
    } else if (defaultPayerId && editingFlight && editingFlight.paidBy.length === 0) {
      setEditingFlight((p) => (p ? { ...p, paidBy: [defaultPayerId] } : p));
    }
  }, [defaultPayerId]);

  // Set which tour date/time picker to edit and seed the current value.
  const openTourDatePicker = (field: 'date' | 'bookedOn' | 'freeCancel' | 'startTime') => {
    setTourDateField(field);
    const current = editingTour
      ? field === 'date'
        ? editingTour.date
        : field === 'bookedOn'
          ? editingTour.bookedOn
          : field === 'freeCancel'
            ? editingTour.freeCancelBy
            : editingTour.startTime
      : null;
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

  useEffect(() => {
    const nights = calculateNights(lodgingDraft.checkInDate, lodgingDraft.checkOutDate);
    const totalNum = Number(lodgingDraft.totalCost) || 0;
    const computed = nights > 0 && totalNum ? (totalNum / nights).toFixed(2) : '';
    setLodgingDraft((prev) => ({ ...prev, costPerNight: computed }));
  }, [lodgingDraft.checkInDate, lodgingDraft.checkOutDate, lodgingDraft.totalCost]);

  useEffect(() => {
    if (!editingLodging) return;
    const nights = calculateNights(editingLodging.checkInDate, editingLodging.checkOutDate);
    const totalNum = Number(editingLodging.totalCost) || 0;
    const computed = nights > 0 && totalNum ? (totalNum / nights).toFixed(2) : '';
    if (computed !== editingLodging.costPerNight) {
      setEditingLodging((prev) => (prev ? { ...prev, costPerNight: computed } : prev));
    }
  }, [editingLodging?.checkInDate, editingLodging?.checkOutDate, editingLodging?.totalCost]);

  // Filter the local airport list for quick suggestions.
  const filterAirports = (query: string): Airport[] => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    return airports
      .filter((a) => a.iata_code && a.iata_code.length === 3)
      .filter((a) => {
        const target = `${a.name ?? ''} ${a.city ?? ''} ${a.iata_code ?? ''}`.toLowerCase();
        return target.includes(q);
      })
      .slice(0, 8);
  };

  // Pretty-print an airport with city + IATA code when present.
  const formatAirportLabel = (a: Airport): string => {
    const city = a.city || a.name;
    const code = a.iata_code ? ` (${a.iata_code})` : '';
    return `${city}${code}`;
  };

  // Extract "Hh Mm" parts from a stored layover duration string.
  const parseLayoverDuration = (value: string | null | undefined): { hours: string; minutes: string } => {
    const safe = value ?? '';
    const hoursMatch = safe.match(/(\d+)\s*h/i);
    const minutesMatch = safe.match(/(\d+)\s*m/i);
    const hours = hoursMatch ? hoursMatch[1] : '';
    const minutes = minutesMatch ? minutesMatch[1] : '';
    return { hours, minutes };
  };

  // Prefer a friendly label; otherwise show the uppercased location code.
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
    // While the user is actively typing in this input, show the raw text.
    if (currentTarget === activeTarget) {
      return rawValue;
    }
    return formatLocationDisplay(rawValue);
  };

  // Parsing handled in utils/flightParser.parseFlightText.

  // Merge parsed flight data into the current draft without overwriting existing fields.
  const mergeParsedFlight = (current: FlightEditDraft, parsed: Partial<FlightEditDraft>): FlightEditDraft => {
    const next = { ...current };
    (Object.entries(parsed) as [keyof FlightEditDraft, string][]).forEach(([key, value]) => {
      if (value && (!current[key] || current[key].trim().length === 0)) {
        next[key] = value;
      }
    });
    return next;
  };

  // Read PDF text via pdfjs.
  const extractTextFromPdf = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjs = await import('pdfjs-dist/build/pdf');
    (pdfjs as any).GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${(pdfjs as any).version}/pdf.worker.min.js`;
    const loadingTask = (pdfjs as any).getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let combined = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      combined += content.items.map((item: any) => item.str).join(' ') + '\n';
    }
    return combined;
  };

  // OCR image to text via tesseract.
  const extractTextFromImage = async (file: File): Promise<string> => {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    const url = URL.createObjectURL(file);
    try {
      const { data } = await worker.recognize(url);
      return data.text ?? '';
    } finally {
      URL.revokeObjectURL(url);
      await worker.terminate();
    }
  };

  // Parse an uploaded flight confirmation (PDF/image) and queue parsed flights.
  const handleFlightFile = async (file: File) => {
    if (Platform.OS !== 'web') {
      alert('File upload is available on web right now.');
      return;
    }
    if (!activeTripId) {
      alert('Select an active trip before uploading a flight.');
      return;
    }
    setIsParsingPdf(true);
    setPdfParseMessage(null);
    try {
      const type = file.type || '';
      const isPdf = type.includes('pdf') || file.name.toLowerCase().endsWith('.pdf');
      const text = isPdf ? await extractTextFromPdf(file) : await extractTextFromImage(file);
      const { primary, bulk } = parseFlightText(text);
      const flightsToSave = (bulk.length ? bulk : [primary]).map((flight) =>
        mergeParsedFlight(createInitialFlightState(), flight as Partial<FlightEditDraft>)
      );
      setParsedFlights(flightsToSave);
      await saveParsedFlights(flightsToSave);
    } catch (err) {
      console.error('File parse failed', err);
      alert('Could not read that file. Please upload a legible flight confirmation PDF or image.');
    } finally {
      setIsParsingPdf(false);
    }
  };

  // Create or update a lodging; computes cost-per-night and applies default payer.
  const saveLodging = async (draft: LodgingDraft, lodgingId?: string | null) => {
    if (!draft.name.trim() || !activeTripId) {
      alert('Please enter a lodging name and select an active trip.');
      return;
    }
    const nights = calculateNights(draft.checkInDate, draft.checkOutDate);
    if (nights <= 0) {
      alert('Check-out must be after check-in.');
      return;
    }
    const totalNum = Number(draft.totalCost) || 0;
    const rooms = Number(draft.rooms) || 1;
    const costPerNight = totalNum && rooms > 0 ? (totalNum / (nights * rooms)).toFixed(2) : '0';
    const paidBy = draft.paidBy.length ? draft.paidBy : defaultPayerId ? [defaultPayerId] : [];
    const payload = {
      ...draft,
      tripId: activeTripId,
      rooms,
      costPerNight,
      paidBy,
    };
    const url = lodgingId ? `${backendUrl}/api/lodgings/${lodgingId}` : `${backendUrl}/api/lodgings`;
    const method = lodgingId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to save lodging');
      return;
    }
    if (lodgingId) {
      setEditingLodgingId(null);
      setEditingLodging(null);
    } else {
      setLodgingDraft(createInitialLodgingState());
    }
    fetchLodgings();
  };

  const removeLodging = async (id: string) => {
    const res = await fetch(`${backendUrl}/api/lodgings/${id}`, { method: 'DELETE', headers: jsonHeaders });
    if (!res.ok) {
      alert('Unable to delete lodging');
      return;
    }
    fetchLodgings();
  };

  // Populate the lodging edit modal with the selected row.
  const openLodgingEditor = (lodging: Lodging) => {
    setEditingLodgingId(lodging.id);
    const base: LodgingDraft = {
      name: lodging.name,
      checkInDate: normalizeDateString(lodging.checkInDate),
      checkOutDate: normalizeDateString(lodging.checkOutDate),
      rooms: lodging.rooms || '1',
      refundBy: lodging.refundBy ? normalizeDateString(lodging.refundBy) : '',
      totalCost: lodging.totalCost || '',
      costPerNight: lodging.costPerNight || '',
      address: lodging.address || '',
      paidBy: Array.isArray(lodging.paidBy) && lodging.paidBy.length ? lodging.paidBy : defaultPayerId ? [defaultPayerId] : [],
    };
    setEditingLodging(base);
  };

  // Close the lodging edit modal.
  const closeLodgingEditor = () => {
    setEditingLodgingId(null);
    setEditingLodging(null);
  };

  const openTourEditor = (tour?: Tour) => {
    if (!activeTripId) {
      alert('Select an active trip before adding a tour.');
      return;
    }
    const base = tour ? { ...tour } : createInitialTourState();
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

  const saveTour = () => {
    if (!editingTour) return;
    if (!editingTour.name.trim()) {
      alert('Please enter a tour name.');
      return;
    }
    const cleanCost = (editingTour.cost || '').replace(/[^0-9.]/g, '');
    let payload: TourDraft = { ...editingTour, cost: cleanCost };
    if ((!payload.paidBy || payload.paidBy.length === 0) && defaultPayerId) {
      payload = { ...payload, paidBy: [defaultPayerId] };
    }
    if (!activeTripId) {
      alert('Select an active trip before saving a tour.');
      return;
    }
    const method = editingTourId ? 'PUT' : 'POST';
    const url = editingTourId ? `${backendUrl}/api/tours/${editingTourId}` : `${backendUrl}/api/tours`;
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
          throw new Error(data.error || `Unable to save tour (status ${res.status})`);
        }
        await fetchTours();
        closeTourEditor();
      } catch (err: any) {
        console.error('saveTour failed', err);
        alert(err.message || 'Unable to save tour');
      }
    })();
  };

  const removeTour = (id: string) => {
    fetch(`${backendUrl}/api/tours/${id}`, { method: 'DELETE', headers: jsonHeaders })
      .then((res) => {
        if (!res.ok) throw new Error('Unable to delete tour');
        fetchTours();
      })
      .catch((err) => alert(err.message));
  };

  const loadAirports = async () => {
    try {
      const res = await fetch('https://raw.githubusercontent.com/algolia/datasets/master/airports/airports.json');
      const data = await res.json();
      setAirports(
        (data as any[])
          .filter((a) => a.iata_code && a.iata_code.length === 3)
          .map((a) => ({
            name: a.name,
            city: a.city,
            country: a.country,
            iata_code: a.iata_code,
          }))
      );
    } catch {
      setAirports(fallbackAirports);
    }
  };

  useEffect(() => {
    loadAirports();
  }, []);

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

  const showAirportDropdown = (
    target: 'dep' | 'arr' | 'modal-dep' | 'modal-arr',
    node: any,
    query: string
  ) => {
    setAirportTarget(target);
    setAirportSuggestions(filterAirports(query));
    if (target.startsWith('modal')) {
      // inline dropdown inside modal; no global anchor
      setAirportAnchor(null);
      return;
    }
    // sensible default in case measurement fails
    let fallbackAnchor = { x: 16, y: 120, width: 260, height: 40 };
    if (node?.measureInWindow) {
      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        setAirportAnchor({ x, y, width, height });
      });
    } else if (typeof node?.getBoundingClientRect === 'function') {
      const rect = node.getBoundingClientRect();
      fallbackAnchor = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    }
    setAirportAnchor((prev) => prev ?? fallbackAnchor);
  };

  const hideAirportDropdown = () => {
    setAirportTarget(null);
    setAirportAnchor(null);
    setAirportSuggestions([]);
  };

  const selectAirport = (target: 'dep' | 'arr' | 'modal-dep' | 'modal-arr', airport: Airport) => {
    const code = airport.iata_code ?? '';
    if ((target === 'dep' || target === 'modal-dep') && editingFlight) {
      setEditingFlight((prev) => (prev ? { ...prev, departureLocation: code, departureAirportCode: code } : prev));
    } else if ((target === 'arr' || target === 'modal-arr') && editingFlight) {
      setEditingFlight((prev) => (prev ? { ...prev, arrivalLocation: code, arrivalAirportCode: code } : prev));
    }
    hideAirportDropdown();
  };

  const fetchLocationSuggestions = async (
    target: 'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover',
    text: string
  ) => {
    setLocationTarget(target);
    if (!userToken) {
      setLocationSuggestions([]);
      return;
    }
    const q = text.trim();
    if (!q) {
      setLocationSuggestions([]);
      return;
    }
    // Debug: note when we invoke the location search endpoint from a location input
    console.log('[locations] fetching suggestions', { target, q });
    try {
      const res = await fetch(`${backendUrl}/api/flights/locations?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      if (!res.ok) {
        setLocationSuggestions([]);
        return;
      }
      const data = (await res.json()) as string[];
      if (data.length) {
        setLocationSuggestions(data);
      } else {
        // fallback to airport list if no history matches
        setLocationSuggestions(
          filterAirports(q).map(
            (a) => formatAirportLabel(a)
          )
        );
      }
    } catch {
      setLocationSuggestions([]);
    }
  };

  const openFlightDetails = (flight: Flight) => {
    setEditingFlightId(flight.id);
    const base: FlightEditDraft = {
      passengerName: flight.passenger_name,
      departureDate: normalizeDateString(flight.departure_date),
      departureLocation: flight.departure_location ?? '',
      departureAirportCode: flight.departure_airport_code ?? '',
      departureTime: flight.departure_time,
      arrivalLocation: flight.arrival_location ?? '',
      arrivalAirportCode: flight.arrival_airport_code ?? '',
      layoverLocation: flight.layover_location ?? '',
      layoverLocationCode: flight.layover_location_code ?? '',
      layoverDuration: flight.layover_duration ?? '',
      arrivalTime: flight.arrival_time,
      cost: String(flight.cost ?? ''),
      carrier: flight.carrier,
      flightNumber: flight.flight_number,
      bookingReference: flight.booking_reference,
      paidBy: Array.isArray(flight.paidBy) ? flight.paidBy : Array.isArray(flight.paid_by) ? flight.paid_by : [],
    };
    if (base.paidBy.length === 0 && defaultPayerId) {
      base.paidBy = [defaultPayerId];
    }
    setEditingFlight(base);
  };

  const closeFlightDetails = () => {
    setEditingFlightId(null);
    setEditingFlight(null);
  };

  const saveFlightDetails = async () => {
    if (!userToken || !editingFlightId || !editingFlight) return;
    if (editingFlightId === 'new' && !activeTripId) {
      alert('Select an active trip before adding a flight.');
      return;
    }
    const payload = buildFlightPayload(editingFlight, editingFlightId === 'new' ? activeTripId ?? undefined : undefined, defaultPayerId);
    let res: Response;
    if (editingFlightId === 'new') {
      res = await fetch(`${backendUrl}/api/flights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          ...payload,
        }),
      });
    } else {
      res = await fetch(`${backendUrl}/api/flights/${editingFlightId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to update flight');
      return;
    }
    closeFlightDetails();
    fetchFlights();
  };

  const headers = useMemo<Record<string, string>>(
    () => (userToken ? { Authorization: `Bearer ${userToken}` } : ({} as Record<string, string>)),
    [userToken]
  );
  const jsonHeaders = useMemo<Record<string, string>>(
    () => ({ 'Content-Type': 'application/json', ...(userToken ? { Authorization: `Bearer ${userToken}` } : {}) }),
    [userToken]
  );
  const logout = () => {
    setUserToken(null);
    setUserName(null);
    setUserEmail(null);
    setFlights([]);
    setTours([]);
    setInvites([]);
    setGroups([]);
    setTraits([]);
    setSelectedTraitNames(new Set());
    setTraitAge('');
    setTraitGender('prefer-not');
    setItineraryCountry('');
    setItineraryDays('5');
    setBudgetMin(500);
    setBudgetMax(2500);
    setItineraryAirport('');
    setItineraryAirportOptions([]);
    setShowItineraryAirportDropdown(false);
    setItineraryPlan('');
    setItineraryError('');
    setItineraryLoading(false);
    setAccountProfile({ firstName: '', lastName: '', email: '' });
    setPasswordForm({ currentPassword: '', newPassword: '' });
    setAccountMessage(null);
    setShowDeleteConfirm(false);
    setActivePage('menu');
    clearSession();
  };

  const loginWithPassword = async () => {
    try {
      const res = await fetch(`${backendUrl}/api/web-auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authForm.email.trim(), password: authForm.password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Login failed');
        return;
      }
      const name = `${data.user.firstName} ${data.user.lastName}`;
      const email = authForm.email.trim();
      setUserToken(data.token);
      setUserName(name);
      setUserEmail(email);
      setAccountProfile({
        firstName: data.user.firstName ?? '',
        lastName: data.user.lastName ?? '',
        email,
      });
      saveSession(data.token, name, 'menu', email);
      fetchFlights(data.token);
      fetchLodgings(data.token);
      fetchTours(data.token);
      fetchInvites(data.token);
      fetchAccountProfile(data.token);
      setActivePage('menu');
    } catch (err) {
      alert((err as Error).message || 'Login failed');
    }
  };

  const register = async () => {
    try {
      const res = await fetch(`${backendUrl}/api/web-auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: authForm.firstName.trim(),
          lastName: authForm.lastName.trim(),
          email: authForm.email.trim(),
        password: authForm.password,
      }),
    });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Registration failed');
        return;
      }
      const name = `${data.user.firstName} ${data.user.lastName}`;
      const email = authForm.email.trim();
      setUserToken(data.token);
      setUserName(name);
      setUserEmail(email);
      setAccountProfile({
        firstName: data.user.firstName ?? '',
        lastName: data.user.lastName ?? '',
        email,
      });
      saveSession(data.token, name, 'menu', email);
      fetchFlights(data.token);
      fetchLodgings(data.token);
      fetchTours(data.token);
      fetchInvites(data.token);
      fetchAccountProfile(data.token);
      setActivePage('menu');
    } catch (err) {
      alert((err as Error).message || 'Registration failed');
    }
  };

  const fetchAccountProfile = async (token?: string) => {
    const auth = token ?? userToken;
    if (!auth) return;
    try {
      const res = await fetch(`${backendUrl}/api/account`, {
        headers: { Authorization: `Bearer ${auth}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const fullName = `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim() || 'Traveler';
      setAccountProfile({
        firstName: data.firstName ?? '',
        lastName: data.lastName ?? '',
        email: data.email ?? '',
      });
      setUserName(fullName);
      setUserEmail(data.email ?? null);
    } catch {
      // best-effort fetch; ignore errors so other data loads.
    }
  };

  const updateAccountProfile = async () => {
    if (!userToken) return;
    setAccountMessage(null);
    const res = await fetch(`${backendUrl}/api/account/profile`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(accountProfile),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to update profile');
      return;
    }
    const updatedUser = data.user ?? accountProfile;
    const fullName = `${updatedUser.firstName ?? ''} ${updatedUser.lastName ?? ''}`.trim() || 'Traveler';
    if (data.token) {
      setUserToken(data.token);
      saveSession(data.token, fullName, activePage, updatedUser.email ?? accountProfile.email);
    }
    setUserName(fullName);
    setUserEmail(updatedUser.email ?? null);
    setAccountProfile({
      firstName: updatedUser.firstName ?? '',
      lastName: updatedUser.lastName ?? '',
      email: updatedUser.email ?? '',
    });
    setAccountMessage('Profile updated');
  };

  const updateAccountPassword = async () => {
    if (!userToken) return;
    setAccountMessage(null);
    const res = await fetch(`${backendUrl}/api/account/password`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(passwordForm),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to update password');
      return;
    }
    setAccountMessage('Password updated');
    setPasswordForm({ currentPassword: '', newPassword: '' });
  };

  const deleteAccount = async () => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/account`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to delete account');
      return;
    }
    setShowDeleteConfirm(false);
    logout();
  };

  // Fetch flights for the active trip; normalize paidBy casing.
  const fetchFlights = async (token?: string) => {
    if (!activeTripId) {
      setFlights([]);
      return;
    }
    const res = await fetch(`${backendUrl}/api/flights?tripId=${activeTripId}`, {
      headers: { Authorization: `Bearer ${token ?? userToken}` },
    });
    const data = await res.json();
    setFlights(
      (data as any[]).map((f) => ({
        ...f,
        paidBy: Array.isArray(f.paidBy) ? f.paidBy : Array.isArray(f.paid_by) ? f.paid_by : [],
      }))
    );
  };

  // Fetch lodgings for the active trip; normalize nullable fields.
  const fetchLodgings = async (token?: string) => {
    if (!activeTripId) {
      setLodgings([]);
      return;
    }
    const res = await fetch(`${backendUrl}/api/lodgings?tripId=${activeTripId}`, {
      headers: { Authorization: `Bearer ${token ?? userToken}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    setLodgings(
      (data as any[]).map((l) => ({
        ...l,
        rooms: String(l.rooms ?? ''),
        totalCost: String(l.totalCost ?? ''),
        costPerNight: String(l.costPerNight ?? ''),
        refundBy: l.refundBy ?? '',
        paidBy: Array.isArray(l.paidBy) ? l.paidBy : [],
      }))
    );
  };

  // Fetch tours for the active trip; normalize string fields.
  const fetchTours = async (token?: string) => {
    if (!activeTripId) {
      setTours([]);
      return;
    }
    const res = await fetch(`${backendUrl}/api/tours?tripId=${activeTripId}`, {
      headers: { Authorization: `Bearer ${token ?? userToken}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    setTours(
      (data as any[]).map((t) => ({
        ...t,
        cost: String(t.cost ?? ''),
        paidBy: Array.isArray(t.paidBy) ? t.paidBy : [],
        bookedOn: t.bookedOn ?? '',
        freeCancelBy: t.freeCancelBy ?? '',
      }))
    );
  };

  const fetchGroups = async (sort?: 'created' | 'name') => {
    const res = await fetch(`${backendUrl}/api/groups?sort=${sort ?? groupSort}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    setGroups(data);
    if (!newTripGroupId && data.length) {
      setNewTripGroupId(data[0].id);
    }
  };

  const fetchTrips = async () => {
    const res = await fetch(`${backendUrl}/api/trips`, { headers: { Authorization: `Bearer ${userToken}` } });
    if (!res.ok) return;
    const data = await res.json();
    setTrips(data);
    if (!activeTripId && data.length) {
      setActiveTripId(data[0].id);
    } else if (activeTripId && !data.find((t: Trip) => t.id === activeTripId)) {
      setActiveTripId(data[0]?.id ?? null);
    }
  };

  const clampTraitLevelInput = (val: string) => {
    const num = Number(val);
    if (!Number.isFinite(num)) return 1;
    return Math.min(Math.max(Math.round(num), 1), 5);
  };

  const parsePlanToDetails = (plan: string): Array<{ day: number; activity: string; cost?: number | null }> => {
    const lines = plan.split('\n');
    let currentDay: number | null = null;
    const details: Array<{ day: number; activity: string; cost?: number | null }> = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const dayMatch = line.match(/day\s+(\d+)/i);
      if (dayMatch) {
        currentDay = Number(dayMatch[1]);
        continue;
      }
      if (currentDay === null) continue;
      const activity = line.replace(/^[-*•]\s*/, '').trim();
      if (!activity) continue;
      // If activity looks like a generic encouragement, treat cost as null (show "-")
      const looksGeneric = /enjoy|welcome|adventure/i.test(activity);
      // Explicit "free" (or free time) gets cost 0
      const isFree = /(^|\s)free(\s|$)/i.test(activity);
      const costMatch = activity.match(/\$?([\d][\d,]*(?:\.\d+)?)/);
      const cost = costMatch ? Number(costMatch[1].replace(/,/g, '')) : null;
      const numericCost = isFree
        ? 0
        : looksGeneric || !Number.isFinite(cost as number)
          ? null
          : (cost as number);
      details.push({ day: currentDay, activity, cost: numericCost });
    }
    return details;
  };

  const dedupeDetails = (list: ItineraryDetailRecord[]) => {
    const seen = new Set<string>();
    return list.filter((d) => {
      const key = `${d.day}|${(d.activity || '').toLowerCase().trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const clampBudget = (val: number) => {
    if (!Number.isFinite(val)) return 0;
    return Math.min(Math.max(Math.round(val), 0), 20000);
  };

  const fetchTraits = async () => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/traits`, { headers: { Authorization: `Bearer ${userToken}` } });
    if (!res.ok) return;
    const data = (await res.json()) as Trait[];
    setTraits(data);
    const drafts: Record<string, { level: string; notes: string }> = {};
    for (const t of data) {
      drafts[t.id] = { level: String(t.level ?? 1), notes: t.notes ?? '' };
    }
    setTraitDrafts(drafts);
    setSelectedTraitNames(new Set(data.map((t) => t.name)));
  };

  const fetchTraitProfile = async () => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/traits/profile/demographics`, { headers });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    if (data.age != null) setTraitAge(String(data.age));
    if (data.gender) {
      if (data.gender === 'female' || data.gender === 'male' || data.gender === 'nonbinary' || data.gender === 'prefer-not') {
        setTraitGender(data.gender);
      }
    }
  };

  const createTrait = async () => {
    if (!userToken) return;
    const name = newTraitName.trim();
    if (!name) {
      alert('Enter a trait name');
      return;
    }
    const level = Math.min(Math.max(Number(newTraitLevel) || 1, 1), 5);
    const notes = newTraitNotes.trim();
    const res = await fetch(`${backendUrl}/api/traits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ name, level, notes: notes || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to save trait');
      return;
    }
    setNewTraitName('');
    setNewTraitLevel('3');
    setNewTraitNotes('');
    fetchTraits();
  };

  const updateTrait = async (traitId: string) => {
    if (!userToken) return;
    const draft = traitDrafts[traitId];
    const level = Math.min(Math.max(Number(draft?.level ?? '') || 1, 1), 5);
    const notes = draft?.notes?.trim() ?? '';
    const res = await fetch(`${backendUrl}/api/traits/${traitId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ level, notes: notes || null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to update trait');
      return;
    }
    fetchTraits();
  };

  const deleteTrait = async (traitId: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/traits/${traitId}`, { method: 'DELETE', headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to delete trait');
      return;
    }
    setTraitDrafts((prev) => {
      const next = { ...prev };
      delete next[traitId];
      return next;
    });
    fetchTraits();
  };

  const fetchItineraryAirports = async (q: string) => {
    if (!userToken || !q.trim()) {
      setItineraryAirportOptions([]);
      return;
    }
    const res = await fetch(`${backendUrl}/api/flights/locations?q=${encodeURIComponent(q.trim())}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (!res.ok) {
      setItineraryAirportOptions([]);
      return;
    }
    const data = await res.json();
    setItineraryAirportOptions(data);
    setShowItineraryAirportDropdown(true);
  };

  const generateItinerary = async () => {
    if (!userToken) return;
    const country = itineraryCountry.trim();
    const days = itineraryDays.trim();
    if (!country || !days || !activeTripId) {
      alert('Enter a country, number of days, and select an active trip.');
      return;
    }
    setItineraryLoading(true);
    setItineraryError('');
    setItineraryPlan('');
    try {
    const res = await fetch(`${backendUrl}/api/itinerary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        country,
        days: Number(days),
        budgetMin,
        budgetMax,
        departureAirport: itineraryAirport.trim() || undefined,
        tripStyle: itineraryTripStyle.trim() || undefined,
        tripId: activeTripId,
        traits: traits.map((t) => ({ name: t.name, level: t.level, notes: t.notes })),
      }),
    });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.detail ? ` (${data.detail})` : '';
        setItineraryError((data.error || 'Failed to generate itinerary') + detail);
        return;
      }
      setItineraryPlan(data.plan || '');
      await saveGeneratedItinerary(data.plan || '');
    } catch (err) {
      setItineraryError((err as Error).message);
    } finally {
      setItineraryLoading(false);
    }
  };

  const saveItineraryRecord = async () => {
    if (!userToken) return;
    if (!activeTripId) {
      alert('Choose an active trip before saving an itinerary.');
      return;
    }
    if (!itineraryCountry.trim() || !itineraryDays.trim()) {
      alert('Enter destination and days first.');
      return;
    }
    const destination = itineraryCountry.trim();
    const daysNum = Number(itineraryDays);
    const existing = findExistingItinerary(activeTripId, destination, daysNum, editingItineraryId, budgetMax);
    if (existing) {
      alert('Itinerary already exists for this trip');
      return;
    }
    const method = editingItineraryId ? 'PUT' : 'POST';
    const url = editingItineraryId ? `${backendUrl}/api/itineraries/${editingItineraryId}` : `${backendUrl}/api/itineraries`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        tripId: activeTripId,
        destination,
        days: daysNum,
        budget: budgetMax, // store upper budget bound
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to save itinerary');
      return;
    }
    if (data.id) {
      setSelectedItineraryId(data.id);
      fetchItineraryDetails(data.id);
    }
    setEditingItineraryId(null);
    fetchItineraries();
  };

  const saveDetail = async () => {
    if (!userToken || !selectedItineraryId) {
      alert('Select an itinerary to add details');
      return;
    }
    if (!detailDraft.activity.trim()) {
      alert('Enter an activity');
      return;
    }
    const payload = {
      day: Number(detailDraft.day || '1'),
      time: detailDraft.time || null,
      activity: detailDraft.activity.trim(),
      cost: detailDraft.cost ? Number(detailDraft.cost) : null,
    };
    const url = editingDetailId
      ? `${backendUrl}/api/itineraries/details/${editingDetailId}`
      : `${backendUrl}/api/itineraries/${selectedItineraryId}/details`;
    const method = editingDetailId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to save detail');
      return;
    }
    setDetailDraft({ day: '1', time: '', activity: '', cost: '' });
    setEditingDetailId(null);
    fetchItineraryDetails(selectedItineraryId);
  };

  const saveGeneratedItinerary = async (plan: string) => {
    if (!activeTripId) {
      setItineraryError('Select an active trip before saving the itinerary.');
      return;
    }
    const destination = itineraryCountry.trim() || 'Unknown';
    const daysNum = Number(itineraryDays || '1');
    const existing = findExistingItinerary(activeTripId, destination, daysNum, null, budgetMax);
    let itineraryId = existing?.id;
    if (!itineraryId) {
      const createRes = await fetch(`${backendUrl}/api/itineraries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          tripId: activeTripId,
          destination,
          days: daysNum,
          budget: budgetMax,
        }),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        const message = (created.error || '').toLowerCase();
        if (message.includes('already exists')) {
          const existingRecord = itineraryRecords.find((i) => i.tripId === activeTripId);
          itineraryId = existingRecord?.id;
        }
        if (!itineraryId) {
          setItineraryError(created.error || 'Unable to save itinerary');
          return;
        }
      } else {
        itineraryId = created.id as string;
        fetchItineraries();
      }
      setSelectedItineraryId(itineraryId);
    } else {
      setItineraryError('');
      setSelectedItineraryId(itineraryId);
    }
    const parsedDetails = parsePlanToDetails(plan);
    if (parsedDetails.length) {
      // avoid posting duplicate day+activity pairs
      const uniqueKeys = new Set<string>();
      for (const d of parsedDetails) {
        const key = `${d.day}|${d.activity.toLowerCase().trim()}`;
        if (uniqueKeys.has(key)) continue;
        uniqueKeys.add(key);
        await fetch(`${backendUrl}/api/itineraries/${itineraryId}/details`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({
            day: d.day,
            activity: d.activity,
            cost: d.cost ?? null,
          }),
        }).catch(() => undefined);
      }
      fetchItineraryDetails(itineraryId);
    }
  };

  const traitOptions = [
    'Adventurous',
    'Hiking',
    'Cafes',
    'Relaxing',
    'Beaches',
    'Nightlife',
    'Cultural',
    'Foodie',
    'Road Trips',
    'Museums',
    'Luxury',
    'Budget',
    'Outdoorsy',
    'Photography',
    'Family Friendly',
    'Solo Travel',
  ];

  const toggleTrait = (name: string) => {
    setSelectedTraitNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const saveTraitSelections = async () => {
    if (!userToken) return;
    const selected = new Set(selectedTraitNames);
    const existingByName = new Map(traits.map((t) => [t.name, t]));
    // Delete unselected
    for (const t of traits) {
      if (!selected.has(t.name)) {
        await fetch(`${backendUrl}/api/traits/${t.id}`, { method: 'DELETE', headers }).catch(() => undefined);
      }
    }
    // Create new selections not yet stored
    for (const name of selected) {
      if (!existingByName.has(name)) {
        await fetch(`${backendUrl}/api/traits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ name, level: 3 }),
        }).catch(() => undefined);
      }
    }
    // Save age/gender without blocking UI if it fails
    await fetch(`${backendUrl}/api/traits/profile/demographics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        age: traitAge ? Number(traitAge) : null,
        gender: traitGender,
      }),
    }).catch(() => undefined);
    fetchTraitProfile();
    fetchTraits();
    alert('Traits saved');
  };

  const fetchGroupMembersForActiveTrip = async () => {
    if (!activeTripId) {
      setGroupMembers([]);
      return;
    }
    const activeTrip = trips.find((t) => t.id === activeTripId);
    if (!activeTrip?.groupId) {
      setGroupMembers([]);
      return;
    }
    const res = await fetch(`${backendUrl}/api/groups/${activeTrip.groupId}/members`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (!res.ok) {
      setGroupMembers([]);
      return;
    }
    const data = await res.json();
    setGroupMembers(data);
  };

  const fetchInvites = async (token?: string) => {
    const res = await fetch(`${backendUrl}/api/groups/invites`, { headers: { Authorization: `Bearer ${token ?? userToken}` } });
    if (!res.ok) return;
    const data = await res.json();
    setInvites(data);
  };

  // Create a new flight row for the active trip using the quick-add table inputs.
  const addFlight = async () => {
    if (!userToken) return false;
    if (!activeTripId) {
      alert('Select an active trip before adding a flight.');
      return false;
    }

    const payload = buildFlightPayload(newFlight, activeTripId, defaultPayerId);
    const res = await fetch(`${backendUrl}/api/flights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        ...payload,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to save flight');
      return false;
    }

    setNewFlight(createInitialFlightState());
    await fetchFlights();
    return true;
  };

  const removeFlight = async (id: string) => {
    if (!userToken) return;
    await fetch(`${backendUrl}/api/flights/${id}`, { method: 'DELETE', headers });
    fetchFlights();
  };

  // Share a flight with an email address (server sends invite/email if configured).
  const shareFlight = async (id: string) => {
    if (!userToken) return;
    if (!email.trim()) {
      alert('Enter an email to share this flight.');
      return;
    }
    await fetch(`${backendUrl}/api/flights/${id}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ email }),
    });
    fetchFlights();
  };

  const createGroup = async () => {
    if (!userToken) return;
    if (!groupName.trim()) {
      alert('Enter a group name');
      return;
    }

    const memberPayload = [
      ...groupUserEmails.split(',').map((e) => e.trim()).filter(Boolean).map((email) => ({ email })),
      ...groupGuestNames.split(',').map((n) => n.trim()).filter(Boolean).map((guestName) => ({ guestName })),
    ];

    const res = await fetch(`${backendUrl}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ name: groupName.trim(), members: memberPayload }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to create group');
      return;
    }

    setGroupName('');
    setGroupUserEmails('');
    setGroupGuestNames('');
    fetchInvites();
    fetchGroups();
  };

  const fetchItineraries = async () => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/itineraries`, { headers });
    if (!res.ok) return;
    const data = await res.json();
    setItineraryRecords(data);
  };

  const fetchItineraryDetails = async (itineraryId: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/itineraries/${itineraryId}/details`, { headers });
    if (!res.ok) return;
    const data = await res.json();
    setItineraryDetails((prev) => ({ ...prev, [itineraryId]: dedupeDetails(data) }));
  };

  const deleteItinerary = async (itineraryId: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/itineraries/${itineraryId}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to delete itinerary');
      return;
    }
    setItineraryRecords((prev) => prev.filter((i) => i.id !== itineraryId));
    setItineraryDetails((prev) => {
      const next = { ...prev };
      delete next[itineraryId];
      return next;
    });
    if (selectedItineraryId === itineraryId) {
      setSelectedItineraryId(null);
    }
    if (editingItineraryId === itineraryId) {
      setEditingItineraryId(null);
    }
    setEditingDetailId(null);
  };

  const acceptInvite = async (inviteId: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/groups/invites/${inviteId}/accept`, {
      method: 'POST',
      headers: headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to accept invite');
      return;
    }
    fetchInvites();
    fetchGroups();
    fetchTrips();
  };

  useEffect(() => {
    if (userToken) {
      fetchAccountProfile();
      fetchFlights();
      fetchLodgings();
      fetchTours();
      fetchInvites();
      fetchGroups();
      fetchTrips();
      fetchTraits();
      fetchTraitProfile();
      fetchItineraries();
    }
  }, [userToken]);

  useEffect(() => {
    if (userToken) return;
    const session = loadSession();
    if (session) {
      setUserToken(session.token);
      setUserName(session.name);
      setUserEmail(session.email ?? null);
      const sessionPage = session.page;
      if (sessionPage === 'flights' || sessionPage === 'lodging' || sessionPage === 'groups' || sessionPage === 'trips' || sessionPage === 'traits' || sessionPage === 'itinerary' || sessionPage === 'tours' || sessionPage === 'cost' || sessionPage === 'account') {
        setActivePage(sessionPage as Page);
      } else {
        setActivePage('menu');
      }
    }
  }, [userToken]);

  useEffect(() => {
    if (!userToken) return;
    saveSession(userToken, userName ?? 'Traveler', activePage, userEmail);
  }, [userToken, userName, userEmail, activePage]);

  useEffect(() => {
    if (userToken) {
      fetchFlights();
      fetchLodgings();
      fetchTours();
    }
  }, [activeTripId]);

  useEffect(() => {
    if (userToken) {
      fetchGroupMembersForActiveTrip();
    }
  }, [userToken, activeTripId, trips]);

  // Start adding a new flight row in the table; seeds default payer and clears suggestions.
  const handleAddPress = async () => {
    if (!activeTripId) {
      alert('Select an active trip before adding a flight.');
      return;
    } 
    setEditingFlightId('new');
    const init = createInitialFlightState();
    if (defaultPayerId && !init.paidBy.includes(defaultPayerId)) {
      init.paidBy.push(defaultPayerId);
    }
    setEditingFlight(init);
    setAirportTarget(null);
    setAirportAnchor(null);
    setAirportSuggestions([]);
    setLocationTarget(null);
    setLocationSuggestions([]);
    setShowPassengerSuggestions(false);
    setPassengerSuggestions([]);
    
  };

  const findActiveTrip = () => trips.find((t) => t.id === activeTripId);

  const ensurePassengerInGroup = async (passengerName: string) => {
    if (!userToken) return;
    const activeTrip = findActiveTrip();
    if (!activeTrip?.groupId) return;
    const normalizedTarget = normalizePassengerName(passengerName);
    const alreadyInGroup = groupMembers.some((m) => normalizePassengerName(formatMemberName(m)) === normalizedTarget);
    if (alreadyInGroup) return;
    try {
      await fetch(`${backendUrl}/api/groups/${activeTrip.groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ guestName: passengerName }),
      });
      await fetchGroupMembersForActiveTrip();
    } catch {
      // non-blocking
    }
  };

  // Persist parsed flights (or an override list) for the active trip.
  const saveParsedFlights = async (flightsOverride?: FlightEditDraft[]) => {
    const flightsToSave = flightsOverride ?? parsedFlights;
    if (!userToken || !activeTripId || !flightsToSave.length) {
      alert('No parsed flights to add.');
      return;
    }
    setIsSavingParsedFlights(true);
    try {
      let saved = 0;
      const failures: string[] = [];
      for (const flight of flightsToSave) {
        const enriched: FlightEditDraft = {
          ...flight,
          passengerName: flight.passengerName?.trim() || 'Traveler',
          departureLocation: flight.departureLocation?.trim() || flight.departureAirportCode || '',
          departureAirportCode: flight.departureAirportCode?.trim() || flight.departureLocation || '',
          arrivalLocation: flight.arrivalLocation?.trim() || flight.arrivalAirportCode || '',
          arrivalAirportCode: flight.arrivalAirportCode?.trim() || flight.arrivalLocation || '',
          departureDate: flight.departureDate?.trim() || new Date().toISOString().slice(0, 10),
          departureTime: flight.departureTime?.trim() || '00:00',
          arrivalTime: flight.arrivalTime?.trim() || '00:00',
          carrier: flight.carrier?.trim() || 'UNKNOWN',
          flightNumber: flight.flightNumber?.trim() || 'UNKNOWN',
          bookingReference: flight.bookingReference?.trim() || 'UNKNOWN',
        };
        if ((!enriched.paidBy || enriched.paidBy.length === 0) && defaultPayerId) {
          enriched.paidBy = [defaultPayerId];
        }
        if (!enriched.departureLocation || !enriched.arrivalLocation) {
          failures.push('Missing departure or arrival location.');
          continue;
        }
        await ensurePassengerInGroup(flight.passengerName);
        const res = await fetch(`${backendUrl}/api/flights`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({
            ...enriched,
            cost: Number(flight.cost) || 0,
            tripId: activeTripId,
            departureDate: enriched.departureDate,
            paidBy: enriched.paidBy,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          failures.push(data.error || 'Failed to save flight');
          continue;
        }
        saved += 1;
      }
      // Keep parsed flights visible so the user can review what was parsed.
      setParsedFlights(flightsToSave);
      if (saved) {
        const baseMsg =
          saved === 1 ? 'Added 1 flight to this trip.' : `Added ${saved} flights to this trip.`;
        const failMsg = failures.length ? ` ${failures.length} failed. First error: ${failures[0]}` : '';
        setPdfParseMessage(baseMsg + failMsg);
      } else {
        const failMsg = failures.length ? `Reason: ${failures[0]}` : '';
        setPdfParseMessage(`No flights added. Please review the upload. ${failMsg}`);
      }
      fetchFlights();
    } catch {
      alert('Unable to add parsed flights. Please review and add manually.');
    } finally {
      setIsSavingParsedFlights(false);
    }
  };

  const addMemberToGroup = async (groupId: string, type: 'user' | 'guest') => {
    if (!userToken) return;
    const email = groupAddEmail[groupId] ?? '';
    const guest = groupAddGuest[groupId] ?? '';

    if (type === 'user' && !email.trim()) {
      alert('Enter an email to add a user');
      return;
    }
    if (type === 'guest' && !guest.trim()) {
      alert('Enter a guest name');
      return;
    }

    const res = await fetch(`${backendUrl}/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(type === 'user' ? { email } : { guestName: guest }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to add member');
      return;
    }
    setGroupAddEmail((prev) => ({ ...prev, [groupId]: '' }));
    setGroupAddGuest((prev) => ({ ...prev, [groupId]: '' }));
    fetchGroups();
    fetchInvites();
  };

  const removeMemberFromGroup = async (groupId: string, memberId: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/groups/${groupId}/members/${memberId}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to remove member');
      return;
    }
    fetchGroups();
  };

  const cancelInvite = async (inviteId: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/groups/invites/${inviteId}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to cancel invite');
      return;
    }
    fetchGroups();
  };

  const createTrip = async () => {
    if (!userToken || !newTripName.trim() || !newTripGroupId) {
      alert('Enter a trip name and choose a group');
      return;
    }
    const res = await fetch(`${backendUrl}/api/trips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ name: newTripName.trim(), groupId: newTripGroupId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to create trip');
      return;
    }
    setNewTripName('');
    if (data?.id) setActiveTripId(data.id as string);
    fetchTrips();
  };

  const deleteTrip = async (tripId: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/trips/${tripId}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to delete trip');
      return;
    }
    fetchTrips();
  };

  const changeTripGroup = async (tripId: string, groupId: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/trips/${tripId}/group`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ groupId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to change trip group');
      return;
    }
    setTripDropdownOpenId(null);
    fetchTrips();
  };

  const deleteGroupApi = async (groupId: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/groups/${groupId}`, { method: 'DELETE', headers });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to delete group');
      return;
    }
    fetchGroups();
    fetchTrips();
  };

  const columns: { key: keyof Flight | 'actions'; label: string; minWidth?: number }[] = [
    { key: 'passenger_name', label: 'Passenger', minWidth: 130 },
    { key: 'departure_date', label: 'Departure Date' },
    { key: 'departure_location', label: 'Departure Location' },
    { key: 'departure_time', label: 'Departure Time' },
    { key: 'arrival_location', label: 'Arrival Location' },
    { key: 'arrival_time', label: 'Arrival Time' },
    { key: 'layover_duration', label: 'Layover Duration' },
    { key: 'cost', label: 'Cost' },
    { key: 'carrier', label: 'Carrier' },
    { key: 'flight_number', label: 'Flight #' },
    { key: 'booking_reference', label: 'Booking Ref' },
    { key: 'paidBy', label: 'Paid By', minWidth: 160 },
    { key: 'actions', label: 'Actions', minWidth: 180 },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.title}>Shared Trip Planner</Text>
        {userToken ? (
          <View style={styles.topRightWrapper}>
            {trips.length ? (
              <TouchableOpacity
                activeOpacity={0.8}
                style={[styles.input, styles.inlineInput, styles.dropdown, styles.activeTrip]}
                onPress={() => setShowActiveTripDropdown((s) => !s)}
              >
                <Text style={styles.cellText}>
                  Active Trip: {activeTripId ? trips.find((t) => t.id === activeTripId)?.name ?? 'Select' : 'Select'}
                </Text>
                {showActiveTripDropdown && (
                  <View style={styles.dropdownList}>
                    {trips.map((trip) => (
                      <TouchableOpacity
                        key={trip.id}
                        style={styles.dropdownOption}
                        onPress={() => {
                          setActiveTripId(trip.id);
                          setShowActiveTripDropdown(false);
                        }}
                      >
                        <Text style={styles.cellText}>{trip.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            ) : null}
            <View style={styles.topRight}>
              <Text style={styles.bodyText}>{userName ?? 'Traveler'}</Text>
              <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={logout}>
                <Text style={styles.buttonText}>Logout</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>
      {userToken ? (
        <ScrollView style={styles.contentScroll} contentContainerStyle={styles.contentScrollContent}>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Choose a section</Text>
              <View style={styles.navRow}>
                <TouchableOpacity style={[styles.button, activePage === 'flights' && styles.toggleActive]} onPress={() => setActivePage('flights')}>
                  <Text style={styles.buttonText}>Flights</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, activePage === 'lodging' && styles.toggleActive]} onPress={() => setActivePage('lodging')}>
                  <Text style={styles.buttonText}>Lodging</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, activePage === 'tours' && styles.toggleActive]} onPress={() => setActivePage('tours')}>
                  <Text style={styles.buttonText}>Tours</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, activePage === 'cost' && styles.toggleActive]} onPress={() => setActivePage('cost')}>
                  <Text style={styles.buttonText}>Cost Report</Text>
                </TouchableOpacity>
              <TouchableOpacity style={[styles.button, activePage === 'groups' && styles.toggleActive]} onPress={() => setActivePage('groups')}>
                <Text style={styles.buttonText}>Groups</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, activePage === 'trips' && styles.toggleActive]} onPress={() => setActivePage('trips')}>
                <Text style={styles.buttonText}>Trips</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, activePage === 'account' && styles.toggleActive]} onPress={() => setActivePage('account')}>
                <Text style={styles.buttonText}>Account</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, activePage === 'traits' && styles.toggleActive]} onPress={() => setActivePage('traits')}>
                <Text style={styles.buttonText}>Traits</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, activePage === 'itinerary' && styles.toggleActive]} onPress={() => setActivePage('itinerary')}>
                <Text style={styles.buttonText}>Create Itinerary</Text>
              </TouchableOpacity>
            </View>
          </View>

          {activePage === 'itinerary' ? (
            <View style={[styles.card, styles.itinerarySection]}>
              <Text style={styles.sectionTitle}>Create Itinerary</Text>
              <Text style={styles.helperText}>Capture the basics and we’ll use your traits to shape trip ideas.</Text>

              <TextInput
                style={styles.input}
                placeholder="What country are you trying to visit?"
                value={itineraryCountry}
                onChangeText={setItineraryCountry}
              />

              <View style={styles.dropdown}>
                <TextInput
                  style={styles.input}
                  placeholder="Departure airport (e.g., JFK, LAX, CDG)"
                  value={itineraryAirport}
                  onFocus={() => fetchItineraryAirports(itineraryAirport)}
                  onChangeText={(text) => {
                    setItineraryAirport(text);
                    fetchItineraryAirports(text);
                  }}
                />
                {showItineraryAirportDropdown && itineraryAirportOptions.length ? (
                  <View style={[styles.dropdownList, styles.itineraryDropdown]}>
                    {itineraryAirportOptions.map((opt) => (
                      <TouchableOpacity
                        key={opt}
                        style={styles.dropdownOption}
                        onPress={() => {
                          setItineraryAirport(opt);
                          setShowItineraryAirportDropdown(false);
                        }}
                      >
                        <Text style={styles.cellText}>{opt}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>

              <TextInput
                style={styles.input}
                placeholder="How many days will your vacation be?"
                keyboardType="numeric"
                value={itineraryDays}
                onChangeText={(text) => setItineraryDays(text.replace(/[^0-9]/g, ''))}
              />
              <TextInput
                style={styles.input}
                placeholder="What kind of trip do you want? (e.g., foodie weekend, outdoor adventure, museum crawl)"
                value={itineraryTripStyle}
                onChangeText={setItineraryTripStyle}
                multiline
              />

              <Text style={styles.modalLabel}>Budget range</Text>
              {Platform.OS === 'web' ? (
                <View style={styles.rangeContainer}>
                  <View style={styles.rangeLabels}>
                    <Text style={styles.helperText}>${budgetMin} min</Text>
                    <Text style={styles.helperText}>${budgetMax} max</Text>
                  </View>
                  {React.createElement('input', {
                    type: 'range',
                    min: 0,
                    max: 20000,
                    step: 100,
                    value: budgetMin,
                    style: { width: '100%' },
                    onChange: (e: any) => {
                      const next = clampBudget(Number(e.target.value));
                      setBudgetMin(Math.min(next, budgetMax));
                    },
                  })}
                  {React.createElement('input', {
                    type: 'range',
                    min: 0,
                    max: 20000,
                    step: 100,
                    value: budgetMax,
                    style: { width: '100%' },
                    onChange: (e: any) => {
                      const next = clampBudget(Number(e.target.value));
                      setBudgetMax(Math.max(next, budgetMin));
                    },
                  })}
                </View>
              ) : (
                <View style={styles.addRow}>
                  <TextInput
                    style={[styles.input, styles.inlineInput]}
                    placeholder="Min"
                    keyboardType="numeric"
                    value={String(budgetMin)}
                    onChangeText={(text) => {
                      const num = clampBudget(Number(text));
                      setBudgetMin(Math.min(num, budgetMax));
                    }}
                  />
                  <TextInput
                    style={[styles.input, styles.inlineInput]}
                    placeholder="Max"
                    keyboardType="numeric"
                    value={String(budgetMax)}
                onChangeText={(text) => {
                  const num = clampBudget(Number(text));
                  setBudgetMax(Math.max(num, budgetMin));
                }}
              />
            </View>
          )}

              <View style={styles.itinerarySummary}>
                <Text style={styles.bodyText}>
                  Destination: {itineraryCountry.trim() || '—'}
                </Text>
                <Text style={styles.bodyText}>
              Days: {itineraryDays.trim() || '—'}
            </Text>
            <Text style={styles.bodyText}>
              Budget: ${budgetMin} – ${budgetMax}
            </Text>
            <Text style={styles.bodyText}>
              Departure airport: {itineraryAirport.trim() || '—'}
            </Text>
            <Text style={styles.helperText}>
              Traits will help recommend activities (e.g., hikes for Adventurous, cafes for Coffee Lovers).
            </Text>
          </View>

              <TouchableOpacity style={styles.button} onPress={generateItinerary} disabled={itineraryLoading}>
                <Text style={styles.buttonText}>{itineraryLoading ? 'Generating…' : 'Generate Itinerary'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={saveItineraryRecord}>
                <Text style={styles.buttonText}>{editingItineraryId ? 'Update Itinerary' : 'Save Itinerary Info'}</Text>
              </TouchableOpacity>
              {editingItineraryId ? (
                <Text style={styles.helperText}>Editing itinerary — tap Save to update, or select another to cancel.</Text>
              ) : null}

          {itineraryError ? <Text style={styles.warningText}>{itineraryError}</Text> : null}
          {itineraryPlan ? (
            <View style={styles.planBox}>
              <Text style={styles.sectionTitle}>Suggested Plan</Text>
              <Text style={styles.bodyText}>{itineraryPlan}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {activePage === 'itinerary' ? (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Saved Itineraries</Text>
            {!itineraryRecords.length ? (
              <Text style={styles.helperText}>No itineraries saved yet.</Text>
            ) : (
              itineraryRecords.map((it) => {
                const isSelected = selectedItineraryId === it.id;
                return (
                  <TouchableOpacity
                    key={it.id}
                    style={[styles.row, { alignItems: 'center', paddingVertical: 6 }]}
                    onPress={() => {
                      setEditingItineraryId(null);
                      setSelectedItineraryId(it.id);
                      if (!itineraryDetails[it.id]) {
                        fetchItineraryDetails(it.id);
                      }
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.flightTitle}>{it.tripName || 'Trip'}</Text>
                      <Text style={styles.helperText}>
                        {it.destination} • {it.days} days • Budget ${it.budget ?? '—'} • Created {formatDateLong(it.createdAt)}
                      </Text>
                    </View>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => beginEditItinerary(it)}>
                      <Text style={styles.buttonText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => deleteItinerary(it.id)}>
                      <Text style={styles.buttonText}>Delete</Text>
                    </TouchableOpacity>
                    <View style={[styles.button, isSelected && styles.toggleActive]}>
                      <Text style={styles.buttonText}>{isSelected ? 'Selected' : 'View'}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          {selectedItineraryId ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Itinerary Details</Text>
              <View style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeader]}>
                  <View style={[styles.cell, { flex: 1 }]}>
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
                  <View style={[styles.cell, styles.actionCell, { flex: 1 }]}>
                    <Text style={styles.headerText}>Actions</Text>
                  </View>
                </View>
                {(itineraryDetails[selectedItineraryId] ?? []).map((d) => (
                  <View key={d.id} style={styles.tableRow}>
                    <View style={[styles.cell, { flex: 1 }]}>
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
                    <View style={[styles.cell, styles.actionCell, { flex: 1 }]}>
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
                          fetchItineraryDetails(selectedItineraryId);
                        }}
                      >
                        <Text style={styles.buttonText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                <View style={[styles.tableRow, styles.inputRow]}>
                  <View style={[styles.cell, { flex: 1 }]}>
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
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={saveDetail}>
                      <Text style={styles.buttonText}>{editingDetailId ? 'Update' : 'Add'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          ) : null}
        </>
      ) : null}

      {activePage === 'traits' ? (
        <>
          <View style={[styles.card, styles.traitsSection]}>
            <Text style={styles.sectionTitle}>Traits</Text>
            <Text style={styles.helperText}>Capture travel personality markers to tailor itinerary ideas (e.g., Adventurous, Coffee Lover, Beach Bum).</Text>
            <TextInput
              style={styles.input}
              placeholder="Trait name"
              value={newTraitName}
              onChangeText={setNewTraitName}
            />
            <View style={styles.addRow}>
              <TextInput
                style={[styles.input, styles.inlineInput]}
                placeholder="Level (1-5)"
                keyboardType="numeric"
                value={newTraitLevel}
                onChangeText={setNewTraitLevel}
              />
              <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={createTrait}>
                <Text style={styles.buttonText}>Save Trait</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Notes (optional, e.g., loves sunrise hikes or third-wave cafes)"
              value={newTraitNotes}
              onChangeText={setNewTraitNotes}
              multiline
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Your profile traits</Text>
            {!traits.length ? (
              <Text style={styles.helperText}>No traits yet. Add one above to start personalizing trip ideas.</Text>
            ) : (
              traits.map((trait) => {
                const draft = traitDrafts[trait.id] ?? { level: String(trait.level ?? 1), notes: trait.notes ?? '' };
                return (
                  <View key={trait.id} style={styles.traitRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.flightTitle}>{trait.name}</Text>
                      <Text style={styles.helperText}>Level {draft.level || trait.level} • Added {formatDateLong(trait.createdAt)}</Text>
                      <View style={styles.addRow}>
                        <TextInput
                          style={[styles.input, styles.inlineInput]}
                          value={draft.level}
                          keyboardType="numeric"
                          placeholder="1-5"
                          onChangeText={(text) =>
                            setTraitDrafts((prev) => ({
                              ...prev,
                              [trait.id]: { level: text, notes: prev[trait.id]?.notes ?? draft.notes },
                            }))
                          }
                        />
                        <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => updateTrait(trait.id)}>
                          <Text style={styles.buttonText}>Update</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => deleteTrait(trait.id)}>
                          <Text style={styles.buttonText}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                      <TextInput
                        style={[styles.input, styles.traitNoteInput]}
                        placeholder="Notes (optional)"
                        value={draft.notes}
                        onChangeText={(text) =>
                          setTraitDrafts((prev) => ({
                            ...prev,
                            [trait.id]: { level: prev[trait.id]?.level ?? draft.level, notes: text },
                          }))
                        }
                        multiline
                      />
                    </View>
                  </View>
                );
              })
            )}
          </View>

          <View style={[styles.card, styles.traitsSection]}>
            <Text style={styles.sectionTitle}>Select as many user traits that fit your travel style</Text>
            <Text style={styles.helperText}>These help personalize suggestions and itineraries.</Text>
            <TextInput
              style={styles.input}
              placeholder="Age"
              keyboardType="numeric"
              value={traitAge}
              onChangeText={(text) => setTraitAge(text.replace(/[^0-9]/g, ''))}
            />
            <View style={styles.traitGrid}>
              {[
                { key: 'female', label: 'Female' },
                { key: 'male', label: 'Male' },
                { key: 'nonbinary', label: 'Non-binary' },
                { key: 'prefer-not', label: 'Prefer not to say' },
              ].map((opt) => {
                const selected = traitGender === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.traitChip, selected && styles.traitChipSelected]}
                    onPress={() => setTraitGender(opt.key as typeof traitGender)}
                  >
                    <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.traitGrid}>
              {traitOptions.map((name) => {
                const selected = selectedTraitNames.has(name);
                return (
                  <TouchableOpacity
                    key={name}
                    style={[styles.traitChip, selected && styles.traitChipSelected]}
                    onPress={() => toggleTrait(name)}
                  >
                    <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={styles.button} onPress={saveTraitSelections}>
              <Text style={styles.buttonText}>Save Traits</Text>
            </TouchableOpacity>
          </View>
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Your profile traits</Text>
                {!traits.length ? (
                  <Text style={styles.helperText}>No traits yet. Add one above to start personalizing trip ideas.</Text>
                ) : (
                  traits.map((trait) => {
                    const draft = traitDrafts[trait.id] ?? { level: String(trait.level ?? 1), notes: trait.notes ?? '' };
                    return (
                      <View key={trait.id} style={styles.traitRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.flightTitle}>{trait.name}</Text>
                          <Text style={styles.helperText}>Level {draft.level || trait.level} • Added {formatDateLong(trait.createdAt)}</Text>
                          <View style={styles.addRow}>
                            <TextInput
                              style={[styles.input, styles.inlineInput]}
                              value={draft.level}
                              keyboardType="numeric"
                              placeholder="1-5"
                              onChangeText={(text) =>
                                setTraitDrafts((prev) => ({
                                  ...prev,
                                  [trait.id]: { level: text, notes: prev[trait.id]?.notes ?? draft.notes },
                                }))
                              }
                            />
                            <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => updateTrait(trait.id)}>
                              <Text style={styles.buttonText}>Update</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => deleteTrait(trait.id)}>
                              <Text style={styles.buttonText}>Delete</Text>
                            </TouchableOpacity>
                          </View>
                          <TextInput
                            style={[styles.input, styles.traitNoteInput]}
                            placeholder="Notes (optional)"
                            value={draft.notes}
                            onChangeText={(text) =>
                              setTraitDrafts((prev) => ({
                                ...prev,
                                [trait.id]: { level: prev[trait.id]?.level ?? draft.level, notes: text },
                              }))
                            }
                            multiline
                          />
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            </>
          ) : null}

          {activePage === 'lodging' ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Lodging</Text>
              {Platform.OS !== 'web' && lodgingDateField && NativeDateTimePicker ? (
                <NativeDateTimePicker
                  value={lodgingDateValue}
                  mode="date"
                  onChange={(_, date) => {
                    if (!date) {
                      setLodgingDateField(null);
                      return;
                    }
                    const iso = date.toISOString().slice(0, 10);
                    if (lodgingDateField === 'checkIn') setLodgingDraft((p) => ({ ...p, checkInDate: iso }));
                    if (lodgingDateField === 'checkOut') setLodgingDraft((p) => ({ ...p, checkOutDate: iso }));
                    if (lodgingDateField === 'refund') setLodgingDraft((p) => ({ ...p, refundBy: iso }));
                    setLodgingDateField(null);
                  }}
                />
              ) : null}
              <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
                <View style={styles.table}>
                  <View style={[styles.tableRow, styles.tableHeader]}>
                    <View style={[styles.cell, styles.lodgingNameCol]}>
                      <Text style={styles.headerText}>Name</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingDateCol]}>
                      <Text style={styles.headerText}>Check-in</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingDateCol]}>
                      <Text style={styles.headerText}>Check-out</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingRoomsCol]}>
                      <Text style={styles.headerText}>Rooms</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingRefundCol]}>
                      <Text style={styles.headerText}>Refund By</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingCostCol]}>
                      <Text style={styles.headerText}>Total</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingCostCol]}>
                      <Text style={styles.headerText}>Per Night</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingCostCol]}>
                      <Text style={styles.headerText}>Paid By</Text>
                    </View>
                    <View style={[styles.cell, styles.lastCell, styles.lodgingAddressCol]}>
                      <Text style={styles.headerText}>Address</Text>
                    </View>
                  </View>

                  <View style={[styles.tableRow, styles.inputRow]}>
                    <View style={[styles.cell, styles.lodgingNameCol]}>
                      <TextInput
                        style={styles.cellInput}
                        placeholder="Lodging name"
                        value={lodgingDraft.name}
                        onChangeText={(text) => setLodgingDraft((p) => ({ ...p, name: text }))}
                      />
                    </View>
                    <View style={[styles.cell, styles.lodgingDateCol]}>
                      {Platform.OS === 'web' ? (
                        <input
                          style={{ ...StyleSheet.flatten(styles.cellInput), width: '100%' }}
                          type="date"
                          value={lodgingDraft.checkInDate}
                          onChange={(e) => setLodgingDraft((p) => ({ ...p, checkInDate: e.target.value }))}
                        />
                      ) : (
                        <TouchableOpacity
                          style={[styles.cellInput, { justifyContent: 'center' }]}
                          onPress={() => {
                            setLodgingDateField('checkIn');
                            setLodgingDateValue(new Date(lodgingDraft.checkInDate));
                          }}
                        >
                          <Text>{lodgingDraft.checkInDate}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={[styles.cell, styles.lodgingDateCol]}>
                      {Platform.OS === 'web' ? (
                        <input
                          style={{ ...StyleSheet.flatten(styles.cellInput), width: '100%' }}
                          type="date"
                          value={lodgingDraft.checkOutDate}
                          onChange={(e) => setLodgingDraft((p) => ({ ...p, checkOutDate: e.target.value }))}
                        />
                      ) : (
                        <TouchableOpacity
                          style={[styles.cellInput, { justifyContent: 'center' }]}
                          onPress={() => {
                            setLodgingDateField('checkOut');
                            setLodgingDateValue(new Date(lodgingDraft.checkOutDate));
                          }}
                        >
                          <Text>{lodgingDraft.checkOutDate}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={[styles.cell, styles.lodgingRoomsCol]}>
                      <TextInput
                        style={styles.cellInput}
                        keyboardType="numeric"
                        value={lodgingDraft.rooms}
                        onChangeText={(text) => setLodgingDraft((p) => ({ ...p, rooms: text }))}
                      />
                    </View>
                    <View style={[styles.cell, styles.lodgingRefundCol]}>
                      {Platform.OS === 'web' ? (
                        <input
                          style={{ ...StyleSheet.flatten(styles.cellInput), width: '100%' }}
                          type="date"
                          value={lodgingDraft.refundBy}
                          onChange={(e) => setLodgingDraft((p) => ({ ...p, refundBy: e.target.value }))}
                        />
                      ) : (
                        <TouchableOpacity
                          style={[styles.cellInput, { justifyContent: 'center' }]}
                          onPress={() => {
                            setLodgingDateField('refund');
                            setLodgingDateValue(
                              lodgingDraft.refundBy ? new Date(lodgingDraft.refundBy) : new Date(lodgingDraft.checkInDate)
                            );
                          }}
                        >
                          <Text>{lodgingDraft.refundBy || 'Select'}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={[styles.cell, styles.lodgingCostCol]}>
                      <TextInput
                        style={styles.cellInput}
                        keyboardType="numeric"
                        value={lodgingDraft.totalCost}
                        onChangeText={(text) => setLodgingDraft((p) => ({ ...p, totalCost: text }))}
                        placeholder="Total cost"
                      />
                    </View>
                    <View style={[styles.cell, styles.lodgingCostCol]}>
                      <Text style={styles.cellText}>${lodgingDraft.costPerNight || '-'}</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingCostCol]}>
                      <View style={styles.payerChips}>
                        {lodgingDraft.paidBy.map((id) => (
                          <View key={id} style={styles.payerChip}>
                            <Text style={styles.cellText}>{payerName(id)}</Text>
                            <TouchableOpacity onPress={() => setLodgingDraft((p) => ({ ...p, paidBy: p.paidBy.filter((x) => x !== id) }))}>
                              <Text style={styles.removeText}>×</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                      <View style={styles.payerOptions}>
                        {userMembers
                          .filter((m) => !lodgingDraft.paidBy.includes(m.id))
                          .map((m) => (
                            <TouchableOpacity
                              key={m.id}
                              style={styles.smallButton}
                              onPress={() => setLodgingDraft((p) => ({ ...p, paidBy: [...p.paidBy, m.id] }))}
                            >
                              <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                            </TouchableOpacity>
                          ))}
                      </View>
                    </View>
                    <View style={[styles.cell, styles.lastCell, styles.lodgingAddressCol]}>
                      <TextInput
                        style={styles.cellInput}
                        value={lodgingDraft.address}
                        onChangeText={(text) => setLodgingDraft((p) => ({ ...p, address: text }))}
                        placeholder="Address"
                      />
                    </View>
                  </View>
                  <View style={styles.tableFooter}>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => saveLodging(lodgingDraft)}>
                      <Text style={styles.buttonText}>Add lodging</Text>
                    </TouchableOpacity>
                  </View>

                  {lodgings.map((l) => (
                    <View key={l.id} style={styles.tableRow}>
                      <View style={[styles.cell, styles.lodgingNameCol]}>
                        <Text style={styles.cellText}>{l.name}</Text>
                      </View>
                      <View style={[styles.cell, styles.lodgingDateCol]}>
                        <Text style={styles.cellText}>{formatDateLong(l.checkInDate)}</Text>
                      </View>
                      <View style={[styles.cell, styles.lodgingDateCol]}>
                        <Text style={styles.cellText}>{formatDateLong(l.checkOutDate)}</Text>
                      </View>
                      <View style={[styles.cell, styles.lodgingRoomsCol]}>
                        <Text style={styles.cellText}>{l.rooms}</Text>
                      </View>
                      <View style={[styles.cell, styles.lodgingRefundCol]}>
                        <Text style={styles.cellText}>{l.refundBy ? formatDateLong(l.refundBy) : 'Non-refundable'}</Text>
                      </View>
                      <View style={[styles.cell, styles.lodgingCostCol]}>
                        <Text style={styles.cellText}>${l.totalCost || '-'}</Text>
                      </View>
                      <View style={[styles.cell, styles.lodgingCostCol]}>
                        <Text style={styles.cellText}>${l.costPerNight || '-'}</Text>
                      </View>
                      <View style={[styles.cell, styles.lodgingCostCol]}>
                        <Text style={styles.cellText}>{l.paidBy && l.paidBy.length ? l.paidBy.map(payerName).join(', ') : '-'}</Text>
                      </View>
                      <View
                        style={[
                          styles.cell,
                          styles.lastCell,
                          styles.lodgingAddressCol,
                          { flexDirection: 'row', justifyContent: 'space-between' },
                        ]}
                      >
                        <Text style={[styles.cellText, styles.linkText]} onPress={() => openMaps(l.address)}>
                          {l.address || '-'}
                        </Text>
                        <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => openLodgingEditor(l)}>
                          <Text style={styles.buttonText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => removeLodging(l.id)}>
                          <Text style={styles.removeText}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              </ScrollView>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.flightTitle}>Total lodging cost: ${lodgingTotal.toFixed(2)}</Text>
              </View>
            </View>
          ) : null}

          {editingLodging && editingLodgingId ? (
            <View style={styles.passengerOverlay}>
              <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={closeLodgingEditor} />
              <View style={styles.modalCard}>
                <Text style={styles.sectionTitle}>Edit Lodging</Text>
                <ScrollView style={{ maxHeight: 420 }}>
                  <Text style={styles.modalLabel}>Name</Text>
                  <TextInput
                    style={styles.input}
                    value={editingLodging.name}
                    onChangeText={(text) => setEditingLodging((prev) => (prev ? { ...prev, name: text } : prev))}
                  />
                  <Text style={styles.modalLabel}>Check-in</Text>
                  {Platform.OS === 'web' ? (
                    <input
                      type="date"
                      value={editingLodging.checkInDate}
                      onChange={(e) => setEditingLodging((prev) => (prev ? { ...prev, checkInDate: e.target.value } : prev))}
                      style={styles.input as any}
                    />
                  ) : (
                    <TextInput
                      style={styles.input}
                      value={editingLodging.checkInDate}
                      onChangeText={(text) => setEditingLodging((prev) => (prev ? { ...prev, checkInDate: normalizeDateString(text) } : prev))}
                    />
                  )}
                  <Text style={styles.modalLabel}>Check-out</Text>
                  {Platform.OS === 'web' ? (
                    <input
                      type="date"
                      value={editingLodging.checkOutDate}
                      onChange={(e) => setEditingLodging((prev) => (prev ? { ...prev, checkOutDate: e.target.value } : prev))}
                      style={styles.input as any}
                    />
                  ) : (
                    <TextInput
                      style={styles.input}
                      value={editingLodging.checkOutDate}
                      onChangeText={(text) => setEditingLodging((prev) => (prev ? { ...prev, checkOutDate: normalizeDateString(text) } : prev))}
                    />
                  )}
                  <Text style={styles.modalLabel}>Rooms</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={editingLodging.rooms}
                    onChangeText={(text) => setEditingLodging((prev) => (prev ? { ...prev, rooms: text } : prev))}
                  />
                  <Text style={styles.modalLabel}>Refund by</Text>
                  {Platform.OS === 'web' ? (
                    <input
                      type="date"
                      value={editingLodging.refundBy}
                      onChange={(e) => setEditingLodging((prev) => (prev ? { ...prev, refundBy: e.target.value } : prev))}
                      style={styles.input as any}
                    />
                  ) : (
                    <TextInput
                      style={styles.input}
                      value={editingLodging.refundBy}
                      placeholder="YYYY-MM-DD"
                      onChangeText={(text) => setEditingLodging((prev) => (prev ? { ...prev, refundBy: normalizeDateString(text) } : prev))}
                    />
                  )}
                  <Text style={styles.modalLabel}>Total cost</Text>
                  <TextInput
                    style={styles.input}
                    value={editingLodging.totalCost}
                    keyboardType="numeric"
                    onChangeText={(text) => setEditingLodging((prev) => (prev ? { ...prev, totalCost: text } : prev))}
                  />
                  <Text style={styles.modalLabel}>Cost per night</Text>
                  <Text style={styles.helperText}>{editingLodging.costPerNight ? `$${editingLodging.costPerNight}` : '-'}</Text>

                  <Text style={styles.modalLabel}>Paid by</Text>
                  <View style={[styles.input, styles.payerBox]}>
                    <View style={styles.payerChips}>
                      {editingLodging.paidBy.map((id) => (
                        <View key={id} style={styles.payerChip}>
                          <Text style={styles.cellText}>{payerName(id)}</Text>
                          <TouchableOpacity
                            onPress={() =>
                              setEditingLodging((p) =>
                                p
                                  ? {
                                      ...p,
                                      paidBy: p.paidBy.filter((x) => x !== id),
                                    }
                                  : p
                              )
                            }
                          >
                            <Text style={styles.removeText}>x</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                    <View style={styles.payerOptions}>
                      {userMembers
                        .filter((m) => !editingLodging.paidBy.includes(m.id))
                        .map((m) => (
                          <TouchableOpacity
                            key={m.id}
                            style={styles.smallButton}
                            onPress={() => setEditingLodging((p) => (p ? { ...p, paidBy: [...p.paidBy, m.id] } : p))}
                          >
                            <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                          </TouchableOpacity>
                        ))}
                    </View>
                  </View>

                  <Text style={styles.modalLabel}>Address</Text>
                  <TextInput
                    style={styles.input}
                    value={editingLodging.address}
                    onChangeText={(text) => setEditingLodging((prev) => (prev ? { ...prev, address: text } : prev))}
                  />
                </ScrollView>
                <View style={styles.row}>
                  <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={closeLodgingEditor}>
                    <Text style={styles.buttonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.button}
                    onPress={() => editingLodging && saveLodging(editingLodging, editingLodgingId)}
                  >
                    <Text style={styles.buttonText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : null}

          {activePage === 'tours' ? (
            <View style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Tours</Text>
                <TouchableOpacity style={styles.button} onPress={() => openTourEditor()}>
                  <Text style={styles.buttonText}>+ Add Tour</Text>
                </TouchableOpacity>
              </View>
              {Platform.OS !== 'web' && tourDateField && editingTour && NativeDateTimePicker ? (
                <NativeDateTimePicker
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
                      { label: 'Tour', width: 180 },
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
                  {tours.map((t) => (
                    <View key={t.id} style={styles.tableRow}>
                      <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                        <Text style={styles.cellText}>{formatDateLong(t.date)}</Text>
                      </View>
                      <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                        <Text style={styles.cellText}>{t.name || '-'}</Text>
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
                        <TouchableOpacity style={[styles.smallButton]} onPress={() => openTourEditor(t)}>
                          <Text style={styles.buttonText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.smallButton, styles.dangerButton]} onPress={() => removeTour(t.id)}>
                          <Text style={styles.buttonText}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              </ScrollView>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.flightTitle}>Total tour cost: ${toursTotal.toFixed(2)}</Text>
                {Object.keys(payerTotals).length ? (
                  <View style={{ marginTop: 4 }}>
                    {Object.entries(payerTotals).map(([id, total]) => (
                      <Text key={id} style={styles.helperText}>
                        {payerName(id)}: ${total.toFixed(2)}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
              {editingTour ? (
                <View style={styles.passengerOverlay}>
                  <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={closeTourEditor} />
                  <View style={styles.modalCard}>
                    <Text style={styles.sectionTitle}>{editingTourId ? 'Edit Tour' : 'Add Tour'}</Text>
                    <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingRight: 12 }}>
                      <Text style={styles.modalLabel}>Date</Text>
                      {Platform.OS === 'web' ? (
                        <input
                          style={{ ...StyleSheet.flatten(styles.input), width: '100%' }}
                          type="date"
                          value={editingTour.date}
                          onChange={(e) => setEditingTour((p) => (p ? { ...p, date: e.target.value } : p))}
                        />
                      ) : (
                        <TouchableOpacity style={styles.input} onPress={() => openTourDatePicker('date')}>
                          <Text style={styles.cellText}>{formatDateLong(editingTour.date)}</Text>
                        </TouchableOpacity>
                      )}
                      <Text style={styles.modalLabel}>Tour</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Tour name"
                        value={editingTour.name}
                        onChangeText={(text) => setEditingTour((p) => (p ? { ...p, name: text } : p))}
                      />
                      <Text style={styles.modalLabel}>Start location</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Start location"
                        value={editingTour.startLocation}
                        onChangeText={(text) => setEditingTour((p) => (p ? { ...p, startLocation: text } : p))}
                      />
                      <Text style={styles.modalLabel}>Start time</Text>
                      {Platform.OS === 'web' ? (
                        <input
                          style={{ ...StyleSheet.flatten(styles.input), width: '100%' }}
                          type="time"
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
                        onChangeText={(text) => setEditingTour((p) => (p ? { ...p, duration: text } : p))}
                      />
                      <Text style={styles.modalLabel}>Cost</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Cost"
                        keyboardType="numeric"
                        value={editingTour.cost}
                        onChangeText={(text) => setEditingTour((p) => (p ? { ...p, cost: text.replace(/[^0-9.]/g, '') } : p))}
                      />
                      <View style={styles.modalRow}>
                        <Text style={styles.modalLabel}>Free cancellation by</Text>
                        <TouchableOpacity onPress={() => setEditingTour((p) => (p ? { ...p, freeCancelBy: '' } : p))}>
                          <Text style={styles.linkText}>Clear</Text>
                        </TouchableOpacity>
                      </View>
                      {Platform.OS === 'web' ? (
                        <input
                          style={{ ...StyleSheet.flatten(styles.input), width: '100%' }}
                          type="date"
                          value={editingTour.freeCancelBy}
                          onChange={(e) => setEditingTour((p) => (p ? { ...p, freeCancelBy: e.target.value } : p))}
                        />
                      ) : (
                        <TouchableOpacity style={styles.input} onPress={() => openTourDatePicker('freeCancel')}>
                          <Text style={styles.cellText}>{editingTour.freeCancelBy ? formatDateLong(editingTour.freeCancelBy) : 'Select date'}</Text>
                        </TouchableOpacity>
                      )}
                      <Text style={styles.modalLabel}>Platform Booked On</Text>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TextInput
                          style={[styles.input, { flex: 1 }]}
                          placeholder="Viator, Get Your Guide, Klook, etc."
                          value={editingTour.bookedOn}
                          onChangeText={(text) => setEditingTour((p) => (p ? { ...p, bookedOn: text } : p))}
                        />
                        <TextInput
                          style={[styles.input, { flex: 1 }]}
                          placeholder="Reference"
                          value={editingTour.reference}
                          onChangeText={(text) => setEditingTour((p) => (p ? { ...p, reference: text } : p))}
                        />
                      </View>
                      <Text style={styles.modalLabel}>Paid by</Text>
                      <View style={[styles.input, styles.payerBox]}>
                        <View style={styles.payerChips}>
                          {editingTour.paidBy.map((id) => (
                            <View key={id} style={styles.payerChip}>
                              <Text style={styles.cellText}>{payerName(id)}</Text>
                              <TouchableOpacity onPress={() => setEditingTour((p) => (p ? { ...p, paidBy: p.paidBy.filter((x) => x !== id) } : p))}>
                                <Text style={styles.removeText}>×</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>
                        <View style={styles.payerOptions}>
                          {userMembers
                            .filter((m) => !editingTour.paidBy.includes(m.id))
                            .map((m) => (
                              <TouchableOpacity
                                key={m.id}
                                style={styles.smallButton}
                                onPress={() => setEditingTour((p) => (p ? { ...p, paidBy: [...p.paidBy, m.id] } : p))}
                              >
                                <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                              </TouchableOpacity>
                            ))}
                        </View>
                      </View>
                    </ScrollView>
                    <View style={[styles.tableFooter, { justifyContent: 'space-between' }]}>
                      <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={closeTourEditor}>
                        <Text style={styles.buttonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.button} onPress={saveTour}>
                        <Text style={styles.buttonText}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {activePage === 'cost' ? (
            <View style={[styles.card, styles.flightsSection]}>
              <Text style={styles.sectionTitle}>Cost Report</Text>
              <Text style={styles.helperText}>Combined totals by category and user.</Text>
              <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
                <View style={styles.table}>
                  <View style={[styles.tableRow, styles.tableHeader]}>
                    <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                      <Text style={styles.headerText}>Category</Text>
                    </View>
                    {userMembers.map((m) => (
                      <View key={m.id} style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                        <Text style={styles.headerText}>{formatMemberName(m)}</Text>
                      </View>
                    ))}
                    <View style={[styles.cell, styles.lastCell, { minWidth: 120, flex: 1 }]}>
                      <Text style={styles.headerText}>Total</Text>
                    </View>
                  </View>
                  {[
                    { label: 'Flights', total: flightsTotal },
                    { label: 'Lodging', total: lodgingTotal },
                    { label: 'Tours', total: toursTotal },
                  ].map((row, idx, arr) => (
                    <View key={row.label} style={[styles.tableRow, idx === arr.length - 1 && styles.lastRow]}>
                      <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                        <Text style={styles.cellText}>{row.label}</Text>
                      </View>
                      {userMembers.map((m) => {
                        let share = 0;
                        if (row.label === 'Tours') {
                          share = payerTotals[m.id] || 0;
                        } else if (row.label === 'Flights') {
                          const pay = flightsPayerTotals[m.id];
                          share = typeof pay === 'number' && pay > 0 ? pay : row.total / (userMembers.length || 1);
                        } else if (row.label === 'Lodging') {
                          const pay = lodgingPayerTotals[m.id];
                          share = typeof pay === 'number' && pay > 0 ? pay : row.total / (userMembers.length || 1);
                        }
                        return (
                          <View key={`${row.label}-${m.id}`} style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                            <Text style={styles.cellText}>${share.toFixed(2)}</Text>
                          </View>
                        );
                      })}
                      <View style={[styles.cell, styles.lastCell, { minWidth: 120, flex: 1 }]}>
                        <Text style={styles.cellText}>${row.total.toFixed(2)}</Text>
                      </View>
                    </View>
                  ))}
                  <View style={[styles.tableRow, styles.tableHeader]}>
                    <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                      <Text style={styles.headerText}>Overall</Text>
                    </View>
                    {userMembers.map((m) => {
                      const divisor = userMembers.length || 1;
                      const flightsShare = (() => {
                        const pay = flightsPayerTotals[m.id];
                        return typeof pay === 'number' && pay > 0 ? pay : flightsTotal / divisor;
                      })();
                      const lodgingShare = (() => {
                        const pay = lodgingPayerTotals[m.id];
                        return typeof pay === 'number' && pay > 0 ? pay : lodgingTotal / divisor;
                      })();
                      const tourShare = payerTotals[m.id] || 0;
                      const total = flightsShare + lodgingShare + tourShare;
                      return (
                        <View key={`overall-${m.id}`} style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                          <Text style={styles.headerText}>${total.toFixed(2)}</Text>
                        </View>
                      );
                    })}
                    <View style={[styles.cell, styles.lastCell, { minWidth: 120, flex: 1 }]}>
                      <Text style={styles.headerText}>${overallCost.toFixed(2)}</Text>
                    </View>
                  </View>
                </View>
              </ScrollView>
            </View>
          ) : null}

          {activePage === 'account' ? (
            <View style={[styles.card, styles.accountSection]}>
              <Text style={styles.sectionTitle}>Account</Text>
              <Text style={styles.helperText}>Update your profile, change your password, or remove your account.</Text>
              {accountMessage ? (
                <View style={styles.successCard}>
                  <Text style={styles.bodyText}>{accountMessage}</Text>
                </View>
              ) : null}
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="First name"
                  value={accountProfile.firstName}
                  onChangeText={(text) => setAccountProfile((p) => ({ ...p, firstName: text }))}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Last name"
                  value={accountProfile.lastName}
                  onChangeText={(text) => setAccountProfile((p) => ({ ...p, lastName: text }))}
                />
              </View>
              <TextInput
                style={styles.input}
                placeholder="Email"
                autoCapitalize="none"
                keyboardType="email-address"
                value={accountProfile.email}
                onChangeText={(text) => setAccountProfile((p) => ({ ...p, email: text }))}
              />
              <TouchableOpacity style={styles.button} onPress={updateAccountProfile}>
                <Text style={styles.buttonText}>Save Profile</Text>
              </TouchableOpacity>

              <View style={styles.divider} />
              <Text style={styles.modalLabel}>Change password</Text>
              <TextInput
                style={styles.input}
                placeholder="Current password"
                secureTextEntry
                value={passwordForm.currentPassword}
                onChangeText={(text) => setPasswordForm((p) => ({ ...p, currentPassword: text }))}
              />
              <TextInput
                style={styles.input}
                placeholder="New password"
                secureTextEntry
                value={passwordForm.newPassword}
                onChangeText={(text) => setPasswordForm((p) => ({ ...p, newPassword: text }))}
              />
              <TouchableOpacity style={styles.button} onPress={updateAccountPassword}>
                <Text style={styles.buttonText}>Update Password</Text>
              </TouchableOpacity>

              <View style={styles.divider} />
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={() => setShowDeleteConfirm(true)}>
                <Text style={styles.buttonText}>Delete Account</Text>
              </TouchableOpacity>
              {showDeleteConfirm ? (
                <View style={styles.modalOverlay}>
                  <View style={styles.confirmModal}>
                    <Text style={styles.sectionTitle}>Delete account?</Text>
                    <Text style={styles.helperText}>This cannot be undone. All solo trips and data will be removed.</Text>
                    <View style={styles.row}>
                      <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => setShowDeleteConfirm(false)}>
                        <Text style={styles.buttonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.button, styles.dangerButton, { flex: 1 }]} onPress={deleteAccount}>
                        <Text style={styles.buttonText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {activePage === 'groups' ? (
            <>
              {invites.length ? (
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Group Invitations</Text>
                  {invites.map((invite) => (
                    <View key={invite.id} style={styles.inviteRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.bodyText}>{invite.inviterEmail} invited you to "{invite.groupName}"</Text>
                        <Text style={styles.helperText}>Tap accept to join this group.</Text>
                      </View>
                      <TouchableOpacity style={styles.button} onPress={() => acceptInvite(invite.id)}>
                        <Text style={styles.buttonText}>Accept</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.sectionTitle}>Groups</Text>
                  <TouchableOpacity
                    style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]}
                    onPress={() => {
                      const nextSort = groupSort === 'created' ? 'name' : 'created';
                      setGroupSort(nextSort);
                      fetchGroups(nextSort);
                    }}
                  >
                    <Text style={styles.buttonText}>Sort: {groupSort === 'created' ? 'Newest' : 'Name'}</Text>
                  </TouchableOpacity>
                </View>
                {groups.map((group) => {
                  const userMembers = group.members.filter((m) => m.userId);
                  const guestMembers = group.members.filter((m) => !m.userId);
                  const created = formatDateLong(group.createdAt);
                  return (
                    <View key={group.id} style={styles.groupRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.flightTitle}>{group.name}</Text>
                        <Text style={styles.helperText}>Created: {created}</Text>
                      </View>
                      <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={() => deleteGroupApi(group.id)}>
                        <Text style={styles.buttonText}>Delete Group</Text>
                      </TouchableOpacity>
                      <View style={[styles.groupColumn, { flex: 1 }]}>
                        <Text style={styles.headerText}>Users</Text>
                        {group.invites.length ? (
                          <View style={styles.pendingBlock}>
                            {group.invites.map((inv) => (
                              <View key={inv.id} style={styles.memberPill}>
                                <Text style={styles.cellText}>{inv.inviteeEmail} (Pending)</Text>
                                <TouchableOpacity onPress={() => cancelInvite(inv.id)}>
                                  <Text style={styles.removeText}>Cancel</Text>
                                </TouchableOpacity>
                              </View>
                            ))}
                          </View>
                        ) : null}
                        {userMembers.map((m) => (
                          <View key={m.id} style={styles.memberPill}>
                            <Text style={styles.cellText}>{m.userEmail ?? 'User'}</Text>
                            <TouchableOpacity onPress={() => removeMemberFromGroup(group.id, m.id)}>
                              <Text style={styles.removeText}>Remove</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                        <View style={styles.addRow}>
                          <TextInput
                            placeholder="user email"
                            style={[styles.input, styles.inlineInput]}
                            value={groupAddEmail[group.id] ?? ''}
                            onChangeText={(text) => setGroupAddEmail((prev) => ({ ...prev, [group.id]: text }))}
                            autoCapitalize="none"
                          />
                          <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => addMemberToGroup(group.id, 'user')}>
                            <Text style={styles.buttonText}>Add</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                      <View style={[styles.groupColumn, { flex: 1 }]}>
                        <Text style={styles.headerText}>Guests</Text>
                        {guestMembers.map((m) => (
                          <View key={m.id} style={styles.memberPill}>
                            <Text style={styles.cellText}>{m.guestName ?? 'Guest'}</Text>
                            <TouchableOpacity onPress={() => removeMemberFromGroup(group.id, m.id)}>
                              <Text style={styles.removeText}>Remove</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                        <View style={styles.addRow}>
                          <TextInput
                            placeholder="guest name"
                            style={[styles.input, styles.inlineInput]}
                            value={groupAddGuest[group.id] ?? ''}
                            onChangeText={(text) => setGroupAddGuest((prev) => ({ ...prev, [group.id]: text }))}
                          />
                          <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => addMemberToGroup(group.id, 'guest')}>
                            <Text style={styles.buttonText}>Add</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Create Group</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Group name"
                  value={groupName}
                  onChangeText={setGroupName}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Add users by email (comma separated)"
                  value={groupUserEmails}
                  onChangeText={setGroupUserEmails}
                  autoCapitalize="none"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Add guest members by name (comma separated)"
                  value={groupGuestNames}
                  onChangeText={setGroupGuestNames}
                />
                <TouchableOpacity style={styles.button} onPress={createGroup}>
                  <Text style={styles.buttonText}>Create Group</Text>
                </TouchableOpacity>
                <Text style={styles.helperText}>
                  Users found in the system will receive an invite email (if SMTP is configured) or see it above after logging in.
                  Guest members are added directly without needing a login.
                </Text>
          </View>
        </>
      ) : null}

      {activePage === 'lodging' ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Lodging</Text>
          <Text style={styles.helperText}>Track stays for your active trip. Total: ${lodgingTotal.toFixed(2)}</Text>
          <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeader]}>
                <View style={[styles.cell, styles.lodgingNameCol]}>
                  <Text style={styles.headerText}>Name</Text>
                </View>
                <View style={[styles.cell, styles.lodgingDateCol]}>
                  <Text style={styles.headerText}>Check-in</Text>
                </View>
                <View style={[styles.cell, styles.lodgingDateCol]}>
                  <Text style={styles.headerText}>Check-out</Text>
                </View>
                <View style={[styles.cell, styles.lodgingRoomsCol]}>
                  <Text style={styles.headerText}>Rooms</Text>
                </View>
                <View style={[styles.cell, styles.lodgingRefundCol]}>
                  <Text style={styles.headerText}>Refundable By</Text>
                </View>
                <View style={[styles.cell, styles.lodgingCostCol]}>
                  <Text style={styles.headerText}>Total Cost</Text>
                </View>
                <View style={[styles.cell, styles.lodgingCostCol]}>
                  <Text style={styles.headerText}>Per Night</Text>
                </View>
                <View style={[styles.cell, styles.lodgingAddressCol]}>
                  <Text style={styles.headerText}>Address</Text>
                </View>
                <View style={[styles.cell, styles.actionCell, styles.lodgingCostCol]}>
                  <Text style={styles.headerText}>Actions</Text>
                </View>
              </View>

              {lodgings.map((l) => (
                <View key={l.id} style={styles.tableRow}>
                  <View style={[styles.cell, styles.lodgingNameCol]}>
                    <Text style={styles.cellText}>{l.name}</Text>
                  </View>
                  <View style={[styles.cell, styles.lodgingDateCol]}>
                    <Text style={styles.cellText}>{formatDateLong(normalizeDateString(l.checkInDate))}</Text>
                  </View>
                  <View style={[styles.cell, styles.lodgingDateCol]}>
                    <Text style={styles.cellText}>{formatDateLong(normalizeDateString(l.checkOutDate))}</Text>
                  </View>
                  <View style={[styles.cell, styles.lodgingRoomsCol]}>
                    <Text style={styles.cellText}>{l.rooms || '-'}</Text>
                  </View>
                  <View style={[styles.cell, styles.lodgingRefundCol]}>
                    <Text style={styles.cellText}>{l.refundBy ? formatDateLong(normalizeDateString(l.refundBy)) : '—'}</Text>
                  </View>
                  <View style={[styles.cell, styles.lodgingCostCol]}>
                    <Text style={styles.cellText}>{l.totalCost ? `$${l.totalCost}` : '-'}</Text>
                  </View>
                  <View style={[styles.cell, styles.lodgingCostCol]}>
                    <Text style={styles.cellText}>{l.costPerNight ? `$${l.costPerNight}` : '-'}</Text>
                  </View>
                  <View style={[styles.cell, styles.lodgingAddressCol]}>
                    <Text style={styles.cellText}>{l.address || '-'}</Text>
                  </View>
                  <View style={[styles.cell, styles.actionCell, styles.lodgingCostCol]}>
                    {l.address ? (
                      <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => openMaps(l.address)}>
                        <Text style={styles.buttonText}>Map</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => openLodgingEditor(l)}>
                      <Text style={styles.buttonText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => removeLodging(l.id)}>
                      <Text style={styles.buttonText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              <View style={[styles.tableRow, styles.inputRow]}>
                <View style={[styles.cell, styles.lodgingNameCol]}>
                  <TextInput
                    style={styles.input}
                    placeholder="Hotel / Airbnb"
                    value={lodgingDraft.name}
                    onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, name: text }))}
                  />
                </View>
                <View style={[styles.cell, styles.lodgingDateCol]}>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    value={lodgingDraft.checkInDate}
                    onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, checkInDate: normalizeDateString(text) }))}
                  />
                </View>
                <View style={[styles.cell, styles.lodgingDateCol]}>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    value={lodgingDraft.checkOutDate}
                    onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, checkOutDate: normalizeDateString(text) }))}
                  />
                </View>
                <View style={[styles.cell, styles.lodgingRoomsCol]}>
                  <TextInput
                    style={styles.input}
                    placeholder="Rooms"
                    keyboardType="numeric"
                    value={lodgingDraft.rooms}
                    onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, rooms: text }))}
                  />
                </View>
                <View style={[styles.cell, styles.lodgingRefundCol]}>
                  <TextInput
                    style={styles.input}
                    placeholder="Refund by (YYYY-MM-DD)"
                    value={lodgingDraft.refundBy}
                    onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, refundBy: normalizeDateString(text) }))}
                  />
                </View>
                <View style={[styles.cell, styles.lodgingCostCol]}>
                  <TextInput
                    style={styles.input}
                    placeholder="Total $"
                    keyboardType="numeric"
                    value={lodgingDraft.totalCost}
                    onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, totalCost: text }))}
                  />
                </View>
                <View style={[styles.cell, styles.lodgingCostCol]}>
                  <Text style={styles.cellText}>{lodgingDraft.costPerNight ? `$${lodgingDraft.costPerNight}` : '-'}</Text>
                </View>
                <View style={[styles.cell, styles.lodgingAddressCol]}>
                  <TextInput
                    style={styles.input}
                    placeholder="Address"
                    value={lodgingDraft.address}
                    onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, address: text }))}
                  />
                </View>
                <View style={[styles.cell, styles.actionCell, styles.lodgingCostCol]}>
                  <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => saveLodging(lodgingDraft)}>
                    <Text style={styles.buttonText}>Add</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      ) : null}

      {activePage === 'flights' ? (
        <View style={[styles.card, styles.flightsSection]}>
          <Text style={styles.sectionTitle}>Flights</Text>
              {Platform.OS === 'web' ? (
                <View style={styles.pdfRow}>
                  <input
                    ref={fileInputRef as any}
                    type="file"
                    accept="application/pdf,image/*"
                    style={styles.hiddenInput as any}
                    onChange={(e: any) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleFlightFile(file);
                      }
                      e.target.value = '';
                    }}
                  />
                  <TouchableOpacity
                    style={[styles.button, isParsingPdf && styles.disabledButton]}
                    disabled={isParsingPdf}
                    onPress={() => fileInputRef.current?.click()}
                  >
                    <Text style={styles.buttonText}>{isParsingPdf ? 'Reading...' : 'Upload Flight PDF'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.button, styles.smallButton, isSavingParsedFlights && styles.disabledButton]}
                    disabled={isSavingParsedFlights || parsedFlights.length === 0}
                    onPress={() => saveParsedFlights()}
                  >
                    <Text style={styles.buttonText}>
                      {isSavingParsedFlights
                        ? 'Adding flights...'
                        : parsedFlights.length
                          ? `Add parsed flights (${parsedFlights.length})`
                          : 'Add parsed flights'}
                    </Text>
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.helperText}>
                      {pdfParseMessage ?? 'Upload a confirmation email PDF or image to auto-add flights.'}
                    </Text>
                    {parsedFlights.length ? (
                      <View style={styles.parsedList}>
                        {parsedFlights.map((f, idx) => (
                          <Text key={`${f.passengerName}-${idx}`} style={styles.helperText}>
                            {`${f.passengerName || 'Traveler'} | ${f.departureDate || 'Date?'} | ${f.departureLocation} -> ${f.arrivalLocation} | ${f.departureTime || '?'} / Arr ${f.arrivalTime || '?'} | Cost ${f.cost || '0'} | Ref ${f.bookingReference || '-'}`}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : null}
              <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
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
                  {flights.map((item) => (
                    <View key={item.id} style={styles.tableRow}>
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
                            {!item.passengerInGroup ? (
                              <Text style={styles.warningText}>Passenger not in trip group</Text>
                            ) : null}
                            <TouchableOpacity style={styles.smallButton} onPress={() => openFlightDetails(item)}>
                              <Text style={styles.buttonText}>Details</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.smallButton, styles.dangerButton]} onPress={() => removeFlight(item.id)}>
                              <Text style={styles.buttonText}>Delete</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.smallButton} onPress={() => shareFlight(item.id)}>
                              <Text style={styles.buttonText}>Share</Text>
                              </TouchableOpacity>
                            </View>
                          );
                        }
                        const value = item[col.key as keyof Flight];
                        const baseDisplay = value != null ? String(value) : '-';
                        const display = col.key === 'cost'
                          ? `$${value}`
                          : col.key === 'booking_reference'
                            ? baseDisplay.toUpperCase()
                            : col.key === 'paidBy'
                              ? (Array.isArray(item.paidBy) && item.paidBy.length ? item.paidBy.map(payerName).join(', ') : '-')
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
                        const valueMap: Record<string, string> = {
                          passenger_name: newFlight.passengerName,
                          departure_date: newFlight.departureDate,
                          departure_location: newFlight.departureLocation,
                          departure_time: newFlight.departureTime,
                          arrival_location: newFlight.arrivalLocation,
                          arrival_time: newFlight.arrivalTime,
                          layover_duration: newFlight.layoverDuration,
                          cost: newFlight.cost,
                          carrier: newFlight.carrier,
                          flight_number: newFlight.flightNumber,
                          booking_reference: newFlight.bookingReference,
                        };

                        const setters: Record<string, (text: string) => void> = {
                          passenger_name: (text) => setNewFlight((prev) => ({ ...prev, passengerName: text })),
                          departure_date: (text) => setNewFlight((prev) => ({ ...prev, departureDate: text })),
                          departure_location: (text) => setNewFlight((prev) => ({ ...prev, departureLocation: text })),
                          departure_time: (text) => setNewFlight((prev) => ({ ...prev, departureTime: text })),
                          arrival_location: (text) => setNewFlight((prev) => ({ ...prev, arrivalLocation: text })),
                          arrival_time: (text) => setNewFlight((prev) => ({ ...prev, arrivalTime: text })),
                          layover_duration: (text) => setNewFlight((prev) => ({ ...prev, layoverDuration: text })),
                          cost: (text) => setNewFlight((prev) => ({ ...prev, cost: text })),
                          carrier: (text) => setNewFlight((prev) => ({ ...prev, carrier: text })),
                          flight_number: (text) => setNewFlight((prev) => ({ ...prev, flightNumber: text })),
                          booking_reference: (text) => setNewFlight((prev) => ({ ...prev, bookingReference: text.toUpperCase() })),
                        };

                      if (col.key === 'passenger_name') {
                        const displayName = valueMap.passenger_name || 'Select passenger';
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

                      if (col.key === 'departure_location' || col.key === 'arrival_location') {
                        const isDeparture = col.key === 'departure_location';
                        const rawValue = valueMap[col.key];
                        const label = rawValue || (isDeparture ? 'Departure location' : 'Arrival location');
                        const suggestions = locationTarget === (isDeparture ? 'dep' : 'arr') ? locationSuggestions : [];
                        const displayValue = getLocationInputValue(rawValue, isDeparture ? 'dep' : 'arr', locationTarget);
                        return (
                          <View
                            key={`input-${col.key}`}
                            style={[
                              styles.cell,
                              styles.locationField,
                              { minWidth: col.minWidth ?? 120, flex: 1 },
                              isLast && styles.lastCell,
                            ]}
                          >
                              <TextInput
                            style={styles.input}
                            value={displayValue}
                            placeholder={label}
                            // Location autocomplete (hits GET /api/flights/locations)
                            onFocus={() => fetchLocationSuggestions(isDeparture ? 'dep' : 'arr', rawValue)}
                            onChangeText={(text) => {
                              setters[col.key](text);
                              fetchLocationSuggestions(isDeparture ? 'dep' : 'arr', text);
                            }}
                            />
                            {suggestions.length ? (
                              <View style={styles.inlineDropdownList}>
                                {suggestions.map((loc) => (
                                  <TouchableOpacity
                                    key={`${col.key}-${loc}`}
                                    style={styles.dropdownOption}
                                    onPress={() => {
                                      const codeMatch = loc.match(/\(([A-Za-z]{3})\)/i);
                                      const code = codeMatch ? codeMatch[1].toUpperCase() : loc;
                                      if (isDeparture) {
                                        setNewFlight((prev) => ({ ...prev, departureLocation: code, departureAirportCode: code }));
                                      } else {
                                        setNewFlight((prev) => ({ ...prev, arrivalLocation: code, arrivalAirportCode: code }));
                                      }
                                      setLocationSuggestions([]);
                                      setLocationTarget(null);
                                    }}
                                  >
                                    <Text style={styles.cellText}>{loc}</Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            ) : null}
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
              </ScrollView>
              <View style={styles.totalRow}>
                <Text style={styles.flightTitle}>Total flight cost: ${flightsTotal.toFixed(2)}</Text>
              </View>
              <View style={styles.tableFooter}>
                <TouchableOpacity style={styles.button} onPress={handleAddPress}>
                  <Text style={styles.buttonText}>{isAddingRow ? 'OK' : 'Add'}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.shareRow}>
                <TextInput
                  placeholder="Share with email"
                  value={email}
                  onChangeText={setEmail}
                  style={[styles.input, styles.shareInput]}
                  autoCapitalize="none"
                />
                <Text style={styles.helperText}>Enter an email, then press Share on a row.</Text>
              </View>
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
                      return (
                        <TouchableOpacity
                          key={member.id}
                          style={styles.dropdownOption}
                          onPress={() => {
                            setNewFlight((prev) => ({ ...prev, passengerName: name }));
                            setShowPassengerDropdown(false);
                          }}
                        >
                          <Text style={styles.cellText}>{name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : null}
              {airportTarget && !airportTarget.startsWith('modal') && airportAnchor ? (
                <View style={styles.passengerOverlay}>
                  <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={hideAirportDropdown} />
                  <View
                    style={[
                      styles.passengerOverlayList,
                      airportAnchor
                        ? {
                            left: airportAnchor.x,
                            top: airportAnchor.y + airportAnchor.height,
                            width: airportAnchor.width,
                          }
                        : { left: 20, top: 120, width: 260 },
                    ]}
                  >
                    {airportSuggestions.map((airport) => (
                      <TouchableOpacity
                        key={`${airport.iata_code}-${airport.name}`}
                        style={styles.dropdownOption}
                        onPress={() => selectAirport(airportTarget, airport)}
                      >
                        <Text style={styles.cellText}>{formatAirportLabel(airport)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : null}
              {editingFlight && editingFlightId ? (
                <View style={styles.passengerOverlay}>
                  <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={closeFlightDetails} />
                  <View style={styles.modalCard}>
                    <Text style={styles.sectionTitle}>Flight Details</Text>
                    <Text style={styles.helperText}>
                      Current Departure: {formatDateLong(editingFlight.departureDate)} at {editingFlight.departureTime || '—'}
                    </Text>
                    <ScrollView style={{ maxHeight: 420 }}>
                      <Text style={styles.modalLabel}>Passenger</Text>
                      <TextInput
                        style={styles.input}
                        value={editingFlight.passengerName}
                        onChangeText={(text) => setEditingFlight((prev) => (prev ? { ...prev, passengerName: text } : prev))}
                      />
                      <Text style={styles.modalLabel}>Departure</Text>
                      <View style={styles.modalRow}>
                        <View style={styles.modalField}>
                          <Text style={styles.modalLabelSmall}>Date</Text>
                          {Platform.OS === 'web' ? (
                            <input
                              type="date"
                              value={editingFlight.departureDate}
                              onChange={(e) =>
                                setEditingFlight((prev) => (prev ? { ...prev, departureDate: e.target.value } : prev))
                              }
                              style={styles.input as any}
                            />
                          ) : (
                            <TextInput
                              style={styles.input}
                              value={editingFlight.departureDate}
                              placeholder="Date"
                              onChangeText={(text) => setEditingFlight((prev) => (prev ? { ...prev, departureDate: text } : prev))}
                            />
                          )}
                        </View>
                        <View style={styles.modalField}>
                          <Text style={styles.modalLabelSmall}>Location</Text>
                          <TextInput
                            style={styles.input}
                            value={getLocationInputValue(editingFlight.departureLocation, 'modal-dep', airportTarget)}
                            placeholder="Location"
                            ref={modalDepLocationRef}
                            // Location autocomplete (hits GET /api/flights/locations)
                            onFocus={() => showAirportDropdown('modal-dep', modalDepLocationRef.current, editingFlight.departureLocation)}
                            onChangeText={(text) => {
                              setEditingFlight((prev) => (prev ? { ...prev, departureLocation: text } : prev));
                              showAirportDropdown('modal-dep', modalDepLocationRef.current, text);
                            }}
                        />
                        {airportTarget === 'modal-dep' && airportSuggestions.length ? (
                          <View style={styles.inlineDropdownList}>
                            {airportSuggestions.map((airport) => (
                              <TouchableOpacity
                                key={`${airport.iata_code}-${airport.name}-dep`}
                                style={styles.dropdownOption}
                                onPress={() => selectAirport('modal-dep', airport)}
                              >
                                <Text style={styles.cellText}>{formatAirportLabel(airport)}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        ) : null}
                      </View>
                        <View style={styles.modalField}>
                          <Text style={styles.modalLabelSmall}>Time</Text>
                          {Platform.OS === 'web' ? (
                            <input
                              type="time"
                              value={editingFlight.departureTime}
                              onChange={(e) =>
                                setEditingFlight((prev) => (prev ? { ...prev, departureTime: e.target.value } : prev))
                              }
                              style={styles.input as any}
                            />
                          ) : (
                            <TextInput
                              style={styles.input}
                              value={editingFlight.departureTime}
                              placeholder="Time"
                              onChangeText={(text) => setEditingFlight((prev) => (prev ? { ...prev, departureTime: text } : prev))}
                            />
                          )}
                        </View>
                      </View>
                      <Text style={styles.modalLabel}>Arrival</Text>
                      <View style={styles.modalRow}>
                        <View style={styles.modalField}>
                          <Text style={styles.modalLabelSmall}>Location</Text>
                          <TextInput
                            style={styles.input}
                            value={getLocationInputValue(editingFlight.arrivalLocation, 'modal-arr', airportTarget)}
                            placeholder="Location"
                            ref={modalArrLocationRef}
                            // Location autocomplete (hits GET /api/flights/locations)
                            onFocus={() => showAirportDropdown('modal-arr', modalArrLocationRef.current, editingFlight.arrivalLocation)}
                            onChangeText={(text) => {
                              setEditingFlight((prev) => (prev ? { ...prev, arrivalLocation: text } : prev));
                              showAirportDropdown('modal-arr', modalArrLocationRef.current, text);
                            }}
                          />
                          {airportTarget === 'modal-arr' && airportSuggestions.length ? (
                            <View style={styles.inlineDropdownList}>
                              {airportSuggestions.map((airport) => (
                                <TouchableOpacity
                                  key={`${airport.iata_code}-${airport.name}-arr`}
                                  style={styles.dropdownOption}
                                  onPress={() => selectAirport('modal-arr', airport)}
                                >
                                  <Text style={styles.cellText}>{formatAirportLabel(airport)}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          ) : null}
                        </View>
                        <View style={styles.modalField}>
                          <Text style={styles.modalLabelSmall}>Time</Text>
                          {Platform.OS === 'web' ? (
                            <input
                              type="time"
                              value={editingFlight.arrivalTime}
                              onChange={(e) => setEditingFlight((prev) => (prev ? { ...prev, arrivalTime: e.target.value } : prev))}
                              style={styles.input as any}
                            />
                          ) : (
                            <TextInput
                              style={styles.input}
                              value={editingFlight.arrivalTime}
                              placeholder="Time"
                              onChangeText={(text) => setEditingFlight((prev) => (prev ? { ...prev, arrivalTime: text } : prev))}
                            />
                          )}
                        </View>
                      </View>

                      <Text style={styles.modalLabel}>Layover</Text>
                      <View style={styles.modalRow}>
                        <View style={styles.modalField}>
                          <Text style={styles.modalLabelSmall}>Location</Text>
                          <TextInput
                            style={styles.input}
                            value={getLocationInputValue(editingFlight.layoverLocation, 'modal-layover', locationTarget)}
                            placeholder="Layover location"
                            // Location autocomplete (hits GET /api/flights/locations)
                            onFocus={() => fetchLocationSuggestions('modal-layover', editingFlight.layoverLocation)}
                            onChangeText={(text) => {
                              setEditingFlight((prev) => (prev ? { ...prev, layoverLocation: text } : prev));
                              fetchLocationSuggestions('modal-layover', text);
                            }}
                        />
                          {locationTarget === 'modal-layover' && locationSuggestions.length ? (
                            <View style={styles.inlineDropdownList}>
                              {locationSuggestions.map((loc) => (
                                <TouchableOpacity
                                  key={`layover-${loc}`}
                                  style={styles.dropdownOption}
                                  onPress={() => {
                                  const codeMatch = loc.match(/\(([A-Za-z]{3})\)/i);
                                  const code = codeMatch ? codeMatch[1].toUpperCase() : loc;
                                  setEditingFlight((prev) => (prev ? { ...prev, layoverLocation: code, layoverLocationCode: code } : prev));
                                  setLocationSuggestions([]);
                                  setLocationTarget(null);
                                }}
                                >
                                  <Text style={styles.cellText}>{loc}</Text>
                                </TouchableOpacity>
                              ))}
                          </View>
                        ) : null}
                        </View>
                        <View style={styles.modalField}>
                          <Text style={styles.modalLabelSmall}>Duration</Text>
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            {(() => {
                              const { hours, minutes } = parseLayoverDuration(editingFlight.layoverDuration);
                              return (
                                <>
                                  <TextInput
                                    style={[styles.input, { flex: 1 }]}
                                    keyboardType="numeric"
                                    placeholder="Hours"
                                    value={hours}
                                    onChangeText={(text) => {
                                      const { minutes: currentMinutes } = parseLayoverDuration(editingFlight.layoverDuration);
                                      setEditingFlight((prev) =>
                                        prev ? { ...prev, layoverDuration: `${text}h ${currentMinutes || '0'}m` } : prev
                                      );
                                    }}
                                  />
                                  <TextInput
                                    style={[styles.input, { flex: 1 }]}
                                    keyboardType="numeric"
                                    placeholder="Minutes"
                                    value={minutes}
                                    onChangeText={(text) => {
                                      const { hours: currentHours } = parseLayoverDuration(editingFlight.layoverDuration);
                                      setEditingFlight((prev) =>
                                        prev ? { ...prev, layoverDuration: `${currentHours || '0'}h ${text}m` } : prev
                                      );
                                    }}
                                  />
                                </>
                              );
                            })()}
                          </View>
                        </View>
                      </View>
                      <Text style={styles.modalLabel}>Flight</Text>
                      <View style={styles.modalRow}>
                        <View style={styles.modalField}>
                          <Text style={styles.modalLabelSmall}>Carrier</Text>
                          <TextInput
                            style={styles.input}
                            value={editingFlight.carrier}
                            onChangeText={(text) => setEditingFlight((prev) => (prev ? { ...prev, carrier: text } : prev))}
                          />
                        </View>
                        <View style={styles.modalField}>
                          <Text style={styles.modalLabelSmall}>Flight #</Text>
                          <TextInput
                            style={styles.input}
                            value={editingFlight.flightNumber}
                            onChangeText={(text) => setEditingFlight((prev) => (prev ? { ...prev, flightNumber: text } : prev))}
                          />
                        </View>
                        <View style={styles.modalField}>
                          <Text style={styles.modalLabelSmall}>Booking Ref</Text>
                          <TextInput
                            style={styles.input}
                            value={editingFlight.bookingReference}
                            onChangeText={(text) => setEditingFlight((prev) => (prev ? { ...prev, bookingReference: text.toUpperCase() } : prev))}
                          />
                        </View>
                      </View>
                      <Text style={styles.modalLabel}>Paid by</Text>
                      <View style={[styles.input, styles.payerBox]}>
                        <View style={styles.payerChips}>
                          {editingFlight.paidBy.map((id) => (
                            <View key={id} style={styles.payerChip}>
                              <Text style={styles.cellText}>{payerName(id)}</Text>
                              <TouchableOpacity
                                onPress={() =>
                                  setEditingFlight((p) =>
                                    p
                                      ? {
                                          ...p,
                                          paidBy: p.paidBy.filter((x) => x !== id),
                                          cost: String(Number(p.cost) || 0),
                                        }
                                      : p
                                  )
                                }
                              >
                                <Text style={styles.removeText}>×</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>
                        <View style={styles.payerOptions}>
                          {userMembers
                            .filter((m) => !editingFlight.paidBy.includes(m.id))
                            .map((m) => (
                              <TouchableOpacity
                                key={m.id}
                                style={styles.smallButton}
                                onPress={() => setEditingFlight((p) => (p ? { ...p, paidBy: [...p.paidBy, m.id] } : p))}
                              >
                                <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                              </TouchableOpacity>
                            ))}
                        </View>
                      </View>
                      <Text style={styles.modalLabel}>Cost</Text>
                      <TextInput
                        style={styles.input}
                        value={editingFlight.cost}
                        keyboardType="numeric"
                        onChangeText={(text) => setEditingFlight((prev) => (prev ? { ...prev, cost: text } : prev))}
                      />
                    </ScrollView>
                    <View style={styles.row}>
                      <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={closeFlightDetails}>
                        <Text style={styles.buttonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.button} onPress={saveFlightDetails}>
                        <Text style={styles.buttonText}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {activePage === 'trips' ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Trips</Text>
              <View style={styles.addRow}>
                <TextInput
                  placeholder="Trip name"
                  style={[styles.input, styles.inlineInput]}
                  value={newTripName}
                  onChangeText={setNewTripName}
                />
                <View style={[styles.input, styles.inlineInput, styles.dropdown]}>
                  <TouchableOpacity onPress={() => setShowTripGroupDropdown((s) => !s)}>
                    <Text style={styles.cellText}>
                      {newTripGroupId
                        ? groups.find((g) => g.id === newTripGroupId)?.name ?? 'Select group'
                        : 'Select group'}
                    </Text>
                  </TouchableOpacity>
                  {showTripGroupDropdown && (
                    <View style={styles.dropdownList}>
                      {groups.map((g) => (
                        <TouchableOpacity
                          key={g.id}
                          style={styles.dropdownOption}
                          onPress={() => {
                            setNewTripGroupId(g.id);
                            setShowTripGroupDropdown(false);
                          }}
                        >
                          <Text style={styles.cellText}>{g.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
                <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={createTrip}>
                  <Text style={styles.buttonText}>Create</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.helperText}>Choose a group to associate this trip.</Text>
              <View style={{ marginTop: 12 }}>
                {trips.map((trip) => (
                  <View key={trip.id} style={styles.groupRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.flightTitle}>{trip.name}</Text>
                      <Text style={styles.helperText}>Created: {formatDateLong(trip.createdAt)}</Text>
                    </View>
                    <View style={[styles.input, styles.inlineInput, styles.dropdown, { maxWidth: 200 }]}>
                      <TouchableOpacity onPress={() => setTripDropdownOpenId((prev) => (prev === trip.id ? null : trip.id))}>
                        <Text style={styles.cellText}>{trip.groupName}</Text>
                      </TouchableOpacity>
                      {tripDropdownOpenId === trip.id && (
                        <View style={styles.dropdownList}>
                          {groups.map((g) => (
                            <TouchableOpacity
                              key={g.id}
                              style={styles.dropdownOption}
                              onPress={() => changeTripGroup(trip.id, g.id)}
                            >
                              <Text style={styles.cellText}>{g.name}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                    <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={() => deleteTrip(trip.id)}>
                      <Text style={styles.buttonText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      ) : (
        <View style={styles.auth}>
          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggleButton, authMode === 'login' && styles.toggleActive]}
              onPress={() => setAuthMode('login')}
            >
              <Text style={styles.toggleText}>Login</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleButton, authMode === 'register' && styles.toggleActive]}
              onPress={() => setAuthMode('register')}
            >
              <Text style={styles.toggleText}>Create</Text>
            </TouchableOpacity>
          </View>

          {authMode === 'register' ? (
            <>
              <TextInput
                style={styles.input}
                placeholder="First name"
                value={authForm.firstName}
                onChangeText={(text) => setAuthForm((p) => ({ ...p, firstName: text }))}
              />
              <TextInput
                style={styles.input}
                placeholder="Last name"
                value={authForm.lastName}
                onChangeText={(text) => setAuthForm((p) => ({ ...p, lastName: text }))}
              />
            </>
          ) : null}

          <TextInput
            style={styles.input}
            placeholder="Email"
            autoCapitalize="none"
            value={authForm.email}
            onChangeText={(text) => setAuthForm((p) => ({ ...p, email: text }))}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            secureTextEntry
            value={authForm.password}
            onChangeText={(text) => setAuthForm((p) => ({ ...p, password: text }))}
          />
          <TouchableOpacity
            style={styles.button}
            onPress={authMode === 'login' ? loginWithPassword : register}
          >
            <Text style={styles.buttonText}>{authMode === 'login' ? 'Login' : 'Create account'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f7f7f7',
  },
  contentScroll: {
    flex: 1,
  },
  contentScrollContent: {
    paddingBottom: 120,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    position: 'relative',
    zIndex: 1500,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topRightWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  auth: {
    gap: 8,
  },
  input: {
    padding: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    marginVertical: 6,
    backgroundColor: '#fff',
  },
  card: {
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  successCard: {
    padding: 12,
    backgroundColor: '#e0f2fe',
    borderRadius: 8,
    marginBottom: 12,
    borderColor: '#bfdbfe',
    borderWidth: 1,
  },
  divider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 12,
  },
  accountSection: {
    gap: 6,
  },
  button: {
    backgroundColor: '#0d6efd',
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginVertical: 6,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  sectionTitle: {
    fontWeight: '700',
    fontSize: 18,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  groupRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
  },
  traitRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
  },
  groupColumn: {
    gap: 6,
  },
  shareRow: {
    marginTop: 12,
    gap: 6,
  },
  toggleRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  toggleButton: {
    flex: 1,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ccc',
  },
  toggleActive: {
    backgroundColor: '#0d6efd',
    borderColor: '#0d6efd',
  },
  toggleText: {
    color: '#0f172a',
    fontWeight: '600',
  },
  bodyText: {
    fontSize: 14,
  },
  table: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    overflow: 'visible',
    minWidth: 900,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'visible',
  },
  tableHeader: {
    backgroundColor: '#f1f5f9',
  },
  cell: {
    padding: 10,
    minWidth: 120,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
    justifyContent: 'center',
  },
  lastCell: {
    borderRightWidth: 0,
  },
  cellText: {
    color: '#111827',
  },
  headerText: {
    fontWeight: '700',
    color: '#0f172a',
  },
  flightTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  actionCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputRow: {
    backgroundColor: '#f8fafc',
  },
  cellInput: {
    padding: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  tableFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  formGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  totalRow: {
    marginTop: 8,
  },
  summaryRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryOverall: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
    marginTop: 12,
  },
  summaryBreakdown: {
    marginTop: 6,
    gap: 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  payerBox: {
    display: 'flex',
    gap: 6,
  },
  payerChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  payerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#e5e7eb',
    borderRadius: 12,
  },
  payerOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  smallButton: {
    backgroundColor: '#0d6efd',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  dangerButton: {
    backgroundColor: '#dc2626',
  },
  helperText: {
    color: '#6b7280',
    fontSize: 12,
  },
  parsedList: {
    marginTop: 4,
    gap: 2,
  },
  pdfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  hiddenInput: {
    display: 'none',
  },
  disabledButton: {
    backgroundColor: '#94a3b8',
  },
  shareInput: {
    flex: 1,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  flightsSection: {
    position: 'relative',
    zIndex: 2500,
  },
  traitsSection: {
    position: 'relative',
  },
  itinerarySection: {
    position: 'relative',
  },
  navRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  memberPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  pendingBlock: {
    gap: 4,
    marginBottom: 4,
  },
  removeText: {
    color: '#dc2626',
    fontWeight: '600',
  },
  linkText: {
    color: '#0d6efd',
    textDecorationLine: 'underline',
  },
  lodgingNameCol: {
    minWidth: 180,
  },
  lodgingDateCol: {
    minWidth: 130,
  },
  lodgingRoomsCol: {
    minWidth: 80,
  },
  lodgingRefundCol: {
    minWidth: 150,
  },
  lodgingCostCol: {
    minWidth: 120,
  },
  lodgingPayerCol: {
    minWidth: 150,
  },
  lodgingAddressCol: {
    minWidth: 240,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inlineInput: {
    flex: 1,
    marginVertical: 0,
  },
  dropdown: {
    position: 'relative',
  },
  dropdownList: {
    position: 'absolute',
    top: 40,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    zIndex: 11000,
    elevation: 18,
  },
  dropdownOption: {
    padding: 10,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  activeTrip: {
    minWidth: 180,
    position: 'relative',
    zIndex: 2000,
  },
  warningText: {
    color: '#dc2626',
    fontWeight: '600',
  },
  passengerDropdown: {
    zIndex: 3000,
    position: 'relative',
  },
  passengerDropdownList: {
    zIndex: 5000,
    elevation: 12,
  },
  passengerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 12000,
    elevation: 28,
  },
  passengerOverlayBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  passengerOverlayList: {
    position: 'absolute',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    zIndex: 13000,
    elevation: 32,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 40,
    maxHeight: 520,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  modalLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 8,
  },
  modalLabelSmall: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  modalRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  modalField: {
    flex: 1,
    position: 'relative',
  },
  inlineDropdownList: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    zIndex: 14000,
    elevation: 30, // keep above other inputs on native
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  locationField: {
    position: 'relative',
  },
  tableScroll: {
    overflow: 'visible',
  },
  tableScrollContent: {
    overflow: 'visible',
  },
  traitNoteInput: {
    minHeight: 60,
  },
  rangeContainer: {
    gap: 6,
    marginBottom: 8,
  },
  rangeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  itinerarySummary: {
    marginTop: 8,
    gap: 4,
  },
  planBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
  },
  itineraryDropdown: {
    zIndex: 6000,
  },
  traitGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  traitChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  traitChipSelected: {
    backgroundColor: '#0d6efd',
    borderColor: '#0d6efd',
  },
  traitChipText: {
    color: '#0f172a',
    fontWeight: '600',
  },
  traitChipTextSelected: {
    color: '#fff',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    zIndex: 20000,
  },
  confirmModal: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 10,
    width: '100%',
    maxWidth: 420,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
});

export default App;
