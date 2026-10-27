import { resolveComponentTheme as resolveStyleTheme, themeStyle, type AppTheme } from '../theme/theme';

import { useAppTheme as useStyleTheme } from '../theme/ThemeContext';
import PayerSelect from '../components/PayerSelect';
import { singlePayerIds } from '../utils/payerSelection';
import type { ImportTripDraft } from '../../server/src/types';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import HorizontalTableScroll from '../components/HorizontalTableScroll';
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
import { budgetRangeFromComfort } from '../utils/aiItineraryRequest';
import { normalizeDateString } from '../utils/normalizeDateString';
import { sanitizeCostInput } from '../utils/sanitizeCost';
import { saveWizardCarRentals, saveWizardFlights, saveWizardLodgings } from '../utils/wizardSaves';
import { buildMapUrl, loadStoredMapPreference } from '../utils/mapLinks';
import { toWebStyle } from '../utils/webStyle';
import { track } from '../utils/analytics/track';

const CREATE_TRIP_TASK = { task: 'create_trip', feature: 'create_trip' } as const;

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
  PROMPT_INTERACTION_STYLE_OPTIONS,
  PROMPT_MOBILITY_OPTIONS,
  PROMPT_PACE_OPTIONS,
  type PromptInterestWeights,
  extractPromptTraitsFromTraits,
  normalizePromptTraits,
  serializePromptTraits,
} from '../utils/promptTraits';
import LodgingDialog from '../components/LodgingDialog';
import { LocationSelector, type LocationOption } from '../components/LocationSelector';
import { MustSeeAttractionSelector, type AttractionOption } from '../components/MustSeeAttractionSelector';
import SelectField, { type SelectFieldOption } from '../components/SelectField';
import ConfirmDialog from '../components/ConfirmDialog';
import DialogShell from '../components/DialogShell';
import DateField from '../components/DateField';
import { createIdempotencyKey } from '../utils/idempotencyKey';
import { fixedTableColumn } from '../utils/tableColumns';

type Suggestion = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  source?: 'user' | 'fellow';
};

const WIZARD_CAR_COLUMNS = [
  { label: 'Pick Up Location', width: 140 },
  { label: 'Pick Up Date', width: 140 },
  { label: 'Drop Off Location', width: 140 },
  { label: 'Drop Off Date', width: 140 },
  { label: 'Status', width: 130 },
  { label: 'Reference', width: 140 },
  { label: 'Vendor', width: 140 },
  { label: 'Prepaid?', width: 140 },
  { label: 'Cost', width: 120 },
  { label: 'Car Model', width: 180 },
  { label: 'Notes', width: 220 },
  { label: 'For', width: 180 },
  { label: 'Paid By', width: 180 },
  { label: 'Actions', width: 160 },
] as const;

