import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import { formatDateLong } from './utils/formatDateLong';

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

type Page = 'menu' | 'flights' | 'groups' | 'trips' | 'traits' | 'itinerary';

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
  const [showActiveTripDropdown, setShowActiveTripDropdown] = useState(false);
  const [groupMembers, setGroupMembers] = useState<GroupMemberOption[]>([]);
  const [showPassengerDropdown, setShowPassengerDropdown] = useState(false);
  const [passengerAnchor, setPassengerAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [editingFlightId, setEditingFlightId] = useState<string | null>(null);
  const [editingFlight, setEditingFlight] = useState<FlightEditDraft | null>(null);
  const [airports, setAirports] = useState<Airport[]>([]);
  const [airportSuggestions, setAirportSuggestions] = useState<Airport[]>([]);
  const [airportAnchor, setAirportAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [airportTarget, setAirportTarget] = useState<'dep' | 'arr' | 'modal-dep' | 'modal-arr' | null>(null);
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([]);
  const [locationTarget, setLocationTarget] = useState<'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover' | null>(null);
  const [traits, setTraits] = useState<Trait[]>([]);
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
  const [itineraryLoading, setItineraryLoading] = useState(false);
  const [itineraryError, setItineraryError] = useState('');
  const [itineraryRecords, setItineraryRecords] = useState<ItineraryRecord[]>([]);
  const [itineraryDetails, setItineraryDetails] = useState<Record<string, ItineraryDetailRecord[]>>({});
  const [selectedItineraryId, setSelectedItineraryId] = useState<string | null>(null);
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
  const [isAddingRow, setIsAddingRow] = useState(false);
  const passengerDropdownRef = useRef<TouchableOpacity | null>(null);
  const depLocationRef = useRef<TextInput | null>(null);
  const arrLocationRef = useRef<TextInput | null>(null);
  const modalDepLocationRef = useRef<TextInput | null>(null);
  const modalArrLocationRef = useRef<TextInput | null>(null);

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

  const normalizeDateString = (value: string): string => {
    if (!value) return value;
    if (value.includes('-') && value.length === 10) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString().slice(0, 10);
  };

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
    const label = formatAirportLabel(airport);
    const code = airport.iata_code ?? '';
    if (target === 'dep') {
      setNewFlight((prev) => ({ ...prev, departureLocation: code, departureAirportCode: code }));
    } else if (target === 'arr') {
      setNewFlight((prev) => ({ ...prev, arrivalLocation: code, arrivalAirportCode: code }));
    } else if (target === 'modal-dep' && editingFlight) {
      setEditingFlight((prev) => (prev ? { ...prev, departureLocation: code, departureAirportCode: code } : prev));
    } else if (target === 'modal-arr' && editingFlight) {
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
  };

  const closeFlightDetails = () => {
    setEditingFlightId(null);
    setEditingFlight(null);
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
    const res = await fetch(`${backendUrl}/api/flights/${editingFlightId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        ...editingFlight,
        cost: Number(editingFlight.cost) || 0,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to update flight');
      return;
    }
    closeFlightDetails();
    fetchFlights();
  };

  const headers = useMemo(() => (userToken ? { Authorization: `Bearer ${userToken}` } : {}), [userToken]);
  const logout = () => {
    setUserToken(null);
    setUserName(null);
    setFlights([]);
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
      setUserToken(data.token);
      setUserName(name);
      saveSession(data.token, name, 'menu');
      fetchFlights(data.token);
      fetchInvites(data.token);
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
      setUserToken(data.token);
      setUserName(name);
      saveSession(data.token, name, 'menu');
      fetchFlights(data.token);
      fetchInvites(data.token);
      setActivePage('menu');
    } catch (err) {
      alert((err as Error).message || 'Registration failed');
    }
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
    // Avoid saving duplicates: check existing by destination+days+budget+trip
    const res = await fetch(`${backendUrl}/api/itineraries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        tripId: activeTripId,
        destination: itineraryCountry.trim(),
        days: Number(itineraryDays),
        budget: budgetMax, // store upper budget bound
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to save itinerary');
      return;
    }
    fetchItineraries();
  };

  const addDetail = async () => {
    if (!userToken || !selectedItineraryId) {
      alert('Select an itinerary to add details');
      return;
    }
    if (!detailDraft.activity.trim()) {
      alert('Enter an activity');
      return;
    }
    const res = await fetch(`${backendUrl}/api/itineraries/${selectedItineraryId}/details`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        day: Number(detailDraft.day || '1'),
        time: detailDraft.time || null,
        activity: detailDraft.activity.trim(),
        cost: detailDraft.cost ? Number(detailDraft.cost) : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to add detail');
      return;
    }
    setDetailDraft({ day: '1', time: '', activity: '', cost: '' });
    fetchItineraryDetails(selectedItineraryId);
  };

  const saveGeneratedItinerary = async (plan: string) => {
    if (!activeTripId) {
      setItineraryError('Select an active trip before saving the itinerary.');
      return;
    }
    const createRes = await fetch(`${backendUrl}/api/itineraries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        tripId: activeTripId,
        destination: itineraryCountry.trim() || 'Unknown',
        days: Number(itineraryDays || '1'),
        budget: budgetMax,
      }),
    });
    const created = await createRes.json().catch(() => ({}));
    if (!createRes.ok) {
      setItineraryError(created.error || 'Unable to save itinerary');
      return;
    }
    const itineraryId = created.id as string;
    setSelectedItineraryId(itineraryId);
    fetchItineraries();
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

  const addFlight = async () => {
    if (!userToken) return false;
    if (!activeTripId) {
      alert('Select an active trip before adding a flight.');
      return false;
    }

    const required = [
      newFlight.passengerName,
      newFlight.departureDate,
      newFlight.departureTime,
      newFlight.arrivalTime,
      newFlight.carrier,
      newFlight.flightNumber,
      newFlight.bookingReference,
    ];

    if (required.some((val) => !val || !val.trim())) {
      alert('Please fill out all required fields before adding a flight.');
      return false;
    }

    const res = await fetch(`${backendUrl}/api/flights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        ...newFlight,
        tripId: activeTripId,
        departureDate: newFlight.departureDate,
        cost: Number(newFlight.cost) || 0,
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
      const sessionPage = session.page;
      if (sessionPage === 'flights' || sessionPage === 'groups' || sessionPage === 'trips' || sessionPage === 'traits' || sessionPage === 'itinerary') {
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
    }
  }, [activeTripId]);

  useEffect(() => {
    if (userToken) {
      fetchGroupMembersForActiveTrip();
    }
  }, [userToken, activeTripId, trips]);

  const handleAddPress = async () => {
    if (isAddingRow) {
      const saved = await addFlight();
      if (saved) setIsAddingRow(false);
    } else {
      setNewFlight(createInitialFlightState());
      setIsAddingRow(true);
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
        <ScrollView style={styles.contentScroll} contentContainerStyle={styles.contentScrollContent}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Choose a section</Text>
            <View style={styles.navRow}>
              <TouchableOpacity style={[styles.button, activePage === 'flights' && styles.toggleActive]} onPress={() => setActivePage('flights')}>
                <Text style={styles.buttonText}>Flights</Text>
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
                <Text style={styles.buttonText}>Save Itinerary Info</Text>
              </TouchableOpacity>

              {itineraryError ? <Text style={styles.warningText}>{itineraryError}</Text> : null}
              {itineraryPlan ? (
                <View style={styles.planBox}>
                  <Text style={styles.sectionTitle}>Suggested Plan</Text>
                  <Text style={styles.bodyText}>{itineraryPlan}</Text>
                </View>
              ) : null}

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Saved Itineraries</Text>
                {!itineraryRecords.length ? (
                  <Text style={styles.helperText}>No itineraries saved yet.</Text>
                ) : (
                  <View style={styles.table}>
                    <View style={[styles.tableRow, styles.tableHeader]}>
                      {['Destination', 'Trip Name', 'Days', 'Budget'].map((h) => (
                        <View key={h} style={[styles.cell, { flex: 1 }]}>
                          <Text style={styles.headerText}>{h}</Text>
                        </View>
                      ))}
                    </View>
                    {itineraryRecords.map((it) => (
                      <TouchableOpacity
                        key={it.id}
                        style={styles.tableRow}
                        onPress={() => {
                          setSelectedItineraryId(it.id);
                          fetchItineraryDetails(it.id);
                        }}
                      >
                        <View style={[styles.cell, { flex: 1 }]}>
                          <Text style={styles.cellText}>{it.destination}</Text>
                        </View>
                        <View style={[styles.cell, { flex: 1 }]}>
                          <Text style={styles.cellText}>{it.tripName}</Text>
                        </View>
                        <View style={[styles.cell, { flex: 1 }]}>
                          <Text style={styles.cellText}>{it.days}</Text>
                        </View>
                        <View style={[styles.cell, { flex: 1 }]}>
                          <Text style={styles.cellText}>{it.budget != null ? `$${it.budget}` : '—'}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {selectedItineraryId ? (
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Itinerary Details</Text>
                  <View style={styles.row}>
                    <TextInput
                      style={[styles.input, styles.inlineInput]}
                      placeholder="Day"
                      keyboardType="numeric"
                      value={detailDraft.day}
                      onChangeText={(text) => setDetailDraft((d) => ({ ...d, day: text }))}
                    />
                    <TextInput
                      style={[styles.input, styles.inlineInput]}
                      placeholder="Time"
                      value={detailDraft.time}
                      onChangeText={(text) => setDetailDraft((d) => ({ ...d, time: text }))}
                    />
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Activity"
                    value={detailDraft.activity}
                    onChangeText={(text) => setDetailDraft((d) => ({ ...d, activity: text }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Cost"
                    keyboardType="numeric"
                    value={detailDraft.cost}
                    onChangeText={(text) => setDetailDraft((d) => ({ ...d, cost: text }))}
                  />
                  <TouchableOpacity style={styles.button} onPress={addDetail}>
                    <Text style={styles.buttonText}>Add Detail</Text>
                  </TouchableOpacity>

                  <View style={styles.table}>
                    <View style={[styles.tableRow, styles.tableHeader]}>
                      {['Day', 'Time', 'Activity', 'Cost'].map((h) => (
                        <View key={h} style={[styles.cell, { flex: 1 }]}>
                          <Text style={styles.headerText}>{h}</Text>
                        </View>
                      ))}
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
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {selectedItineraryId ? (
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Itinerary Details</Text>
                  <View style={styles.row}>
                    <TextInput
                      style={[styles.input, styles.inlineInput]}
                      placeholder="Day"
                      keyboardType="numeric"
                      value={detailDraft.day}
                      onChangeText={(text) => setDetailDraft((d) => ({ ...d, day: text }))}
                    />
                    <TextInput
                      style={[styles.input, styles.inlineInput]}
                      placeholder="Time"
                      value={detailDraft.time}
                      onChangeText={(text) => setDetailDraft((d) => ({ ...d, time: text }))}
                    />
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Activity"
                    value={detailDraft.activity}
                    onChangeText={(text) => setDetailDraft((d) => ({ ...d, activity: text }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Cost"
                    keyboardType="numeric"
                    value={detailDraft.cost}
                    onChangeText={(text) => setDetailDraft((d) => ({ ...d, cost: text }))}
                  />
                  <TouchableOpacity style={styles.button} onPress={addDetail}>
                    <Text style={styles.buttonText}>Add Detail</Text>
                  </TouchableOpacity>

                  <View style={styles.table}>
                    <View style={[styles.tableRow, styles.tableHeader]}>
                      {['Day', 'Time', 'Activity', 'Cost'].map((h) => (
                        <View key={h} style={[styles.cell, { flex: 1 }]}>
                          <Text style={styles.headerText}>{h}</Text>
                        </View>
                      ))}
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
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {activePage === 'traits' ? (
            <>
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
                  <Text style={styles.helperText}>No traits saved yet.</Text>
                ) : (
                  <View style={styles.traitGrid}>
                    {traits.map((trait) => (
                      <View key={trait.id} style={[styles.traitChip, styles.traitChipSelected]}>
                        <Text style={[styles.traitChipText, styles.traitChipTextSelected]}>{trait.name}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </>
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
});

export default App;
