import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import type { Trait } from './traits';
import { FlightsTab, type Flight, type GroupMemberOption, type Trip } from './transfers';
import {
  type Lodging,
  type LodgingDraft,
  buildLodgingPayload,
  calculateNights,
  createInitialLodgingState,
  createLodgingDraftForTrip,
  toLodgingDraft,
} from './lodging';
import { balanceCategoryTotals, computePayerTotals } from './costReport';
import { renderRichTextBlocks } from '../utils/richText';
import { formatDateLong } from '../utils/formatDateLong';
import { ActivityTab, type Tour, buildActivityPayload } from './activities';
import { type CarRental, type CarRentalDraft, buildCarRentalFromDraft, createInitialCarRentalDraft } from './carRentals';
import { computeDurationFromRange, formatMonthYear } from '../utils/tripDates';
import { normalizeDateString } from '../utils/normalizeDateString';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { saveWizardFlights, saveWizardLodgings } from '../utils/wizardSaves';
import { buildMapUrl, loadStoredMapPreference } from '../utils/mapLinks';
import { toWebStyle } from '../utils/webStyle';
import {
  DEFAULT_NEW_ITINERARY_STATUS,
  ITINERARY_STATUSES,
  LEGACY_ITINERARY_STATUS,
  normalizeItineraryStatus,
  shouldRelaxRequiredFields,
} from '../utils/itineraryStatus';
import {
  TripDetails,
  TripDates,
  ParticipantInput,
  ItineraryItemInput,
  KnownInfoInput,
  ensureParticipantIncluded,
  ensureRangeEndDate,
  getDefaultTripRangeDates,
  buildTripDescription,
  computeTripDays,
  canProceedFromItineraryStep,
  normalizeEmail,
  validateParticipants,
  validateTripDates,
  validateTripDetails,
} from '../utils/createTripWizard';
import {
  PROMPT_CAR_OPTIONS,
  PROMPT_COMFORT_OPTIONS,
  PROMPT_INTEREST_OPTIONS,
  PROMPT_MOBILITY_OPTIONS,
  PROMPT_PACE_OPTIONS,
  PROMPT_TRIP_MODE_OPTIONS,
  extractPromptTraitsFromTraits,
  normalizePromptTraits,
  serializePromptTraits,
} from '../utils/promptTraits';
import LodgingDialog from '../components/LodgingDialog';
import { LocationSelector, type LocationOption } from '../components/LocationSelector';
  
type Suggestion = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  source?: 'user' | 'fellow';
};

type CreateTripWizardProps = {
  backendUrl: string;
  userToken: string | null;
  headers: Record<string, string>;
  traits: Trait[];
  airportOptions: string[];
  onSearchAirports: (q: string) => Promise<void> | void;
  styles: Record<string, any>;
  onCancel: () => void;
  onTripCreated: (tripId: string) => void;
  onAiItineraryQueued?: (tripId: string, jobId: string) => void;
  onUnauthorized?: () => void;
  onWizardCarRentals?: (rentals: CarRental[]) => void;
  currentUserName?: string | null;
  currentUserEmail?: string | null;
};

const steps = [
  'Trip Details',
  'Dates',
  'Participants',
  'Itinerary',
  'Flight Details',
  'Accommodation Details',
  'Activities',
  'Rental Cars',
  'Review & Confirm',
];

const itineraryStyleOptions = [
  'Relaxation',
  'Adventure',
  'Family',
  'Romantic',
  'Food & Wine',
  'Culture & Museums',
  'Beach',
  'City Break',
  'Nature & Hiking',
  'Wellness & Spa',
];

const INTEREST_WEIGHT_FIELDS: Array<{
  key: 'o' | 'c' | 'f' | 'n' | 'r';
  label: string;
  help: string;
}> = [
  { key: 'o', label: 'Outdoors', help: 'Nature, parks, hiking, open-air time.' },
  { key: 'c', label: 'Culture', help: 'Museums, landmarks, architecture, local history.' },
  { key: 'f', label: 'Food', help: 'Restaurants, markets, culinary experiences.' },
  { key: 'n', label: 'Nightlife', help: 'Evening bars, live music, late-night options.' },
  { key: 'r', label: 'Relax', help: 'Low-intensity pacing, spa, downtime.' },
];

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