type CreateTripWizardProps = {
  initialDraft?: ImportTripDraft | null;
  backendUrl: string;
  userToken: string | null;
  headers: Record<string, string>;
  traits: Trait[];
  airportOptions: string[];
  onSearchAirports: (q: string) => Promise<void> | void;
  styles: Record<string, any>;
  theme?: AppTheme;
  onCancel: () => void;
  onTripCreated: (tripId: string) => void;
  onAiItineraryQueued?: (tripId: string, jobId: string, request: Record<string, unknown>) => void;
  onUnauthorized?: () => void;
  onWizardCarRentals?: (rentals: CarRental[]) => void;
  currentUserName?: string | null;
  currentUserEmail?: string | null;
  // Kill switch for defaulting the wizard to the 3-field Quick Start screen
  // (implementation-plan-ux-remediation.md, Initiative C). Defaults to `true`;
  // `false` starts every new trip directly in the full 9-step wizard, same as
  // before this initiative shipped.
  featureQuickStartTripWizard?: boolean;
  // Reflects the `ai_itinerary_generation` feature flag (+ tier entitlement)
  // for the current user. When false, the AI option is hidden and the
  // wizard is locked to manual itinerary creation.
  aiItineraryGenerationAllowed?: boolean;
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

const INTEREST_WEIGHT_FIELDS: Array<{
  key: keyof PromptInterestWeights;
  label: string;
  lowDescriptor: string;
  mediumDescriptor: string;
  highDescriptor: string;
}> = [
  {
    key: 'outdoors',
    label: 'Outdoors',
    lowDescriptor: 'Nature? Only through a window',
    mediumDescriptor: 'Easy hikes with nice views',
    highDescriptor: 'Sleep under the stars',
  },
  {
    key: 'adventure',
    label: 'Adventure',
    lowDescriptor: 'Surround me with bubblewrap',
    mediumDescriptor: 'A little thrill is fine',
    highDescriptor: "I'm bored of base jumping",
  },
  {
    key: 'culture',
    label: 'Culture',
    lowDescriptor: 'Skip the museums',
    mediumDescriptor: 'History is good in small doses',
    highDescriptor: 'Immerse me in the past',
  },
  {
    key: 'food',
    label: 'Food',
    lowDescriptor: "Its just fuel",
    mediumDescriptor: 'Good local spots',
    highDescriptor: 'Plan around the meals',
  },
  {
    key: 'nightlife',
    label: 'Nightlife',
    lowDescriptor: 'Early to bed, early to rise',
    mediumDescriptor: 'Late dinner is OK',
    highDescriptor: 'Out until sunrise',
  },
  {
    key: 'relax',
    label: 'Relaxing',
    lowDescriptor: 'Keep it moving',
    mediumDescriptor: 'Mix busy and chill',
    highDescriptor: 'Slow and easy',
  },
  {
    key: 'photography',
    label: 'Photography',
    lowDescriptor: 'Phone stays pocketed',
    mediumDescriptor: 'Some great shots to show mom',
    highDescriptor: "I'm an professional",
  },
  {
    key: 'authentic_local',
    label: 'Authentic/Local',
    lowDescriptor: 'Tourist is fine',
    mediumDescriptor: 'Some hidden gems',
    highDescriptor: 'Live like a local',
  },
  {
    key: 'iconic_landmarks',
    label: 'Iconic Landmarks',
    lowDescriptor: 'Skip the big sights',
    mediumDescriptor: 'Hit a few must-sees',
    highDescriptor: 'All the classics',
  },
];

const descriptorForValue = (
  value: number,
  descriptors: { lowDescriptor: string; mediumDescriptor: string; highDescriptor: string }
): string => {
  if (value <= 25) return descriptors.lowDescriptor;
  if (value >= 75) return descriptors.highDescriptor;
  return descriptors.mediumDescriptor;
};

const CreateTripWizard: React.FC<CreateTripWizardProps> = ({
  backendUrl,
  userToken,
  headers,
  traits,
  airportOptions,
  onSearchAirports,
  styles,
  theme: _providedTheme,
  onCancel,
  onTripCreated,
  onAiItineraryQueued,
  onUnauthorized,
  onWizardCarRentals,
  currentUserName,
  currentUserEmail,
  initialDraft,
  featureQuickStartTripWizard = true,
  aiItineraryGenerationAllowed = true,
}) => {
  const _styleTheme = useStyleTheme();
  const theme = resolveStyleTheme(_providedTheme, _styleTheme);
  const destinationAttractionWizardEnabled = !['0', 'false', 'off', 'no'].includes(
    String(process.env.EXPO_PUBLIC_WIZARD_DESTINATION_ATTRACTIONS_ENABLED ?? 'true')
      .trim()
      .toLowerCase()
  );
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
  const [quickStartMode, setQuickStartMode] = useState(featureQuickStartTripWizard);
  const [details, setDetails] = useState<TripDetails>({ name: initialDraft?.name ?? '', description: '' });
  const [selectedLocations, setSelectedLocations] = useState<LocationOption[]>([]);
  const [selectedMustSeeAttractions, setSelectedMustSeeAttractions] = useState<AttractionOption[]>([]);
  const [dates, setDates] = useState<TripDates>({
    startDate: initialDraft?.startDate ?? '',
    endDate: initialDraft?.endDate ?? '',
    startMonth: '',
    startYear: '',
    durationDays: '',
    mode: 'range',
  });
  const [dateModeSelected, setDateModeSelected] = useState<TripDates['mode'] | null>(initialDraft?.startDate ? 'range' : null);
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
  const [editingWizardLodgingId, setEditingWizardLodgingId] = useState<string | null>(null);
  const [editingWizardLodging, setEditingWizardLodging] = useState<LodgingDraft | null>(null);
  const [itineraryEnabled, setItineraryEnabled] = useState(false);
  const [itineraryItems, setItineraryItems] = useState<ItineraryItemInput[]>([]);
  const [itineraryDraft, setItineraryDraft] = useState<ItineraryItemInput>({ date: '', time: '', activity: '' });
  const [itineraryDays, setItineraryDays] = useState('');
  const [itineraryDaysTouched, setItineraryDaysTouched] = useState(false);
  const defaultPromptTraits = useMemo(() => extractPromptTraitsFromTraits(traits).profile, [traits]);
  const defaultPromptTraitsDigest = useMemo(() => serializePromptTraits(defaultPromptTraits), [defaultPromptTraits]);
  const [wizardPromptTraits, setWizardPromptTraits] = useState(() => normalizePromptTraits(defaultPromptTraits));
  const [itineraryDepartureAirport, setItineraryDepartureAirport] = useState('');
  const [showItineraryAirportSuggestions, setShowItineraryAirportSuggestions] = useState(false);
  const itineraryAirportRef = useRef<any>(null);
  // create_trip task: started once when the wizard opens, cancelled when the user exits it,
  // failed on each failed submit; the server's trip_created event is the outcome.
  const createTripTaskStarted = useRef(false);
  useEffect(() => {
    if (createTripTaskStarted.current) return;
    createTripTaskStarted.current = true;
    track('task_started', CREATE_TRIP_TASK);
  }, []);
  const cancelWizard = () => {
    track('task_cancelled', CREATE_TRIP_TASK);
    onCancel();
  };
  const [itineraryAirportAnchor, setItineraryAirportAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [generateItinerary, setGenerateItinerary] = useState(false);
  const [itineraryMode, setItineraryMode] = useState<'ai' | 'manual' | null>(null);
  const [manualDay, setManualDay] = useState<number | null>(null);
  const [manualDraft, setManualDraft] = useState({ time: '', activity: '' });
  const [knownInfo, setKnownInfo] = useState<KnownInfoInput>({ flights: '', lodging: '', tours: '', cars: '' });
  const [wizardError, setWizardError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [createdTripId, setCreatedTripId] = useState<string | null>(null);
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
      durationDays: dates.mode !== 'range' ? Number(dates.durationDays) || null : null,
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
    (): SelectFieldOption[] => [
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
  const yearOptions = useMemo<SelectFieldOption[]>(() => {
    const start = new Date().getFullYear();
    return Array.from({ length: 11 }, (_, i) => {
      const year = String(start + i);
      return { label: year, value: year };
    });
  }, []);
  const dayOptions = useMemo<SelectFieldOption[]>(
    () => Array.from({ length: 90 }, (_, i) => {
      const day = String(i + 1);
      return { label: day, value: day };
    }),
    []
  );
  const prepaidOptions = useMemo<SelectFieldOption[]>(
    () => [
      { label: 'Yes', value: 'Yes' },
      { label: 'No', value: 'No' },
    ],
    []
  );
  const webInputStyle = useMemo(() => toWebStyle(styles.input), [styles]);
  const webInputStyleFlex = useMemo(() => (themeStyle('tabs_createTripWizard_1', { webInputStyle: webInputStyle }, (theme ?? _styleTheme))), [webInputStyle, _styleTheme]);
  const webDateInputStyle = useMemo(
    () =>
      toWebStyle([styles.input, styles.webDateInput], themeStyle('tabs_createTripWizard_2', { theme: theme }, (theme ?? _styleTheme))),
    [styles, theme?.mode, _styleTheme]
  );
  const webDateInputStyleFlex = useMemo(() => (themeStyle('tabs_createTripWizard_3', { webDateInputStyle: webDateInputStyle }, (theme ?? _styleTheme))), [webDateInputStyle, _styleTheme]);
  const wizardCarInputStyle = useMemo(() => [styles.input, themeStyle('tabs_createTripWizard_4', {  }, (theme ?? _styleTheme))], [styles, _styleTheme]);
  const wizardCarDateInputStyle = useMemo(() => (themeStyle('tabs_createTripWizard_5', {  }, (theme ?? _styleTheme))), [_styleTheme]);
  const wizardCarWebInputStyle = useMemo(
    () => (themeStyle('tabs_createTripWizard_6', { webDateInputStyle: webDateInputStyle }, (theme ?? _styleTheme))),
    [webDateInputStyle, _styleTheme]
  );
  const wizardCarDateWrapStyle = useMemo(
    () => [styles.dateInputWrap, themeStyle('tabs_createTripWizard_7', {  }, (theme ?? _styleTheme))],
    [styles, _styleTheme]
  );
  const wizardCarInputCellStyle = useMemo(() => [styles.cell, themeStyle('tabs_createTripWizard_8', {  }, (theme ?? _styleTheme))], [styles, _styleTheme]);
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
    const rangeDays = dates.mode === 'range' ? computedDays : null;
    if (rangeDays) return rangeDays;
    const monthDays = Number(dates.durationDays);
    if (dates.mode !== 'range' && Number.isFinite(monthDays) && monthDays > 0) return monthDays;
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
    if (dates.mode === 'duration') {
      setItineraryDays(dates.durationDays);
    } else if (dates.mode === 'range' && computedDays && !itineraryDaysTouched) {
      setItineraryDays(String(computedDays));
    }
  }, [computedDays, dates.mode, dates.durationDays, itineraryDaysTouched]);

  useEffect(() => {
    setWizardPromptTraits(normalizePromptTraits(defaultPromptTraits));
  }, [defaultPromptTraitsDigest]);

  const itineraryAirportSuggestions = useMemo<string[]>(() => {
    const trimmed = itineraryDepartureAirport.trim().toLowerCase();
    if (!trimmed) return [];
    return airportOptions.filter((opt) => opt.toLowerCase().includes(trimmed)).slice(0, 10);
  }, [airportOptions, itineraryDepartureAirport]);

  // Debounce the server-side airport search so we don't fire a request per
  // keystroke. The dropdown still updates instantly via the useMemo above
  // by filtering whatever airportOptions snapshot is in memory.
  useEffect(() => {
    const trimmed = itineraryDepartureAirport.trim();
    if (!trimmed) return;
    const handle = setTimeout(() => {
      try {
        void onSearchAirports(trimmed);
      } catch {
        // ignore background errors
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [itineraryDepartureAirport, onSearchAirports]);

  const showItineraryAirportDropdown = () => {
    setShowItineraryAirportSuggestions(true);
    const node = itineraryAirportRef.current as any;
    if (node?.measureInWindow) {
      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        setItineraryAirportAnchor(themeStyle('tabs_createTripWizard_9', { x: x, y: y, width: width, height: height }, (theme ?? _styleTheme)));
      });
    } else if (typeof node?.getBoundingClientRect === 'function') {
      const rect = node.getBoundingClientRect();
      setItineraryAirportAnchor(themeStyle('tabs_createTripWizard_10', { rect: rect }, (theme ?? _styleTheme)));
    }
  };

  const hideItineraryAirportDropdown = () => {
    setShowItineraryAirportSuggestions(false);
    setItineraryAirportAnchor(null);
  };

  const setWizardWeight = (key: keyof PromptInterestWeights, raw: string | number) => {
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
  const buildDateForDay = useCallback((day: number): string => {
    if (dates.mode === 'range' && dates.startDate) {
      const start = new Date(dates.startDate);
      if (!Number.isNaN(start.valueOf())) {
        const date = new Date(start.getTime() + (day - 1) * 24 * 60 * 60 * 1000);
        return date.toISOString().slice(0, 10);
      }
    }
    const monthNum = Number(dates.startMonth);
    const yearNum = Number(dates.startYear);
    if (dates.mode === 'month' && monthNum && yearNum) {
      const date = new Date(yearNum, monthNum - 1, day);
      if (!Number.isNaN(date.valueOf())) {
        return date.toISOString().slice(0, 10);
      }
    }
    return `Day ${day}`;
  }, [dates.mode, dates.startDate, dates.startMonth, dates.startYear]);
  const formatManualDayLabel = (day: number): string => {
    const dateLabel = buildDateForDay(day);
    if (dateLabel.startsWith('Day ')) return dateLabel;
    return `Day ${day} · ${dateLabel}`;
  };
  const getItemDayIndex = useCallback((item: ItineraryItemInput): number => {
    const raw = item.date?.trim();
    if (raw) {
      const match = /^Day\s+(\d+)/i.exec(raw);
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
        if (dates.mode === 'month' && monthNum && yearNum) {
          const start = new Date(yearNum, monthNum - 1, 1);
          if (!Number.isNaN(start.valueOf())) {
            const diff = Math.floor((parsed.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            if (Number.isFinite(diff) && diff > 0) return diff;
          }
        }
      }
    }
    return 1;
  }, [dates.mode, dates.startDate, dates.startMonth, dates.startYear]);
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

  const budgetRange = useMemo(() => budgetRangeFromComfort(wizardPromptTraits.tt.c), [wizardPromptTraits.tt.c]);

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

  const addLocation = useCallback((location: LocationOption) => {
    if (!location?.id) return;
    setSelectedLocations((prev) =>
      prev.some((entry) => entry.id === location.id) ? prev : [...prev, location]
    );
  }, []);

  const removeLocation = useCallback((locationId: string) => {
    setSelectedLocations((prev) => prev.filter((location) => location.id !== locationId));
  }, []);

  const addMustSeeAttraction = useCallback((attraction: AttractionOption) => {
    if (!attraction?.id || !attraction?.name) return;
    setSelectedMustSeeAttractions((prev) =>
      prev.some((entry) => entry.id === attraction.id) ? prev : [...prev, attraction]
    );
  }, []);

  const removeMustSeeAttraction = useCallback((attractionId: string) => {
    setSelectedMustSeeAttractions((prev) => prev.filter((item) => item.id !== attractionId));
  }, []);

  const focusDescriptionField = useCallback(() => {
    descriptionRef.current?.focus();
  }, []);

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
    setManualDay(null);
    setWizardError('');
  };

  // AI itinerary generation is behind the `ai_itinerary_generation` feature
  // flag / tier entitlement. When it's off, skip the Yes/No question
  // entirely and lock the wizard into manual itinerary creation.
  useEffect(() => {
    if (!aiItineraryGenerationAllowed && itineraryMode !== 'manual') {
      selectItineraryMode('manual');
    }
  }, [aiItineraryGenerationAllowed]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStartDateWithRangeGuard = useCallback((value: string) => {
    const normalized = normalizeDateString(value);
    setDates((prev) => {
      if (prev.mode !== 'range') {
        return { ...prev, startDate: normalized };
      }
      const nextEnd = ensureRangeEndDate(normalized, prev.endDate);
      return { ...prev, startDate: normalized, endDate: nextEnd };
    });
  }, []);
  const primeRangeDates = () => {
    if (dates.mode !== 'range') return;
    const defaults = getDefaultTripRangeDates({ startDate: dates.startDate, endDate: dates.endDate });
    if (defaults.startDate !== dates.startDate || defaults.endDate !== dates.endDate) {
      setDates((prev) => ({ ...prev, startDate: defaults.startDate, endDate: defaults.endDate }));
    }
  };

  const canMoveNext = useMemo(() => {
    if (stepIndex === 0) return !validateTripDetails(details);
    if (stepIndex === 1) {
      if (!dateModeSelected) return false;
      if (dateModeSelected === 'range') {
        if (!dates.startDate || !dates.endDate) return false;
      } else if (dateModeSelected === 'month') {
        if (!dates.startMonth || !dates.startYear || !dates.durationDays) return false;
      }
      return !validateTripDates(dates);
    }
    if (stepIndex === 2) return !validateParticipants(participants);
    if (stepIndex === 3) return canProceedFromItineraryStep(itineraryMode);
    return true;
  }, [dateModeSelected, dates, details, itineraryMode, participants, stepIndex]);

  const quickStartReady = Boolean(details.name.trim() && selectedLocations.length && (dates.mode === 'duration' ? !validateTripDates(dates) : dates.startDate && dates.endDate && !validateTripDates({ ...dates, mode: 'range' })));

  const goNext = useCallback(() => {
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
      } else if (dateModeSelected === 'month' && (!dates.startMonth || !dates.startYear || !dates.durationDays)) {
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
  }, [dateModeSelected, dates, details, itineraryMode, participants, stepIndex, totalSteps]);

  const goBack = useCallback(() => {
    setWizardError('');
    setStepIndex((prev) => Math.max(prev - 1, 0));
  }, []);

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
    track('map_link_opened', { provider: pref, feature: 'create_trip' });
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url).catch((err) => Alert.alert('Could not open map', err?.message ?? String(err)));
    }
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
    const paidBy = singlePayerIds(draft.paidBy, wizardDefaultPayerId);
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
    return result.lodgingIds ?? {};
  };

  const saveWizardCarRentalsForTrip = async (tripId: string, groupId: string) => {
    const result = await saveWizardCarRentals({
      backendUrl,
      headers,
      userToken,
      groupId,
      tripId,
      wizardCarRentals,
      wizardGroupMembers,
    });
    if (result.fatal) {
      setWizardError(result.fatal);
      return;
    }
    if (result.carRentals?.length) {
      onWizardCarRentals?.(result.carRentals);
    }
    if (result.failures.length) {
      setWizardError(`Trip created, but ${result.failures.length} car rental${result.failures.length === 1 ? '' : 's'} failed to save.`);
    }
  };

  const saveWizardTours = async (tripId: string, groupId: string, lodgingIds: Record<string, string> = {}) => {
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
        if (tour.nearLodgingId && !lodgingIds[tour.nearLodgingId]) {
          failures.push(`Hotel for ${tour.name || 'optional activity'} could not be saved.`);
          continue;
        }
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
          status: (tour as any).status ?? 'Proposed',
          activityType: (tour as any).activityType ?? 'Tour',
          date: tour.date,
          nearLodgingId: tour.nearLodgingId ? lodgingIds[tour.nearLodgingId] : null,
          name: tour.name,
          startLocation: tour.startLocation,
          startTime: tour.startTime,
          duration: tour.duration,
          cost: tour.cost,
          freeCancelBy: tour.freeCancelBy,
          bookedOn: tour.bookedOn,
          reference: tour.reference,
          notes: (tour as any).notes ?? '',
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
    const destinationError = quickStartMode && !selectedLocations.length ? 'Choose at least one destination.' : null;
    const participantError = quickStartMode ? null : validateParticipants(participants);
    if (detailError || dateError || participantError || destinationError) {
      setWizardError(detailError || dateError || participantError || destinationError || '');
      track('task_failed', { ...CREATE_TRIP_TASK, failure: 'validation' });
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
          mustSeeAttractions: selectedMustSeeAttractions.map((item) => item.name).filter(Boolean),
          startDate: dates.mode === 'range' ? dates.startDate || undefined : undefined,
          endDate: dates.mode === 'range' ? dates.endDate || undefined : undefined,
          startMonth: dates.mode === 'month' ? Number(dates.startMonth) || undefined : undefined,
          startYear: dates.mode === 'month' ? Number(dates.startYear) || undefined : undefined,
          durationDays: dates.mode !== 'range' ? Number(dates.durationDays) || undefined : undefined,
          participants: participantPayload,
        }),
      });
    if (res.status === 401) {
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
      if (groupId && !quickStartMode) {
        await saveWizardFlightsForTrip(tripId, groupId);
        const lodgingIds = await saveWizardLodgingsForTrip(tripId, groupId);
        await saveWizardTours(tripId, groupId, lodgingIds);
        await saveWizardCarRentalsForTrip(tripId, groupId);
      }

      if (!quickStartMode && itineraryEnabled && (itineraryItems.length || generateItinerary || dates.mode === 'duration')) {
        const rangeDays = computeDurationFromRange(dates.startDate, dates.endDate);
        const days =
          (dates.mode === 'duration' ? Number(dates.durationDays) : dates.mode === 'range' ? rangeDays : null) ??
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
              const idempotencyKey = createIdempotencyKey(`wizard-${tripId}`);
              const aiRequestBody = {
                country: destination,
                locations: locationNames,
                mustSeeAttractions: selectedMustSeeAttractions
                  .filter((item) => item.name)
                  .map((item) =>
                    item.destinationName ? { name: item.name, destinationName: item.destinationName } : item.name
                  ),
                days,
                budgetMin: budgetRange.min,
                budgetMax: budgetRange.max,
                departureAirport: itineraryDepartureAirport.trim() || undefined,
                tripId,
                itineraryId,
                tt: wizardPromptTraits.tt,
                ut: wizardPromptTraits.ut,
              };
              const aiRes = await fetchWithTimeout(
                `${backendUrl}/api/itinerary/async`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, ...headers },
                  body: JSON.stringify({ ...aiRequestBody, idempotencyKey }),
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
                // Stash the request body (minus the one-shot idempotency key) so a later
                // retry from the Overview tab can resubmit the same inputs.
                onAiItineraryQueued?.(tripId, String(aiData.jobId), aiRequestBody);
              }
            }
          }
        } catch (err) {
          setWizardError((err as Error).message || 'Trip created, but itinerary setup failed.');
          console.warn(`${wizardDebugPrefix} itinerary-setup-exception tripId=${tripId} message="${(err as Error).message}"`);
        }
      }

      setCreatedTripId(tripId);
      handleTripCreated(tripId);
    } catch (err) {
      track('task_failed', { ...CREATE_TRIP_TASK, failure: /network|fetch/i.test((err as Error).message) ? 'network' : 'server' });
      setWizardError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderQuickStart = () => (
    <>
      <Text style={styles.sectionTitle}>Start planning in seconds</Text>
      {initialDraft && <Text style={styles.helperText}>Started from your booking. Check the destination and dates; the booking stays in Imports until you choose to add it.</Text>}
      <Text style={styles.helperText}>Add a trip name, destination, and dates now. You can invite travelers and customize planning preferences from the trip later.</Text>
      <Text style={styles.modalLabel}>Trip name</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Summer in Japan"
        accessibilityLabel="Quick start trip name"
        testID="quick-start-trip-name"
        value={details.name}
        onChangeText={(text: string) => setDetails((prev) => ({ ...prev, name: text }))}
      />
      <Text style={styles.modalLabel}>Destination</Text>
      <LocationSelector
        backendUrl={backendUrl}
        headers={stableHeaders}
        initialQuery={initialDraft?.destinationQuery}
        selectedLocations={selectedLocations}
        onAddLocation={addLocation}
        onRemoveLocation={removeLocation}
        onNext={primeRangeDates}
        styles={styles}
        placeholder={destinationAttractionWizardEnabled ? 'Search destinations, countries, or states' : 'Search locations (countries/regions/cities)'}
        locationSearchKind={destinationAttractionWizardEnabled ? 'country_destination' : 'country_state'}
        showCitySearch={!destinationAttractionWizardEnabled}
      />
      <Text style={styles.modalLabel}>Dates</Text>
      <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
        <TouchableOpacity testID="quick-start-dates-scheduled" accessibilityRole="button" accessibilityState={{ selected: dates.mode === 'range' }} style={[styles.button, styles.smallButton]} onPress={() => setDates((prev) => ({ ...prev, mode: 'range' }))}><Text style={styles.buttonText}>Set dates</Text></TouchableOpacity>
        <TouchableOpacity testID="quick-start-dates-unscheduled" accessibilityRole="button" accessibilityState={{ selected: dates.mode === 'duration' }} style={[styles.button, styles.smallButton]} onPress={() => setDates((prev) => ({ ...prev, mode: 'duration' }))}><Text style={styles.buttonText}>Dates not set</Text></TouchableOpacity>
      </View>
      {dates.mode === 'duration' ? <View>
        <Text style={styles.modalLabel}>Trip length (days)</Text>
        <TextInput testID="quick-start-trip-length" accessibilityLabel="Trip length in days" keyboardType="number-pad" style={styles.input} value={dates.durationDays} onChangeText={(durationDays) => setDates((prev) => ({ ...prev, durationDays }))} />
      </View> : <>

      <View style={[styles.row, themeStyle('tabs_createTripWizard_11', { isNarrowLayout: isNarrowLayout }, (theme ?? _styleTheme))]}>
        <View style={[styles.dateInputWrap, themeStyle('tabs_createTripWizard_12', { isNarrowLayout: isNarrowLayout }, (theme ?? _styleTheme))]}>
          <DateField
            value={dates.startDate}
            onChange={setStartDateWithRangeGuard}
            styles={styles}
            theme={theme}
            onOpen={primeRangeDates}
            testID="quick-start-start-date"
            accessibilityLabel="Start date"
          />
        </View>
        <View style={[styles.dateInputWrap, themeStyle('tabs_createTripWizard_13', { isNarrowLayout: isNarrowLayout }, (theme ?? _styleTheme))]}>
          <DateField
            value={dates.endDate}
            onChange={(endDate) => setDates((prev) => ({ ...prev, mode: 'range', endDate }))}
            styles={styles}
            theme={theme}
            onOpen={primeRangeDates}
            testID="quick-start-end-date"
            accessibilityLabel="End date"
          />
        </View>
      </View>
      {computedDays ? <Text style={styles.helperText}>{computedDays} day(s)</Text> : null}
      </>}
      <TouchableOpacity
        style={[styles.button, styles.outlineButton ?? styles.button, themeStyle('tabs_createTripWizard_14', {  }, (theme ?? _styleTheme))]}
        onPress={() => { setQuickStartMode(false); setDateModeSelected(dates.mode === 'duration' ? 'duration' : dates.startDate || dates.endDate ? 'range' : null); }}
        testID="quick-start-customize"
      >
        <Text style={styles.buttonText}>Customize before creating</Text>
      </TouchableOpacity>
    </>
  );

  const renderStepContent = () => {
    if (quickStartMode) return renderQuickStart();
    switch (stepIndex) {
      case 0:
        return (
          <>
            <Text style={styles.sectionTitle}>Trip Details</Text>
            <Text style={styles.helperText}>Name your trip and add a rich description.</Text>
            <TextInput
              style={styles.input}
              placeholder="Trip name"
              accessibilityLabel="Trip name"
              value={details.name}
              onChangeText={(text: string) => setDetails((prev) => ({ ...prev, name: text }))}
            />
            <LocationSelector
              backendUrl={backendUrl}
              headers={stableHeaders}
              initialQuery={initialDraft?.destinationQuery}
              selectedLocations={selectedLocations}
              onAddLocation={addLocation}
              onRemoveLocation={removeLocation}
              onNext={focusDescriptionField}
              styles={styles}
              placeholder={
                destinationAttractionWizardEnabled
                  ? 'Search destinations, countries, or states'
                  : 'Search locations (countries/regions/cities)'
              }
              locationSearchKind={destinationAttractionWizardEnabled ? 'country_destination' : 'country_state'}
              showCitySearch={!destinationAttractionWizardEnabled}
            />
            {selectedLocations.length === 0 ? (
              <Text style={styles.helperText}>Select one or more destinations, countries, or states for this trip.</Text>
            ) : null}
            {destinationAttractionWizardEnabled ? (
              <MustSeeAttractionSelector
                backendUrl={backendUrl}
                headers={stableHeaders}
                selectedLocations={selectedLocations}
                selectedAttractions={selectedMustSeeAttractions}
                onAddAttraction={addMustSeeAttraction}
                onRemoveAttraction={removeMustSeeAttraction}
                styles={styles}
              />
            ) : null}
            <TextInput
              ref={descriptionRef}
              style={[styles.input, themeStyle('tabs_createTripWizard_15', {  }, (theme ?? _styleTheme))]}
              placeholder="Description (optional)"
              accessibilityLabel="Description"
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
            <Text style={styles.helperText}>Choose exact dates, a month and duration, or a trip length with dates to be decided.</Text>
            <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
              <TouchableOpacity
                style={[
                  themeStyle('tabs_createTripWizard_16', { dateModeSelected: dateModeSelected, theme: theme }, (theme ?? _styleTheme)),
                  themeStyle('tabs_createTripWizard_17', {  }, (theme ?? _styleTheme)),
                ]}
                onPress={() => {
                  setDateModeSelected('range');
                  setDates((prev) => ({ ...prev, mode: 'range' }));
                }}
              >
                <Text
                  style={[
                    themeStyle('tabs_createTripWizard_18', { dateModeSelected: dateModeSelected }, (theme ?? _styleTheme)),
                  ]}
                >
                  I know which dates I'm going
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  themeStyle('tabs_createTripWizard_19', { dateModeSelected: dateModeSelected, theme: theme }, (theme ?? _styleTheme)),
                ]}
                onPress={() => {
                  setDateModeSelected('month');
                  setDates((prev) => ({ ...prev, mode: 'month' }));
                }}
              >
                <Text
                  style={[
                    themeStyle('tabs_createTripWizard_20', { dateModeSelected: dateModeSelected }, (theme ?? _styleTheme)),
                  ]}
                >
                  Flexible Timeline
                </Text>
              </TouchableOpacity>
              <TouchableOpacity testID="wizard-dates-unscheduled" accessibilityRole="button" accessibilityState={{ selected: dateModeSelected === 'duration' }} style={[styles.button, styles.smallButton, dateModeSelected === 'duration' && styles.toggleActive]} onPress={() => { setDateModeSelected('duration'); setDates((prev) => ({ ...prev, mode: 'duration' })); }}>
                <Text style={styles.buttonText}>Dates not set</Text>
              </TouchableOpacity>
            </View>
            {!dateModeSelected ? (
              <Text style={styles.helperText}>Select a date option to continue.</Text>
            ) : dates.mode === 'duration' ? (
              <View>
                <Text style={styles.modalLabel}>Trip length (days)</Text>
                <TextInput testID="wizard-trip-length" accessibilityLabel="Trip length in days" style={styles.input} keyboardType="number-pad" value={dates.durationDays} onChangeText={(durationDays) => setDates((prev) => ({ ...prev, durationDays }))} />
                <Text style={styles.helperText}>Choose your dates later. Your itinerary will use numbered days.</Text>
              </View>
            ) : dates.mode === 'range' ? (
              <>
                <View style={[styles.row, themeStyle('tabs_createTripWizard_21', { isNarrowLayout: isNarrowLayout }, (theme ?? _styleTheme))]}>
                  <View style={[styles.dateInputWrap, themeStyle('tabs_createTripWizard_22', { isNarrowLayout: isNarrowLayout }, (theme ?? _styleTheme))]}>
                    <DateField
                      value={dates.startDate}
                      onChange={setStartDateWithRangeGuard}
                      styles={styles}
                      theme={theme}
                      onOpen={primeRangeDates}
                      testID="wizard-start-date"
                      accessibilityLabel="Start date"
                    />
                  </View>
                  <View style={[styles.dateInputWrap, themeStyle('tabs_createTripWizard_23', { isNarrowLayout: isNarrowLayout }, (theme ?? _styleTheme))]}>
                    <DateField
                      value={dates.endDate}
                      onChange={(endDate) => setDates((prev) => ({ ...prev, endDate }))}
                      styles={styles}
                      theme={theme}
                      onOpen={primeRangeDates}
                      testID="wizard-end-date"
                      accessibilityLabel="End date"
                    />
                  </View>
                </View>
                {computedDays ? <Text style={styles.helperText}>Trip length: {computedDays} day(s)</Text> : null}
              </>
            ) : (
              <>
                <View style={styles.row}>
                  <SelectField
                    styles={styles}
                    options={monthOptions}
                    value={dates.startMonth}
                    placeholder="Month"
                    title="Select month"
                    style={themeStyle('tabs_createTripWizard_24', {  }, (theme ?? _styleTheme))}
                    webStyle={webDateInputStyleFlex}
                    onChange={(value) => setDates((prev) => ({ ...prev, startMonth: value }))}
                  />
                  <SelectField
                    styles={styles}
                    options={yearOptions}
                    value={dates.startYear}
                    placeholder="Year"
                    title="Select year"
                    style={themeStyle('tabs_createTripWizard_25', {  }, (theme ?? _styleTheme))}
                    webStyle={webDateInputStyleFlex}
                    onChange={(value) => setDates((prev) => ({ ...prev, startYear: value }))}
                  />
                </View>
                <SelectField
                  styles={styles}
                  options={dayOptions}
                  value={dates.durationDays}
                  placeholder="Days"
                  title="Select number of days"
                  webStyle={webDateInputStyle}
                  onChange={(value) => setDates((prev) => ({ ...prev, durationDays: value }))}
                />
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
            <View style={styles.dropdown}>
              <TextInput
                style={styles.input}
                placeholder="Search past travelers"
                accessibilityLabel="Search participants"
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
            </View>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, themeStyle('tabs_createTripWizard_26', {  }, (theme ?? _styleTheme))]}
                placeholder="First name"
                accessibilityLabel="First name"
                autoComplete="given-name"
                textContentType="givenName"
                value={participantDraft.firstName}
                onChangeText={(text: string) => setParticipantDraft((prev) => ({ ...prev, firstName: text }))}
              />
              <TextInput
                style={[styles.input, themeStyle('tabs_createTripWizard_27', {  }, (theme ?? _styleTheme))]}
                placeholder="Last name"
                accessibilityLabel="Last name"
                autoComplete="family-name"
                textContentType="familyName"
                value={participantDraft.lastName}
                onChangeText={(text: string) => setParticipantDraft((prev) => ({ ...prev, lastName: text }))}
              />
            </View>
            <TextInput
              style={styles.input}
              placeholder="Email (optional)"
              accessibilityLabel="Email"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              keyboardType="email-address"
              value={participantDraft.email ?? ''}
              onChangeText={(text: any) => setParticipantDraft((prev) => ({ ...prev, email: text }))}
            />
            <TouchableOpacity style={styles.button} onPress={() => addParticipant(participantDraft)}>
              <Text style={styles.buttonText}>Add Participant</Text>
            </TouchableOpacity>
            {participants.length ? (
              <View style={themeStyle('tabs_createTripWizard_28', {  }, (theme ?? _styleTheme))}>
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
            {aiItineraryGenerationAllowed ? (
              <>
                <Text style={styles.helperText}>
                  Would you like to create a base itinerary using the help of AI?
                </Text>
                <View style={styles.row}>
                  <TouchableOpacity
                    style={[
                      styles.mapOptionButton ?? styles.button,
                      itineraryMode === 'ai' && (styles.mapOptionActive ?? styles.toggleActive),
                      themeStyle('tabs_createTripWizard_29', {  }, (theme ?? _styleTheme)),
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
              </>
            ) : (
              <Text style={styles.helperText}>
                AI itinerary generation is currently unavailable. You can build your itinerary manually below.
              </Text>
            )}
            {itineraryMode === 'ai' ? (
              <ScrollView
                style={themeStyle('tabs_createTripWizard_30', {  }, (theme ?? _styleTheme))}
                contentContainerStyle={themeStyle('tabs_createTripWizard_31', {  }, (theme ?? _styleTheme))}
                showsVerticalScrollIndicator
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.helperText}>We'll generate a starter plan you can edit later.</Text>
                <Text style={styles.helperText}>
                  The AI itinerary will be generated after you complete all steps of the trip wizard.
                </Text>
                <Text style={styles.helperText}>
                  Planning preferences are pre-populated from your profile when available.
                </Text>
                <TextInput
                    style={[
                    styles.input,
                    dates.mode === 'range' && computedDays ? styles.disabledInput : null,
                    ]}
                    placeholder="Trip days (optional if dates are set)"
                    accessibilityLabel="Trip days"
                    keyboardType="numeric"
                    value={itineraryDays}
                    onChangeText={(text: string) => {
                    setItineraryDaysTouched(true);
                    setItineraryDays(text);
                    }}
                    editable={!(dates.mode === 'range' && computedDays) && dates.mode !== 'duration'}
                  />
                <Text style={styles.modalLabel}>Planning Preferences</Text>
                <Text style={styles.helperText}>Tell us how your group likes to travel and we'll shape the AI itinerary around it.</Text>

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

                <Text style={styles.modalLabel}>Interaction Style</Text>
                <View style={styles.traitGrid}>
                  {PROMPT_INTERACTION_STYLE_OPTIONS.map((opt) => {
                    const selected = wizardPromptTraits.tt.is === opt.value;
                    return (
                      <TouchableOpacity
                        key={`wizard-interaction-style-${opt.value}`}
                        style={[styles.traitChip, selected && styles.traitChipSelected]}
                        onPress={() => setWizardPromptTraits((prev) => ({ ...prev, tt: { ...prev.tt, is: opt.value } }))}
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
                  const descriptor = descriptorForValue(value, field);
                  return (
                    <View key={`wizard-weight-${field.key}`} style={themeStyle('tabs_createTripWizard_32', {  }, (theme ?? _styleTheme))}>
                      <View style={[styles.row, themeStyle('tabs_createTripWizard_33', {  }, (theme ?? _styleTheme))]}>
                        <Text style={styles.cellText}>{field.label}</Text>
                        <Text style={styles.helperText}>{descriptor}</Text>
                      </View>
                      {Platform.OS === 'web' ? (
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={value}
                          onChange={(e: any) => setWizardWeight(field.key, Number(e.target.value))}
                          style={themeStyle('tabs_createTripWizard_34', {  }, (theme ?? _styleTheme))}
                        />
                      ) : (
                        <TextInput
                          style={styles.input}
                          keyboardType="numeric"
                          value={String(value)}
                          onChangeText={(text: string) => setWizardWeight(field.key, text)}
                        />
                      )}
                    </View>
                  );
                })}
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
                <View style={themeStyle('tabs_createTripWizard_35', {  }, (theme ?? _styleTheme))}>
                  <TextInput
                    ref={itineraryAirportRef}
                    style={styles.input}
                    placeholder="Departure airport (optional)"
                    accessibilityLabel="Departure airport"
                    value={itineraryDepartureAirport}
                    onFocus={showItineraryAirportDropdown}
                    onChangeText={(text: string) => {
                      setItineraryDepartureAirport(text);
                      setShowItineraryAirportSuggestions(true);
                    }}
                  />
                  <TouchableOpacity
                    style={themeStyle('tabs_createTripWizard_36', {  }, (theme ?? _styleTheme))}
                    onPress={showItineraryAirportDropdown}
                  >
                    <Text style={styles.selectCaret}></Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : null}
            {itineraryMode === 'manual' ? (
              <ScrollView
                style={themeStyle('tabs_createTripWizard_37', {  }, (theme ?? _styleTheme))}
                contentContainerStyle={themeStyle('tabs_createTripWizard_38', {  }, (theme ?? _styleTheme))}
                showsVerticalScrollIndicator
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.helperText}>All days are free to start. Add manual items to any day.</Text>
                {!computedDays && dates.mode === 'range' ? (
                  <TextInput
                    style={styles.input}
                    placeholder="Trip days (optional if dates are set)"
                    accessibilityLabel="Trip days"
                    keyboardType="numeric"
                    value={itineraryDays}
                    onChangeText={setItineraryDays}
                  />
                ) : null}
                {!dates.durationDays && dates.mode === 'month' ? (
                  <TextInput
                    style={styles.input}
                    placeholder="Trip days (optional if dates are set)"
                    accessibilityLabel="Trip days"
                    keyboardType="numeric"
                    value={itineraryDays}
                    onChangeText={setItineraryDays}
                  />
                ) : null}
                <View style={themeStyle('tabs_createTripWizard_39', {  }, (theme ?? _styleTheme))}>
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
                          accessibilityLabel={`Add item to ${formatManualDayLabel(day)}`}
                        >
                          <Text style={styles.buttonText}>Add item</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            ) : null}
            {itineraryMode === 'manual' && manualDay ? (
              <DialogShell
                visible={manualDay !== null}
                title={`Add item to ${formatManualDayLabel(manualDay)}`}
                styles={styles}
                onClose={() => setManualDay(null)}
                useNativeModal
                testID="manual-itinerary-item-dialog"
              >
                <DateField
                  mode="time"
                  value={manualDraft.time}
                  onChange={(time) => setManualDraft((prev) => ({ ...prev, time }))}
                  styles={styles}
                  theme={theme}
                  placeholder="Time (optional)"
                  testID="manual-itinerary-item-time"
                  accessibilityLabel="Time"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Activity description"
                  accessibilityLabel="Activity description"
                  value={manualDraft.activity}
                  onChangeText={(text: any) => setManualDraft((prev) => ({ ...prev, activity: text }))}
                />
                <View style={styles.row}>
                  <TouchableOpacity style={[styles.button, themeStyle('tabs_createTripWizard_40', {  }, (theme ?? _styleTheme))]} onPress={() => addManualItem(manualDay)}>
                    <Text style={styles.buttonText}>Add Itinerary Item</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.button, styles.dangerButton, themeStyle('tabs_createTripWizard_41', {  }, (theme ?? _styleTheme))]}
                    onPress={() => setManualDay(null)}
                  >
                    <Text style={styles.dangerButtonText}>Done</Text>
                  </TouchableOpacity>
                </View>
              </DialogShell>
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
              theme={theme}
              airportOptions={airportOptions}
              onSearchAirports={onSearchAirports}
              modalOverlayStyle={themeStyle('tabs_createTripWizard_42', { Platform: Platform }, (theme ?? _styleTheme))}
              modalCardStyle={themeStyle('tabs_createTripWizard_43', {  }, (theme ?? _styleTheme))}
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
            <HorizontalTableScroll
              style={styles.tableScroll}
              contentContainerStyle={styles.tableScrollContent}
            >
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
                        themeStyle('tabs_createTripWizard_44', {  }, (theme ?? _styleTheme)),
                      ]}
                    >
                      <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => openWizardLodgingEditor(l)}>
                        <Text style={styles.buttonText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.button, styles.smallButton, styles.dangerButton]}
                        onPress={() => removeWizardLodging(l.id)}
                      >
                        <Text style={styles.dangerButtonText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            </HorizontalTableScroll>
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
                theme={theme}
                onSave={() => saveWizardLodging(editingWizardLodging, editingWizardLodgingId)}
                onSaveAndAddAnother={
                  !editingWizardLodgingId
                    ? () => saveWizardLodging(editingWizardLodging, null, { addAnother: true })
                    : undefined
                }
                onCancel={closeWizardLodgingEditor}
              />
            ) : null}
            <View style={themeStyle('tabs_createTripWizard_45', {  }, (theme ?? _styleTheme))}>
              <Text style={styles.flightTitle}>Total lodging cost: ${wizardLodgingTotal.toFixed(2)}</Text>
              <Text style={styles.helperText}>Breakdown (aligned with total even when no payers are set):</Text>
              {wizardGroupMembers.map((m) => (
                <Text key={m.id} style={styles.helperText}>
                  {formatWizardMemberName(m)}: ${Number(wizardLodgingTotalsBalanced[m.id] ?? 0).toFixed(2)}
                </Text>
              ))}
              <Text style={[styles.helperText, themeStyle('tabs_createTripWizard_46', {  }, (theme ?? _styleTheme))]}>Subtotal across payers: ${wizardLodgingBreakdownSum.toFixed(2)}</Text>
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
              theme={theme}
              fetchTours={async () => undefined}
              mode="wizard"
              lodgings={wizardLodgings}
              defaultActivityDate={dates.mode === 'range' ? dates.startDate : null}
            />
          </>
        );
      case 7:
        return (
          <>
            <Text style={styles.sectionTitle}>Rental Cars</Text>
            <Text style={styles.helperText}>Optional. Add rental cars using the full car rentals interface.</Text>
            <HorizontalTableScroll
              style={styles.tableScroll}
              contentContainerStyle={styles.tableScrollContent}
            >
              <View style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeader]}>
                {WIZARD_CAR_COLUMNS.map((column, idx, arr) => (
                    <View
                      key={column.label}
                      style={[styles.cell, fixedTableColumn(column.width), idx === arr.length - 1 && styles.lastCell]}
                    >
                      <Text style={styles.headerText}>{column.label}</Text>
                    </View>
                  ))}
                </View>
                {wizardCarRentals.map((car) => (
                  <View key={car.id} style={styles.tableRow}>
                    <View style={[styles.cell, fixedTableColumn(140)]}>
                      <Text style={[styles.cellText, styles.cellTextWrap]}>{car.pickupLocation || '-'}</Text>
                    </View>
                    <View style={[styles.cell, fixedTableColumn(140)]}>
                      <Text style={styles.cellText}>{car.pickupDate || '-'}</Text>
                    </View>
                    <View style={[styles.cell, fixedTableColumn(140)]}>
                      <Text style={[styles.cellText, styles.cellTextWrap]}>{car.dropoffLocation || '-'}</Text>
                    </View>
                    <View style={[styles.cell, fixedTableColumn(140)]}>
                      <Text style={styles.cellText}>{car.dropoffDate || '-'}</Text>
                    </View>
                    <View style={[styles.cell, fixedTableColumn(130)]}>
                      <Text style={styles.cellText}>{normalizeItineraryStatus((car as any).status, LEGACY_ITINERARY_STATUS)}</Text>
                    </View>
                    <View style={[styles.cell, fixedTableColumn(140)]}>
                      <Text style={styles.cellText}>{car.reference || '-'}</Text>
                    </View>
                    <View style={[styles.cell, fixedTableColumn(140)]}>
                      <Text style={styles.cellText}>{car.vendor || '-'}</Text>
                    </View>
                    <View style={[styles.cell, fixedTableColumn(140)]}>
                      <Text style={styles.cellText}>{car.prepaid || '-'}</Text>
                    </View>
                    <View style={[styles.cell, fixedTableColumn(120)]}>
                      <Text style={styles.cellText}>{car.cost ? `$${car.cost}` : '-'}</Text>
                    </View>
                    <View style={[styles.cell, fixedTableColumn(180)]}>
                      <Text style={styles.cellText}>{car.model || '-'}</Text>
                    </View>
                    <View style={[styles.cell, fixedTableColumn(220)]}>
                      <Text style={[styles.cellText, styles.cellTextWrap]}>{car.notes || '-'}</Text>
                    </View>
                    <View style={[styles.cell, fixedTableColumn(180)]}>
                      <Text style={styles.cellText}>
                        {(car.travelerIds ?? []).length ? (car.travelerIds ?? []).map(wizardPayerName).join(', ') : '-'}
                      </Text>
                    </View>
                    <View style={[styles.cell, fixedTableColumn(180)]}>
                      <Text style={styles.cellText}>{car.paidBy.length ? car.paidBy.map(wizardPayerName).join(', ') : '-'}</Text>
                    </View>
                    <View style={[styles.cell, styles.actionCell, fixedTableColumn(160), styles.lastCell]}>
                      <TouchableOpacity style={[styles.smallButton, styles.dangerButton]} onPress={() => removeWizardCarRental(car.id)}>
                        <Text style={styles.dangerButtonText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                <View style={[styles.tableRow, styles.inputRow, styles.lastRow, themeStyle('tabs_createTripWizard_47', {  }, (theme ?? _styleTheme))]}>
                  <View style={[wizardCarInputCellStyle, fixedTableColumn(140)]}>
                    <TextInput
                      style={wizardCarInputStyle}
                      placeholder="Pick up location"
                      accessibilityLabel="Pick up location"
                      value={wizardCarDraft.pickupLocation}
                      onChangeText={(text: any) => setWizardCarDraft((p) => ({ ...p, pickupLocation: text }))}
                    />
                  </View>
                  <View style={[wizardCarInputCellStyle, fixedTableColumn(140)]}>
                    <View style={wizardCarDateWrapStyle}>
                      <DateField
                        value={wizardCarDraft.pickupDate}
                        onChange={(pickupDate) => setWizardCarDraft((p) => ({ ...p, pickupDate }))}
                        styles={styles}
                        theme={theme}
                        style={wizardCarDateInputStyle}
                        testID="wizard-car-pickup-date"
                        accessibilityLabel="Pick up date"
                      />
                    </View>
                  </View>
                  <View style={[wizardCarInputCellStyle, fixedTableColumn(140)]}>
                    <TextInput
                      style={wizardCarInputStyle}
                      placeholder="Drop off location"
                      accessibilityLabel="Drop off location"
                      value={wizardCarDraft.dropoffLocation}
                      onChangeText={(text: any) => setWizardCarDraft((p) => ({ ...p, dropoffLocation: text }))}
                    />
                  </View>
                  <View style={[wizardCarInputCellStyle, fixedTableColumn(140)]}>
                    <View style={wizardCarDateWrapStyle}>
                      <DateField
                        value={wizardCarDraft.dropoffDate}
                        onChange={(dropoffDate) => setWizardCarDraft((p) => ({ ...p, dropoffDate }))}
                        styles={styles}
                        theme={theme}
                        style={wizardCarDateInputStyle}
                        testID="wizard-car-dropoff-date"
                        accessibilityLabel="Drop off date"
                      />
                    </View>
                  </View>
                  <View style={[wizardCarInputCellStyle, fixedTableColumn(130)]}>
                    {Platform.OS === 'web' ? (
                      <select
                        value={normalizeItineraryStatus(wizardCarDraft.status, DEFAULT_NEW_ITINERARY_STATUS)}
                        onChange={(e) =>
                          setWizardCarDraft((p) => ({
                            ...p,
                            status: normalizeItineraryStatus(e.target.value, DEFAULT_NEW_ITINERARY_STATUS),
                          }))
                        }
                        style={themeStyle('tabs_createTripWizard_48', { wizardCarWebInputStyle: wizardCarWebInputStyle }, (theme ?? _styleTheme))}
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
                  <View style={[wizardCarInputCellStyle, fixedTableColumn(140)]}>
                    <TextInput
                      style={wizardCarInputStyle}
                      placeholder="Reference"
                      accessibilityLabel="Reference"
                      value={wizardCarDraft.reference}
                      onChangeText={(text: any) => setWizardCarDraft((p) => ({ ...p, reference: text }))}
                    />
                  </View>
                  <View style={[wizardCarInputCellStyle, fixedTableColumn(140)]}>
                    <TextInput
                      style={wizardCarInputStyle}
                      placeholder="Vendor"
                      accessibilityLabel="Vendor"
                      value={wizardCarDraft.vendor}
                      onChangeText={(text: any) => setWizardCarDraft((p) => ({ ...p, vendor: text }))}
                    />
                  </View>
                  <View style={[wizardCarInputCellStyle, fixedTableColumn(140)]}>
                    <SelectField
                      styles={styles}
                      options={prepaidOptions}
                      value={wizardCarDraft.prepaid}
                      placeholder="Select Yes/No"
                      title="Prepaid status"
                      style={themeStyle('tabs_createTripWizard_49', {  }, (theme ?? _styleTheme))}
                      webStyle={wizardCarWebInputStyle}
                      listStyle={themeStyle('tabs_createTripWizard_50', {  }, (theme ?? _styleTheme))}
                      onChange={(value) => setWizardCarDraft((p) => ({ ...p, prepaid: value }))}
                    />
                  </View>
                  <View style={[wizardCarInputCellStyle, fixedTableColumn(120)]}>
                    <TextInput
                      style={wizardCarInputStyle}
                      placeholder="Cost"
                      accessibilityLabel="Cost"
                      keyboardType="numeric"
                      value={wizardCarDraft.cost}
                      onChangeText={(text: string) =>
                        setWizardCarDraft((p) => ({ ...p, cost: sanitizeCostInput(text) }))
                      }
                    />
                  </View>
                  <View style={[wizardCarInputCellStyle, fixedTableColumn(180)]}>
                    <TextInput
                      style={wizardCarInputStyle}
                      placeholder="Car model"
                      accessibilityLabel="Car model"
                      value={wizardCarDraft.model}
                      onChangeText={(text: any) => setWizardCarDraft((p) => ({ ...p, model: text }))}
                    />
                  </View>
                  <View style={[wizardCarInputCellStyle, fixedTableColumn(220)]}>
                    <TextInput
                      style={[wizardCarInputStyle, styles.cellTextWrap]}
                      placeholder="Notes"
                      accessibilityLabel="Notes"
                      value={wizardCarDraft.notes}
                      onChangeText={(text: any) => setWizardCarDraft((p) => ({ ...p, notes: text }))}
                    />
                  </View>
                  <View style={[wizardCarInputCellStyle, fixedTableColumn(180)]}>
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
                  <View style={[wizardCarInputCellStyle, fixedTableColumn(180)]}>
                    <PayerSelect members={wizardGroupMembers} value={wizardCarDraft.paidBy} formatName={formatWizardMemberName} onChange={ids => setWizardCarDraft(prev => ({ ...prev, paidBy: ids }))} styles={styles} testID="wizard-car-payer" />

                  </View>
                  <View style={[styles.cell, styles.actionCell, fixedTableColumn(160), styles.lastCell]}>
                    <TouchableOpacity style={styles.button} onPress={addWizardCarRental}>
                      <Text style={styles.buttonText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </HorizontalTableScroll>
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
            {selectedMustSeeAttractions.length ? (
              <Text style={styles.bodyText}>
                Must See Attractions: {selectedMustSeeAttractions.map((attraction) => attraction.name).join(', ')}
              </Text>
            ) : null}
            {dates.mode === 'range' && (dates.startDate || dates.endDate) ? (
              <Text style={styles.bodyText}>Dates: {dates.startDate || 'TBD'} - {dates.endDate || 'TBD'}</Text>
            ) : null}
            {dates.mode === 'duration' ? <Text style={styles.bodyText}>Dates not set · {dates.durationDays} day(s)</Text> : null}
            {dates.mode === 'month' && monthLabel && dates.durationDays ? (
              <Text style={styles.bodyText}>
                Dates: {monthLabel} · {dates.durationDays} day(s)
              </Text>
            ) : null}
            {details.description ? (
              <View style={themeStyle('tabs_createTripWizard_51', {  }, (theme ?? _styleTheme))}>
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
    <View style={themeStyle('tabs_createTripWizard_52', {  }, (theme ?? _styleTheme))}>
      <View style={[styles.card, themeStyle('tabs_createTripWizard_53', {  }, (theme ?? _styleTheme))]}>
        <View style={[styles.row, themeStyle('tabs_createTripWizard_54', {  }, (theme ?? _styleTheme))]}>
          <View>
            <Text style={styles.sectionTitle}>{quickStartMode ? 'Create a trip' : 'Create Trip Wizard'}</Text>
            <Text style={styles.helperText}>
              {quickStartMode ? 'Quick start' : `Step ${stepIndex + 1} of ${totalSteps}: ${steps[stepIndex]}`}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.button, styles.dangerButton, themeStyle('tabs_createTripWizard_55', {  }, (theme ?? _styleTheme))]}
            onPress={() => setShowExitConfirm(true)}
          >
            <Text style={styles.dangerButtonText}>X</Text>
          </TouchableOpacity>
        </View>
        {wizardError ? <Text style={styles.errorText}>{wizardError}</Text> : null}
        {/* Step content scrolls; nav buttons stay anchored below */}
        <ScrollView
          style={themeStyle('tabs_createTripWizard_56', {  }, (theme ?? _styleTheme))}
          contentContainerStyle={themeStyle('tabs_createTripWizard_57', {  }, (theme ?? _styleTheme))}
          keyboardShouldPersistTaps="handled"
        >
          {renderStepContent()}
        </ScrollView>
        <View style={[styles.row, themeStyle('tabs_createTripWizard_58', {  }, (theme ?? _styleTheme))]}>
          <TouchableOpacity
            style={[
              styles.button,
              themeStyle('tabs_createTripWizard_59', {  }, (theme ?? _styleTheme)),
              stepIndex === 0 ? styles.dangerButton : (styles.mapOptionButton ?? styles.button),
            ]}
            onPress={quickStartMode || stepIndex === 0 ? cancelWizard : goBack}
          >
            <Text style={quickStartMode || stepIndex === 0 ? styles.dangerButtonText : (styles.mapOptionText ?? styles.buttonText)}>
              {quickStartMode || stepIndex === 0 ? 'Cancel' : 'Back'}
            </Text>
          </TouchableOpacity>
          {quickStartMode ? (
            <View style={[styles.row, themeStyle('tabs_createTripWizard_60', {  }, (theme ?? _styleTheme))]}>
              <TouchableOpacity style={[styles.button, themeStyle('tabs_createTripWizard_61', {  }, (theme ?? _styleTheme)), !quickStartReady && themeStyle('tabs_createTripWizard_62', {  }, (theme ?? _styleTheme))]} onPress={submitWizard} disabled={!quickStartReady || isSubmitting} testID="quick-start-create">
                <Text style={styles.buttonText}>{isSubmitting ? 'Creating...' : 'Create Trip'}</Text>
              </TouchableOpacity>
              <View
                accessibilityLabel="Beta feature"
                style={themeStyle('tabs_createTripWizard_63', { theme: theme }, (theme ?? _styleTheme))}
              >
                <Text style={themeStyle('tabs_createTripWizard_64', { theme: theme }, (theme ?? _styleTheme))}>BETA</Text>
              </View>
            </View>
          ) : stepIndex < totalSteps - 1 ? (
            <>
              <TouchableOpacity
                style={[styles.button, themeStyle('tabs_createTripWizard_65', {  }, (theme ?? _styleTheme)), !canMoveNext && themeStyle('tabs_createTripWizard_66', {  }, (theme ?? _styleTheme))]}
                onPress={goNext}
                disabled={!canMoveNext}
              >
                <Text style={styles.buttonText}>Next</Text>
              </TouchableOpacity>
              {stepIndex >= 3 ? (
                <TouchableOpacity
                  style={[styles.button, themeStyle('tabs_createTripWizard_67', {  }, (theme ?? _styleTheme)), !canMoveNext && themeStyle('tabs_createTripWizard_68', {  }, (theme ?? _styleTheme))]}
                  onPress={submitWizard}
                  disabled={!canMoveNext || isSubmitting}
                >
                  <Text style={styles.buttonText}>{isSubmitting ? 'Creating...' : 'Finish Trip'}</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
            <View style={[styles.row, themeStyle('tabs_createTripWizard_69', {  }, (theme ?? _styleTheme))]}>
              <TouchableOpacity style={[styles.button, themeStyle('tabs_createTripWizard_70', {  }, (theme ?? _styleTheme))]} onPress={submitWizard} disabled={isSubmitting}>
                <Text style={styles.buttonText}>{isSubmitting ? 'Creating...' : 'Create Trip'}</Text>
              </TouchableOpacity>
              <View
                accessibilityLabel="Beta feature"
                style={themeStyle('tabs_createTripWizard_71', { theme: theme }, (theme ?? _styleTheme))}
              >
                <Text style={themeStyle('tabs_createTripWizard_72', { theme: theme }, (theme ?? _styleTheme))}>BETA</Text>
              </View>
            </View>
          )}
        </View>
      </View>
      {showItineraryAirportSuggestions && itineraryAirportAnchor ? (
        <View style={[styles.passengerOverlay, themeStyle('tabs_createTripWizard_73', {  }, (theme ?? _styleTheme))]}>
          <TouchableOpacity
            style={[styles.passengerOverlayBackdrop, themeStyle('tabs_createTripWizard_74', {  }, (theme ?? _styleTheme))]}
            onPress={hideItineraryAirportDropdown}
          />
          <View
            style={[
              styles.passengerOverlayList,
              themeStyle('tabs_createTripWizard_75', { itineraryAirportAnchor: itineraryAirportAnchor }, (theme ?? _styleTheme)),
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
      {editingWizardLodging && editingWizardLodgingId ? (
        <View style={styles.passengerOverlay}>
          <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={closeWizardLodgingEditor} />
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>Edit Lodging</Text>
            <ScrollView style={themeStyle('tabs_createTripWizard_76', {  }, (theme ?? _styleTheme))}>
              <Text style={styles.modalLabel}>Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Lodging name"
                accessibilityLabel="Lodging name"
                value={editingWizardLodging.name}
                onChangeText={(text: any) => setEditingWizardLodging((prev) => (prev ? { ...prev, name: text } : prev))}
              />
              <Text style={styles.modalLabel}>Check-in</Text>
              <DateField
                value={editingWizardLodging.checkInDate}
                onChange={(checkInDate) => setEditingWizardLodging((prev) => (prev ? { ...prev, checkInDate } : prev))}
                styles={styles}
                theme={theme}
                testID="wizard-lodging-check-in-date"
                accessibilityLabel="Check-in date"
              />
              <Text style={styles.modalLabel}>Check-out</Text>
              <DateField
                value={editingWizardLodging.checkOutDate}
                onChange={(checkOutDate) => setEditingWizardLodging((prev) => (prev ? { ...prev, checkOutDate } : prev))}
                styles={styles}
                theme={theme}
                testID="wizard-lodging-check-out-date"
                accessibilityLabel="Check-out date"
              />
              <Text style={styles.modalLabel}>Rooms</Text>
              <TextInput
                style={styles.input}
                placeholder="Number of rooms"
                accessibilityLabel="Rooms"
                keyboardType="numeric"
                value={editingWizardLodging.rooms}
                onChangeText={(text: any) => setEditingWizardLodging((prev) => (prev ? { ...prev, rooms: text } : prev))}
              />
              <Text style={styles.modalLabel}>Refund by</Text>
              <DateField
                value={editingWizardLodging.refundBy}
                onChange={(refundBy) => setEditingWizardLodging((prev) => (prev ? { ...prev, refundBy } : prev))}
                styles={styles}
                theme={theme}
                testID="wizard-lodging-refund-date"
                accessibilityLabel="Refund by date"
              />
              <Text style={styles.modalLabel}>Total cost</Text>
              <TextInput
                style={styles.input}
                placeholder="Total cost"
                accessibilityLabel="Total cost"
                value={editingWizardLodging.totalCost}
                keyboardType="numeric"
                onChangeText={(text: any) => setEditingWizardLodging((prev) => (prev ? { ...prev, totalCost: text } : prev))}
              />
              <Text style={styles.modalLabel}>Cost per night</Text>
              <Text style={styles.helperText}>{editingWizardLodging.costPerNight ? `$${editingWizardLodging.costPerNight}` : '-'}</Text>

              <Text style={styles.modalLabel}>Paid by</Text>
              <PayerSelect members={wizardGroupMembers} value={editingWizardLodging.paidBy} formatName={formatWizardMemberName} onChange={ids => setEditingWizardLodging(prev => prev ? ({ ...prev, paidBy: ids }) : prev)} styles={styles} testID="wizard-lodging-payer" />

              <Text style={styles.modalLabel}>Address</Text>
              <TextInput
                style={styles.input}
                placeholder="Address"
                accessibilityLabel="Address"
                value={editingWizardLodging.address}
                onChangeText={(text: any) => setEditingWizardLodging((prev) => (prev ? { ...prev, address: text } : prev))}
              />
            </ScrollView>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={closeWizardLodgingEditor}>
                <Text style={styles.dangerButtonText}>Cancel</Text>
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
      <ConfirmDialog
        visible={showExitConfirm}
        title="Exit trip wizard?"
        message="Your progress will not be saved."
        confirmLabel="Exit"
        cancelLabel="Stay"
        onConfirm={() => {
          setShowExitConfirm(false);
          cancelWizard();
        }}
        onCancel={() => setShowExitConfirm(false)}
        styles={styles}
      />
    </View>
  );
};

export default React.memo(CreateTripWizard);

