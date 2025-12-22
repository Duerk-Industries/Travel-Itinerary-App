import React, { useEffect, useMemo, useRef, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Linking, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import { formatDateLong } from './utils/formatDateLong';
import { parseFlightText, type ParsedFlight } from './utils/flightParser';

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

type Page = 'menu' | 'flights' | 'lodging' | 'groups' | 'trips' | 'traits' | 'itinerary';

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
};

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
});

const createInitialLodgingState = (): LodgingDraft => ({
  name: '',
  checkInDate: new Date().toISOString().slice(0, 10),
  checkOutDate: new Date().toISOString().slice(0, 10),
  rooms: '1',
  refundBy: '',
  totalCost: '',
  costPerNight: '',
  address: '',
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

const loadSession = (): { token: string; name: string; page?: string } | null => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(sessionKey);
    if (!raw) return null;
    const data = JSON.parse(raw) as { token: string; name: string; expiresAt: number; page?: string };
    if (!data?.token || !data?.name || !data?.expiresAt) return null;
    if (Date.now() > data.expiresAt) {
      window.localStorage.removeItem(sessionKey);
      return null;
    }
    return { token: data.token, name: data.name, page: data.page };
  } catch {
    return null;
  }
};

const saveSession = (token: string, name: string, page?: string) => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const payload = {
    token,
    name,
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
  const [showActiveTripDropdown, setShowActiveTripDropdown] = useState(false);
  const [groupMembers, setGroupMembers] = useState<GroupMemberOption[]>([]);
  const [passengerSuggestions, setPassengerSuggestions] = useState<GroupMemberOption[]>([]);
  const [showPassengerSuggestions, setShowPassengerSuggestions] = useState(false);
  const [editingFlightId, setEditingFlightId] = useState<string | null>(null);
  const [editingFlight, setEditingFlight] = useState<FlightEditDraft | null>(null);
  const [lodgings, setLodgings] = useState<Lodging[]>([]);
  const [lodgingDraft, setLodgingDraft] = useState<LodgingDraft>(createInitialLodgingState());
  const [lodgingDateField, setLodgingDateField] = useState<'checkIn' | 'checkOut' | 'refund' | null>(null);
  const [lodgingDateValue, setLodgingDateValue] = useState<Date>(new Date());
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
  const [activePage, setActivePage] = useState<Page>('menu');
  const [itineraryCountry, setItineraryCountry] = useState('');
  const [itineraryDays, setItineraryDays] = useState('5');
  const [budgetMin, setBudgetMin] = useState(500);
  const [budgetMax, setBudgetMax] = useState(2500);
  const [itineraryPlan, setItineraryPlan] = useState('');
  const [itineraryLoading, setItineraryLoading] = useState(false);
  const [itineraryError, setItineraryError] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });
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
    if (member.firstName || member.lastName) {
      return `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim();
    }
    if (member.guestName) return member.guestName;
    if (member.email) return member.email;
    return 'Member';
  };

  const filterPassengers = (query: string): GroupMemberOption[] => {
    const q = query.trim().toLowerCase();
    if (!q) return groupMembers;
    return groupMembers.filter((m) => formatMemberName(m).toLowerCase().includes(q));
  };

  const normalizeDateString = (value: string): string => {
    if (!value) return value;
    if (value.includes('-') && value.length === 10) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10);
  };

  const calculateNights = (checkIn: string, checkOut: string): number => {
    const start = new Date(checkIn).getTime();
    const end = new Date(checkOut).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
    return Math.round((end - start) / (1000 * 60 * 60 * 24));
  };

  const lodgingTotal = useMemo(
    () => lodgings.reduce((sum, l) => sum + (Number(l.totalCost) || 0), 0),
    [lodgings]
  );

  const openMaps = (address: string) => {
    if (!address) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  useEffect(() => {
    const nights = calculateNights(lodgingDraft.checkInDate, lodgingDraft.checkOutDate);
    const totalNum = Number(lodgingDraft.totalCost) || 0;
    const computed = nights > 0 && totalNum ? (totalNum / nights).toFixed(2) : '';
    setLodgingDraft((prev) => ({ ...prev, costPerNight: computed }));
  }, [lodgingDraft.checkInDate, lodgingDraft.checkOutDate, lodgingDraft.totalCost]);

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
    // While the user is actively typing in this input, show the raw text.
    if (currentTarget === activeTarget) {
      return rawValue;
    }
    return formatLocationDisplay(rawValue);
  };

  // Parsing handled in utils/flightParser.parseFlightText.

  const mergeParsedFlight = (current: FlightEditDraft, parsed: Partial<FlightEditDraft>): FlightEditDraft => {
    const next = { ...current };
    (Object.entries(parsed) as [keyof FlightEditDraft, string][]).forEach(([key, value]) => {
      if (value && (!current[key] || current[key].trim().length === 0)) {
        next[key] = value;
      }
    });
    return next;
  };

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

  const addLodging = async () => {
    if (!lodgingDraft.name.trim() || !activeTripId) {
      alert('Please enter a lodging name and select an active trip.');
      return;
    }
    const nights = calculateNights(lodgingDraft.checkInDate, lodgingDraft.checkOutDate);
    if (nights <= 0) {
      alert('Check-out must be after check-in.');
      return;
    }
    const totalNum = Number(lodgingDraft.totalCost) || 0;
    const rooms = Number(lodgingDraft.rooms) || 1;
    const costPerNight = totalNum && rooms > 0 ? (totalNum / (nights * rooms)).toFixed(2) : '0';
    const res = await fetch(`${backendUrl}/api/lodgings`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        ...lodgingDraft,
        tripId: activeTripId,
        rooms,
        costPerNight,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to save lodging');
      return;
    }
    setLodgingDraft(createInitialLodgingState());
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
    setEditingFlight({
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
    });
    setShowPassengerSuggestions(false);
    setPassengerSuggestions([]);
  };

  const closeFlightDetails = () => {
    setEditingFlightId(null);
    setEditingFlight(null);
    setShowPassengerSuggestions(false);
    setPassengerSuggestions([]);
  };

  const saveFlightDetails = async () => {
    if (!userToken || !editingFlightId || !editingFlight) return;
    const required = [
      editingFlight.passengerName,
      editingFlight.departureDate,
      editingFlight.departureTime,
      editingFlight.arrivalTime,
      editingFlight.carrier,
      editingFlight.flightNumber,
      editingFlight.bookingReference,
    ];
    if (required.some((val) => !val || !val.trim())) {
      alert('Please fill out all required fields before saving.');
      return;
    }
    if (editingFlightId === 'new' && !activeTripId) {
      alert('Select an active trip before adding a flight.');
      return;
    }
    const payload = {
      ...editingFlight,
      cost: Number(editingFlight.cost) || 0,
    };
    let res: Response;
    if (editingFlightId === 'new') {
      res = await fetch(`${backendUrl}/api/flights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          ...payload,
          tripId: activeTripId,
          departureDate: editingFlight.departureDate,
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
      alert(data.error || (editingFlightId === 'new' ? 'Unable to save flight' : 'Unable to update flight'));
      return;
    }
    closeFlightDetails();
    fetchFlights();
  };

  const isCreatingFlight = editingFlightId === 'new';
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
    setFlights([]);
    setInvites([]);
    setGroups([]);
    setTraits([]);
    setTraitDrafts({});
    setNewTraitName('');
    setNewTraitLevel('3');
    setNewTraitNotes('');
    setItineraryCountry('');
    setItineraryDays('5');
    setBudgetMin(500);
    setBudgetMax(2500);
    setItineraryPlan('');
    setItineraryError('');
    setItineraryLoading(false);
    setGroupMembers([]);
    setActivePage('menu');
    clearSession();
  };

  const loginWithPassword = async () => {
    const res = await fetch(`${backendUrl}/api/web-auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: authForm.email.trim(), password: authForm.password }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Login failed');
      return;
    }
    const name = `${data.user.firstName} ${data.user.lastName}`;
    setUserToken(data.token);
    setUserName(name);
    saveSession(data.token, name, 'menu');
    fetchFlights(data.token);
    fetchLodgings(data.token);
    fetchInvites(data.token);
    setActivePage('menu');
  };

  const register = async () => {
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
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Registration failed');
      return;
    }
    const name = `${data.user.firstName} ${data.user.lastName}`;
    setUserToken(data.token);
    setUserName(name);
    saveSession(data.token, name, 'menu');
    fetchFlights(data.token);
    fetchLodgings(data.token);
    fetchInvites(data.token);
    setActivePage('menu');
  };

  const fetchFlights = async (token?: string) => {
    if (!activeTripId) {
      setFlights([]);
      return;
    }
    const res = await fetch(`${backendUrl}/api/flights?tripId=${activeTripId}`, { headers: { Authorization: `Bearer ${token ?? userToken}` } });
    const data = await res.json();
    setFlights(data);
  };

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

  const clampBudget = (val: number) => {
    if (!Number.isFinite(val)) return 0;
    return Math.min(Math.max(Math.round(val), 0), 20000);
  };

  const syncTraitDrafts = (data: Trait[]) => {
    setTraitDrafts((prev) => {
      const next: Record<string, { level: string; notes: string }> = {};
      data.forEach((trait) => {
        next[trait.id] = prev[trait.id] ?? { level: String(trait.level ?? 1), notes: trait.notes ?? '' };
      });
      return next;
    });
  };

  const fetchTraits = async () => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/traits`, { headers: { Authorization: `Bearer ${userToken}` } });
    if (!res.ok) return;
    const data = (await res.json()) as Trait[];
    setTraits(data);
    syncTraitDrafts(data);
  };

  const createTrait = async () => {
    if (!userToken) return;
    const name = newTraitName.trim();
    if (!name) {
      alert('Enter a trait name (e.g., Adventurous)');
      return;
    }
    const level = clampTraitLevelInput(newTraitLevel);
    const res = await fetch(`${backendUrl}/api/traits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ name, level, notes: newTraitNotes.trim() || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to save trait');
      return;
    }
    setNewTraitName('');
    setNewTraitNotes('');
    setNewTraitLevel('3');
    fetchTraits();
  };

  const updateTrait = async (traitId: string) => {
    if (!userToken) return;
    const draft = traitDrafts[traitId] ?? { level: '1', notes: '' };
    const level = clampTraitLevelInput(draft.level);
    const res = await fetch(`${backendUrl}/api/traits/${traitId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ level, notes: draft.notes }),
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
    const res = await fetch(`${backendUrl}/api/traits/${traitId}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to delete trait');
      return;
    }
    fetchTraits();
  };

  const generateItinerary = async () => {
    if (!userToken) return;
    const country = itineraryCountry.trim();
    const days = itineraryDays.trim();
    if (!country || !days) {
      alert('Enter a country and number of days');
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
    } catch (err) {
      setItineraryError((err as Error).message);
    } finally {
      setItineraryLoading(false);
    }
  };

  const fetchInvites = async (token?: string) => {
    const res = await fetch(`${backendUrl}/api/groups/invites`, { headers: { Authorization: `Bearer ${token ?? userToken}` } });
    if (!res.ok) return;
    const data = await res.json();
    setInvites(data);
  };

  const fetchGroupMembersForActiveTrip = async () => {
    if (!activeTripId || !userToken) {
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

  const removeFlight = async (id: string) => {
    if (!userToken) return;
    await fetch(`${backendUrl}/api/flights/${id}`, { method: 'DELETE', headers });
    fetchFlights();
  };

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
      fetchFlights();
      fetchLodgings();
      fetchInvites();
      fetchGroups();
      fetchTrips();
      fetchTraits();
    }
  }, [userToken]);

  useEffect(() => {
    if (userToken) return;
    const session = loadSession();
    if (session) {
      setUserToken(session.token);
      setUserName(session.name);
      const sessionPage = session.page;
      if (sessionPage === 'flights' || sessionPage === 'lodging' || sessionPage === 'groups' || sessionPage === 'trips' || sessionPage === 'traits' || sessionPage === 'itinerary') {
        setActivePage(sessionPage as Page);
      } else {
        setActivePage('menu');
      }
    }
  }, [userToken]);

  useEffect(() => {
    if (!userToken) return;
    saveSession(userToken, userName ?? 'Traveler', activePage);
  }, [userToken, userName, activePage]);

  useEffect(() => {
    if (userToken) {
      fetchFlights();
      fetchLodgings();
    }
  }, [activeTripId]);

  useEffect(() => {
    if (!userToken) {
      setGroupMembers([]);
      return;
    }
    fetchGroupMembersForActiveTrip();
  }, [userToken, activeTripId, trips]);

  useEffect(() => {
    if (!showPassengerSuggestions || !editingFlight) return;
    setPassengerSuggestions(filterPassengers(editingFlight.passengerName));
  }, [groupMembers, showPassengerSuggestions, editingFlight]);

  const handleAddPress = () => {
    if (!activeTripId) {
      alert('Select an active trip before adding a flight.');
      return;
    }
    setEditingFlightId('new');
    setEditingFlight(createInitialFlightState());
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
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Choose a section</Text>
            <View style={styles.navRow}>
              <TouchableOpacity style={[styles.button, activePage === 'flights' && styles.toggleActive]} onPress={() => setActivePage('flights')}>
                <Text style={styles.buttonText}>Flights</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, activePage === 'lodging' && styles.toggleActive]} onPress={() => setActivePage('lodging')}>
                <Text style={styles.buttonText}>Lodging</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, activePage === 'groups' && styles.toggleActive]} onPress={() => setActivePage('groups')}>
                <Text style={styles.buttonText}>Groups</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, activePage === 'trips' && styles.toggleActive]} onPress={() => setActivePage('trips')}>
                <Text style={styles.buttonText}>Trips</Text>
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

              <TextInput
                style={styles.input}
                placeholder="How many days will your vacation be?"
                keyboardType="numeric"
                value={itineraryDays}
                onChangeText={(text) => setItineraryDays(text.replace(/[^0-9]/g, ''))}
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
            <Text style={styles.helperText}>
              Traits will help recommend activities (e.g., hikes for Adventurous, cafes for Coffee Lovers).
            </Text>
          </View>

          <TouchableOpacity style={styles.button} onPress={generateItinerary} disabled={itineraryLoading}>
            <Text style={styles.buttonText}>{itineraryLoading ? 'Generating…' : 'Generate Itinerary'}</Text>
          </TouchableOpacity>

          {itineraryError ? <Text style={styles.warningText}>{itineraryError}</Text> : null}
          {itineraryPlan ? (
            <View style={styles.planBox}>
              <Text style={styles.sectionTitle}>Suggested Plan</Text>
              <Text style={styles.bodyText}>{itineraryPlan}</Text>
            </View>
          ) : null}
        </View>
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
            </>
          ) : null}

          {activePage === 'lodging' ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Lodging</Text>
              {Platform.OS !== 'web' && lodgingDateField ? (
                <DateTimePicker
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
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={addLodging}>
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
                </View>
              </ScrollView>
              <View style={styles.tableFooter}>
                <TouchableOpacity style={styles.button} onPress={handleAddPress}>
                  <Text style={styles.buttonText}>Add</Text>
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
                    <Text style={styles.sectionTitle}>{isCreatingFlight ? 'Add Flight' : 'Flight Details'}</Text>
                    <Text style={styles.helperText}>
                      {isCreatingFlight
                        ? 'Fill out the flight details, then tap Add.'
                        : `Current Departure: ${formatDateLong(editingFlight.departureDate)} at ${editingFlight.departureTime || 'Time not set'}`}
                    </Text>
                    <ScrollView style={{ maxHeight: 420 }}>
                      <Text style={styles.modalLabel}>Passenger</Text>
                      <TextInput
                        style={styles.input}
                        value={editingFlight.passengerName}
                        onFocus={() => {
                          setShowPassengerSuggestions(true);
                          setPassengerSuggestions(filterPassengers(editingFlight.passengerName));
                        }}
                        onChangeText={(text) => {
                          setEditingFlight((prev) => (prev ? { ...prev, passengerName: text } : prev));
                          setShowPassengerSuggestions(true);
                          setPassengerSuggestions(filterPassengers(text));
                        }}
                      />
                      {showPassengerSuggestions && passengerSuggestions.length ? (
                        <View style={styles.inlineDropdownList}>
                          {passengerSuggestions.map((member) => {
                            const name = formatMemberName(member);
                            return (
                              <TouchableOpacity
                                key={member.id}
                                style={styles.dropdownOption}
                                onPress={() => {
                                  setEditingFlight((prev) => (prev ? { ...prev, passengerName: name } : prev));
                                  setShowPassengerSuggestions(false);
                                }}
                              >
                                <Text style={styles.cellText}>{name}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ) : null}
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
                        <Text style={styles.buttonText}>{isCreatingFlight ? 'Add Flight' : 'Save'}</Text>
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
        </>
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
});

export default App;
