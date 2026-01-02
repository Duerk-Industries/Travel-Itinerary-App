import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { formatDateLong } from '../utils/formatDateLong';
import { normalizeDateString } from '../utils/normalizeDateString';
import { parseFlightText, type ParsedFlight } from '../utils/parsers/flightParser';

export interface Flight {
  id: string;
  passenger_name: string;
  passenger_ids?: string[];
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

export type FlightDraft = {
  passengerName: string;
  passengerIds: string[];
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

export type FlightEditDraft = {
  passengerName: string;
  passengerIds: string[];
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

export type GroupMemberOption = {
  id: string;
  guestName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
};

export type Trip = {
  id: string;
  groupId: string;
  groupName: string;
  name: string;
  createdAt: string;
};

export const createInitialFlightState = (): FlightDraft => ({
  passengerName: '',
  passengerIds: [],
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

export const buildFlightPayload = (flight: FlightEditDraft, tripId?: string | null, defaultPayerId?: string | null) => {
  const trim = (v: string | null | undefined) => (v ?? '').trim();
  const departureDate = normalizeDateString(trim(flight.departureDate)) || new Date().toISOString().slice(0, 10);
  const departureLocation = trim(flight.departureLocation) || trim(flight.departureAirportCode);
  const arrivalLocation = trim(flight.arrivalLocation) || trim(flight.arrivalAirportCode);
  const layoverLocation = trim(flight.layoverLocation);
  const layoverLocationCode = trim(flight.layoverLocationCode);
  const passengerIds = Array.isArray(flight.passengerIds) ? flight.passengerIds.filter(Boolean) : [];
  return {
    passengerName: trim(flight.passengerName) || 'Traveler',
    passengerIds,
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
  const res = await fetch(`${backendUrl}/api/flights?tripId=${activeTripId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data as any[]).map((f) => ({
    ...f,
    passenger_ids: Array.isArray((f as any).passenger_ids) ? (f as any).passenger_ids : [],
    paidBy: Array.isArray(f.paidBy) ? f.paidBy : Array.isArray(f.paid_by) ? f.paid_by : [],
  }));
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
};

type Airport = {
  name: string;
  city?: string;
  country?: string;
  iata_code?: string;
};

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

const columns: { key: keyof Flight | 'actions' | 'costPerPerson'; label: string; minWidth?: number }[] = [
  { key: 'passenger_name', label: 'Passenger', minWidth: 130 },
  { key: 'departure_date', label: 'Departure Date' },
  { key: 'departure_location', label: 'Departure Location' },
  { key: 'departure_time', label: 'Departure Time' },
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
}) => {
  const containerRef = useRef<View | null>(null);
  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    groupMembers.forEach((m) => map.set(m.id, formatMemberName(m)));
    return map;
  }, [groupMembers, formatMemberName]);

  const buildPassengerName = (ids: string[]) => {
    const names = ids.map((id) => memberNames.get(id)).filter(Boolean) as string[];
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
  const [airportTarget, setAirportTarget] = useState<'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover' | null>(null);
  const [airportQuery, setAirportQuery] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([]);
  const [locationTarget, setLocationTarget] = useState<'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover' | null>(null);
  const [showLocationOverlay, setShowLocationOverlay] = useState(false);
  const [locationFieldTarget, setLocationFieldTarget] = useState<'dep' | 'arr' | null>(null);
  const [locationSearch, setLocationSearch] = useState('');
  const [email, setEmail] = useState('');
  const [isParsingPdf, setIsParsingPdf] = useState(false);
  const [pdfParseMessage, setPdfParseMessage] = useState<string | null>(null);
  const [parsedFlights, setParsedFlights] = useState<FlightEditDraft[]>([]);
  const [isSavingParsedFlights, setIsSavingParsedFlights] = useState(false);
  const [isAddingRow] = useState(false);
  const passengerDropdownRef = useRef<TouchableOpacity | null>(null);
  const modalDepLocationRef = useRef<TextInput | null>(null);
  const modalArrLocationRef = useRef<TextInput | null>(null);
  const modalLayoverLocationRef = useRef<TextInput | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [containerOffset, setContainerOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const normalizePassengerName = (name: string): string => {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    const parts = trimmed.toLowerCase().split(' ').filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]} ${parts[parts.length - 1]}`;
    }
    return trimmed.toLowerCase();
  };

  const flightsTotal = useMemo(() => flights.reduce((sum, f) => sum + (Number(f.cost) || 0), 0), [flights]);

  const userMembers = useMemo(() => groupMembers.filter((m) => !m.guestName), [groupMembers]);

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
        return airportOptions.map(parseAirportLabel).slice(0, 15);
      }
      if (airports.length) return airports.slice(0, 15);
      return fallbackAirports;
    }
    if (airportOptions.length) {
      const parsed = airportOptions.map(parseAirportLabel);
      const filtered = parsed.filter((a) => `${a.name ?? ''} ${a.city ?? ''} ${a.iata_code ?? ''}`.toLowerCase().includes(q));
      return (filtered.length ? filtered : parsed).slice(0, 8);
    }
    return filterAirports(query);
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

  const fetchFlights = async (token?: string) => {
    if (!userToken || !activeTripId) {
      setFlights([]);
      return;
    }
    const list = await fetchFlightsForTrip({ backendUrl, activeTripId, token: token ?? userToken });
    setFlights(list);
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
          passengerIds:
            flight.passengerIds && flight.passengerIds.length
              ? flight.passengerIds
              : groupMembers.length
                ? [groupMembers[0].id]
                : [],
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
        if (!enriched.passengerIds.length) {
          failures.push('No passengers selected for a parsed flight.');
          continue;
        }
        enriched.passengerName = buildPassengerName(enriched.passengerIds) || enriched.passengerName;
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
      setParsedFlights(flightsToSave);
      if (saved) {
        const baseMsg = saved === 1 ? 'Added 1 flight to this trip.' : `Added ${saved} flights to this trip.`;
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


  const fetchLocationSuggestions = async (
    target: 'dep' | 'arr' | 'modal-dep' | 'modal-arr' | 'modal-layover',
    text: string
  ) => {
    setLocationTarget(target);
    setLocationSearch(text);
    if (!userToken) {
      setLocationSuggestions([]);
      return;
    }
    const q = text.trim();
    if (!q) {
      setLocationSuggestions([]);
      return;
    }
    try {
      await onSearchAirports(q);
      const filtered = airportOptions.filter((opt) => opt.toLowerCase().includes(q.toLowerCase()));
      if (filtered.length) {
        setLocationSuggestions(filtered);
        return;
      }
    } catch {
      // fall through to local fetch
    }
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
        setLocationSuggestions(filterAirports(q).map((a) => formatAirportLabel(a)));
      }
    } catch {
      setLocationSuggestions([]);
    }
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
    setAirportSuggestions(buildAirportSuggestions(query));
    measureContainerOffset();
    if (query.trim()) {
      try {
        void onSearchAirports(query);
      } catch {
        // ignore background errors
      }
    }
    let nextAnchor = { x: 16, y: 120, width: 260, height: 40 };
    if (node?.measureInWindow) {
      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        setAirportAnchor({ x: x - containerOffset.x, y: y - containerOffset.y, width, height });
      });
    } else if (typeof node?.getBoundingClientRect === 'function') {
      const rect = node.getBoundingClientRect();
      const containerRect = (containerRef.current as any)?.getBoundingClientRect?.();
      const containerLeft = (containerRect?.left ?? 0) + (typeof window !== 'undefined' ? window.scrollX : 0);
      const containerTop = (containerRect?.top ?? 0) + (typeof window !== 'undefined' ? window.scrollY : 0);
      nextAnchor = {
        x: rect.left + (typeof window !== 'undefined' ? window.scrollX : 0) - containerLeft,
        y: rect.top + (typeof window !== 'undefined' ? window.scrollY : 0) - containerTop,
        width: rect.width,
        height: rect.height,
      };
    }
    setAirportAnchor(nextAnchor);
  };

  const hideAirportDropdown = () => {
    setAirportTarget(null);
    setAirportAnchor(null);
    setAirportSuggestions([]);
    setAirportQuery('');
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

  const openFlightDetails = (flight: Flight) => {
    setEditingFlightId(flight.id);
    const base: FlightEditDraft = {
      passengerName: flight.passenger_name,
      passengerIds: Array.isArray(flight.passenger_ids) ? flight.passenger_ids : [],
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
    if (base.passengerIds.length) {
      base.passengerName = buildPassengerName(base.passengerIds) || base.passengerName;
    }
    setEditingFlight(base);
  };

  const closeFlightDetails = () => {
    setEditingFlightId(null);
    setEditingFlight(null);
  };

  const saveFlightDetails = async () => {
    if (!userToken || !editingFlightId || !editingFlight) return;
    if (!editingFlight.passengerIds.length) {
      alert('Select at least one passenger');
      return;
    }
    if (editingFlightId === 'new' && !activeTripId) {
      alert('Select an active trip before adding a flight.');
      return;
    }
    const payload = buildFlightPayload(
      { ...editingFlight, passengerName: buildPassengerName(editingFlight.passengerIds) || editingFlight.passengerName },
      editingFlightId === 'new' ? activeTripId ?? undefined : undefined,
      defaultPayerId
    );
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


  const addFlight = async () => {
    if (!userToken) return false;
    if (!activeTripId) {
      alert('Select an active trip before adding a flight.');
      return false;
    }

    if (!newFlight.passengerIds.length) {
      alert('Select at least one passenger');
      return false;
    }
    const payload = buildFlightPayload(
      { ...newFlight, passengerName: buildPassengerName(newFlight.passengerIds) || newFlight.passengerName },
      activeTripId,
      defaultPayerId
    );
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

  const handleAddPress = () => {
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
  };

  useEffect(() => {
    if (defaultPayerId && editingFlight && editingFlight.paidBy.length === 0) {
      setEditingFlight((p) => (p ? { ...p, paidBy: [defaultPayerId] } : p));
    }
  }, [defaultPayerId, editingFlight]);

  useEffect(() => {
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
    loadAirports();
    measureContainerOffset();
  }, []);

  useEffect(() => {
    if (!locationTarget || !locationSearch.trim()) return;
    if (airportOptions.length) {
      const filtered = airportOptions.filter((opt) => opt.toLowerCase().includes(locationSearch.trim().toLowerCase()));
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


  return (
    <View style={[styles.card, styles.flightsSection]} ref={containerRef as any}>
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
          <TouchableOpacity style={[styles.button, isParsingPdf && styles.disabledButton]} disabled={isParsingPdf} onPress={() => fileInputRef.current?.click()}>
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
            <Text style={styles.helperText}>{pdfParseMessage ?? 'Upload a confirmation email PDF or image to auto-add flights.'}</Text>
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
                      {!item.passengerInGroup ? <Text style={styles.warningText}>Passenger not in trip group</Text> : null}
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
                const display =
                  col.key === 'passenger_name'
                    ? (() => {
                        const ids = Array.isArray(item.passenger_ids) ? item.passenger_ids : [];
                        const names = ids.map((id) => memberNames.get(id)).filter(Boolean) as string[];
                        return names.length ? names.join(', ') : baseDisplay;
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
                const valueMap: Record<string, string> = {
                  passenger_name: buildPassengerName(newFlight.passengerIds) || 'Select passengers',
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
        <TextInput placeholder="Share with email" value={email} onChangeText={setEmail} style={[styles.input, styles.shareInput]} autoCapitalize="none" />
        <Text style={styles.helperText}>Enter an email, then press Share on a row.</Text>
      </View>

      {showLocationOverlay ? (
        <View style={styles.dropdownOverlay}>
          <TouchableOpacity style={styles.dropdownBackdrop} onPress={closeLocationOverlay} />
          <View style={styles.dropdownPortal}>
            <TextInput
              style={[styles.input, styles.inlineInput]}
              placeholder="Search airports or cities"
              value={locationSearch}
              onChangeText={(text) => {
                setLocationSearch(text);
                if (locationFieldTarget) fetchLocationSuggestions(locationFieldTarget, text);
              }}
              autoFocus
            />
            <ScrollView style={styles.dropdownScroll}>
              {locationSuggestions.map((loc) => (
                <TouchableOpacity
                  key={`overlay-${loc}`}
                  style={styles.dropdownOption}
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
                </TouchableOpacity>
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
                <TouchableOpacity
                  key={member.id}
                  style={styles.dropdownOption}
                  onPress={() => {
                    const next = selected
                      ? newFlight.passengerIds.filter((id) => id !== member.id)
                      : [...newFlight.passengerIds, member.id];
                    setNewFlightPassengers(next);
                  }}
                >
                  <Text style={styles.cellText}>{`${selected ? '[x] ' : ''}${name}`}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}
      {airportTarget && airportAnchor ? (
        <View
          style={[
            styles.passengerOverlay,
            { backgroundColor: 'transparent', zIndex: 52000, elevation: 80, pointerEvents: 'box-none' },
          ]}
          pointerEvents="box-none"
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
            pointerEvents="box-none"
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
              Current Departure: {formatDateLong(editingFlight.departureDate)} at {editingFlight.departureTime || '?'}
            </Text>
            <ScrollView style={{ maxHeight: 420 }}>
                      <Text style={styles.modalLabel}>Passengers (tap to toggle)</Text>
                      <View style={styles.payerChips}>
                        {groupMembers.map((m) => {
                          const selected = editingFlight.passengerIds.includes(m.id);
                          const name = formatMemberName(m);
                          return (
                            <TouchableOpacity
                              key={m.id}
                              style={[styles.payerChip, selected && styles.toggleActive]}
                              onPress={() => {
                                const next = selected
                                  ? editingFlight.passengerIds.filter((id) => id !== m.id)
                                  : [...editingFlight.passengerIds, m.id];
                                setEditingFlightPassengers(next);
                              }}
                            >
                              <Text style={styles.cellText}>{name}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
              <Text style={styles.modalLabel}>Departure</Text>
              <View style={styles.modalRow}>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabelSmall}>Date</Text>
                  {Platform.OS === 'web' ? (
                    <input
                      type="date"
                      value={editingFlight.departureDate}
                      onChange={(e) => setEditingFlight((prev) => (prev ? { ...prev, departureDate: e.target.value } : prev))}
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
                  <View style={{ position: 'relative' }}>
                    <TextInput
                      style={styles.input}
                      value={getLocationInputValue(editingFlight.departureLocation, 'modal-dep', airportTarget)}
                      placeholder="Location"
                      ref={modalDepLocationRef}
                      onFocus={() => showAirportDropdown('modal-dep', modalDepLocationRef.current, editingFlight.departureLocation)}
                      onChangeText={(text) => {
                        setEditingFlight((prev) => (prev ? { ...prev, departureLocation: text } : prev));
                        showAirportDropdown('modal-dep', modalDepLocationRef.current, text);
                      }}
                    />
                    <TouchableOpacity
                      style={{ position: 'absolute', right: 8, top: 10, padding: 6 }}
                      onPress={() => showAirportDropdown('modal-dep', modalDepLocationRef.current, editingFlight.departureLocation)}
                    >
                      <Text style={styles.selectCaret}>▼</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabelSmall}>Time</Text>
                  {Platform.OS === 'web' ? (
                    <input
                      type="time"
                      value={editingFlight.departureTime}
                      onChange={(e) => setEditingFlight((prev) => (prev ? { ...prev, departureTime: e.target.value } : prev))}
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
                  <View style={{ position: 'relative' }}>
                    <TextInput
                      style={styles.input}
                      value={getLocationInputValue(editingFlight.arrivalLocation, 'modal-arr', airportTarget)}
                      placeholder="Location"
                      ref={modalArrLocationRef}
                      onFocus={() => showAirportDropdown('modal-arr', modalArrLocationRef.current, editingFlight.arrivalLocation)}
                      onChangeText={(text) => {
                        setEditingFlight((prev) => (prev ? { ...prev, arrivalLocation: text } : prev));
                        showAirportDropdown('modal-arr', modalArrLocationRef.current, text);
                      }}
                    />
                    <TouchableOpacity
                      style={{ position: 'absolute', right: 8, top: 10, padding: 6 }}
                      onPress={() => showAirportDropdown('modal-arr', modalArrLocationRef.current, editingFlight.arrivalLocation)}
                    >
                      <Text style={styles.selectCaret}>▼</Text>
                    </TouchableOpacity>
                  </View>
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
                  <View style={{ position: 'relative' }}>
                    <TextInput
                      style={styles.input}
                      value={getLocationInputValue(editingFlight.layoverLocation, 'modal-layover', airportTarget)}
                      placeholder="Layover location"
                      ref={modalLayoverLocationRef}
                      onFocus={() => showAirportDropdown('modal-layover', modalLayoverLocationRef.current, editingFlight.layoverLocation)}
                      onChangeText={(text) => {
                        setEditingFlight((prev) => (prev ? { ...prev, layoverLocation: text } : prev));
                        showAirportDropdown('modal-layover', modalLayoverLocationRef.current, text);
                      }}
                    />
                    <TouchableOpacity
                      style={{ position: 'absolute', right: 8, top: 10, padding: 6 }}
                      onPress={() => showAirportDropdown('modal-layover', modalLayoverLocationRef.current, editingFlight.layoverLocation)}
                    >
                      <Text style={styles.selectCaret}>▼</Text>
                    </TouchableOpacity>
                  </View>
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
                    .filter((m) => !editingFlight.paidBy.includes(m.id))
                    .map((m) => (
                      <TouchableOpacity key={m.id} style={styles.smallButton} onPress={() => setEditingFlight((p) => (p ? { ...p, paidBy: [...p.paidBy, m.id] } : p))}>
                        <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                      </TouchableOpacity>
                    ))}
                </View>
              </View>
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
  );
};

export const mergeFlightsFromApi = (list: Flight[]): Flight[] =>
  list.map((f) => ({
    ...f,
    paidBy: Array.isArray(f.paidBy) ? f.paidBy : Array.isArray((f as any).paid_by) ? (f as any).paid_by : [],
  }));
