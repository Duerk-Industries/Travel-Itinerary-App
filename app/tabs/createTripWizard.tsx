import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { Trait } from './traits';
import { FlightsTab, type Flight, type GroupMemberOption, buildFlightPayload, type FlightEditDraft } from './flights';
import {
  type Lodging,
  type LodgingDraft,
  buildLodgingPayload,
  calculateNights,
  createInitialLodgingState,
  toLodgingDraft,
} from './lodging';
import { balanceCategoryTotals, computePayerTotals } from './costReport';
import { renderRichTextBlocks } from '../utils/richText';
import { formatDateLong } from '../utils/formatDateLong';
import { TourTab, type Tour, buildTourPayload } from './tours';
import { type CarRental, type CarRentalDraft, buildCarRentalFromDraft, createInitialCarRentalDraft } from './carRentals';
import { parsePlanToDetails } from '../utils/itineraryParser';
import { computeDurationFromRange, formatMonthYear } from '../utils/tripDates';
import { normalizeDateString } from '../utils/normalizeDateString';
import {
  TripDetails,
  TripDates,
  ParticipantInput,
  ItineraryItemInput,
  KnownInfoInput,
  buildTripDescription,
  computeTripDays,
  canProceedFromItineraryStep,
  normalizeEmail,
  validateParticipants,
  validateTripDates,
  validateTripDetails,
} from '../utils/createTripWizard';

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
  'Tours & Activities',
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
  onUnauthorized,
  onWizardCarRentals,
  currentUserName,
  currentUserEmail,
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [details, setDetails] = useState<TripDetails>({ name: '', description: '', destination: '' });
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
  const [wizardLodgingDraft, setWizardLodgingDraft] = useState<LodgingDraft>(createInitialLodgingState());
  const [wizardCarDraft, setWizardCarDraft] = useState<CarRentalDraft>(createInitialCarRentalDraft());
  const [wizardCarDateField, setWizardCarDateField] = useState<'pickup' | 'dropoff' | null>(null);
  const [wizardCarDateValue, setWizardCarDateValue] = useState<Date>(new Date());
  const [wizardCarPrepaidOpen, setWizardCarPrepaidOpen] = useState(false);
  const [editingWizardLodgingId, setEditingWizardLodgingId] = useState<string | null>(null);
  const [editingWizardLodging, setEditingWizardLodging] = useState<LodgingDraft | null>(null);
  const [wizardLodgingDateField, setWizardLodgingDateField] = useState<'checkIn' | 'checkOut' | 'refund' | null>(null);
  const [wizardLodgingDateContext, setWizardLodgingDateContext] = useState<'draft' | 'edit'>('draft');
  const [wizardLodgingDateValue, setWizardLodgingDateValue] = useState<Date>(new Date());
  const [itineraryEnabled, setItineraryEnabled] = useState(false);
  const [itineraryItems, setItineraryItems] = useState<ItineraryItemInput[]>([]);
  const [itineraryDraft, setItineraryDraft] = useState<ItineraryItemInput>({ date: '', time: '', activity: '' });
  const [itineraryDays, setItineraryDays] = useState('');
  const [itineraryDaysTouched, setItineraryDaysTouched] = useState(false);
  const [itineraryTripStyle, setItineraryTripStyle] = useState('');
  const [itineraryDepartureAirport, setItineraryDepartureAirport] = useState('');
  const [itineraryAirportSuggestions, setItineraryAirportSuggestions] = useState<string[]>([]);
  const [showItineraryAirportSuggestions, setShowItineraryAirportSuggestions] = useState(false);
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
  const startDateRef = useRef<HTMLInputElement | null>(null);
  const endDateRef = useRef<HTMLInputElement | null>(null);
  const itineraryDateRef = useRef<HTMLInputElement | null>(null);
  const wizardLodgingCheckInRef = useRef<HTMLInputElement | null>(null);
  const wizardLodgingCheckOutRef = useRef<HTMLInputElement | null>(null);
  const wizardEditLodgingCheckInRef = useRef<HTMLInputElement | null>(null);
  const wizardEditLodgingCheckOutRef = useRef<HTMLInputElement | null>(null);
  const wizardCarPickupDateRef = useRef<HTMLInputElement | null>(null);
  const wizardCarDropoffDateRef = useRef<HTMLInputElement | null>(null);

  const totalSteps = steps.length;
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
  const webInputStyle = useMemo(() => StyleSheet.flatten(styles.input) ?? {}, [styles]);
  const webInputStyleFlex = useMemo(() => ({ ...webInputStyle, flex: 1 }), [webInputStyle]);
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
    if (member.guestName) return member.guestName;
    const first = (member.firstName ?? '').trim();
    const last = (member.lastName ?? '').trim();
    const name = `${first} ${last}`.trim();
    return name || member.email || 'Traveler';
  };
  const wizardPayerName = (id: string): string => {
    const match = wizardGroupMembers.find((m) => m.id === id);
    return match ? formatWizardMemberName(match) : 'Traveler';
  };
  const wizardJsonHeaders = useMemo(
    () => ({ 'Content-Type': 'application/json', ...headers }),
    [headers]
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

  const getCurrentUserParticipant = (): ParticipantInput | null => {
    const safeEmail = normalizeEmail(currentUserEmail);
    const safeName = (currentUserName ?? '').trim();
    if (!safeEmail && !safeName) return null;
    const parts = safeName.split(/\s+/).filter(Boolean);
    const firstName = parts[0] ?? (safeEmail ? safeEmail.split('@')[0] || 'Traveler' : 'Traveler');
    const lastName = parts.slice(1).join(' ') || 'Traveler';
    return { firstName, lastName, email: safeEmail || '' };
  };
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
    if (wizardDefaultPayerId && (!wizardLodgingDraft.paidBy || wizardLodgingDraft.paidBy.length === 0)) {
      setWizardLodgingDraft((prev) => ({ ...prev, paidBy: [wizardDefaultPayerId] }));
    }
  }, [wizardDefaultPayerId]);

  useEffect(() => {
    if (dates.mode === 'range' && computedDays && !itineraryDaysTouched) {
      setItineraryDays(String(computedDays));
    }
  }, [computedDays, dates.mode, itineraryDaysTouched]);

  useEffect(() => {
    const query = itineraryDepartureAirport.trim();
    if (!query) {
      setItineraryAirportSuggestions([]);
      setShowItineraryAirportSuggestions(false);
      return;
    }
    const filtered = airportOptions.filter((opt) => opt.toLowerCase().includes(query.toLowerCase()));
    setItineraryAirportSuggestions(filtered.slice(0, 10));
  }, [airportOptions, itineraryDepartureAirport]);

  useEffect(() => {
    const nights = calculateNights(wizardLodgingDraft.checkInDate, wizardLodgingDraft.checkOutDate);
    const totalNum = Number(wizardLodgingDraft.totalCost) || 0;
    const computed = nights > 0 && totalNum ? (totalNum / nights).toFixed(2) : '';
    setWizardLodgingDraft((prev) => ({ ...prev, costPerNight: computed }));
  }, [wizardLodgingDraft.checkInDate, wizardLodgingDraft.checkOutDate, wizardLodgingDraft.totalCost]);

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
      const res = await fetch(`${backendUrl}/api/trips/participants/search?q=${encodeURIComponent(query)}`, { headers });
      if (!res.ok) {
        setParticipantSuggestions([]);
        return;
      }
      const data = await res.json().catch(() => []);
      setParticipantSuggestions(Array.isArray(data) ? data : []);
    }, 300);
    return () => clearTimeout(handle);
  }, [backendUrl, headers, participantSearch, userToken]);

  useEffect(() => {
    if (hasSeededCurrentUser) return;
    const entry = getCurrentUserParticipant();
    if (!entry) return;
    setParticipants((prev) => {
      const existing = prev.some((p) => {
        const normalizedEmail = normalizeEmail(p.email);
        if (entry.email && normalizedEmail === entry.email) return true;
        return (
          p.firstName.trim().toLowerCase() === entry.firstName.toLowerCase() &&
          p.lastName.trim().toLowerCase() === entry.lastName.toLowerCase()
        );
      });
      return existing ? prev : [entry, ...prev];
    });
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

  const isoDateString = (date: Date): string => date.toISOString().slice(0, 10);
  const addDaysToIso = (value: string, days: number): string | null => {
    const base = new Date(value);
    if (Number.isNaN(base.getTime())) return null;
    const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
    return isoDateString(next);
  };
  const ensureRangeEndDate = (startDate: string, endDate?: string): string => {
    if (!startDate) return endDate ?? '';
    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) return endDate ?? '';
    if (!endDate) return addDaysToIso(startDate, 1) ?? '';
    const end = new Date(endDate);
    if (Number.isNaN(end.getTime()) || end < start) {
      return addDaysToIso(startDate, 1) ?? endDate;
    }
    return endDate;
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
    const start = dates.startDate || isoDateString(new Date());
    const end = ensureRangeEndDate(start, dates.endDate);
    if (start !== dates.startDate || end !== dates.endDate) {
      setDates((prev) => ({ ...prev, startDate: start, endDate: end }));
    }
  };

  const openDatePicker = (field: 'start' | 'end' | 'itinerary') => {
    if (field === 'start' || field === 'end') {
      primeRangeDates();
    }
    if (Platform.OS !== 'web' && NativeDateTimePicker) {
      const base =
        field === 'start'
          ? dates.startDate || isoDateString(new Date())
          : field === 'end'
            ? ensureRangeEndDate(dates.startDate || isoDateString(new Date()), dates.endDate)
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
    const encoded = encodeURIComponent(address);
    const url = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  const applyWizardLodgingDate = (field: 'checkIn' | 'checkOut', value: string, context: 'draft' | 'edit') => {
    if (context === 'edit') {
      setEditingWizardLodging((prev) =>
        prev ? { ...prev, [field === 'checkIn' ? 'checkInDate' : 'checkOutDate']: value } : prev
      );
    } else {
      setWizardLodgingDraft((prev) => ({ ...prev, [field === 'checkIn' ? 'checkInDate' : 'checkOutDate']: value }));
    }
  };

  const openWizardLodgingDatePicker = (field: 'checkIn' | 'checkOut', context: 'draft' | 'edit', current?: string) => {
    if (Platform.OS === 'web') {
      const ref =
        context === 'edit'
          ? field === 'checkIn'
            ? wizardEditLodgingCheckInRef.current
            : wizardEditLodgingCheckOutRef.current
          : field === 'checkIn'
            ? wizardLodgingCheckInRef.current
            : wizardLodgingCheckOutRef.current;
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
    setWizardLodgingDateField(field);
    setWizardLodgingDateContext(context);
  };

  const openWizardLodgingEditor = (lodging: Lodging) => {
    setEditingWizardLodgingId(lodging.id);
    setEditingWizardLodging(
      toLodgingDraft(lodging, { normalize: normalizeDateString, defaultPayerId: wizardDefaultPayerId })
    );
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
    const result = buildCarRentalFromDraft(wizardCarDraft, wizardDefaultPayerId);
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

  const saveWizardLodging = (draft: LodgingDraft, lodgingId?: string | null) => {
    const name = draft.name.trim();
    if (!name) {
      setWizardError('Please enter a lodging name.');
      return;
    }
    const nights = calculateNights(draft.checkInDate, draft.checkOutDate);
    if (nights <= 0) {
      setWizardError('Check-out must be after check-in.');
      return;
    }
    const totalNum = Number(draft.totalCost) || 0;
    const computed = nights > 0 && totalNum ? (totalNum / nights).toFixed(2) : '';
    const paidBy = draft.paidBy.length ? draft.paidBy : wizardDefaultPayerId ? [wizardDefaultPayerId] : [];
    const next: Lodging = {
      id: lodgingId ?? `wizard-lodging-${Date.now()}-${Math.round(Math.random() * 10000)}`,
      name,
      checkInDate: normalizeDateString(draft.checkInDate),
      checkOutDate: normalizeDateString(draft.checkOutDate),
      rooms: draft.rooms || '1',
      refundBy: draft.refundBy ? normalizeDateString(draft.refundBy) : '',
      totalCost: draft.totalCost,
      costPerNight: computed,
      address: draft.address,
      paidBy,
    };
    setWizardLodgings((prev) => {
      if (lodgingId) {
        return prev.map((l) => (l.id === lodgingId ? { ...next, id: lodgingId } : l));
      }
      return [...prev, next];
    });
    setWizardError('');
    if (lodgingId) {
      closeWizardLodgingEditor();
    } else {
      setWizardLodgingDraft(createInitialLodgingState());
    }
  };

  const saveWizardFlights = async (tripId: string, groupId: string) => {
    if (!userToken || wizardFlights.length === 0) return;
    try {
      const res = await fetch(`${backendUrl}/api/groups/${groupId}/members`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      if (!res.ok) {
        setWizardError('Trip created, but flights could not be saved.');
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
      const activeMembers = members.filter((m: any) => m.status !== 'pending');
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
      const fallbackPassengerId = activeMembers[0]?.id ?? members[0]?.id ?? null;
      const fallbackPayerId = activeMembers[0]?.id ?? null;
      const failures: string[] = [];

      for (const flight of wizardFlights) {
        const rawPassengerIds = Array.isArray(flight.passenger_ids) ? flight.passenger_ids : [];
        const resolvedPassengerIds = rawPassengerIds
          .map((id) => wizardMembersById.get(String(id)))
          .map((member) => {
            if (!member) return null;
            if (member.email) return memberByEmail.get(member.email.toLowerCase()) ?? null;
            if (member.guestName) return memberByGuest.get(member.guestName.toLowerCase()) ?? null;
            return null;
          })
          .filter(Boolean) as string[];

        const passengerIds = resolvedPassengerIds.length ? resolvedPassengerIds : fallbackPassengerId ? [fallbackPassengerId] : [];
        if (!passengerIds.length) {
          failures.push('Missing passengers for a flight.');
          continue;
        }

        const rawPaidBy = Array.isArray(flight.paidBy) ? flight.paidBy : Array.isArray((flight as any).paid_by) ? (flight as any).paid_by : [];
        const resolvedPaidBy = rawPaidBy
          .map((id: any) => wizardMembersById.get(String(id)))
          .map((member) => {
            if (!member || !member.email) return null;
            return memberByEmail.get(member.email.toLowerCase()) ?? null;
          })
          .filter(Boolean) as string[];
        const paidBy = resolvedPaidBy.length ? resolvedPaidBy : fallbackPayerId ? [fallbackPayerId] : [];

        const draft: FlightEditDraft = {
          passengerName: flight.passenger_name || 'Traveler',
          passengerIds,
          departureDate: normalizeDateString(flight.departure_date || '') || new Date().toISOString().slice(0, 10),
          arrivalDate: normalizeDateString(flight.arrival_date || '') || normalizeDateString(flight.departure_date || '') || new Date().toISOString().slice(0, 10),
          departureLocation: flight.departure_location ?? '',
          departureAirportCode: flight.departure_airport_code ?? '',
          departureTime: flight.departure_time || '00:00',
          arrivalLocation: flight.arrival_location ?? '',
          arrivalAirportCode: flight.arrival_airport_code ?? '',
          layoverLocation: flight.layover_location ?? '',
          layoverLocationCode: flight.layover_location_code ?? '',
          layoverDuration: flight.layover_duration ?? '',
          arrivalTime: flight.arrival_time || '00:00',
          cost: String(flight.cost ?? 0),
          carrier: flight.carrier || 'UNKNOWN',
          flightNumber: flight.flight_number || 'UNKNOWN',
          bookingReference: flight.booking_reference || 'UNKNOWN',
          paidBy,
        };
        const payload = buildFlightPayload(draft, tripId, fallbackPayerId ?? undefined);
        const saveRes = await fetch(`${backendUrl}/api/flights`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(payload),
        });
        if (!saveRes.ok) {
          const errData = await saveRes.json().catch(() => ({}));
          failures.push(errData.error || 'Failed to save flight');
        }
      }

      if (failures.length) {
        setWizardError(`Trip created, but ${failures.length} flight(s) failed to save.`);
      }
    } catch {
      setWizardError('Trip created, but flights could not be saved.');
    }
  };

  const saveWizardLodgings = async (tripId: string, groupId: string) => {
    if (!userToken || wizardLodgings.length === 0) return;
    try {
      const res = await fetch(`${backendUrl}/api/groups/${groupId}/members`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      if (!res.ok) {
        setWizardError('Trip created, but lodging could not be saved.');
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
      const activeMembers = members.filter((m: any) => m.status !== 'pending');
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

      for (const lodging of wizardLodgings) {
        const rawPaidBy = Array.isArray(lodging.paidBy) ? lodging.paidBy : [];
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

        const draft: LodgingDraft = {
          name: lodging.name,
          checkInDate: normalizeDateString(lodging.checkInDate),
          checkOutDate: normalizeDateString(lodging.checkOutDate),
          rooms: lodging.rooms || '1',
          refundBy: lodging.refundBy ? normalizeDateString(lodging.refundBy) : '',
          totalCost: lodging.totalCost || '',
          costPerNight: lodging.costPerNight || '',
          address: lodging.address || '',
          paidBy,
        };
        const { payload, error } = buildLodgingPayload(draft, tripId, fallbackPayerId ?? undefined);
        if (error || !payload) {
          failures.push(error || 'Failed to save lodging');
          continue;
        }
        payload.paidBy = paidBy;
        const saveRes = await fetch(`${backendUrl}/api/lodgings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(payload),
        });
        if (!saveRes.ok) {
          const errData = await saveRes.json().catch(() => ({}));
          failures.push(errData.error || 'Failed to save lodging');
        }
      }

      if (failures.length) {
        setWizardError(`Trip created, but ${failures.length} lodging entr${failures.length === 1 ? 'y' : 'ies'} failed to save.`);
      }
    } catch {
      setWizardError('Trip created, but lodging could not be saved.');
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
      const activeMembers = members.filter((m: any) => m.status !== 'pending');
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
        };
        const { payload, error } = buildTourPayload(draft, fallbackPayerId ?? undefined);
        if (error || !payload) {
          failures.push(error || 'Failed to save tour');
          continue;
        }
        const saveRes = await fetch(`${backendUrl}/api/tours`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({
            ...payload,
            tripId,
            freeCancelBy: payload.freeCancelBy?.trim() || null,
          }),
        });
        if (!saveRes.ok) {
          const errData = await saveRes.json().catch(() => ({}));
          failures.push(errData.error || 'Failed to save tour');
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
    try {
      const res = await fetch(`${backendUrl}/api/trips/wizard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          name: details.name.trim(),
          description: description.trim() || undefined,
          destination: details.destination.trim() || undefined,
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
        await saveWizardFlights(tripId, groupId);
        await saveWizardLodgings(tripId, groupId);
        await saveWizardTours(tripId, groupId);
      }
      if (wizardCarRentals.length) {
        onWizardCarRentals?.(wizardCarRentals);
      }

      if (itineraryEnabled && (itineraryItems.length || generateItinerary)) {
        const rangeDays = computeDurationFromRange(dates.startDate, dates.endDate);
        const days =
          (dates.mode === 'range' ? rangeDays : null) ??
          (Number(itineraryDays) > 0 ? Number(itineraryDays) : Number(dates.durationDays) || 1);
        const destination = details.destination.trim() || details.name.trim() || 'Trip';
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
          } else {
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
              const aiRes = await fetchWithTimeout(
                `${backendUrl}/api/itinerary`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...headers },
                  body: JSON.stringify({
                    country: destination,
                    days,
                    budgetMin: budgetRange.min,
                    budgetMax: budgetRange.max,
                    departureAirport: itineraryDepartureAirport.trim() || undefined,
                    tripStyle: itineraryTripStyle.trim() || undefined,
                    tripId,
                    traits: traits.map((t) => ({ name: t.name, level: t.level, notes: t.notes })),
                  }),
                },
                20000
              );
              const aiData = await aiRes.json().catch(() => ({}));
              if (!aiRes.ok || !aiData.plan) {
                setWizardError(aiData?.error || 'Trip created, but the AI itinerary could not be generated.');
              } else {
                const parsed = parsePlanToDetails(String(aiData.plan));
                await Promise.all(
                  parsed.map((detail) =>
                    fetchWithTimeout(
                      `${backendUrl}/api/itineraries/${itineraryId}/details`,
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...headers },
                        body: JSON.stringify({
                          day: detail.day,
                          activity: detail.activity,
                          cost: detail.cost ?? null,
                        }),
                      },
                      10000
                    ).catch(() => null)
                  )
                );
                if (!parsed.length) {
                  setWizardError('Trip created, but the AI itinerary returned no activities.');
                }
              }
            }
          }
        } catch (err) {
          setWizardError((err as Error).message || 'Trip created, but itinerary setup failed.');
        }
      }

      setCreatedTripId(tripId);
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
              value={details.name}
              onChangeText={(text) => setDetails((prev) => ({ ...prev, name: text }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Destination (optional, can include multiple locations)"
              value={details.destination}
              onChangeText={(text) => setDetails((prev) => ({ ...prev, destination: text }))}
            />
            <TextInput
              style={[styles.input, { minHeight: 120 }]}
              placeholder="Description (optional)"
              multiline
              value={details.description}
              onChangeText={(text) => setDetails((prev) => ({ ...prev, description: text }))}
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
                <View style={styles.row}>
                  <View style={[styles.dateInputWrap, { flex: 1 }]}>
                    {Platform.OS === 'web' ? (
                      <input
                        ref={startDateRef as any}
                        type="date"
                        value={dates.startDate}
                        onChange={(e) => setStartDateWithRangeGuard(e.target.value)}
                        onFocus={primeRangeDates}
                        style={styles.input as any}
                      />
                    ) : (
                      <TouchableOpacity style={[styles.input, styles.dateTouchable]} onPress={() => openDatePicker('start')}>
                        <Text style={styles.cellText}>{dates.startDate || 'YYYY-MM-DD'}</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.dateIcon} onPress={() => openDatePicker('start')}>
                      <Text style={styles.selectCaret}>v</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={[styles.dateInputWrap, { flex: 1 }]}>
                    {Platform.OS === 'web' ? (
                      <input
                        ref={endDateRef as any}
                        type="date"
                        value={dates.endDate}
                        onChange={(e) => setDates((prev) => ({ ...prev, endDate: normalizeDateString(e.target.value) }))}
                        onFocus={primeRangeDates}
                        style={styles.input as any}
                      />
                    ) : (
                      <TouchableOpacity style={[styles.input, styles.dateTouchable]} onPress={() => openDatePicker('end')}>
                        <Text style={styles.cellText}>{dates.endDate || 'YYYY-MM-DD'}</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.dateIcon} onPress={() => openDatePicker('end')}>
                      <Text style={styles.selectCaret}>v</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {computedDays ? <Text style={styles.helperText}>Trip length: {computedDays} day(s)</Text> : null}
              </>
            ) : (
              <>
                <View style={styles.row}>
                  {Platform.OS === 'web' ? (
                    <select
                      style={webInputStyleFlex as any}
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
                      style={webInputStyleFlex as any}
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
                    style={webInputStyle as any}
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
                value={participantDraft.firstName}
                onChangeText={(text) => setParticipantDraft((prev) => ({ ...prev, firstName: text }))}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Last name"
                value={participantDraft.lastName}
                onChangeText={(text) => setParticipantDraft((prev) => ({ ...prev, lastName: text }))}
              />
            </View>
            <TextInput
              style={styles.input}
              placeholder="Email (optional)"
              autoCapitalize="none"
              keyboardType="email-address"
              value={participantDraft.email ?? ''}
              onChangeText={(text) => setParticipantDraft((prev) => ({ ...prev, email: text }))}
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
                    dates.mode === 'range' && computedDays
                      ? { backgroundColor: '#e5e7eb', color: '#6b7280' }
                      : null,
                  ]}
                  placeholder="Trip days (optional if dates are set)"
                  keyboardType="numeric"
                  value={itineraryDays}
                  onChangeText={(text) => {
                    setItineraryDaysTouched(true);
                    setItineraryDays(text);
                  }}
                  editable={!(dates.mode === 'range' && computedDays)}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Trip style (optional)"
                  value={itineraryTripStyle}
                  onChangeText={setItineraryTripStyle}
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
                <TextInput
                  style={styles.input}
                  placeholder="Departure airport (optional)"
                  value={itineraryDepartureAirport}
                  onChangeText={(text) => {
                    setItineraryDepartureAirport(text);
                    setShowItineraryAirportSuggestions(true);
                    const query = text.trim();
                    if (query) {
                      try {
                        void onSearchAirports(query);
                      } catch {
                        // ignore background errors
                      }
                    }
                  }}
                  onFocus={() => setShowItineraryAirportSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowItineraryAirportSuggestions(false), 150)}
                />
                {showItineraryAirportSuggestions && itineraryAirportSuggestions.length ? (
                  <View style={styles.dropdownList}>
                    {itineraryAirportSuggestions.map((opt) => (
                      <TouchableOpacity
                        key={opt}
                        style={styles.dropdownOption}
                        onPress={() => {
                          setItineraryDepartureAirport(opt);
                          setShowItineraryAirportSuggestions(false);
                        }}
                      >
                        <Text style={styles.cellText}>{opt}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
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
                    keyboardType="numeric"
                    value={itineraryDays}
                    onChangeText={setItineraryDays}
                  />
                ) : null}
                {!dates.durationDays && dates.mode === 'month' ? (
                  <TextInput
                    style={styles.input}
                    placeholder="Trip days (optional if dates are set)"
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
                      value={manualDraft.time}
                      onChangeText={(text) => setManualDraft((prev) => ({ ...prev, time: text }))}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Activity description"
                      value={manualDraft.activity}
                      onChangeText={(text) => setManualDraft((prev) => ({ ...prev, activity: text }))}
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
              findActiveTrip={() => undefined}
              fetchGroupMembersForActiveTrip={async () => undefined}
              styles={styles}
              airportOptions={airportOptions}
              onSearchAirports={onSearchAirports}
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
                      <Text style={[styles.cellText, styles.cellTextWrap]}>{l.address || '-'}</Text>
                    </View>
                    <View style={[styles.cell, styles.actionCell, styles.lodgingActionCol, styles.lastCell]}>
                      {l.address ? (
                        <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => openWizardMaps(l.address)}>
                          <Text style={styles.buttonText}>Map</Text>
                        </TouchableOpacity>
                      ) : null}
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

                <View style={[styles.tableRow, styles.inputRow, styles.lastRow]}>
                  <View style={[styles.cell, styles.lodgingNameCol]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Hotel / Airbnb"
                      value={wizardLodgingDraft.name}
                      onChangeText={(text) => setWizardLodgingDraft((prev) => ({ ...prev, name: text }))}
                    />
                  </View>
                  <View style={[styles.cell, styles.lodgingDateCol]}>
                    <View style={styles.dateInputWrap}>
                      {Platform.OS === 'web' ? (
                        <input
                          ref={wizardLodgingCheckInRef as any}
                          type="date"
                          value={wizardLodgingDraft.checkInDate}
                          onChange={(e) =>
                            setWizardLodgingDraft((prev) => ({ ...prev, checkInDate: normalizeDateString(e.target.value) }))
                          }
                          style={styles.input as any}
                        />
                      ) : (
                        <TouchableOpacity
                          style={[styles.input, styles.dateTouchable]}
                          onPress={() => openWizardLodgingDatePicker('checkIn', 'draft', wizardLodgingDraft.checkInDate)}
                        >
                          <Text style={styles.cellText}>{wizardLodgingDraft.checkInDate || 'YYYY-MM-DD'}</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.dateIcon}
                        onPress={() => openWizardLodgingDatePicker('checkIn', 'draft', wizardLodgingDraft.checkInDate)}
                      >
                        <Text style={styles.selectCaret}>dY".</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={[styles.cell, styles.lodgingDateCol]}>
                    <View style={styles.dateInputWrap}>
                      {Platform.OS === 'web' ? (
                        <input
                          ref={wizardLodgingCheckOutRef as any}
                          type="date"
                          value={wizardLodgingDraft.checkOutDate}
                          onChange={(e) =>
                            setWizardLodgingDraft((prev) => ({ ...prev, checkOutDate: normalizeDateString(e.target.value) }))
                          }
                          style={styles.input as any}
                        />
                      ) : (
                        <TouchableOpacity
                          style={[styles.input, styles.dateTouchable]}
                          onPress={() => openWizardLodgingDatePicker('checkOut', 'draft', wizardLodgingDraft.checkOutDate)}
                        >
                          <Text style={styles.cellText}>{wizardLodgingDraft.checkOutDate || 'YYYY-MM-DD'}</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.dateIcon}
                        onPress={() => openWizardLodgingDatePicker('checkOut', 'draft', wizardLodgingDraft.checkOutDate)}
                      >
                        <Text style={styles.selectCaret}>dY".</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={[styles.cell, styles.lodgingRoomsCol]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Rooms"
                      keyboardType="numeric"
                      value={wizardLodgingDraft.rooms}
                      onChangeText={(text) => setWizardLodgingDraft((prev) => ({ ...prev, rooms: text }))}
                    />
                  </View>
                  <View style={[styles.cell, styles.lodgingRefundCol]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Refund by (YYYY-MM-DD)"
                      value={wizardLodgingDraft.refundBy}
                      onChangeText={(text) => setWizardLodgingDraft((prev) => ({ ...prev, refundBy: normalizeDateString(text) }))}
                    />
                  </View>
                  <View style={[styles.cell, styles.lodgingCostCol]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Total $"
                      keyboardType="numeric"
                      value={wizardLodgingDraft.totalCost}
                      onChangeText={(text) => setWizardLodgingDraft((prev) => ({ ...prev, totalCost: text }))}
                    />
                  </View>
                  <View style={[styles.cell, styles.lodgingCostCol]}>
                    <Text style={styles.cellText}>{wizardLodgingDraft.costPerNight ? `$${wizardLodgingDraft.costPerNight}` : '-'}</Text>
                  </View>
                  <View style={[styles.cell, styles.lodgingPayerCol]}>
                    <View style={styles.payerChips}>
                      {wizardLodgingDraft.paidBy.map((id) => (
                        <View key={id} style={styles.payerChip}>
                          <Text style={styles.cellText}>{wizardPayerName(id)}</Text>
                          <TouchableOpacity onPress={() => setWizardLodgingDraft((prev) => ({ ...prev, paidBy: prev.paidBy.filter((x) => x !== id) }))}>
                            <Text style={styles.removeText}>x</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                    <View style={styles.payerOptions}>
                      {wizardGroupMembers
                        .filter((m) => !wizardLodgingDraft.paidBy.includes(m.id))
                        .map((m) => (
                          <TouchableOpacity
                            key={m.id}
                            style={styles.smallButton}
                            onPress={() => setWizardLodgingDraft((prev) => ({ ...prev, paidBy: [...prev.paidBy, m.id] }))}
                          >
                            <Text style={styles.buttonText}>Add {formatWizardMemberName(m)}</Text>
                          </TouchableOpacity>
                        ))}
                    </View>
                  </View>
                  <View style={[styles.cell, styles.lodgingAddressCol]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Address"
                      value={wizardLodgingDraft.address}
                      onChangeText={(text) => setWizardLodgingDraft((prev) => ({ ...prev, address: text }))}
                    />
                  </View>
                  <View style={[styles.cell, styles.actionCell, styles.lodgingActionCol, styles.lastCell]}>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => saveWizardLodging(wizardLodgingDraft)}>
                      <Text style={styles.buttonText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </ScrollView>
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
            <Text style={styles.sectionTitle}>Tours & Activities</Text>
            <Text style={styles.helperText}>Optional. Add tours using the full tours interface.</Text>
            <TourTab
              backendUrl={backendUrl}
              userToken={userToken}
              activeTripId={null}
              tours={wizardTours}
              setTours={setWizardTours}
              defaultPayerId={wizardDefaultPayerId}
              payerName={wizardPayerName}
              formatMemberName={formatWizardMemberName}
              userMembers={wizardGroupMembers}
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
                  {['Pick Up Location', 'Pick Up Date', 'Drop Off Location', 'Drop Off Date', 'Reference', 'Vendor', 'Prepaid?', 'Cost', 'Car Model', 'Notes', 'Paid By', 'Actions'].map((label, idx, arr) => (
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
                      value={wizardCarDraft.pickupLocation}
                      onChangeText={(text) => setWizardCarDraft((p) => ({ ...p, pickupLocation: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                    <View style={styles.dateInputWrap}>
                      {Platform.OS === 'web' ? (
                        <input
                          ref={wizardCarPickupDateRef as any}
                          type="date"
                          value={wizardCarDraft.pickupDate}
                          onChange={(e) => setWizardCarDraft((p) => ({ ...p, pickupDate: e.target.value }))}
                          style={styles.input as any}
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
                        <Text style={styles.selectCaret}>dY".</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Drop off location"
                      value={wizardCarDraft.dropoffLocation}
                      onChangeText={(text) => setWizardCarDraft((p) => ({ ...p, dropoffLocation: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                    <View style={styles.dateInputWrap}>
                      {Platform.OS === 'web' ? (
                        <input
                          ref={wizardCarDropoffDateRef as any}
                          type="date"
                          value={wizardCarDraft.dropoffDate}
                          onChange={(e) => setWizardCarDraft((p) => ({ ...p, dropoffDate: e.target.value }))}
                          style={styles.input as any}
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
                        <Text style={styles.selectCaret}>dY".</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Reference"
                      value={wizardCarDraft.reference}
                      onChangeText={(text) => setWizardCarDraft((p) => ({ ...p, reference: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Vendor"
                      value={wizardCarDraft.vendor}
                      onChangeText={(text) => setWizardCarDraft((p) => ({ ...p, vendor: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                    <View style={[styles.dropdown, { width: '100%' }]}>
                      <TouchableOpacity
                        style={[styles.input, styles.selectButtonRow]}
                        onPress={() => setWizardCarPrepaidOpen((s) => !s)}
                      >
                        <Text style={styles.cellText}>{wizardCarDraft.prepaid || 'Select Yes/No'}</Text>
                        <Text style={styles.selectCaret}>ƒ-_</Text>
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
                      keyboardType="numeric"
                      value={wizardCarDraft.cost}
                      onChangeText={(text) => setWizardCarDraft((p) => ({ ...p, cost: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Car model"
                      value={wizardCarDraft.model}
                      onChangeText={(text) => setWizardCarDraft((p) => ({ ...p, model: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { minWidth: 220, flex: 1 }]}>
                    <TextInput
                      style={[styles.input, styles.cellTextWrap]}
                      placeholder="Notes"
                      value={wizardCarDraft.notes}
                      onChangeText={(text) => setWizardCarDraft((p) => ({ ...p, notes: text }))}
                      multiline
                    />
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
            {details.destination ? <Text style={styles.bodyText}>Destination: {details.destination}</Text> : null}
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
                <Text style={styles.headerText}>Tours & Activities</Text>
                {wizardTours.map((t) => (
                  <Text key={t.id} style={styles.bodyText}>
                    {t.name || 'Tour'} ({normalizeDateString(t.date)})
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
                {knownInfo.tours ? <Text style={styles.bodyText}>Tours & Activities: {knownInfo.tours}</Text> : null}
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
        <Text style={styles.sectionTitle}>Trip created!</Text>
        <Text style={styles.helperText}>Your trip is ready. You can view it now.</Text>
        <TouchableOpacity style={styles.button} onPress={() => onTripCreated(createdTripId)}>
          <Text style={styles.buttonText}>View Trip</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={onCancel}>
          <Text style={styles.buttonText}>Back to Trips</Text>
        </TouchableOpacity>
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
            applyWizardLodgingDate(wizardLodgingDateField, iso, wizardLodgingDateContext);
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
                value={editingWizardLodging.name}
                onChangeText={(text) => setEditingWizardLodging((prev) => (prev ? { ...prev, name: text } : prev))}
              />
              <Text style={styles.modalLabel}>Check-in</Text>
              <View style={styles.dateInputWrap}>
                {Platform.OS === 'web' ? (
                  <input
                    ref={wizardEditLodgingCheckInRef as any}
                    type="date"
                    value={editingWizardLodging.checkInDate}
                    onChange={(e) =>
                      setEditingWizardLodging((prev) =>
                        prev ? { ...prev, checkInDate: normalizeDateString(e.target.value) } : prev
                      )
                    }
                    style={styles.input as any}
                  />
                ) : (
                  <TouchableOpacity
                    style={[styles.input, styles.dateTouchable]}
                    onPress={() => openWizardLodgingDatePicker('checkIn', 'edit', editingWizardLodging.checkInDate)}
                  >
                    <Text style={styles.cellText}>{editingWizardLodging.checkInDate || 'YYYY-MM-DD'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.dateIcon}
                  onPress={() => openWizardLodgingDatePicker('checkIn', 'edit', editingWizardLodging.checkInDate)}
                >
                  <Text style={styles.selectCaret}>dY".</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.modalLabel}>Check-out</Text>
              <View style={styles.dateInputWrap}>
                {Platform.OS === 'web' ? (
                  <input
                    ref={wizardEditLodgingCheckOutRef as any}
                    type="date"
                    value={editingWizardLodging.checkOutDate}
                    onChange={(e) =>
                      setEditingWizardLodging((prev) =>
                        prev ? { ...prev, checkOutDate: normalizeDateString(e.target.value) } : prev
                      )
                    }
                    style={styles.input as any}
                  />
                ) : (
                  <TouchableOpacity
                    style={[styles.input, styles.dateTouchable]}
                    onPress={() => openWizardLodgingDatePicker('checkOut', 'edit', editingWizardLodging.checkOutDate)}
                  >
                    <Text style={styles.cellText}>{editingWizardLodging.checkOutDate || 'YYYY-MM-DD'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.dateIcon}
                  onPress={() => openWizardLodgingDatePicker('checkOut', 'edit', editingWizardLodging.checkOutDate)}
                >
                  <Text style={styles.selectCaret}>dY".</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.modalLabel}>Rooms</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={editingWizardLodging.rooms}
                onChangeText={(text) => setEditingWizardLodging((prev) => (prev ? { ...prev, rooms: text } : prev))}
              />
              <Text style={styles.modalLabel}>Refund by</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={editingWizardLodging.refundBy}
                  onChange={(e) => setEditingWizardLodging((prev) => (prev ? { ...prev, refundBy: e.target.value } : prev))}
                  style={styles.input as any}
                />
              ) : (
                <TextInput
                  style={styles.input}
                  value={editingWizardLodging.refundBy}
                  placeholder="YYYY-MM-DD"
                  onChangeText={(text) =>
                    setEditingWizardLodging((prev) => (prev ? { ...prev, refundBy: normalizeDateString(text) } : prev))
                  }
                />
              )}
              <Text style={styles.modalLabel}>Total cost</Text>
              <TextInput
                style={styles.input}
                value={editingWizardLodging.totalCost}
                keyboardType="numeric"
                onChangeText={(text) => setEditingWizardLodging((prev) => (prev ? { ...prev, totalCost: text } : prev))}
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
                value={editingWizardLodging.address}
                onChangeText={(text) => setEditingWizardLodging((prev) => (prev ? { ...prev, address: text } : prev))}
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