const CreateTripWizard: React.FC<CreateTripWizardProps> = ({
  backendUrl,
  userToken,
  headers,
  traits,
  airportOptions,
  onSearchAirports,
  styles,
  onCancel,
  onTripCreated,
  onAiItineraryQueued,
  onUnauthorized,
  onWizardCarRentals,
  currentUserName,
  currentUserEmail,
}) => {
  const { width: viewportWidth } = useWindowDimensions();
  const handleTripCreated = useCallback(
    (tripId: string) => {
      if (typeof onTripCreated === 'function') {
        onTripCreated(tripId);
      }
    },
    [onTripCreated]
  );
  const isNarrowLayout = viewportWidth < 720;
  const [stepIndex, setStepIndex] = useState(0);
  const [details, setDetails] = useState<TripDetails>({ name: '', description: '' });
  const [selectedLocations, setSelectedLocations] = useState<LocationOption[]>([]);
  const [dates, setDates] = useState<TripDates>({
    startDate: '',
    endDate: '',
    startMonth: '',
    startYear: '',
    durationDays: '',
    mode: 'range',
  });
  const [dateModeSelected, setDateModeSelected] = useState<'range' | 'month' | null>(null);
  const [participants, setParticipants] = useState<ParticipantInput[]>([]);
  const [participantDraft, setParticipantDraft] = useState<ParticipantInput>({ firstName: '', lastName: '', email: '' });
  const [participantSearch, setParticipantSearch] = useState('');
  const [participantSuggestions, setParticipantSuggestions] = useState<Suggestion[]>([]);
  const [hasSeededCurrentUser, setHasSeededCurrentUser] = useState(false);
  const [wizardFlights, setWizardFlights] = useState<Flight[]>([]);
  const [wizardLodgings, setWizardLodgings] = useState<Lodging[]>([]);
  const [wizardTours, setWizardTours] = useState<Tour[]>([]);
  const [wizardCarRentals, setWizardCarRentals] = useState<CarRental[]>([]);
  const [wizardCarDraft, setWizardCarDraft] = useState<CarRentalDraft>(createInitialCarRentalDraft());
  const [wizardCarDateField, setWizardCarDateField] = useState<'pickup' | 'dropoff' | null>(null);
  const [wizardCarDateValue, setWizardCarDateValue] = useState<Date>(new Date());
  const [wizardCarPrepaidOpen, setWizardCarPrepaidOpen] = useState(false);
  const [editingWizardLodgingId, setEditingWizardLodgingId] = useState<string | null>(null);
  const [editingWizardLodging, setEditingWizardLodging] = useState<LodgingDraft | null>(null);
  const [wizardLodgingDateField, setWizardLodgingDateField] = useState<'checkIn' | 'checkOut' | 'refund' | null>(null);
  const [wizardLodgingDateValue, setWizardLodgingDateValue] = useState<Date>(new Date());
  const [itineraryEnabled, setItineraryEnabled] = useState(false);
  const [itineraryItems, setItineraryItems] = useState<ItineraryItemInput[]>([]);
  const [itineraryDraft, setItineraryDraft] = useState<ItineraryItemInput>({ date: '', time: '', activity: '' });
  const [itineraryDays, setItineraryDays] = useState('');
  const [itineraryDaysTouched, setItineraryDaysTouched] = useState(false);
  const [itineraryTripStyle, setItineraryTripStyle] = useState('');
  const defaultPromptTraits = useMemo(() => extractPromptTraitsFromTraits(traits).profile, [traits]);
  const defaultPromptTraitsDigest = useMemo(() => serializePromptTraits(defaultPromptTraits), [defaultPromptTraits]);
  const [wizardPromptTraits, setWizardPromptTraits] = useState(() => normalizePromptTraits(defaultPromptTraits));
  const [wizardCustomInterest, setWizardCustomInterest] = useState('');
  const [itineraryDepartureAirport, setItineraryDepartureAirport] = useState('');
  const [itineraryAirportSuggestions, setItineraryAirportSuggestions] = useState<string[]>([]);
  const [showItineraryAirportSuggestions, setShowItineraryAirportSuggestions] = useState(false);
  const itineraryAirportRef = useRef<any>(null);
  const [itineraryAirportAnchor, setItineraryAirportAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [budgetLevel, setBudgetLevel] = useState<'cheap' | 'middle' | 'expensive'>('middle');
  const [generateItinerary, setGenerateItinerary] = useState(false);
  const [itineraryMode, setItineraryMode] = useState<'ai' | 'manual' | null>(null);
  const [manualDay, setManualDay] = useState<number | null>(null);
  const [manualDraft, setManualDraft] = useState({ time: '', activity: '' });
  const [knownInfo, setKnownInfo] = useState<KnownInfoInput>({ flights: '', lodging: '', tours: '', cars: '' });
  const [wizardError, setWizardError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [createdTripId, setCreatedTripId] = useState<string | null>(null);
  const [dateField, setDateField] = useState<'start' | 'end' | 'itinerary' | null>(null);
  const [dateValue, setDateValue] = useState<Date>(new Date());
  const [showMonthDropdown, setShowMonthDropdown] = useState(false);
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [showDaysDropdown, setShowDaysDropdown] = useState(false);
  const startDateRef = useRef<any>(null);
  const endDateRef = useRef<any>(null);
  const itineraryDateRef = useRef<any>(null);
  const wizardEditLodgingCheckInRef = useRef<any>(null);
  const wizardEditLodgingCheckOutRef = useRef<any>(null);
  const wizardCarPickupDateRef = useRef<any>(null);
  const wizardCarDropoffDateRef = useRef<any>(null);
  const descriptionRef = useRef<any>(null);

  useEffect(() => {
    if (createdTripId) {
      handleTripCreated(createdTripId);
    }
  }, [createdTripId, handleTripCreated]);

  const totalSteps = steps.length;
  const selectedLocationLabel = useMemo(() => {
    if (!selectedLocations.length) return null;
    return selectedLocations.map((loc) => loc.name).join(', ');
  }, [selectedLocations]);
  const wizardTripDefaults = useMemo<Trip>(
    () => ({
      id: 'wizard',
      groupId: 'wizard',
      groupName: 'Wizard',
      name: details.name || 'Trip',
      description: details.description || null,
      destination: selectedLocationLabel || null,
      departureLocation: itineraryDepartureAirport.trim() || null,
      startDate: dates.mode === 'range' ? dates.startDate || null : null,
      endDate: dates.mode === 'range' ? dates.endDate || null : null,
      startMonth: dates.mode === 'month' ? Number(dates.startMonth) || null : null,
      startYear: dates.mode === 'month' ? Number(dates.startYear) || null : null,
      durationDays: dates.mode === 'month' ? Number(dates.durationDays) || null : null,
      createdAt: new Date().toISOString(),
    }),
    [dates, details, itineraryDepartureAirport, selectedLocationLabel]
  );
  const computedDays = useMemo(() => computeTripDays(dates.startDate, dates.endDate), [dates.startDate, dates.endDate]);
  const monthLabel = useMemo(
    () => formatMonthYear(Number(dates.startMonth), Number(dates.startYear)),
    [dates.startMonth, dates.startYear]
  );
  const monthOptions = useMemo(
    () => [
      { label: 'January', value: '1' },
      { label: 'February', value: '2' },
      { label: 'March', value: '3' },
      { label: 'April', value: '4' },
      { label: 'May', value: '5' },
      { label: 'June', value: '6' },
      { label: 'July', value: '7' },
      { label: 'August', value: '8' },
      { label: 'September', value: '9' },
      { label: 'October', value: '10' },
      { label: 'November', value: '11' },
      { label: 'December', value: '12' },
    ],
    []
  );
  const yearOptions = useMemo(() => {
    const start = new Date().getFullYear();
    return Array.from({ length: 11 }, (_, i) => start + i);
  }, []);
  const dayOptions = useMemo(() => Array.from({ length: 90 }, (_, i) => i + 1), []);
  const webInputStyle = useMemo(() => toWebStyle(styles.input), [styles]);
  const webInputStyleFlex = useMemo(() => ({ ...webInputStyle, flex: 1 }), [webInputStyle]);
  const webDateInputStyle = useMemo(
    () =>
      toWebStyle([styles.input, styles.webDateInput], {
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }),
    [styles]
  );
  const webDateInputStyleFlex = useMemo(() => ({ ...webDateInputStyle, flex: 1 }), [webDateInputStyle]);
  const hasKnownInfo = useMemo(
    () => [knownInfo.flights, knownInfo.lodging, knownInfo.tours, knownInfo.cars].some((val) => val.trim().length > 0),
    [knownInfo]
  );
  const wizardGroupMembers = useMemo<GroupMemberOption[]>(() => {
    const members: GroupMemberOption[] = [];
    participants.forEach((p, idx) => {
      const firstName = p.firstName.trim();
      const lastName = p.lastName.trim();
      const email = normalizeEmail(p.email);
      const guestName = `${firstName} ${lastName}`.trim();
      members.push({
        id: email ? `wizard-email:${email}` : `wizard-guest:${guestName || idx}`,
        email: email || undefined,
        firstName: email ? firstName : undefined,
        lastName: email ? lastName : undefined,
        guestName: email ? undefined : guestName || 'Guest',
        status: 'active',
      });
    });
    return members;
  }, [participants]);
  const wizardDefaultPayerId = wizardGroupMembers[0]?.id ?? null;
  const formatWizardMemberName = (member: GroupMemberOption): string => {
    const first = (member.firstName ?? '').trim();
    const last = (member.lastName ?? '').trim();
    const name = `${first} ${last}`.trim();
    if (name) return name;
    if (member.guestName) return member.guestName;
    return member.email || 'Traveler';
  };
  const wizardPayerName = (id: string): string => {
    const match = wizardGroupMembers.find((m) => m.id === id);
    return match ? formatWizardMemberName(match) : 'Traveler';
  };
  const stableHeaders = useMemo(() => headers, [JSON.stringify(headers)]);
  const wizardJsonHeaders = useMemo(
    () => ({ 'Content-Type': 'application/json', ...stableHeaders }),
    [stableHeaders]
  );
  const wizardMemberIds = useMemo(() => wizardGroupMembers.map((m) => m.id), [wizardGroupMembers]);
  const wizardLodgingTotal = useMemo(
    () => wizardLodgings.reduce((sum, l) => sum + (Number(l.totalCost) || 0), 0),
    [wizardLodgings]
  );
  const wizardLodgingPayerTotals = useMemo(
    () =>
      computePayerTotals(
        wizardLodgings,
        (l) => Number(l.totalCost) || 0,
        (l) => (Array.isArray(l.paidBy) ? l.paidBy : []),
        wizardMemberIds,
        { fallbackOnEmpty: false }
      ),
    [wizardLodgings, wizardMemberIds]
  );
  const wizardLodgingTotalsBalanced = useMemo(
    () => balanceCategoryTotals(wizardLodgingTotal, wizardLodgingPayerTotals, wizardMemberIds),
    [wizardLodgingPayerTotals, wizardLodgingTotal, wizardMemberIds]
  );
  const wizardLodgingBreakdownSum = useMemo(
    () => Object.values(wizardLodgingTotalsBalanced).reduce((sum, v) => sum + v, 0),
    [wizardLodgingTotalsBalanced]
  );
  const buildWizardLodgingDraft = useCallback(
    () =>
      createLodgingDraftForTrip({
        tripStartDate: wizardTripDefaults.startDate,
        existingLodgings: wizardLodgings,
        defaultPayerId: wizardDefaultPayerId,
        defaultTravelerIds: wizardMemberIds,
      }),
    [wizardMemberIds, wizardLodgings, wizardDefaultPayerId, wizardTripDefaults.startDate]
  );

  const wizardToursTotal = useMemo(
    () => wizardTours.reduce((sum, t) => sum + (Number(t.cost) || 0), 0),
    [wizardTours]
  );
  const wizardToursPayerTotals = useMemo(
    () =>
      computePayerTotals(
        wizardTours,
        (t) => Number(t.cost) || 0,
        (t) => (Array.isArray(t.paidBy) ? t.paidBy : []),
        wizardMemberIds,
        { fallbackOnEmpty: false }
      ),
    [wizardTours, wizardMemberIds]
  );
  const tripDayCount = useMemo(() => {
    const rangeDays = computedDays ?? null;
    if (rangeDays) return rangeDays;
    const monthDays = Number(dates.durationDays);
    if (dates.mode === 'month' && Number.isFinite(monthDays) && monthDays > 0) return monthDays;
    const manualDays = Number(itineraryDays);
    if (Number.isFinite(manualDays) && manualDays > 0) return manualDays;
    return 1;
  }, [computedDays, dates.durationDays, dates.mode, itineraryDays]);

  useEffect(() => {
    if (wizardDefaultPayerId && (!wizardCarDraft.paidBy || wizardCarDraft.paidBy.length === 0)) {
      setWizardCarDraft((prev) => ({ ...prev, paidBy: [wizardDefaultPayerId] }));
    }
  }, [wizardDefaultPayerId, wizardCarDraft.paidBy.length]);

  useEffect(() => {
    if (dates.mode === 'range' && computedDays && !itineraryDaysTouched) {
      setItineraryDays(String(computedDays));
    }
  }, [computedDays, dates.mode, itineraryDaysTouched]);

  useEffect(() => {
    setWizardPromptTraits(normalizePromptTraits(defaultPromptTraits));
  }, [defaultPromptTraitsDigest]);

  const buildItineraryAirportSuggestions = (query: string): string[] => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    return airportOptions.filter((opt) => opt.toLowerCase().includes(trimmed.toLowerCase())).slice(0, 10);
  };

  const showItineraryAirportDropdown = (query: string) => {
    setItineraryAirportSuggestions(buildItineraryAirportSuggestions(query));
    setShowItineraryAirportSuggestions(true);
    const node = itineraryAirportRef.current as any;
    if (node?.measureInWindow) {
      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        setItineraryAirportAnchor({ x, y, width, height });
      });
    } else if (typeof node?.getBoundingClientRect === 'function') {
      const rect = node.getBoundingClientRect();
      setItineraryAirportAnchor({
        x: rect.left + (typeof window !== 'undefined' ? window.scrollX : 0),
        y: rect.top + (typeof window !== 'undefined' ? window.scrollY : 0),
        width: rect.width,
        height: rect.height,
      });
    }
    if (query.trim()) {
      try {
        void onSearchAirports(query);
      } catch {
        // ignore background errors
      }
    }
  };

  const hideItineraryAirportDropdown = () => {
    setShowItineraryAirportSuggestions(false);
    setItineraryAirportAnchor(null);
  };

  const setWizardWeight = (key: 'o' | 'c' | 'f' | 'n' | 'r', raw: string | number) => {
    const parsed =
      typeof raw === 'number'
        ? raw
        : Number(String(raw ?? '').replace(/[^0-9]/g, ''));
    const nextValue = Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
    setWizardPromptTraits((prev) => ({
      ...prev,
      tt: {
        ...prev.tt,
        w: {
          ...prev.tt.w,
          [key]: nextValue,
        },
      },
    }));
  };

  const toggleWizardInterest = (interest: string) => {
    setWizardPromptTraits((prev) => {
      const current = new Set(prev.ut.i);
      if (current.has(interest)) current.delete(interest);
      else current.add(interest);
      return { ...prev, ut: { ...prev.ut, i: Array.from(current) } };
    });
  };

  const addWizardInterest = () => {
    const normalized = wizardCustomInterest.trim();
    if (!normalized) return;
    setWizardPromptTraits((prev) => ({
      ...prev,
      ut: { ...prev.ut, i: Array.from(new Set([...prev.ut.i, normalized])) },
    }));
    setWizardCustomInterest('');
  };

  useEffect(() => {
    if (!editingWizardLodging) return;
    const nights = calculateNights(editingWizardLodging.checkInDate, editingWizardLodging.checkOutDate);
    const totalNum = Number(editingWizardLodging.totalCost) || 0;
    const computed = nights > 0 && totalNum ? (totalNum / nights).toFixed(2) : '';
    if (computed !== editingWizardLodging.costPerNight) {
      setEditingWizardLodging((prev) => (prev ? { ...prev, costPerNight: computed } : prev));
    }
  }, [editingWizardLodging?.checkInDate, editingWizardLodging?.checkOutDate, editingWizardLodging?.totalCost]);
  const manualDayList = useMemo(() => Array.from({ length: tripDayCount }, (_, i) => i + 1), [tripDayCount]);
  const buildDateForDay = (day: number): string => {
    if (dates.mode === 'range' && dates.startDate) {
      const start = new Date(dates.startDate);
      if (!Number.isNaN(start.valueOf())) {
        const date = new Date(start.getTime() + (day - 1) * 24 * 60 * 60 * 1000);
        return date.toISOString().slice(0, 10);
      }
    }
    const monthNum = Number(dates.startMonth);
    const yearNum = Number(dates.startYear);
    if (monthNum && yearNum) {
      const date = new Date(yearNum, monthNum - 1, day);
      if (!Number.isNaN(date.valueOf())) {
        return date.toISOString().slice(0, 10);
      }
    }
    return `Day ${day}`;
  };
  const formatManualDayLabel = (day: number): string => {
    const dateLabel = buildDateForDay(day);
    if (dateLabel.startsWith('Day ')) return dateLabel;
    return `Day ${day} · ${dateLabel}`;
  };
  const getItemDayIndex = (item: ItineraryItemInput): number => {
    const raw = item.date?.trim();
    if (raw) {
      const match = /^Day\\s+(\\d+)/i.exec(raw);
      if (match) {
        const parsedDay = Number(match[1]);
        return Number.isFinite(parsedDay) && parsedDay > 0 ? parsedDay : 1;
      }
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.valueOf())) {
        if (dates.mode === 'range' && dates.startDate) {
          const start = new Date(dates.startDate);
          if (!Number.isNaN(start.valueOf())) {
            const diff = Math.floor((parsed.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            if (Number.isFinite(diff) && diff > 0) return diff;
          }
        }
        const monthNum = Number(dates.startMonth);
        const yearNum = Number(dates.startYear);
        if (monthNum && yearNum) {
          const start = new Date(yearNum, monthNum - 1, 1);
          if (!Number.isNaN(start.valueOf())) {
            const diff = Math.floor((parsed.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            if (Number.isFinite(diff) && diff > 0) return diff;
          }
        }
      }
    }
    return 1;
  };
  const manualItemsByDay = useMemo(() => {
    const map = new Map<number, Array<{ item: ItineraryItemInput; index: number }>>();
    itineraryItems.forEach((item, index) => {
      const day = getItemDayIndex(item);
      const bucket = map.get(day) ?? [];
      bucket.push({ item, index });
      map.set(day, bucket);
    });
    return map;
  }, [getItemDayIndex, itineraryItems]);

  useEffect(() => {
    if (!userToken) return;
    const query = participantSearch.trim();
    if (!query) {
      setParticipantSuggestions([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await fetch(`${backendUrl}/api/trips/participants/search?q=${encodeURIComponent(query)}`, { headers: stableHeaders });
      if (!res.ok) {
        setParticipantSuggestions([]);
        return;
      }
      const data = await res.json().catch(() => []);
      setParticipantSuggestions(Array.isArray(data) ? data : []);
    }, 300);
    return () => clearTimeout(handle);
  }, [backendUrl, stableHeaders, participantSearch, userToken]);

  useEffect(() => {
    if (hasSeededCurrentUser) return;
    setParticipants((prev) => ensureParticipantIncluded(prev, currentUserName, currentUserEmail));
    setHasSeededCurrentUser(true);
  }, [currentUserEmail, currentUserName, hasSeededCurrentUser]);

  const budgetRange = useMemo(() => {
    if (budgetLevel === 'cheap') return { min: 500, max: 1500 };
    if (budgetLevel === 'expensive') return { min: 4000, max: 8000 };
    return { min: 1500, max: 4000 };
  }, [budgetLevel]);

  const addParticipant = (entry: ParticipantInput) => {
    const normalized = {
      firstName: entry.firstName.trim(),
      lastName: entry.lastName.trim(),
      email: normalizeEmail(entry.email),
    };
    if (!normalized.firstName || !normalized.lastName) {
      setWizardError('Each participant needs a first and last name.');
      return;
    }
    if (normalized.email && participants.some((p) => normalizeEmail(p.email) === normalized.email)) {
      setWizardError('Participant emails must be unique.');
      return;
    }
    setParticipants((prev) => [...prev, normalized]);
    setParticipantDraft({ firstName: '', lastName: '', email: '' });
    setWizardError('');
  };

  const addLocation = (location: LocationOption) => {
    if (!location?.id) return;
    if (selectedLocations.some((entry) => entry.id === location.id)) return;
    setSelectedLocations((prev) => [...prev, location]);
  };

  const removeLocation = (locationId: string) => {
    setSelectedLocations((prev) => prev.filter((location) => location.id !== locationId));
  };

  const addItineraryItem = () => {
    if (!itineraryDraft.activity.trim()) {
      setWizardError('Add an activity description for the itinerary item.');
      return;
    }
    setItineraryItems((prev) => [...prev, { ...itineraryDraft, activity: itineraryDraft.activity.trim() }]);
    setItineraryDraft({ date: '', time: '', activity: '' });
    setWizardError('');
  };
  const addManualItem = (day: number) => {
    if (!manualDraft.activity.trim()) {
      setWizardError('Add an activity description for the itinerary item.');
      return;
    }
    const date = buildDateForDay(day);
    setItineraryItems((prev) => [
      ...prev,
      { date, time: manualDraft.time.trim(), activity: manualDraft.activity.trim() },
    ]);
    setManualDraft({ time: '', activity: '' });
    setWizardError('');
  };
  const selectItineraryMode = (mode: 'ai' | 'manual') => {
    setItineraryMode(mode);
    setItineraryEnabled(true);
    setGenerateItinerary(mode === 'ai');
    setWizardError('');
  };

  const setStartDateWithRangeGuard = (value: string) => {
    const normalized = normalizeDateString(value);
    setDates((prev) => {
      if (prev.mode !== 'range') {
        return { ...prev, startDate: normalized };
      }
      const nextEnd = ensureRangeEndDate(normalized, prev.endDate);
      return { ...prev, startDate: normalized, endDate: nextEnd };
    });
  };
  const primeRangeDates = () => {
    if (dates.mode !== 'range') return;
    const defaults = getDefaultTripRangeDates({ startDate: dates.startDate, endDate: dates.endDate });
    if (defaults.startDate !== dates.startDate || defaults.endDate !== dates.endDate) {
      setDates((prev) => ({ ...prev, startDate: defaults.startDate, endDate: defaults.endDate }));
    }
  };

  const openDatePicker = (field: 'start' | 'end' | 'itinerary') => {
    if (field === 'start' || field === 'end') {
      primeRangeDates();
    }
    if (Platform.OS !== 'web' && NativeDateTimePicker) {
      const rangeDefaults = field === 'start' || field === 'end'
        ? getDefaultTripRangeDates({ startDate: dates.startDate, endDate: dates.endDate })
        : null;
      const base =
        field === 'start'
          ? rangeDefaults?.startDate
          : field === 'end'
            ? rangeDefaults?.endDate
            : itineraryDraft.date;
      const date = base ? new Date(base) : new Date();
      setDateValue(date);
      setDateField(field);
      return;
    }
    const ref = field === 'start' ? startDateRef.current : field === 'end' ? endDateRef.current : itineraryDateRef.current;
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

  const canMoveNext = () => {
    if (stepIndex === 0) return !validateTripDetails(details);
    if (stepIndex === 1) {
      if (!dateModeSelected) return false;
      if (dateModeSelected === 'range') {
        if (!dates.startDate || !dates.endDate) return false;
      } else {
        if (!dates.startMonth || !dates.startYear || !dates.durationDays) return false;
      }
      return !validateTripDates(dates);
    }
    if (stepIndex === 2) return !validateParticipants(participants);
    if (stepIndex === 3) return canProceedFromItineraryStep(itineraryMode);
    return true;
  };

  const goNext = () => {
    let error: string | null = null;
    if (stepIndex === 0) error = validateTripDetails(details);
    if (stepIndex === 1 && !dateModeSelected) {
      error = 'Select a date option to continue.';
    }
    if (stepIndex === 1 && !error) {
      if (dateModeSelected === 'range') {
        if (!dates.startDate || !dates.endDate) {
          error = 'Select both a start and end date.';
        }
      } else if (!dates.startMonth || !dates.startYear || !dates.durationDays) {
        error = 'Select a month, year, and number of days.';
      }
    }
    if (stepIndex === 1 && !error) error = validateTripDates(dates);
    if (stepIndex === 2) error = validateParticipants(participants);
    if (stepIndex === 3 && !canProceedFromItineraryStep(itineraryMode)) error = 'Choose Yes or No to continue.';
    if (error) {
      setWizardError(error);
      return;
    }
    setWizardError('');
    setStepIndex((prev) => Math.min(prev + 1, totalSteps - 1));
  };

  const goBack = () => {
    setWizardError('');
    setStepIndex((prev) => Math.max(prev - 1, 0));
  };

  const insertDescriptionSnippet = (snippet: string) => {
    setDetails((prev) => ({
      ...prev,
      description: `${prev.description}${prev.description ? ' ' : ''}${snippet}`,
    }));
  };

  const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number) => {
    if (typeof AbortController === 'undefined') {
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Request timed out')), timeoutMs));
      return Promise.race([fetch(url, options), timeout]) as Promise<Response>;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };

  const openWizardMaps = (address: string) => {
    const pref = loadStoredMapPreference('google');
    const url = buildMapUrl(address, pref);
    if (!url) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  const applyWizardLodgingDate = (field: 'checkIn' | 'checkOut', value: string) => {
    setEditingWizardLodging((prev) =>
      prev ? { ...prev, [field === 'checkIn' ? 'checkInDate' : 'checkOutDate']: value } : prev
    );
  };

  const openWizardLodgingDatePicker = (field: 'checkIn' | 'checkOut' | 'refundBy', current?: string) => {
    if (Platform.OS === 'web') {
      const ref =
        field === 'checkIn'
          ? wizardEditLodgingCheckInRef.current
          : field === 'checkOut'
            ? wizardEditLodgingCheckOutRef.current
            : null;
      if ((ref as any)?.showPicker) {
        (ref as any).showPicker();
        return;
      }
      if (typeof ref?.click === 'function') {
        ref.click();
        return;
      }
      ref?.focus();
      return;
    }
    if (current) {
      const parsed = new Date(current);
      if (!Number.isNaN(parsed.valueOf())) {
        setWizardLodgingDateValue(parsed);
      }
    }
    setWizardLodgingDateField(field as 'checkIn' | 'checkOut' | null);
  };

  const openWizardLodgingEditor = (lodging: Lodging | null) => {
    if (lodging) {
      setEditingWizardLodgingId(lodging.id);
      setEditingWizardLodging(
        toLodgingDraft(lodging, { normalize: normalizeDateString, defaultPayerId: wizardDefaultPayerId })
      );
    } else {
      setEditingWizardLodgingId(null);
      setEditingWizardLodging(buildWizardLodgingDraft());
    }
  };

  const closeWizardLodgingEditor = () => {
    setEditingWizardLodgingId(null);
    setEditingWizardLodging(null);
  };

  const removeWizardLodging = (id: string) => {
    setWizardLodgings((prev) => prev.filter((l) => l.id !== id));
  };

  const applyWizardCarDate = (field: 'pickup' | 'dropoff', value: string) => {
    setWizardCarDraft((prev) => ({ ...prev, [field === 'pickup' ? 'pickupDate' : 'dropoffDate']: value }));
  };

  const openWizardCarDatePicker = (field: 'pickup' | 'dropoff') => {
    if (Platform.OS !== 'web' && NativeDateTimePicker) {
      const base = (field === 'pickup' ? wizardCarDraft.pickupDate : wizardCarDraft.dropoffDate) || '';
      const date = base ? new Date(base) : new Date();
      setWizardCarDateValue(date);
      setWizardCarDateField(field);
      return;
    }
    const ref = field === 'pickup' ? wizardCarPickupDateRef.current : wizardCarDropoffDateRef.current;
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

  const addWizardCarRental = () => {
    const result = buildCarRentalFromDraft(wizardCarDraft, wizardDefaultPayerId, wizardMemberIds);
    if (result.error || !result.rental) {
      setWizardError(result.error || 'Unable to add car rental.');
      return;
    }
    setWizardCarRentals((prev) => [...prev, result.rental as CarRental]);
    setWizardCarDraft(createInitialCarRentalDraft());
    setWizardError('');
  };

  const removeWizardCarRental = (id: string) => {
    setWizardCarRentals((prev) => prev.filter((c) => c.id !== id));
  };

  const saveWizardLodging = (draft: LodgingDraft, lodgingId?: string | null, opts?: { addAnother?: boolean }) => {
    const name = draft.name.trim();
    const relaxed = shouldRelaxRequiredFields(draft.status);
    if (!relaxed && !name) {
      setWizardError('Please enter a lodging name.');
      return;
    }
    const nights = calculateNights(draft.checkInDate, draft.checkOutDate);
    if (!relaxed && nights <= 0) {
      setWizardError('Check-out must be after check-in.');
      return;
    }
    const totalNum = Number(draft.totalCost) || 0;
    const computed = nights > 0 && totalNum ? (totalNum / nights).toFixed(2) : '';
    const paidBy = draft.paidBy.length ? draft.paidBy : wizardDefaultPayerId ? [wizardDefaultPayerId] : [];
    const next: Lodging = {
      id: lodgingId ?? `wizard-lodging-${Date.now()}-${Math.round(Math.random() * 10000)}`,
      userId: '',
      tripId: '',
      status: normalizeItineraryStatus(draft.status, DEFAULT_NEW_ITINERARY_STATUS),
      name,
      checkInDate: normalizeDateString(draft.checkInDate),
      checkOutDate: normalizeDateString(draft.checkOutDate),
      rooms: draft.rooms || '1',
      refundBy: draft.refundBy ? normalizeDateString(draft.refundBy) : '',
      totalCost: draft.totalCost,
      costPerNight: computed,
      address: draft.address,
      paidBy,
      travelerIds: [],
    };
    setWizardLodgings((prev) => {
      if (lodgingId) {
        return prev.map((l) => (l.id === lodgingId ? { ...next, id: lodgingId } : l));
      }
      return [...prev, next];
    });
    setWizardError('');
    if (opts?.addAnother && !lodgingId) {
      setEditingWizardLodgingId(null);
      setEditingWizardLodging(buildWizardLodgingDraft());
      return;
    }
    closeWizardLodgingEditor();
  };

  const saveWizardFlightsForTrip = async (tripId: string, groupId: string) => {
    const result = await saveWizardFlights({
      backendUrl,
      headers,
      userToken,
      groupId,
      tripId,
      wizardFlights,
      wizardGroupMembers,
    });
    if (result.fatal) {
      setWizardError(result.fatal);
      return;
    }
    if (result.failures.length) {
      setWizardError(`Trip created, but ${result.failures.length} flight(s) failed to save.`);
    }
  };

  const saveWizardLodgingsForTrip = async (tripId: string, groupId: string) => {
    const result = await saveWizardLodgings({
      backendUrl,
      headers,
      userToken,
      groupId,
      tripId,
      wizardLodgings,
      wizardGroupMembers,
    });
    if (result.fatal) {
      setWizardError(result.fatal);
      return;
    }
    if (result.failures.length) {
      setWizardError(`Trip created, but ${result.failures.length} lodging entr${result.failures.length === 1 ? 'y' : 'ies'} failed to save.`);
    }
  };

  const saveWizardTours = async (tripId: string, groupId: string) => {
    if (!userToken || wizardTours.length === 0) return;
    try {
      const res = await fetch(`${backendUrl}/api/groups/${groupId}/members`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      if (!res.ok) {
        setWizardError('Trip created, but tours could not be saved.');
        return;
      }
      const data = await res.json().catch(() => []);
      const members = (Array.isArray(data) ? data : []).map((m: any) => ({
        id: m.id,
        email: m.email ?? m.userEmail ?? undefined,
        guestName: m.guestName ?? m.guest_name ?? undefined,
        firstName: m.firstName ?? m.first_name ?? undefined,
        lastName: m.lastName ?? m.last_name ?? undefined,
        status: m.status ?? undefined,
      }));
      const activeMembers = members.filter((m: any) => m.status !== 'removed');
      const memberByEmail = new Map(
        members
          .map((m: any) => [String(m.email ?? '').toLowerCase(), m.id] as const)
          .filter(([email]) => email)
      );
      const memberByGuest = new Map(
        members
          .map((m: any) => [String(m.guestName ?? '').toLowerCase(), m.id] as const)
          .filter(([name]) => name)
      );
      const wizardMembersById = new Map(wizardGroupMembers.map((m) => [m.id, m] as const));
      const fallbackPayerId = activeMembers[0]?.id ?? members[0]?.id ?? null;
      const failures: string[] = [];

      for (const tour of wizardTours) {
        const rawPaidBy = Array.isArray(tour.paidBy) ? tour.paidBy : [];
        const resolvedPaidBy = rawPaidBy
          .map((id) => wizardMembersById.get(String(id)))
          .map((member) => {
            if (!member) return null;
            if (member.email) return memberByEmail.get(member.email.toLowerCase()) ?? null;
            if (member.guestName) return memberByGuest.get(member.guestName.toLowerCase()) ?? null;
            return null;
          })
          .filter(Boolean) as string[];
        const paidBy = resolvedPaidBy.length ? resolvedPaidBy : fallbackPayerId ? [fallbackPayerId] : [];

        const draft = {
          status: (tour as any).status ?? 'Needed',
          activityType: (tour as any).activityType ?? 'Tour',
          date: tour.date,
          name: tour.name,
          startLocation: tour.startLocation,
          startTime: tour.startTime,
          duration: tour.duration,
          cost: tour.cost,
          freeCancelBy: tour.freeCancelBy,
          bookedOn: tour.bookedOn,
          reference: tour.reference,
          paidBy,
          travelerIds: [],
        };
        const { payload, error } = buildActivityPayload(draft, fallbackPayerId ?? undefined);
        if (error || !payload) {
          failures.push(error || 'Failed to save activity');
          continue;
        }
        const saveRes = await fetch(`${backendUrl}/api/activities`, {
          method: 'POST',
          headers: wizardJsonHeaders,
          body: JSON.stringify({
            ...payload,
            tripId,
            freeCancelBy: payload.freeCancelBy?.trim() || null,
          }),
        });
        if (!saveRes.ok) {
          const errData = await saveRes.json().catch(() => ({}));
          failures.push(errData.error || 'Failed to save activity');
        }
      }

      if (failures.length) {
        setWizardError(`Trip created, but ${failures.length} tour(s) failed to save.`);
      }
    } catch {
      setWizardError('Trip created, but tours could not be saved.');
    }
  };

  const submitWizard = async () => {
    if (!userToken) return;
    const detailError = validateTripDetails(details);
    const dateError = validateTripDates(dates);
    const participantError = validateParticipants(participants);
    if (detailError || dateError || participantError) {
      setWizardError(detailError || dateError || participantError || '');
      return;
    }
    const currentUserEmailNormalized = normalizeEmail(currentUserEmail);
    const participantPayload = currentUserEmailNormalized
      ? participants.filter((p) => normalizeEmail(p.email) !== currentUserEmailNormalized)
      : participants;
    setIsSubmitting(true);
    setWizardError('');
    const description = buildTripDescription(details, hasKnownInfo ? knownInfo : undefined);
    const wizardDebugPrefix = '[wizard][itinerary]';
    try {
      const res = await fetch(`${backendUrl}/api/trips/wizard`, {
        method: 'POST',
        headers: wizardJsonHeaders,
        body: JSON.stringify({
          name: details.name.trim(),
          description: description.trim() || undefined,
          locationIds: selectedLocations.map((location) => location.id),
          startDate: dates.mode === 'range' ? dates.startDate || undefined : undefined,
          endDate: dates.mode === 'range' ? dates.endDate || undefined : undefined,
          startMonth: dates.mode === 'month' ? Number(dates.startMonth) || undefined : undefined,
          startYear: dates.mode === 'month' ? Number(dates.startYear) || undefined : undefined,
          durationDays: dates.mode === 'month' ? Number(dates.durationDays) || undefined : undefined,
          participants: participantPayload,
        }),
      });
    if (res.status === 401 || res.status === 403) {
      setWizardError('Session expired. Please log in again.');
      onUnauthorized?.();
      return;
    }
    const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWizardError(data.error || 'Unable to create trip');
        return;
      }

      const tripId = data.trip?.id as string | undefined;
      if (!tripId) {
        setWizardError('Trip created but no id was returned.');
        return;
      }
      const groupId = data.groupId as string | undefined;
      if (groupId) {
        await saveWizardFlightsForTrip(tripId, groupId);
        await saveWizardLodgingsForTrip(tripId, groupId);
        await saveWizardTours(tripId, groupId);
      }
      if (wizardCarRentals.length) {
        onWizardCarRentals?.(wizardCarRentals);
      }

      console.info(
        `${wizardDebugPrefix} post-trip-created tripId=${tripId} itineraryEnabled=${itineraryEnabled} generateItinerary=${generateItinerary} manualItems=${itineraryItems.length}`
      );
      if (itineraryEnabled && (itineraryItems.length || generateItinerary)) {
        const rangeDays = computeDurationFromRange(dates.startDate, dates.endDate);
        const days =
          (dates.mode === 'range' ? rangeDays : null) ??
          (Number(itineraryDays) > 0 ? Number(itineraryDays) : Number(dates.durationDays) || 1);
        const locationNames = selectedLocations.map((location) => location.name).filter(Boolean);
        const destination = locationNames.length ? locationNames.join(', ') : details.name.trim() || 'Trip';
        try {
          const createRes = await fetchWithTimeout(
            `${backendUrl}/api/itineraries`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...headers },
              body: JSON.stringify({
                tripId,
                destination,
                days,
                budget: budgetRange.max,
              }),
            },
            15000
          );
          const created = await createRes.json().catch(() => ({}));
          const itineraryId = created.id ?? null;
          if (!createRes.ok || !itineraryId) {
            setWizardError(created?.error || 'Trip created, but the itinerary could not be created.');
            console.warn(
              `${wizardDebugPrefix} itinerary-record-create-failed tripId=${tripId} status=${createRes.status} error="${String(
                created?.error ?? ''
              )}"`
            );
          } else {
            console.info(`${wizardDebugPrefix} itinerary-record-created tripId=${tripId} itineraryId=${itineraryId}`);
            if (itineraryItems.length) {
              await Promise.all(
                itineraryItems.map((item) => {
                  const day = getItemDayIndex(item);
                  return fetchWithTimeout(
                    `${backendUrl}/api/itineraries/${itineraryId}/details`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', ...headers },
                      body: JSON.stringify({
                        day,
                        time: item.time || undefined,
                        activity: item.activity,
                        cost: null,
                      }),
                    },
                    10000
                  ).catch(() => null);
                })
              );
            }
            if (generateItinerary) {
              console.info(`${wizardDebugPrefix} ai-generation-enqueue-start tripId=${tripId} days=${days} destination="${destination}"`);
              const aiRes = await fetchWithTimeout(
                `${backendUrl}/api/itinerary/async`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...headers },
                  body: JSON.stringify({
                    country: destination,
                    locations: locationNames,
                    days,
                    budgetMin: budgetRange.min,
                    budgetMax: budgetRange.max,
                    departureAirport: itineraryDepartureAirport.trim() || undefined,
                    tripStyle: itineraryTripStyle.trim() || undefined,
                    tripId,
                    itineraryId,
                    tt: wizardPromptTraits.tt,
                    ut: wizardPromptTraits.ut,
                  }),
                },
                10000
              );
              const aiData = await aiRes.json().catch(() => ({}));
              if (!aiRes.ok || !aiData?.jobId) {
                setWizardError(aiData?.error || 'Trip created, but AI itinerary background generation could not be started.');
                console.warn(
                  `${wizardDebugPrefix} ai-generation-enqueue-failed tripId=${tripId} status=${aiRes.status} error="${String(
                    aiData?.error ?? ''
                  )}" hasJob=${Boolean(aiData?.jobId)}`
                );
              } else {
                onAiItineraryQueued?.(tripId, String(aiData.jobId));
                console.info(`${wizardDebugPrefix} ai-generation-enqueue-success tripId=${tripId} jobId=${String(aiData.jobId)}`);
              }
            } else {
              console.info(`${wizardDebugPrefix} ai-generation-skipped tripId=${tripId} reason=generateItinerary_false`);
            }
          }
        } catch (err) {
          setWizardError((err as Error).message || 'Trip created, but itinerary setup failed.');
          console.warn(`${wizardDebugPrefix} itinerary-setup-exception tripId=${tripId} message="${(err as Error).message}"`);
        }
      } else {
        console.info(
          `${wizardDebugPrefix} itinerary-setup-skipped tripId=${tripId} reason=${
            !itineraryEnabled ? 'itinerary_disabled' : 'no_manual_items_and_ai_disabled'
          }`
        );
      }

      setCreatedTripId(tripId);
      handleTripCreated(tripId);
    } catch (err) {
      setWizardError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStepContent = () => {
    switch (stepIndex) {
      case 0:
        return (
          <>
            <Text style={styles.sectionTitle}>Trip Details</Text>
            <Text style={styles.helperText}>Name your trip and add a rich description.</Text>
            <TextInput
              style={styles.input}
              placeholder="Trip name"
              title="Trip name"
              value={details.name}
              onChangeText={(text: string) => setDetails((prev) => ({ ...prev, name: text }))}
            />
            <LocationSelector
              backendUrl={backendUrl}
              headers={stableHeaders}
              selectedLocations={selectedLocations}
              onAddLocation={addLocation}
              onRemoveLocation={removeLocation}
              onNext={() => descriptionRef.current?.focus()}
              styles={styles}
              placeholder="Search locations (countries/regions/cities)"
            />
            {selectedLocations.length === 0 ? (
              <Text style={styles.helperText}>Select one or more locations for this trip.</Text>
            ) : null}
            <TextInput
              ref={descriptionRef}
              style={[styles.input, { minHeight: 120 }]}
              placeholder="Description (optional)"
              title="Description"
              multiline
              value={details.description}
              onChangeText={(text: string) => setDetails((prev) => ({ ...prev, description: text }))}
            />
          </>
        );
      case 1:
        return (
          <>
            <Text style={styles.sectionTitle}>Dates</Text>
            <Text style={styles.helperText}>Choose exact dates or a month and duration (optional).</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[
                  {
                    backgroundColor: dateModeSelected === 'range' ? '#0d6efd' : '#fff',
                    borderColor: '#0d6efd',
                    borderWidth: 1,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 6,
                    alignItems: 'center',
                  },
                  { marginRight: 8 },
                ]}
                onPress={() => {
                  setDateModeSelected('range');
                  setDates((prev) => ({ ...prev, mode: 'range' }));
                }}
              >
                <Text
                  style={[
                    { color: dateModeSelected === 'range' ? '#fff' : '#0d6efd', fontWeight: '600' },
                  ]}
                >
                  I know which dates I'm going
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  {
                    backgroundColor: dateModeSelected === 'month' ? '#0d6efd' : '#fff',
                    borderColor: '#0d6efd',
                    borderWidth: 1,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 6,
                    alignItems: 'center',
                  },
                ]}
                onPress={() => {
                  setDateModeSelected('month');
                  setDates((prev) => ({ ...prev, mode: 'month' }));
                }}
              >
                <Text
                  style={[
                    { color: dateModeSelected === 'month' ? '#fff' : '#0d6efd', fontWeight: '600' },
                  ]}
                >
                  Flexible Timeline
                </Text>
              </TouchableOpacity>
            </View>
            {!dateModeSelected ? (
              <Text style={styles.helperText}>Select a date option to continue.</Text>
            ) : dates.mode === 'range' ? (
              <>
                <View style={[styles.row, { flexWrap: isNarrowLayout ? 'wrap' : 'nowrap' }]}>
                  <View style={[styles.dateInputWrap, { flex: 1, minWidth: isNarrowLayout ? '100%' : 0, maxWidth: '100%' }]}>
                    {Platform.OS === 'web' ? (
                      <input
                        ref={startDateRef as any}
                        type="date"
                        title="Start date"
                        value={dates.startDate}
                        onChange={(e) => setStartDateWithRangeGuard(e.target.value)}
                        onFocus={primeRangeDates}
                        style={webDateInputStyle}
                      />
                    ) : (
                      <TouchableOpacity style={[styles.input, styles.dateTouchable]} onPress={() => openDatePicker('start')}>
                        <Text style={styles.cellText}>{dates.startDate || 'YYYY-MM-DD'}</Text>
                      </TouchableOpacity>
                    )}
                    {Platform.OS !== 'web' ? (
                      <TouchableOpacity style={styles.dateIcon} onPress={() => openDatePicker('start')}>
                        <Text style={styles.selectCaret}>v</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <View style={[styles.dateInputWrap, { flex: 1, minWidth: isNarrowLayout ? '100%' : 0, maxWidth: '100%' }]}>
                    {Platform.OS === 'web' ? (
                      <input
                        ref={endDateRef as any}
                        type="date"
                        title="End date"
                        value={dates.endDate}
                        onChange={(e) => setDates((prev) => ({ ...prev, endDate: normalizeDateString(e.target.value) }))}
                        onFocus={primeRangeDates}
                        style={webDateInputStyle}
                      />
                    ) : (
                      <TouchableOpacity style={[styles.input, styles.dateTouchable]} onPress={() => openDatePicker('end')}>
                        <Text style={styles.cellText}>{dates.endDate || 'YYYY-MM-DD'}</Text>
                      </TouchableOpacity>
                    )}
                    {Platform.OS !== 'web' ? (
                      <TouchableOpacity style={styles.dateIcon} onPress={() => openDatePicker('end')}>
                        <Text style={styles.selectCaret}>v</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
                {computedDays ? <Text style={styles.helperText}>Trip length: {computedDays} day(s)</Text> : null}
              </>
            ) : (
              <>
                <View style={styles.row}>
                  {Platform.OS === 'web' ? (
                    <select
                      style={webDateInputStyleFlex}
                      title="Select month"
                      value={dates.startMonth}
                      onChange={(e) => setDates((prev) => ({ ...prev, startMonth: e.target.value }))}
                    >
                      <option value="">Month</option>
                      {monthOptions.map((month) => (
                        <option key={month.value} value={month.value}>
                          {month.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <View style={[styles.input, styles.dropdown, { flex: 1 }]}>
                      <TouchableOpacity
                        style={styles.selectButton}
                        onPress={() => {
                          setShowMonthDropdown((prev) => !prev);
                          setShowYearDropdown(false);
                          setShowDaysDropdown(false);
                        }}
                      >
                        <View style={styles.selectButtonRow}>
                          <Text style={[styles.cellText, !dates.startMonth && styles.placeholderText]}>
                            {monthOptions.find((m) => m.value === dates.startMonth)?.label ?? 'Month'}
                          </Text>
                          <Text style={styles.selectCaret}>v</Text>
                        </View>
                      </TouchableOpacity>
                      {showMonthDropdown ? (
                        <View style={styles.dropdownList}>
                          {monthOptions.map((month) => (
                            <TouchableOpacity
                              key={month.value}
                              style={styles.dropdownOption}
                              onPress={() => {
                                setDates((prev) => ({ ...prev, startMonth: month.value }));
                                setShowMonthDropdown(false);
                              }}
                            >
                              <Text style={styles.cellText}>{month.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  )}
                  {Platform.OS === 'web' ? (
                    <select
                      style={webDateInputStyleFlex}
                      title="Select year"
                      value={dates.startYear}
                      onChange={(e) => setDates((prev) => ({ ...prev, startYear: e.target.value }))}
                    >
                      <option value="">Year</option>
                      {yearOptions.map((year) => (
                        <option key={year} value={String(year)}>
                          {year}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <View style={[styles.input, styles.dropdown, { flex: 1 }]}>
                      <TouchableOpacity
                        style={styles.selectButton}
                        onPress={() => {
                          setShowYearDropdown((prev) => !prev);
                          setShowMonthDropdown(false);
                          setShowDaysDropdown(false);
                        }}
                      >
                        <View style={styles.selectButtonRow}>
                          <Text style={[styles.cellText, !dates.startYear && styles.placeholderText]}>
                            {dates.startYear || 'Year'}
                          </Text>
                          <Text style={styles.selectCaret}>v</Text>
                        </View>
                      </TouchableOpacity>
                      {showYearDropdown ? (
                        <View style={styles.dropdownList}>
                          {yearOptions.map((year) => (
                            <TouchableOpacity
                              key={year}
                              style={styles.dropdownOption}
                              onPress={() => {
                                setDates((prev) => ({ ...prev, startYear: String(year) }));
                                setShowYearDropdown(false);
                              }}
                            >
                              <Text style={styles.cellText}>{year}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  )}
                </View>
                {Platform.OS === 'web' ? (
                  <select
                    style={webDateInputStyle}
                    title="Select number of days"
                    value={dates.durationDays}
                    onChange={(e) => setDates((prev) => ({ ...prev, durationDays: e.target.value }))}
                  >
                    <option value="">Days</option>
                    {dayOptions.map((day) => (
                      <option key={day} value={String(day)}>
                        {day}
                      </option>
                    ))}
                  </select>
                ) : (
                  <View style={[styles.input, styles.dropdown]}>
                    <TouchableOpacity
                      style={styles.selectButton}
                      onPress={() => {
                        setShowDaysDropdown((prev) => !prev);
                        setShowMonthDropdown(false);
                        setShowYearDropdown(false);
                      }}
                    >
                      <View style={styles.selectButtonRow}>
                        <Text style={[styles.cellText, !dates.durationDays && styles.placeholderText]}>
                          {dates.durationDays || 'Days'}
                        </Text>
                        <Text style={styles.selectCaret}>v</Text>
                      </View>
                    </TouchableOpacity>
                    {showDaysDropdown ? (
                      <View style={styles.dropdownList}>
                        {dayOptions.map((day) => (
                          <TouchableOpacity
                            key={day}
                            style={styles.dropdownOption}
                            onPress={() => {
                              setDates((prev) => ({ ...prev, durationDays: String(day) }));
                              setShowDaysDropdown(false);
                            }}
                          >
                            <Text style={styles.cellText}>{day}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                  </View>
                )}
                {monthLabel && dates.durationDays ? (
                  <Text style={styles.helperText}>
                    {monthLabel} · {dates.durationDays} day(s)
                  </Text>
                ) : null}
              </>
            )}
          </>
        );
      case 2:
        return (
          <>
            <Text style={styles.sectionTitle}>Participants</Text>
            <Text style={styles.helperText}>
              Optional step. We'll add you by default—add fellow travelers or remove yourself if needed.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Search past travelers"
              title="Search participants"
              value={participantSearch}
              onChangeText={setParticipantSearch}
            />
            {participantSuggestions.length ? (
              <View style={styles.dropdownList}>
                {participantSuggestions.map((suggestion) => (
                  <TouchableOpacity
                    key={`${suggestion.source}-${suggestion.id}`}
                    style={styles.dropdownOption}
                    onPress={() => {
                      addParticipant({
                        firstName: suggestion.firstName ?? '',
                        lastName: suggestion.lastName ?? '',
                        email: suggestion.email ?? '',
                      });
                      setParticipantSearch('');
                      setParticipantSuggestions([]);
                    }}
                  >
                    <Text style={styles.cellText}>
                      {`${suggestion.firstName ?? ''} ${suggestion.lastName ?? ''}`.trim() || suggestion.email || 'Traveler'}
                      {suggestion.email ? ` (${suggestion.email})` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="First name"
                title="First name"
                value={participantDraft.firstName}
                onChangeText={(text: string) => setParticipantDraft((prev) => ({ ...prev, firstName: text }))}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Last name"
                title="Last name"
                value={participantDraft.lastName}
                onChangeText={(text: string) => setParticipantDraft((prev) => ({ ...prev, lastName: text }))}
              />
            </View>
            <TextInput
              style={styles.input}
              placeholder="Email (optional)"
              title="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={participantDraft.email ?? ''}
              onChangeText={(text: any) => setParticipantDraft((prev) => ({ ...prev, email: text }))}
            />
            <TouchableOpacity style={styles.button} onPress={() => addParticipant(participantDraft)}>
              <Text style={styles.buttonText}>Add Participant</Text>
            </TouchableOpacity>
            {participants.length ? (
              <View style={{ marginTop: 12 }}>
                {participants.map((p, idx) => (
                  <View key={`${p.firstName}-${p.lastName}-${idx}`} style={styles.memberPill}>
                    <Text style={styles.cellText}>
                      {p.firstName} {p.lastName} {p.email ? `(${p.email})` : ''}
                    </Text>
                    <TouchableOpacity onPress={() => setParticipants((prev) => prev.filter((_, i) => i !== idx))}>
                      <Text style={styles.removeText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.helperText}>No participants added yet.</Text>
            )}
          </>
        );
      case 3:
        return (
          <>
            <Text style={styles.sectionTitle}>Itinerary</Text>
            <Text style={styles.helperText}>
              Would you like to create a base itinerary using the help of AI?
            </Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[
                  styles.mapOptionButton ?? styles.button,
                  itineraryMode === 'ai' && (styles.mapOptionActive ?? styles.toggleActive),
                  { marginRight: 8 },
                ]}
                onPress={() => selectItineraryMode('ai')}
              >
                <Text style={[styles.mapOptionText ?? styles.buttonText, itineraryMode === 'ai' && (styles.mapOptionActiveText ?? styles.buttonText)]}>
                  Yes
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.mapOptionButton ?? styles.button,
                  itineraryMode === 'manual' && (styles.mapOptionActive ?? styles.toggleActive),
                ]}
                onPress={() => selectItineraryMode('manual')}
              >
                <Text style={[styles.mapOptionText ?? styles.buttonText, itineraryMode === 'manual' && (styles.mapOptionActiveText ?? styles.buttonText)]}>
                  No
                </Text>
              </TouchableOpacity>
            </View>
            {itineraryMode === 'ai' ? (
              <ScrollView
                style={{ maxHeight: 520 }}
                contentContainerStyle={{ paddingBottom: 12 }}
                showsVerticalScrollIndicator
                nestedScrollEnabled
              >
                <Text style={styles.helperText}>We'll generate a starter plan you can edit later.</Text>
                <Text style={styles.helperText}>
                  The AI itinerary will be generated after you complete all steps of the trip wizard.
                </Text>
                <TextInput
                    style={[
                    styles.input,
                    dates.mode === 'range' && computedDays ? styles.disabledInput : null,
                    ]}
                    placeholder="Trip days (optional if dates are set)"
                    title="Trip days"
                    keyboardType="numeric"
                    value={itineraryDays}
                    onChangeText={(text: string) => {
                    setItineraryDaysTouched(true);
                    setItineraryDays(text);
                    }}
                    editable={!(dates.mode === 'range' && computedDays)}
                  />
                <TextInput
                  style={styles.input}
                  placeholder="Trip style (optional)"
                  title="Trip style"
                  value={itineraryTripStyle}
                  onChangeText={(text: string) => setItineraryTripStyle(text)}
                />
                <Text style={styles.helperText}>Suggested styles</Text>
                <View style={[styles.row, { flexWrap: 'wrap' }]}>
                  {itineraryStyleOptions.map((style) => (
                    <TouchableOpacity
                      key={style}
                      style={[
                        styles.mapOptionButton ?? styles.button,
                        itineraryTripStyle === style && (styles.mapOptionActive ?? styles.toggleActive),
                        { marginRight: 8, marginTop: 4 },
                      ]}
                      onPress={() => setItineraryTripStyle(style)}
                    >
                      <Text style={[styles.mapOptionText ?? styles.buttonText, itineraryTripStyle === style && (styles.mapOptionActiveText ?? styles.buttonText)]}>
                        {style}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.modalLabel}>Planning Preferences</Text>
                <Text style={styles.helperText}>These map directly to prompt-plan `tt/ut` fields for itinerary generation.</Text>

                <Text style={styles.modalLabel}>Pace</Text>
                <View style={styles.traitGrid}>
                  {PROMPT_PACE_OPTIONS.map((opt) => {
                    const selected = wizardPromptTraits.tt.p === opt.value;
                    return (
                      <TouchableOpacity
                        key={`wizard-pace-${opt.value}`}
                        style={[styles.traitChip, selected && styles.traitChipSelected]}
                        onPress={() => setWizardPromptTraits((prev) => ({ ...prev, tt: { ...prev.tt, p: opt.value } }))}
                      >
                        <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.modalLabel}>Comfort</Text>
                <View style={styles.traitGrid}>
                  {PROMPT_COMFORT_OPTIONS.map((opt) => {
                    const selected = wizardPromptTraits.tt.c === opt.value;
                    return (
                      <TouchableOpacity
                        key={`wizard-comfort-${opt.value}`}
                        style={[styles.traitChip, selected && styles.traitChipSelected]}
                        onPress={() => setWizardPromptTraits((prev) => ({ ...prev, tt: { ...prev.tt, c: opt.value } }))}
                      >
                        <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.modalLabel}>Mobility</Text>
                <View style={styles.traitGrid}>
                  {PROMPT_MOBILITY_OPTIONS.map((opt) => {
                    const selected = wizardPromptTraits.tt.mob === opt.value;
                    return (
                      <TouchableOpacity
                        key={`wizard-mobility-${opt.value}`}
                        style={[styles.traitChip, selected && styles.traitChipSelected]}
                        onPress={() => setWizardPromptTraits((prev) => ({ ...prev, tt: { ...prev.tt, mob: opt.value } }))}
                      >
                        <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.modalLabel}>Car Preference</Text>
                <View style={styles.traitGrid}>
                  {PROMPT_CAR_OPTIONS.map((opt) => {
                    const selected = wizardPromptTraits.tt.car === opt.value;
                    return (
                      <TouchableOpacity
                        key={`wizard-car-${opt.value}`}
                        style={[styles.traitChip, selected && styles.traitChipSelected]}
                        onPress={() => setWizardPromptTraits((prev) => ({ ...prev, tt: { ...prev.tt, car: opt.value } }))}
                      >
                        <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.modalLabel}>Trip Mode</Text>
                <View style={styles.traitGrid}>
                  {PROMPT_TRIP_MODE_OPTIONS.map((opt) => {
                    const selected = wizardPromptTraits.tt.tm === opt.value;
                    return (
                      <TouchableOpacity
                        key={`wizard-mode-${opt.value}`}
                        style={[styles.traitChip, selected && styles.traitChipSelected]}
                        onPress={() => setWizardPromptTraits((prev) => ({ ...prev, tt: { ...prev.tt, tm: opt.value } }))}
                      >
                        <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.modalLabel}>Interest Weights</Text>
                <Text style={styles.helperText}>
                  Higher values make the AI emphasize that style more. Values are automatically rebalanced when generating.
                </Text>
                {INTEREST_WEIGHT_FIELDS.map((field) => {
                  const value = wizardPromptTraits.tt.w[field.key];
                  return (
                    <View key={`wizard-weight-${field.key}`} style={{ marginBottom: 10 }}>
                      <View style={[styles.row, { alignItems: 'center', justifyContent: 'space-between' }]}>
                        <Text style={styles.cellText}>{field.label}</Text>
                        <Text style={styles.helperText}>{value}%</Text>
                      </View>
                      {Platform.OS === 'web' ? (
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={value}
                          onChange={(e: any) => setWizardWeight(field.key, Number(e.target.value))}
                          style={{ width: '100%' }}
                        />
                      ) : (
                        <TextInput
                          style={styles.input}
                          keyboardType="numeric"
                          value={String(value)}
                          onChangeText={(text: string) => setWizardWeight(field.key, text)}
                        />
                      )}
                      <Text style={styles.helperText}>{field.help}</Text>
                    </View>
                  );
                })}

                <Text style={styles.modalLabel}>Interests (`ut.i`)</Text>
                <View style={styles.traitGrid}>
                  {PROMPT_INTEREST_OPTIONS.map((interest) => {
                    const selected = wizardPromptTraits.ut.i.includes(interest);
                    return (
                      <TouchableOpacity
                        key={`wizard-interest-${interest}`}
                        style={[styles.traitChip, selected && styles.traitChipSelected]}
                        onPress={() => toggleWizardInterest(interest)}
                      >
                        <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>{interest}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.row}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Custom interest"
                    value={wizardCustomInterest}
                    onChangeText={setWizardCustomInterest}
                  />
                  <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={addWizardInterest}>
                    <Text style={styles.buttonText}>Add</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.traitGrid}>
                  <TouchableOpacity
                    style={[styles.traitChip, wizardPromptTraits.ut.eb && styles.traitChipSelected]}
                    onPress={() => setWizardPromptTraits((prev) => ({ ...prev, ut: { ...prev.ut, eb: !prev.ut.eb } }))}
                  >
                    <Text style={[styles.traitChipText, wizardPromptTraits.ut.eb && styles.traitChipTextSelected]}>Early Bird</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.traitChip, wizardPromptTraits.ut.no && styles.traitChipSelected]}
                    onPress={() => setWizardPromptTraits((prev) => ({ ...prev, ut: { ...prev.ut, no: !prev.ut.no } }))}
                  >
                    <Text style={[styles.traitChipText, wizardPromptTraits.ut.no && styles.traitChipTextSelected]}>Night Owl</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ position: 'relative' }}>
                  <TextInput
                    ref={itineraryAirportRef}
                    style={styles.input}
                    placeholder="Departure airport (optional)"
                    title="Departure airport"
                    value={itineraryDepartureAirport}
                    onFocus={() => showItineraryAirportDropdown(itineraryDepartureAirport)}
                    onChangeText={(text: string) => {
                      setItineraryDepartureAirport(text);
                      showItineraryAirportDropdown(text);
                    }}
                  />
                  <TouchableOpacity
                    style={{ position: 'absolute', right: 8, top: 10, padding: 6 }}
                    onPress={() => showItineraryAirportDropdown(itineraryDepartureAirport)}
                  >
                    <Text style={styles.selectCaret}></Text>
                  </TouchableOpacity>
                </View>
                <View style={[styles.row, { flexWrap: 'wrap' }]}>
                  {(['cheap', 'middle', 'expensive'] as const).map((level) => (
                    <TouchableOpacity
                      key={level}
                      style={[
                        {
                          backgroundColor: budgetLevel === level ? '#0d6efd' : '#fff',
                          borderColor: '#0d6efd',
                          borderWidth: 1,
                          paddingVertical: 8,
                          paddingHorizontal: 12,
                          borderRadius: 6,
                        },
                        { marginRight: 8, marginTop: 4 },
                      ]}
                      onPress={() => setBudgetLevel(level)}
                    >
                      <Text style={{ color: budgetLevel === level ? '#fff' : '#0d6efd', fontWeight: '600' }}>
                        {level}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.helperText}>Selected budget: {budgetLevel}</Text>
              </ScrollView>
            ) : null}
            {itineraryMode === 'manual' ? (
              <ScrollView
                style={{ maxHeight: 520 }}
                contentContainerStyle={{ paddingBottom: 12 }}
                showsVerticalScrollIndicator
                nestedScrollEnabled
              >
                <Text style={styles.helperText}>All days are free to start. Add manual items to any day.</Text>
                {!computedDays && dates.mode === 'range' ? (
                  <TextInput
                    style={styles.input}
                    placeholder="Trip days (optional if dates are set)"
                    title="Trip days"
                    keyboardType="numeric"
                    value={itineraryDays}
                    onChangeText={setItineraryDays}
                  />
                ) : null}
                {!dates.durationDays && dates.mode === 'month' ? (
                  <TextInput
                    style={styles.input}
                    placeholder="Trip days (optional if dates are set)"
                    title="Trip days"
                    keyboardType="numeric"
                    value={itineraryDays}
                    onChangeText={setItineraryDays}
                  />
                ) : null}
                <View style={{ gap: 8 }}>
                  {manualDayList.map((day) => {
                    const items = manualItemsByDay.get(day) ?? [];
                    return (
                      <View key={`manual-day-${day}`} style={styles.planBox ?? styles.card}>
                        <Text style={styles.headerText}>{formatManualDayLabel(day)}</Text>
                        {items.length ? (
                          items.map(({ item, index }) => (
                            <View key={`${item.activity}-${index}`} style={styles.memberPill}>
                              <Text style={styles.cellText}>
                                {item.time ? `${item.time} - ` : ''}{item.activity}
                              </Text>
                              <TouchableOpacity onPress={() => setItineraryItems((prev) => prev.filter((_, i) => i !== index))}>
                                <Text style={styles.removeText}>Remove</Text>
                              </TouchableOpacity>
                            </View>
                          ))
                        ) : (
                          <Text style={styles.helperText}>Free day</Text>
                        )}
                        <TouchableOpacity
                          style={[styles.button, styles.smallButton]}
                          onPress={() => setManualDay(day)}
                          title={`Add item to ${formatManualDayLabel(day)}`}
                        >
                          <Text style={styles.buttonText}>Add item</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
                {manualDay ? (
                  <View style={styles.card}>
                    <Text style={styles.headerText}>Add item to {formatManualDayLabel(manualDay)}</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Time (optional)"
                      title="Time"
                      value={manualDraft.time}
                      onChangeText={(text: any) => setManualDraft((prev) => ({ ...prev, time: text }))}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Activity description"
                      title="Activity description"
                      value={manualDraft.activity}
                      onChangeText={(text: any) => setManualDraft((prev) => ({ ...prev, activity: text }))}
                    />
                    <TouchableOpacity style={styles.button} onPress={() => addManualItem(manualDay)}>
                      <Text style={styles.buttonText}>Add Itinerary Item</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.helperText}>Select a day to add manual items.</Text>
                )}
              </ScrollView>
            ) : null}
            {!itineraryMode ? (
              <Text style={styles.helperText}>You can always build an itinerary later.</Text>
            ) : null}
          </>
        );
      case 4:
        return (
          <>
            <Text style={styles.sectionTitle}>Flight Details</Text>
            <Text style={styles.helperText}>Optional. Add flight details using the full flights interface.</Text>
            <FlightsTab
              backendUrl={backendUrl}
              userToken={userToken}
              activeTripId={null}
              flights={wizardFlights}
              setFlights={setWizardFlights}
              groupMembers={wizardGroupMembers}
              defaultPayerId={wizardDefaultPayerId}
              formatMemberName={formatWizardMemberName}
              payerName={wizardPayerName}
              headers={headers}
              jsonHeaders={wizardJsonHeaders}
              findActiveTrip={() => wizardTripDefaults}
              fetchGroupMembersForActiveTrip={async () => undefined}
              styles={styles}
              airportOptions={airportOptions}
              onSearchAirports={onSearchAirports}
              modalOverlayStyle={{
                ...(Platform.OS === 'web'
                  ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }
                  : { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }),
                zIndex: 45000,
                elevation: 80,
              }}
              modalCardStyle={{ zIndex: 46000, elevation: 84 }}
              showList
              mode="wizard"
            />
          </>
        );
      case 5:
        return (
          <>
            <Text style={styles.sectionTitle}>Accommodation Details</Text>
            <Text style={styles.helperText}>Optional. Add lodging details using the full lodging interface.</Text>
            <View style={styles.row}>
              <Text style={styles.sectionTitle}>Lodgings</Text>
              <TouchableOpacity style={[styles.button, styles.roundButton]} onPress={() => openWizardLodgingEditor(null)}>
                <Text style={styles.buttonText}>+</Text>
              </TouchableOpacity>
            </View>
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
                  <View style={[styles.cell, styles.lodgingDateCol]}>
                    <Text style={styles.headerText}>Status</Text>
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
                  <View style={[styles.cell, styles.lodgingPayerCol]}>
                    <Text style={styles.headerText}>Paid By</Text>
                  </View>
                  <View style={[styles.cell, styles.lodgingAddressCol]}>
                    <Text style={styles.headerText}>Address</Text>
                  </View>
                  <View style={[styles.cell, styles.actionCell, styles.lodgingActionCol, styles.lastCell]}>
                    <Text style={styles.headerText}>Actions</Text>
                  </View>
                </View>

                {wizardLodgings.map((l) => (
                  <View key={l.id} style={styles.tableRow}>
                    <View style={[styles.cell, styles.lodgingNameCol]}>
                      <Text style={[styles.cellText, styles.cellTextWrap]}>{l.name}</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingDateCol]}>
                      <Text style={[styles.cellText, styles.cellTextWrap]}>{formatDateLong(normalizeDateString(l.checkInDate))}</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingDateCol]}>
                      <Text style={[styles.cellText, styles.cellTextWrap]}>{formatDateLong(normalizeDateString(l.checkOutDate))}</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingDateCol]}>
                      <Text style={[styles.cellText, styles.cellTextWrap]}>{normalizeItineraryStatus((l as any).status, LEGACY_ITINERARY_STATUS)}</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingRoomsCol]}>
                      <Text style={[styles.cellText, styles.cellTextWrap]}>{l.rooms || '-'}</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingRefundCol]}>
                      <Text style={[styles.cellText, styles.cellTextWrap]}>
                        {l.refundBy ? formatDateLong(normalizeDateString(l.refundBy)) : 'Non-refundable'}
                      </Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingCostCol]}>
                      <Text style={[styles.cellText, styles.cellTextWrap]}>{l.totalCost ? `$${l.totalCost}` : '-'}</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingCostCol]}>
                      <Text style={[styles.cellText, styles.cellTextWrap]}>{l.costPerNight ? `$${l.costPerNight}` : '-'}</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingPayerCol]}>
                      <Text style={[styles.cellText, styles.cellTextWrap]}>{l.paidBy?.length ? l.paidBy.map(wizardPayerName).join(', ') : '-'}</Text>
                    </View>
                    <View style={[styles.cell, styles.lodgingAddressCol]}>
                      {l.address ? (
                        <TouchableOpacity onPress={() => openWizardMaps(l.address)}>
                          <Text style={[styles.cellText, styles.linkText, styles.cellTextWrap]}>{l.address}</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={[styles.cellText, styles.cellTextWrap]}>-</Text>
                      )}
                    </View>
                    <View
                      style={[
                        styles.cell,
                        styles.actionCell,
                        styles.lodgingActionCol,
                        styles.lastCell,
                        { flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'flex-start' },
                      ]}
                    >
                      <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => openWizardLodgingEditor(l)}>
                        <Text style={styles.buttonText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.button, styles.smallButton, styles.dangerButton]}
                        onPress={() => removeWizardLodging(l.id)}
                      >
                        <Text style={styles.buttonText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
            {editingWizardLodging ? (
              <LodgingDialog
                visible={!!editingWizardLodging}
                title={editingWizardLodgingId ? 'Lodging Details' : 'Add Lodging'}
                draft={editingWizardLodging}
                setDraft={setEditingWizardLodging as React.Dispatch<React.SetStateAction<LodgingDraft>>}
                groupMembers={wizardGroupMembers}
                formatMemberName={formatWizardMemberName}
                payerName={wizardPayerName}
                defaultPayerId={wizardDefaultPayerId}
                styles={styles}
                onSave={() => saveWizardLodging(editingWizardLodging, editingWizardLodgingId)}
                onSaveAndAddAnother={
                  !editingWizardLodgingId
                    ? () => saveWizardLodging(editingWizardLodging, null, { addAnother: true })
                    : undefined
                }
                onCancel={closeWizardLodgingEditor}
                onOpenDatePicker={(field) => openWizardLodgingDatePicker(field)}
              />
            ) : null}
            <View style={{ marginTop: 12 }}>
              <Text style={styles.flightTitle}>Total lodging cost: ${wizardLodgingTotal.toFixed(2)}</Text>
              <Text style={styles.helperText}>Breakdown (aligned with total even when no payers are set):</Text>
              {wizardGroupMembers.map((m) => (
                <Text key={m.id} style={styles.helperText}>
                  {formatWizardMemberName(m)}: ${Number(wizardLodgingTotalsBalanced[m.id] ?? 0).toFixed(2)}
                </Text>
              ))}
              <Text style={[styles.helperText, { marginTop: 4 }]}>Subtotal across payers: ${wizardLodgingBreakdownSum.toFixed(2)}</Text>
            </View>
          </>
        );
      case 6:
        return (
          <>
            <Text style={styles.sectionTitle}>Activities</Text>
            <Text style={styles.helperText}>Optional. Add tours using the full tours interface.</Text>
            <ActivityTab
              backendUrl={backendUrl}
              userToken={userToken}
              activeTripId={null}
              tours={wizardTours}
              setTours={setWizardTours}
              defaultPayerId={wizardDefaultPayerId}
              payerName={wizardPayerName}
              formatMemberName={formatWizardMemberName}
              groupMembers={wizardGroupMembers}
              jsonHeaders={wizardJsonHeaders}
              payerTotals={wizardToursPayerTotals}
              toursTotal={wizardToursTotal}
              styles={styles}
              nativeDateTimePicker={NativeDateTimePicker}
              fetchTours={async () => undefined}
              mode="wizard"
            />
          </>
        );
      case 7:
        return (
          <>
            <Text style={styles.sectionTitle}>Rental Cars</Text>
            <Text style={styles.helperText}>Optional. Add rental cars using the full car rentals interface.</Text>
            <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
              <View style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeader]}>
                {['Pick Up Location', 'Pick Up Date', 'Drop Off Location', 'Drop Off Date', 'Status', 'Reference', 'Vendor', 'Prepaid?', 'Cost', 'Car Model', 'Notes', 'For', 'Paid By', 'Actions'].map((label, idx, arr) => (
                    <View
                      key={label}
                      style={[styles.cell, { minWidth: 140, flex: 1 }, idx === arr.length - 1 && styles.lastCell]}
                    >
                      <Text style={styles.headerText}>{label}</Text>
                    </View>
                  ))}
                </View>
                {wizardCarRentals.map((car) => (
                  <View key={car.id} style={styles.tableRow}>
                    <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                      <Text style={[styles.cellText, styles.cellTextWrap]}>{car.pickupLocation || '-'}</Text>
                    </View>
                    <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                      <Text style={styles.cellText}>{car.pickupDate || '-'}</Text>
                    </View>
                    <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                      <Text style={[styles.cellText, styles.cellTextWrap]}>{car.dropoffLocation || '-'}</Text>
                    </View>
                    <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                      <Text style={styles.cellText}>{car.dropoffDate || '-'}</Text>
                    </View>
                    <View style={[styles.cell, { minWidth: 130, flex: 1 }]}>
                      <Text style={styles.cellText}>{normalizeItineraryStatus((car as any).status, LEGACY_ITINERARY_STATUS)}</Text>
                    </View>
                    <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                      <Text style={styles.cellText}>{car.reference || '-'}</Text>
                    </View>
                    <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                      <Text style={styles.cellText}>{car.vendor || '-'}</Text>
                    </View>
                    <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                      <Text style={styles.cellText}>{car.prepaid || '-'}</Text>
                    </View>
                    <View style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                      <Text style={styles.cellText}>{car.cost ? `$${car.cost}` : '-'}</Text>
                    </View>
                    <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                      <Text style={styles.cellText}>{car.model || '-'}</Text>
                    </View>
                    <View style={[styles.cell, { minWidth: 220, flex: 1 }]}>
                      <Text style={[styles.cellText, styles.cellTextWrap]}>{car.notes || '-'}</Text>
                    </View>
                    <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                      <Text style={styles.cellText}>
                        {(car.travelerIds ?? []).length ? (car.travelerIds ?? []).map(wizardPayerName).join(', ') : '-'}
                      </Text>
                    </View>
                    <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                      <Text style={styles.cellText}>{car.paidBy.length ? car.paidBy.map(wizardPayerName).join(', ') : '-'}</Text>
                    </View>
                    <View style={[styles.cell, styles.actionCell, { minWidth: 160, flex: 1 }, styles.lastCell]}>
                      <TouchableOpacity style={[styles.smallButton, styles.dangerButton]} onPress={() => removeWizardCarRental(car.id)}>
                        <Text style={styles.buttonText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                <View style={[styles.tableRow, styles.inputRow, styles.lastRow]}>
                  <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Pick up location"
                      title="Pick up location"
                      value={wizardCarDraft.pickupLocation}
                      onChangeText={(text: any) => setWizardCarDraft((p) => ({ ...p, pickupLocation: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                    <View style={[styles.dateInputWrap, { minWidth: 0, width: '100%', flex: 0 }]}>
                      {Platform.OS === 'web' ? (
                        <input
                          ref={wizardCarPickupDateRef as any}
                          type="date"
                          title="Pick up date"
                          value={wizardCarDraft.pickupDate}
                          onChange={(e) => setWizardCarDraft((p) => ({ ...p, pickupDate: e.target.value }))}
                          style={webDateInputStyle}
                        />
                      ) : (
                        <TouchableOpacity
                          style={[styles.input, styles.dateTouchable]}
                          onPress={() => openWizardCarDatePicker('pickup')}
                        >
                          <Text style={styles.cellText}>{wizardCarDraft.pickupDate || 'YYYY-MM-DD'}</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.dateIcon}
                        onPress={() => openWizardCarDatePicker('pickup')}
                      >
                        <Text style={styles.selectCaret}>v</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Drop off location"
                      title="Drop off location"
                      value={wizardCarDraft.dropoffLocation}
                      onChangeText={(text: any) => setWizardCarDraft((p) => ({ ...p, dropoffLocation: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                    <View style={[styles.dateInputWrap, { minWidth: 0, width: '100%', flex: 0 }]}>
                      {Platform.OS === 'web' ? (
                        <input
                          ref={wizardCarDropoffDateRef as any}
                          type="date"
                          title="Drop off date"
                          value={wizardCarDraft.dropoffDate}
                          onChange={(e) => setWizardCarDraft((p) => ({ ...p, dropoffDate: e.target.value }))}
                          style={webDateInputStyle}
                        />
                      ) : (
                        <TouchableOpacity
                          style={[styles.input, styles.dateTouchable]}
                          onPress={() => openWizardCarDatePicker('dropoff')}
                        >
                          <Text style={styles.cellText}>{wizardCarDraft.dropoffDate || 'YYYY-MM-DD'}</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.dateIcon}
                        onPress={() => openWizardCarDatePicker('dropoff')}
                      >
                          <Text style={styles.selectCaret}>v</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                    {Platform.OS === 'web' ? (
                      <select
                        value={normalizeItineraryStatus(wizardCarDraft.status, DEFAULT_NEW_ITINERARY_STATUS)}
                        onChange={(e) =>
                          setWizardCarDraft((p) => ({
                            ...p,
                            status: normalizeItineraryStatus(e.target.value, DEFAULT_NEW_ITINERARY_STATUS),
                          }))
                        }
                        style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box' })}
                      >
                        {ITINERARY_STATUSES.map((opt) => (
                          <option key={`wizard-car-status-${opt}`} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Text style={styles.cellText}>{normalizeItineraryStatus(wizardCarDraft.status, DEFAULT_NEW_ITINERARY_STATUS)}</Text>
                    )}
                  </View>
                  <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Reference"
                      title="Reference"
                      value={wizardCarDraft.reference}
                      onChangeText={(text: any) => setWizardCarDraft((p) => ({ ...p, reference: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Vendor"
                      title="Vendor"
                      value={wizardCarDraft.vendor}
                      onChangeText={(text: any) => setWizardCarDraft((p) => ({ ...p, vendor: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                    <View style={[styles.dropdown, { width: '100%' }]}>
                      <TouchableOpacity
                        style={[styles.input, styles.selectButtonRow]}
                        title="Prepaid status"
                        onPress={() => setWizardCarPrepaidOpen((s) => !s)}
                      >
                        <Text style={styles.cellText}>{wizardCarDraft.prepaid || 'Select Yes/No'}</Text>
                        <Text style={styles.selectCaret}></Text>
                      </TouchableOpacity>
                      {wizardCarPrepaidOpen ? (
                        <View style={[styles.dropdownList, { position: 'relative', top: 0 }]}>
                          {['Yes', 'No'].map((opt) => (
                            <TouchableOpacity
                              key={opt}
                              style={styles.dropdownOption}
                              onPress={() => {
                                setWizardCarDraft((p) => ({ ...p, prepaid: opt }));
                                setWizardCarPrepaidOpen(false);
                              }}
                            >
                              <Text style={styles.cellText}>{opt}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <View style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Cost"
                      title="Cost"
                      keyboardType="numeric"
                      value={wizardCarDraft.cost}
                      onChangeText={(text: string) =>
                        setWizardCarDraft((p) => ({ ...p, cost: sanitizeCostInput(text) }))
                      }
                    />
                  </View>
                  <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Car model"
                      title="Car model"
                      value={wizardCarDraft.model}
                      onChangeText={(text: any) => setWizardCarDraft((p) => ({ ...p, model: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { minWidth: 220, flex: 1 }]}>
                    <TextInput
                      style={[styles.input, styles.cellTextWrap]}
                      placeholder="Notes"
                      title="Notes"
                      value={wizardCarDraft.notes}
                      onChangeText={(text: any) => setWizardCarDraft((p) => ({ ...p, notes: text }))}
                      multiline
                    />
                  </View>
                  <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                    <View style={styles.payerChips}>
                      {wizardCarDraft.travelerIds.map((id) => (
                        <View key={`wizard-car-traveler-${id}`} style={styles.payerChip}>
                          <Text style={styles.cellText}>{wizardPayerName(id)}</Text>
                          <TouchableOpacity onPress={() => setWizardCarDraft((prev) => ({ ...prev, travelerIds: prev.travelerIds.filter((x) => x !== id) }))}>
                            <Text style={styles.removeText}>x</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                    <View style={styles.payerOptions}>
                      {wizardGroupMembers
                        .filter((m) => !wizardCarDraft.travelerIds.includes(m.id))
                        .map((m) => (
                          <TouchableOpacity
                            key={`wizard-car-traveler-add-${m.id}`}
                            style={styles.smallButton}
                            onPress={() => setWizardCarDraft((prev) => ({ ...prev, travelerIds: [...prev.travelerIds, m.id] }))}
                          >
                            <Text style={styles.buttonText}>Add {formatWizardMemberName(m)}</Text>
                          </TouchableOpacity>
                        ))}
                    </View>
                  </View>
                  <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                    <View style={styles.payerChips}>
                      {wizardCarDraft.paidBy.map((id) => (
                        <View key={id} style={styles.payerChip}>
                          <Text style={styles.cellText}>{wizardPayerName(id)}</Text>
                          <TouchableOpacity onPress={() => setWizardCarDraft((prev) => ({ ...prev, paidBy: prev.paidBy.filter((x) => x !== id) }))}>
                            <Text style={styles.removeText}>x</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                    <View style={styles.payerOptions}>
                      {wizardGroupMembers
                        .filter((m) => !wizardCarDraft.paidBy.includes(m.id))
                        .map((m) => (
                          <TouchableOpacity
                            key={m.id}
                            style={styles.smallButton}
                            onPress={() => setWizardCarDraft((prev) => ({ ...prev, paidBy: [...prev.paidBy, m.id] }))}
                          >
                            <Text style={styles.buttonText}>Add {formatWizardMemberName(m)}</Text>
                          </TouchableOpacity>
                        ))}
                    </View>
                  </View>
                  <View style={[styles.cell, styles.actionCell, { minWidth: 160, flex: 1 }, styles.lastCell]}>
                    <TouchableOpacity style={styles.button} onPress={addWizardCarRental}>
                      <Text style={styles.buttonText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </ScrollView>
          </>
        );
      case 8:
      default:
        return (
          <>
            <Text style={styles.sectionTitle}>Review & Confirm</Text>
            <Text style={styles.helperText}>Confirm everything looks good before creating the trip.</Text>
            <Text style={styles.headerText}>Trip</Text>
            <Text style={styles.bodyText}>Name: {details.name || 'Untitled trip'}</Text>
            {selectedLocations.length ? (
              <Text style={styles.bodyText}>Locations: {selectedLocations.map((loc) => loc.name).join(', ')}</Text>
            ) : null}
            {dates.mode === 'range' && (dates.startDate || dates.endDate) ? (
              <Text style={styles.bodyText}>Dates: {dates.startDate || 'TBD'} - {dates.endDate || 'TBD'}</Text>
            ) : null}
            {dates.mode === 'month' && monthLabel && dates.durationDays ? (
              <Text style={styles.bodyText}>
                Dates: {monthLabel} · {dates.durationDays} day(s)
              </Text>
            ) : null}
            {details.description ? (
              <View style={{ marginTop: 8 }}>
                {renderRichTextBlocks(details.description, {
                  base: styles.bodyText,
                  bold: styles.headerText,
                  italic: styles.helperText,
                  link: styles.linkText ?? styles.buttonText,
                  listItem: styles.helperText,
                })}
              </View>
            ) : null}
            <Text style={styles.headerText}>Participants</Text>
            {participants.length ? (
              participants.map((p, idx) => (
                <Text key={`${p.firstName}-${p.lastName}-${idx}`} style={styles.bodyText}>
                  {p.firstName} {p.lastName} {p.email ? `(${p.email})` : ''}
                </Text>
              ))
            ) : (
              <Text style={styles.helperText}>No participants added.</Text>
            )}
            <Text style={styles.headerText}>Itinerary</Text>
            {itineraryEnabled ? (
              <Text style={styles.bodyText}>
                {generateItinerary
                  ? 'AI plan will be generated.'
                  : itineraryMode === 'manual'
                    ? 'Manual itinerary selected.'
                    : 'Itinerary selected.'}{' '}
                Items: {itineraryItems.length}
              </Text>
            ) : (
              <Text style={styles.helperText}>No itinerary created yet.</Text>
            )}
            {wizardLodgings.length ? (
              <>
                <Text style={styles.headerText}>Accommodation</Text>
                {wizardLodgings.map((l) => (
                  <Text key={l.id} style={styles.bodyText}>
                    {l.name} ({normalizeDateString(l.checkInDate)} - {normalizeDateString(l.checkOutDate)})
                  </Text>
                ))}
              </>
            ) : null}
            {wizardTours.length ? (
              <>
                <Text style={styles.headerText}>Activities</Text>
                {wizardTours.map((t) => (
                  <Text key={t.id} style={styles.bodyText}>
                    {t.name || 'Activity'} ({normalizeDateString(t.date)})
                  </Text>
                ))}
              </>
            ) : null}
            {wizardCarRentals.length ? (
              <>
                <Text style={styles.headerText}>Rental Cars</Text>
                {wizardCarRentals.map((r) => (
                  <Text key={r.id} style={styles.bodyText}>
                    {r.vendor || 'Rental'} ({r.pickupDate || 'TBD'} - {r.dropoffDate || 'TBD'})
                  </Text>
                ))}
              </>
            ) : null}
            {hasKnownInfo ? (
              <>
                <Text style={styles.headerText}>Known Info</Text>
                {knownInfo.flights ? <Text style={styles.bodyText}>Flights: {knownInfo.flights}</Text> : null}
                {knownInfo.tours ? <Text style={styles.bodyText}>Activities: {knownInfo.tours}</Text> : null}
                {knownInfo.cars ? <Text style={styles.bodyText}>Rental cars: {knownInfo.cars}</Text> : null}
              </>
            ) : null}
          </>
        );
    }
  };

  if (createdTripId) {
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Creating trip...</Text>
        <Text style={styles.helperText}>Finalizing setup and opening your overview.</Text>
      </View>
    );
  }

  return (
    <View style={{ position: 'relative' }}>
      <ScrollView style={styles.card} contentContainerStyle={{ gap: 12 }}>
        <View style={[styles.row, { alignItems: 'center', justifyContent: 'space-between' }]}>
          <View>
            <Text style={styles.sectionTitle}>Create Trip Wizard</Text>
            <Text style={styles.helperText}>
              Step {stepIndex + 1} of {totalSteps}: {steps[stepIndex]}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.button, styles.dangerButton, { paddingHorizontal: 12, paddingVertical: 6 }]}
            onPress={() => setShowExitConfirm(true)}
          >
            <Text style={styles.buttonText}>X</Text>
          </TouchableOpacity>
        </View>
        {wizardError ? <Text style={styles.errorText}>{wizardError}</Text> : null}
        {renderStepContent()}
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.button, styles.dangerButton, { flex: 1 }]}
            onPress={stepIndex === 0 ? onCancel : goBack}
          >
            <Text style={styles.buttonText}>{stepIndex === 0 ? 'Cancel' : 'Back'}</Text>
          </TouchableOpacity>
          {stepIndex < totalSteps - 1 ? (
            <TouchableOpacity
              style={[styles.button, { flex: 1 }, !canMoveNext() && { opacity: 0.6 }]}
              onPress={goNext}
              disabled={!canMoveNext()}
            >
              <Text style={styles.buttonText}>Next</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={submitWizard} disabled={isSubmitting}>
              <Text style={styles.buttonText}>{isSubmitting ? 'Creating...' : 'Create Trip'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
      {showItineraryAirportSuggestions && itineraryAirportAnchor ? (
        <View style={[styles.passengerOverlay, { backgroundColor: 'transparent', zIndex: 52000, elevation: 80 }]}>
          <TouchableOpacity
            style={[styles.passengerOverlayBackdrop, { backgroundColor: 'transparent' }]}
            onPress={hideItineraryAirportDropdown}
          />
          <View
            style={[
              styles.passengerOverlayList,
              {
                zIndex: 53000,
                elevation: 84,
                left: itineraryAirportAnchor.x,
                top: itineraryAirportAnchor.y + itineraryAirportAnchor.height,
                width: itineraryAirportAnchor.width || 280,
              },
            ]}
          >
            {itineraryAirportSuggestions.length ? (
              itineraryAirportSuggestions.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={styles.dropdownOption}
                  onPress={() => {
                    const codeMatch = opt.match(/\(([A-Za-z]{3})\)/);
                    const value = codeMatch ? codeMatch[1].toUpperCase() : opt;
                    setItineraryDepartureAirport(value);
                    hideItineraryAirportDropdown();
                  }}
                >
                  <Text style={styles.cellText}>{opt}</Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.helperText}>Type to search airports</Text>
            )}
          </View>
        </View>
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
              setStartDateWithRangeGuard(iso);
            } else if (dateField === 'end') {
              setDates((prev) => ({ ...prev, endDate: iso }));
            } else {
              setItineraryDraft((prev) => ({ ...prev, date: iso }));
            }
            setDateField(null);
          }}
        />
      ) : null}
      {Platform.OS !== 'web' && wizardLodgingDateField && NativeDateTimePicker ? (
        <NativeDateTimePicker
          value={wizardLodgingDateValue}
          mode="date"
          onChange={(_, date) => {
            if (!date) {
              setWizardLodgingDateField(null);
              return;
            }
            const iso = date.toISOString().slice(0, 10);
            if (wizardLodgingDateField !== 'checkIn' && wizardLodgingDateField !== 'checkOut') {
              setWizardLodgingDateField(null);
              return;
            }
            applyWizardLodgingDate(wizardLodgingDateField, iso);
            setWizardLodgingDateField(null);
          }}
        />
      ) : null}
      {Platform.OS !== 'web' && wizardCarDateField && NativeDateTimePicker ? (
        <NativeDateTimePicker
          value={wizardCarDateValue}
          mode="date"
          onChange={(_, date) => {
            if (!date) {
              setWizardCarDateField(null);
              return;
            }
            const iso = date.toISOString().slice(0, 10);
            applyWizardCarDate(wizardCarDateField, iso);
            setWizardCarDateField(null);
          }}
        />
      ) : null}
      {editingWizardLodging && editingWizardLodgingId ? (
        <View style={styles.passengerOverlay}>
          <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={closeWizardLodgingEditor} />
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>Edit Lodging</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.modalLabel}>Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Lodging name"
                title="Lodging name"
                value={editingWizardLodging.name}
                onChangeText={(text: any) => setEditingWizardLodging((prev) => (prev ? { ...prev, name: text } : prev))}
              />
              <Text style={styles.modalLabel}>Check-in</Text>
              <View style={styles.dateInputWrap}>
                {Platform.OS === 'web' ? (
                  <input
                    ref={wizardEditLodgingCheckInRef as any}
                    type="date"
                    title="Check-in date"
                    value={editingWizardLodging.checkInDate}
                    onChange={(e) =>
                      setEditingWizardLodging((prev) =>
                        prev ? { ...prev, checkInDate: normalizeDateString(e.target.value) } : prev
                      )
                    }
                    style={webDateInputStyle}
                  />
                ) : (
                  <TouchableOpacity
                    style={[styles.input, styles.dateTouchable]}
                    onPress={() => openWizardLodgingDatePicker('checkIn', editingWizardLodging.checkInDate)}
                  >
                    <Text style={styles.cellText}>{editingWizardLodging.checkInDate || 'YYYY-MM-DD'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.dateIcon}
                  onPress={() => openWizardLodgingDatePicker('checkIn', editingWizardLodging.checkInDate)}
                >
                  <Text style={styles.selectCaret}>v</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.modalLabel}>Check-out</Text>
              <View style={styles.dateInputWrap}>
                {Platform.OS === 'web' ? (
                  <input
                    ref={wizardEditLodgingCheckOutRef as any}
                    type="date"
                    title="Check-out date"
                    value={editingWizardLodging.checkOutDate}
                    onChange={(e) =>
                      setEditingWizardLodging((prev) =>
                        prev ? { ...prev, checkOutDate: normalizeDateString(e.target.value) } : prev
                      )
                    }
                    style={webDateInputStyle}
                  />
                ) : (
                  <TouchableOpacity
                    style={[styles.input, styles.dateTouchable]}
                    onPress={() => openWizardLodgingDatePicker('checkOut', editingWizardLodging.checkOutDate)}
                  >
                    <Text style={styles.cellText}>{editingWizardLodging.checkOutDate || 'YYYY-MM-DD'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.dateIcon}
                  onPress={() => openWizardLodgingDatePicker('checkOut', editingWizardLodging.checkOutDate)}
                >
                  <Text style={styles.selectCaret}>v</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.modalLabel}>Rooms</Text>
              <TextInput
                style={styles.input}
                placeholder="Number of rooms"
                title="Rooms"
                keyboardType="numeric"
                value={editingWizardLodging.rooms}
                onChangeText={(text: any) => setEditingWizardLodging((prev) => (prev ? { ...prev, rooms: text } : prev))}
              />
              <Text style={styles.modalLabel}>Refund by</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  title="Refund by date"
                  value={editingWizardLodging.refundBy}
                  onChange={(e) => setEditingWizardLodging((prev) => (prev ? { ...prev, refundBy: e.target.value } : prev))}
                  style={webDateInputStyle}
                />
              ) : (
                <TextInput
                  style={styles.input}
                  value={editingWizardLodging.refundBy}
                  placeholder="YYYY-MM-DD"
                  title="Refund by date"
                  onChangeText={(text: string) =>
                    setEditingWizardLodging((prev) => (prev ? { ...prev, refundBy: normalizeDateString(text) } : prev))
                  }
                />
              )}
              <Text style={styles.modalLabel}>Total cost</Text>
              <TextInput
                style={styles.input}
                placeholder="Total cost"
                title="Total cost"
                value={editingWizardLodging.totalCost}
                keyboardType="numeric"
                onChangeText={(text: any) => setEditingWizardLodging((prev) => (prev ? { ...prev, totalCost: text } : prev))}
              />
              <Text style={styles.modalLabel}>Cost per night</Text>
              <Text style={styles.helperText}>{editingWizardLodging.costPerNight ? `$${editingWizardLodging.costPerNight}` : '-'}</Text>

              <Text style={styles.modalLabel}>Paid by</Text>
              <View style={[styles.input, styles.payerBox]}>
                <View style={styles.payerChips}>
                  {editingWizardLodging.paidBy.map((id) => (
                    <View key={id} style={styles.payerChip}>
                      <Text style={styles.cellText}>{wizardPayerName(id)}</Text>
                      <TouchableOpacity
                        onPress={() =>
                          setEditingWizardLodging((p) =>
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
                  {wizardGroupMembers
                    .filter((m) => !editingWizardLodging.paidBy.includes(m.id))
                    .map((m) => (
                      <TouchableOpacity
                        key={m.id}
                        style={styles.smallButton}
                        onPress={() =>
                          setEditingWizardLodging((p) => (p ? { ...p, paidBy: [...p.paidBy, m.id] } : p))
                        }
                      >
                        <Text style={styles.buttonText}>Add {formatWizardMemberName(m)}</Text>
                      </TouchableOpacity>
                    ))}
                </View>
              </View>

              <Text style={styles.modalLabel}>Address</Text>
              <TextInput
                style={styles.input}
                placeholder="Address"
                title="Address"
                value={editingWizardLodging.address}
                onChangeText={(text: any) => setEditingWizardLodging((prev) => (prev ? { ...prev, address: text } : prev))}
              />
            </ScrollView>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={closeWizardLodgingEditor}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.button}
                onPress={() => editingWizardLodging && saveWizardLodging(editingWizardLodging, editingWizardLodgingId)}
              >
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
      {showExitConfirm ? (
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <Text style={styles.sectionTitle}>Exit trip wizard?</Text>
            <Text style={styles.helperText}>Your progress will not be saved.</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.button, styles.dangerButton, { flex: 1 }]}
                onPress={() => {
                  setShowExitConfirm(false);
                  onCancel();
                }}
              >
                <Text style={styles.buttonText}>Exit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => setShowExitConfirm(false)}>
                <Text style={styles.buttonText}>Stay</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
};

export default CreateTripWizard;

