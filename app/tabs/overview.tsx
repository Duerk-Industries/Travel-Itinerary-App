// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
  type LayoutChangeEvent,
  useWindowDimensions, } from 'react-native';
import { addDaysToIso, computeTripDays, validateTripDates } from '../utils/createTripWizard';
import { renderRichTextBlocks } from '../utils/richText';
import { buildBookingPriorities, BookingPriorityItem, BookingPriorityUrgency } from '../utils/bookingPriorities';
import {
  buildOverviewRows,
  type DetailItem,
  formatFlightDetails,
  formatTourDetails,
  type OverviewRow,
} from '../utils/overviewBuilder';
import { type MapApp } from '../utils/mapLinks';
import {
  computeEndDateFromDuration,
  formatMonthYear,
} from '../utils/tripDates';
import { buildMemberDisplayLookup, dedupeMembersByIdentity, formatMemberDisplayName, formatTravelerListDisplay } from '../utils/memberDisplay';
import { normalizeDateString } from '../utils/normalizeDateString';
import {
  buildFlightPayload,
  createFlightDraftForTrip,
  createInitialFlightState,
  type Flight,
  type FlightEditDraft,
  type GroupMemberOption,
} from '../tabs/transfers';
import {
  buildLodgingPayload,
  createInitialLodgingState,
  createLodgingDraftForTrip,
  createLodgingForTrip,
  saveLodgingApi,
  toLodgingDraft,
  type LodgingDraft,
} from '../tabs/lodging';
import {
  buildActivityPayload,
  createInitialActivityState,
  createActivityForTrip,
  type TourDraft,
} from '../tabs/activities';
import {
  buildCarRentalFromDraft,
  createInitialCarRentalDraft,
  type CarRental,
  type CarRentalDraft,
} from '../tabs/carRentals';
import DestinationPlaceholderCard from '../components/DestinationPlaceholderCard';
import ActivityEditForm from '../components/ActivityEditForm';
import CarRentalEditForm from '../components/CarRentalEditForm';
import { buildRentalDraftFromRow, buildTourDraftFromRow, getOverviewSaveFlags } from '../utils/overviewEditing';
import {
  buildDayEventsMap,
  flightMatchesDay,
  lodgingCoversDay,
  rentalMatchesDay,
  tourMatchesDay,
} from '../utils/overviewDayEvents';
import { FlightEditingForm } from '../components/TransferEditingForm';
import TripDayMap from '../components/TripDayMap';
import { type TripMapPoint } from '../utils/googleMaps';
import ConfirmDialog from '../components/ConfirmDialog';
import LodgingDialog from '../components/LodgingDialog';
import TripItemDetailsDialog from '../components/TripItemDetailsDialog';
import ReactionBar, { type ReactionSummary, type ReactionValue } from '../components/ReactionBar';
import GetYourGuideCta from '../components/GetYourGuideCta';
import AddItemPopover, { type AddItemKind } from '../components/AddItemPopover';
import PlacePickerDialog, { type PlacePickerSubmit } from '../components/PlacePickerDialog';
import NoteInputDialog, { type NoteSubmit } from '../components/NoteInputDialog';
import ChecklistInputDialog, { type ChecklistSubmit } from '../components/ChecklistInputDialog';
// AsyncStorage is loaded lazily (see getAsyncStorage below) so the day-card
// cache import doesn't add @react-native-async-storage/async-storage to the
// module-evaluation graph of every tab that ends up importing this file.
type AsyncStorageModule = typeof import('@react-native-async-storage/async-storage').default;
let _asyncStoragePromise: Promise<AsyncStorageModule | null> | null = null;
const getAsyncStorage = (): Promise<AsyncStorageModule | null> => {
  if (!_asyncStoragePromise) {
    _asyncStoragePromise = import('@react-native-async-storage/async-storage')
      .then((mod) => mod.default ?? (mod as unknown as AsyncStorageModule))
      .catch(() => null);
  }
  return _asyncStoragePromise;
};
import { LEGACY_ITINERARY_STATUS, normalizeItineraryStatus } from '../utils/itineraryStatus';
import { useImageSourceGetter } from '../utils/imageSource';
import { formatTemperatureFromCelsius, normalizeTemperatureUnit, type TemperatureUnit } from '../utils/temperatureUnit';
import { printItinerary as openPrintableItinerary } from '../utils/printableItinerary';

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
  locationIds?: string[];
  startDate?: string | null;
  endDate?: string | null;
  startMonth?: number | null;
  startYear?: number | null;
  durationDays?: number | null;
  currency?: string | null;
  createdAt: string;
};

type GroupView = {
  id: string;
  name: string;
  members: Array<{ id: string; userEmail?: string; email?: string; guestName?: string }>;
  invites?: Array<{ id: string; inviteeEmail: string; status: string }>;
};

type Lodging = {
  id: string;
  status?: string;
  name: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: string;
  refundBy: string;
  totalCost: string;
  costPerNight: string;
  address: string;
  imageUrl?: string;
};

type Tour = {
  id: string;
  status?: string;
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

type ItineraryDetailKind = 'activity' | 'place' | 'note' | 'checklist';

type ChecklistChildRecord = {
  id: string;
  detailId: string;
  position: number;
  label: string;
  checkedBy?: string | null;
  checkedAt?: string | null;
  createdAt: string;
};

type ItineraryDetail = {
  id: string;
  day: number;
  time?: string | null;
  activity: string;
  cost?: number | null;
  kind?: ItineraryDetailKind;
  placeId?: string | null;
  noteBody?: string | null;
  position?: number;
  checklistItems?: ChecklistChildRecord[];
  reactions?: ReactionSummary;
};

const formatEtaSeconds = (seconds?: number | null): string | null => {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
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
  temperatureUnit?: TemperatureUnit;
  aiItineraryPending?: boolean;
  aiItineraryStageLabel?: string | null;
  aiItineraryStageDetail?: string | null;
  aiItineraryEtaSeconds?: number | null;
  aiItineraryFailedMessage?: string | null;
  onRetryAiItinerary?: (tripId: string) => void;
  onDismissAiItineraryError?: (tripId: string) => void;
  editSignal?: number;
  goToDay1Signal?: number;
  onUpdateCurrency?: (tripId: string, currency: string) => void;
  onOpenAddress: (address: string) => void;
  onRefreshTrips: () => void;
  onRefreshGroups: () => void;
  onRefreshGroupMembers: () => void;
  onFlightDataChanged: () => void;
  onLodgingDataChanged: () => void;
  onTourDataChanged: () => void;
  onAddCarRental: (rental: CarRental) => void;
  onUpdateCarRental?: (id: string, draft?: CarRentalDraft) => boolean | void | Promise<boolean | void>;
  openFlightInFlightsTab: (flightId: string) => void;
  openLodgingDetails: (lodging: Lodging) => void;
  theme?: AppTheme;
  readOnly?: boolean;
  featureStandardizedItemDialogs?: boolean;
  // Kill switch for the designed gradient placeholder shown in place of a
  // missing day/trip cover photo (implementation-plan-ux-remediation.md,
  // Initiative B). Defaults to `true`; `false` reverts to the plain empty
  // fallback tile.
  featureCoverPhotoFallbackV2?: boolean;
  // Gate the reaction bar / checklist-item toggle interactions themselves (not just visibility)
  // against their server-side feature flags, so a disabled flag makes the control inert instead
  // of letting a tap reach a 403 that the global permissionDeniedInterceptor would otherwise pop
  // as a "Permission Denied" alert. Default `true` — both flags default to on server-side, and
  // these gate already-relied-upon controls rather than optional new UI, so the safer default
  // while the real value is still loading is "keep working," not "briefly go inert."
  featureItineraryReactions?: boolean;
  featureItineraryItemKinds?: boolean;
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

type DetailModalState = {
  title: string;
  sections: DetailSection[];
  kind?: 'flight' | 'lodging' | 'activity';
  item?: Flight | Lodging | Tour;
};

type ModalDateField =
  | 'flightDeparture'
  | 'lodgingCheckIn'
  | 'lodgingCheckOut'
  | 'lodgingRefundBy';

export const dedupeAttendees = (
  attendees: OverviewTabProps['attendees']
): OverviewTabProps['attendees'] => {
  return dedupeMembersByIdentity(attendees ?? []);
};

export const formatAttendeeLabel = (member: OverviewTabProps['attendees'][number]) => {
  return formatMemberDisplayName(member);
};

export const formatUserDisplayName = (member: {
  firstName?: string | null;
  lastName?: string | null;
  guestName?: string | null;
  email?: string | null;
  userEmail?: string | null;
}) => {
  return formatMemberDisplayName(member);
};

type DayLocationInfo = {
  flights: Flight[];
  lodgings: Lodging[];
  tours: Tour[];
  rentals: CarRental[];
};

type OverviewWeather = {
  date: string;
  icon: string;
  description?: string | null;
  temperatureHighC?: number | null;
  resolvedLocation?: string | null;
};

const normalizeWeatherLocationText = (value?: string | null): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();

const usStatePattern =
  '(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY|Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)';

const streetSuffixPattern =
  /\b(?:aly|alley|ave|avenue|blvd|boulevard|cir|circle|ct|court|dr|drive|hwy|highway|ln|lane|pkwy|parkway|pl|place|rd|road|st|street|ter|terrace|trl|trail|way)\b/i;

export const makeWeatherLocationGeofriendly = (
  location?: string | null,
  fallbackLocation?: string | null,
  options: { stripLodgingWords?: boolean } = {}
): string => {
  const original = normalizeWeatherLocationText(location);
  const fallback = normalizeWeatherLocationText(fallbackLocation);
  if (!original) return fallback;

  const commaParts = original.split(',').map((part) => part.trim()).filter(Boolean);
  if (commaParts.length >= 3) {
    const [last, secondLast] = [commaParts[commaParts.length - 1], commaParts[commaParts.length - 2]];
    const city = commaParts[commaParts.length - 3];
    const country = /^(?:us|usa|united states)$/i.test(last) ? 'US' : last;
    const state = secondLast.replace(/\b\d{5}(?:-\d{4})?\b/g, '').trim();
    if (city && state) return `${city}, ${state}, ${country}`.trim();
  }

  const stateMatch = original.match(new RegExp(`\\b(${usStatePattern})\\b`, 'i'));
  if (stateMatch?.index != null) {
    const beforeState = original.slice(0, stateMatch.index).trim();
    const afterState = original.slice(stateMatch.index + stateMatch[0].length).trim();
    const countryMatch = afterState.match(/\b(?:US|USA|United States)\b/i);
    const country = countryMatch ? 'US' : '';
    const state = stateMatch[0];
    const beforeTokens = beforeState.split(/\s+/).filter(Boolean);
    let suffixIndex = -1;
    for (let idx = beforeTokens.length - 1; idx >= 0; idx -= 1) {
      if (streetSuffixPattern.test(beforeTokens[idx])) {
        suffixIndex = idx;
        break;
      }
    }
    const cityTokens = beforeTokens.slice(suffixIndex + 1).filter((token) => !/^\d/.test(token));
    const city = cityTokens.join(' ').trim();
    if (city) return [city, state, country].filter(Boolean).join(', ');
  }

  if (options.stripLodgingWords) {
    const cleanedLodgingName = original
      .replace(/\b(?:airbnb|hotel|inn|suites?|resort|lodging|accommodations?|by ihg|express)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+-\s+$/g, '')
      .trim();
    if (cleanedLodgingName && cleanedLodgingName !== original) return cleanedLodgingName;
  }

  return original || fallback;
};

export const buildDayWeatherLocation = (info?: DayLocationInfo | null, fallbackLocation?: string | null) => {
  const fallback = String(fallbackLocation ?? '').trim();
  if (!info) return fallback;

  const lodging = info.lodgings[0];
  if (lodging) {
    const rawAddress = normalizeWeatherLocationText(lodging.address);
    const address = rawAddress ? makeWeatherLocationGeofriendly(rawAddress, fallback) : '';
    if (address) return address;
    return makeWeatherLocationGeofriendly(lodging.name, fallback, { stripLodgingWords: true }) || fallback;
  }

  const arrivalFlight = info.flights.find((flight) =>
    String(flight.arrival_airport_code ?? flight.arrival_location ?? '').trim()
  );
  if (arrivalFlight) {
    return String(arrivalFlight.arrival_airport_code ?? arrivalFlight.arrival_location ?? '').trim() || fallback;
  }

  return fallback;
};

export const isWithinOverviewWeatherWindow = (
  currentDateIso?: string | null,
  tripStartDateIso?: string | null,
  tripEndDateIso?: string | null
) => {
  const current = normalizeDateString(currentDateIso ?? '');
  const start = normalizeDateString(tripStartDateIso ?? '');
  const end = normalizeDateString(tripEndDateIso ?? tripStartDateIso ?? '');
  if (!current || !start || !end) return false;
  const currentTime = new Date(current).getTime();
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if ([currentTime, startTime, endTime].some((value) => Number.isNaN(value))) return false;
  const msPerDay = 24 * 60 * 60 * 1000;
  return currentTime >= startTime - 7 * msPerDay && currentTime <= endTime + msPerDay;
};

export const OverviewTab: React.FC<OverviewTabProps> = ({
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
  temperatureUnit = 'fahrenheit',
  aiItineraryPending,
  aiItineraryStageLabel,
  aiItineraryStageDetail,
  aiItineraryEtaSeconds,
  aiItineraryFailedMessage,
  onRetryAiItinerary,
  onDismissAiItineraryError,
  editSignal,
  goToDay1Signal,
  onUpdateCurrency,
  onOpenAddress,
  onRefreshTrips,
  onRefreshGroups,
  onRefreshGroupMembers,
  onFlightDataChanged,
  onLodgingDataChanged,
  onTourDataChanged,
  onAddCarRental,
  onUpdateCarRental,
  openFlightInFlightsTab: _openFlightInFlightsTab,
  openLodgingDetails,
  theme,
  readOnly = false,
  featureStandardizedItemDialogs = false,
  featureCoverPhotoFallbackV2 = true,
  featureItineraryReactions = true,
  featureItineraryItemKinds = true,
}) => {
  const { width: viewportWidth } = useWindowDimensions();
  const isPhoneLayout = viewportWidth < 700;
  const isTabletLayout = viewportWidth >= 700 && viewportWidth < 1100;
  const dayHeroHeight = Math.max(190, Math.min(300, viewportWidth * (isPhoneLayout ? 0.52 : 0.3)));
  const lodgingThumbnailSize = isPhoneLayout ? 64 : isTabletLayout ? 72 : 80;
  const stripResizeMode = useCallback((style: any) => {
    const flattened = StyleSheet.flatten(style);
    if (!flattened || typeof flattened !== 'object' || !('resizeMode' in flattened)) {
      return style;
    }
    const { resizeMode: _resizeMode, ...rest } = flattened as Record<string, unknown>;
    return rest;
  }, []);
  const dayHeroImageStyle = useMemo(() => stripResizeMode(styles.dayHeroImage), [stripResizeMode, styles.dayHeroImage]);
  const lodgingImageStyle = useMemo(() => stripResizeMode(styles.lodgingImage), [stripResizeMode, styles.lodgingImage]);
  const getImageSource = useImageSourceGetter();
  const responsiveCardStyle = useMemo(
    () => ({
      padding: isPhoneLayout ? 12 : 16,
      borderRadius: isPhoneLayout ? 10 : 12,
    }),
    [isPhoneLayout]
  );
  const [itineraryDetails, setItineraryDetails] = useState<ItineraryDetail[]>([]);
  const [itineraryLoading, setItineraryLoading] = useState(false);
  const [itineraryId, setItineraryId] = useState<string | null>(null);
  const [itineraryPlanMarkdown, setItineraryPlanMarkdown] = useState<string | null>(null);
  const [showItineraryPlanNotes, setShowItineraryPlanNotes] = useState(false);
  const [editingDetailId, setEditingDetailId] = useState<string | null>(null);
  const [detailDraft, setDetailDraft] = useState({ day: '1', time: '', activity: '', cost: '' });
  const [addPopoverOpen, setAddPopoverOpen] = useState(false);
  const [activeAddDialog, setActiveAddDialog] = useState<AddItemKind | null>(null);
  const [addPopoverDay, setAddPopoverDay] = useState<number | null>(null);
  const [isEditingDayItems, setIsEditingDayItems] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
  const [dateDraft, setDateDraft] = useState({
    mode: 'range' as 'range' | 'month',
    startDate: '',
    endDate: '',
    startMonth: '',
    startYear: '',
    durationDays: '',
  });
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const [selectedTour, setSelectedTour] = useState<Tour | null>(null);
  const [selectedLodging, setSelectedLodging] = useState<Lodging | null>(null);
  const [detailModal, setDetailModal] = useState<DetailModalState | null>(null);
  const [itemToDelete, setItemToDelete] = useState<{
    kind: 'flight' | 'lodging' | 'activity';
    id: string;
    name: string;
  } | null>(null);
  const [showAddTraveler, setShowAddTraveler] = useState(false);
  const [travelerDraft, setTravelerDraft] = useState({ firstName: '', lastName: '', email: '' });
  const [pendingRemovalIds, setPendingRemovalIds] = useState<string[]>([]);
  const [showAddLodging, setShowAddLodging] = useState(false);
  const [tripLocationOptions, setTripLocationOptions] = useState<{ id: string; name: string }[]>([]);
  const [retryingAiItineraryTripId, setRetryingAiItineraryTripId] = useState<string | null>(null);

  // Once a retry lands (success or failure) the parent's tracker state changes — either
  // aiItineraryPending flips true, or aiItineraryFailedMessage gets a fresh value. Either
  // way, clear the local "retrying" flag so the button re-enables.
  useEffect(() => {
    setRetryingAiItineraryTripId(null);
  }, [aiItineraryPending, aiItineraryFailedMessage]);

  useEffect(() => {
    const ids = Array.isArray(trip?.locationIds) ? trip!.locationIds : [];
    if (!ids.length) {
      setTripLocationOptions([]);
      return;
    }
    let active = true;
    fetch(`${backendUrl}/api/places/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ ids }),
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!active) return;
        const options = Array.isArray(data)
          ? data
              .map((item: any) => ({ id: String(item?.place_id ?? item?.id ?? ''), name: String(item?.name ?? '') }))
              .filter((item: { id: string; name: string }) => item.name)
          : [];
        setTripLocationOptions(options);
      })
      .catch(() => {
        if (active) setTripLocationOptions([]);
      });
    return () => {
      active = false;
    };
  }, [backendUrl, headers, trip?.id, trip?.locationIds]);
  const locationNames = useMemo(() => tripLocationOptions.map((o) => o.name), [tripLocationOptions]);
  const tripLocationLabel = locationNames.length ? locationNames.join(', ') : trip?.destination || '';
  const tripAttractionsLabel = Array.isArray(trip?.mustSeeAttractions) ? trip!.mustSeeAttractions.join(', ') : '';
  const [showAddTour, setShowAddTour] = useState(false);
  const [showAddRental, setShowAddRental] = useState(false);
  const [lodgingDraft, setLodgingDraft] = useState<LodgingDraft>(createInitialLodgingState());
  const [tourDraft, setTourDraft] = useState<TourDraft>(createInitialActivityState(trip?.startDate ?? null));
  const [rentalDraft, setRentalDraft] = useState<CarRentalDraft>(createInitialCarRentalDraft());
  const [editingFlightId, setEditingFlightId] = useState<string | null>(null);
  const [editingFlightDraft, setEditingFlightDraft] = useState<FlightEditDraft | null>(null);
  const [showFlightEditor, setShowFlightEditor] = useState(false);
  const [returnToOverviewViewAfterItemEdit, setReturnToOverviewViewAfterItemEdit] = useState(false);
  const [flightEditorAnchor, setFlightEditorAnchor] = useState(0);
  const [editingLodgingId, setEditingLodgingId] = useState<string | null>(null);
  const [editingTourId, setEditingTourId] = useState<string | null>(null);
  const [editingRentalId, setEditingRentalId] = useState<string | null>(null);
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
  const [blogDayImages, setBlogDayImages] = useState<Record<string, string>>({});
  const [dayWeather, setDayWeather] = useState<Record<string, OverviewWeather>>({});
  const weatherRequestKeyRef = useRef<string>('');

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
    if (!editSignal) return;
    setIsEditing(true);
  }, [editSignal]);

  useEffect(() => {
    setSelectedDay(null);
    setIsEditingDayItems(false);
  }, [trip?.id]);

  useEffect(() => {
    setIsEditingDayItems(false);
  }, [selectedDay]);

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
        setItineraryPlanMarkdown(null);
        return;
      }
      setItineraryLoading(true);
      try {
        const res = await fetch(`${backendUrl}/api/itineraries`, { headers });
        if (!res.ok) {
          setItineraryDetails([]);
          setItineraryId(null);
          setItineraryPlanMarkdown(null);
          return;
        }
        const data = await res.json();
        const records = (Array.isArray(data) ? data : []).filter((i) => i.tripId === trip.id);
        if (!records.length) {
          setItineraryDetails([]);
          setItineraryId(null);
          setItineraryPlanMarkdown(null);
          return;
        }
        // Use the most-recently-updated record per trip, falling back to createdAt
        // when the server doesn't surface updatedAt yet. Per
        // docs/implementation-plan-itinerary-collab.md §B2.
        const recordTs = (r: any) =>
          new Date((r?.updatedAt ?? r?.createdAt) ?? 0).getTime();
        const latest = [...records].sort((a, b) => recordTs(b) - recordTs(a))[0];
        setItineraryId(latest.id ?? null);
        setItineraryPlanMarkdown(typeof latest.planMarkdown === 'string' && latest.planMarkdown.trim() ? latest.planMarkdown : null);
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
        setItineraryPlanMarkdown(null);
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

  // P2 (docs/implementation_plans/itinerary-narrative-depth-and-validation.md): deterministic,
  // client-computed "what to book now" list — no LLM involved, derived from data already loaded
  // and validated elsewhere on this tab.
  const bookingPriorities = useMemo(
    () => buildBookingPriorities({ flights, lodgings, activities: tours, carRentals }),
    [flights, lodgings, tours, carRentals]
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
      Alert.alert('Activity is required.');
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

  // ---------------------------------------------------------------
  // Phase 3: itinerary item kinds + reactions wired into Day Details.
  // The Day Details "Notes & Checklists" section uses these helpers
  // to add place / note / checklist / custom-activity rows, toggle
  // checklist children, and apply up/down votes.
  // ---------------------------------------------------------------
  const ensureItineraryRecordForTrip = useCallback(
    async (defaultDay: number): Promise<string | null> => {
      if (itineraryId) return itineraryId;
      if (!trip?.id) return null;
      const days = computeTripDays(trip.startDate ?? null, trip.endDate ?? null) ?? defaultDay ?? 1;
      const res = await fetch(`${backendUrl}/api/itineraries`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          tripId: trip.id,
          destination: trip.destination ?? trip.name ?? 'Trip',
          days: Math.max(1, days),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        Alert.alert(data.error || 'Could not create itinerary record');
        return null;
      }
      const created = (await res.json()) as { id?: string };
      const newId = created.id ?? null;
      if (newId) setItineraryId(newId);
      return newId;
    },
    [backendUrl, itineraryId, jsonHeaders, trip?.id, trip?.destination, trip?.name, trip?.startDate, trip?.endDate]
  );

  const postNewDetail = useCallback(
    async (defaultDay: number, payload: Record<string, unknown>): Promise<boolean> => {
      const targetItineraryId = await ensureItineraryRecordForTrip(defaultDay);
      if (!targetItineraryId) return false;
      const res = await fetch(`${backendUrl}/api/itineraries/${targetItineraryId}/details`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        Alert.alert(data.error || 'Could not add item');
        return false;
      }
      const detailsRes = await fetch(`${backendUrl}/api/itineraries/${targetItineraryId}/details`, { headers });
      if (detailsRes.ok) {
        const details = await detailsRes.json();
        setItineraryDetails(Array.isArray(details) ? details : []);
      }
      return true;
    },
    [backendUrl, ensureItineraryRecordForTrip, headers, jsonHeaders]
  );

  const closeAllAddDialogs = useCallback(() => {
    setActiveAddDialog(null);
    setAddPopoverOpen(false);
  }, []);

  const getDateForDayIndex = useCallback(
    (dayIndex?: number | null): string | null => {
      const normalizedDay = Math.max(1, Math.round(Number(dayIndex ?? 1) || 1));
      const cardDate = dayCards[normalizedDay - 1]?.date;
      if (cardDate && /^\d{4}-\d{2}-\d{2}$/.test(cardDate)) return cardDate;
      if (trip?.startDate && /^\d{4}-\d{2}-\d{2}$/.test(trip.startDate)) {
        const start = new Date(`${trip.startDate}T00:00:00.000Z`);
        if (!Number.isNaN(start.getTime())) {
          start.setUTCDate(start.getUTCDate() + normalizedDay - 1);
          return start.toISOString().slice(0, 10);
        }
      }
      return trip?.startDate ?? null;
    },
    [dayCards, trip?.startDate]
  );

  const openCustomActivityDialog = useCallback(
    (dayIndex?: number | null) => {
      setEditingTourId(null);
      setTourDraft(createInitialActivityState(getDateForDayIndex(dayIndex)));
      setShowAddTour(true);
    },
    [getDateForDayIndex]
  );

  const handlePopoverSelect = useCallback((kind: AddItemKind) => {
    if (kind === 'activity') {
      setAddPopoverOpen(false);
      setActiveAddDialog(null);
      openCustomActivityDialog(addPopoverDay ?? 1);
      return;
    }
    setActiveAddDialog(kind);
    setAddPopoverOpen(false);
  }, [addPopoverDay, openCustomActivityDialog]);

  const handleAddPlace = useCallback(
    async (input: PlacePickerSubmit) => {
      const ok = await postNewDetail(input.day, {
        day: input.day,
        time: input.time ?? null,
        activity: input.name,
        kind: 'place',
        noteBody: input.notes ?? null,
      });
      if (ok) closeAllAddDialogs();
    },
    [postNewDetail, closeAllAddDialogs]
  );

  const handleAddNote = useCallback(
    async (input: NoteSubmit) => {
      const ok = await postNewDetail(input.day, {
        day: input.day,
        activity: input.title,
        kind: 'note',
        noteBody: input.body,
      });
      if (ok) closeAllAddDialogs();
    },
    [postNewDetail, closeAllAddDialogs]
  );

  const handleAddChecklist = useCallback(
    async (input: ChecklistSubmit) => {
      const ok = await postNewDetail(input.day, {
        day: input.day,
        activity: input.title,
        kind: 'checklist',
        checklistItems: input.items,
      });
      if (ok) closeAllAddDialogs();
    },
    [postNewDetail, closeAllAddDialogs]
  );

  // Optimistic checklist child toggle.
  const updateLocalChecklistItem = useCallback(
    (detailId: string, itemId: string, patch: Partial<ChecklistChildRecord>) => {
      setItineraryDetails((prev) =>
        prev.map((d) =>
          d.id === detailId
            ? {
                ...d,
                checklistItems: (d.checklistItems ?? []).map((c) =>
                  c.id === itemId ? { ...c, ...patch } : c
                ),
              }
            : d
        )
      );
    },
    []
  );

  const toggleChecklistItem = useCallback(
    async (detailId: string, item: ChecklistChildRecord) => {
      // PATCH /checklist-items/:id 403s when itinerary_item_kinds is disabled — skip the request
      // entirely rather than let a routine checkbox tap surface the global permission-denied modal.
      if (!featureItineraryItemKinds) return;
      const nextChecked = !item.checkedBy;
      const previous = { checkedBy: item.checkedBy ?? null, checkedAt: item.checkedAt ?? null };
      updateLocalChecklistItem(detailId, item.id, {
        checkedBy: nextChecked ? 'me' : null,
        checkedAt: nextChecked ? new Date().toISOString() : null,
      });
      try {
        const res = await fetch(`${backendUrl}/api/itineraries/checklist-items/${item.id}`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({ checked: nextChecked }),
        });
        if (!res.ok) throw new Error('Toggle failed');
        const updated = (await res.json()) as ChecklistChildRecord;
        updateLocalChecklistItem(detailId, item.id, {
          checkedBy: updated.checkedBy ?? null,
          checkedAt: updated.checkedAt ?? null,
        });
      } catch {
        updateLocalChecklistItem(detailId, item.id, previous);
      }
    },
    [backendUrl, jsonHeaders, updateLocalChecklistItem, featureItineraryItemKinds]
  );

  // Reaction handlers — local optimistic, drive the ReactionBar component.
  const updateLocalReactionSummary = useCallback(
    (detailId: string, summary: ReactionSummary) => {
      setItineraryDetails((prev) =>
        prev.map((d) => (d.id === detailId ? { ...d, reactions: summary } : d))
      );
    },
    []
  );

  const castReactionForDetail = useCallback(
    async (detailId: string, value: ReactionValue): Promise<ReactionSummary> => {
      const res = await fetch(`${backendUrl}/api/itineraries/details/${detailId}/reactions`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Reaction failed (${res.status})`);
      }
      const summary = (await res.json()) as ReactionSummary;
      updateLocalReactionSummary(detailId, summary);
      return summary;
    },
    [backendUrl, jsonHeaders, updateLocalReactionSummary]
  );

  const clearReactionForDetail = useCallback(
    async (detailId: string): Promise<ReactionSummary> => {
      const res = await fetch(`${backendUrl}/api/itineraries/details/${detailId}/reactions`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Reaction clear failed (${res.status})`);
      }
      const summary = (await res.json()) as ReactionSummary;
      updateLocalReactionSummary(detailId, summary);
      return summary;
    },
    [backendUrl, headers, updateLocalReactionSummary]
  );

  const emptyReactionSummary: ReactionSummary = useMemo(
    () => ({ score: 0, upCount: 0, downCount: 0, userValue: null }),
    []
  );

  const deleteDetail = useCallback(
    async (detailId: string) => {
      const res = await fetch(`${backendUrl}/api/itineraries/details/${detailId}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        Alert.alert((data as any)?.error || 'Could not delete item');
        return;
      }
      setItineraryDetails((prev) => prev.filter((d) => d.id !== detailId));
    },
    [backendUrl, headers]
  );

  const formatMemberName = (member: GroupMemberOption) => formatUserDisplayName(member);
  
  const groupMembers: GroupMemberOption[] = useMemo(
    () => attendees.map((a) => ({ ...a })),
    [attendees]
  );

  const memberNames = useMemo(() => {
    return buildMemberDisplayLookup(groupMembers);
  }, [groupMembers]);

  const travelerNames = useMemo(() => {
    return buildMemberDisplayLookup(groupMembers);
  }, [groupMembers]);

  const buildPassengerName = (ids: string[]) =>
    ids.map((id) => memberNames.get(id) ?? memberNames.get(String(id).toLowerCase())).filter(Boolean).join(', ');

  const userMembers = useMemo(
    () => groupMembers.filter((m) => !m.guestName && m.status !== 'removed'),
    [groupMembers]
  );

  const payerName = (id: string) => memberNames.get(id) ?? memberNames.get(String(id).toLowerCase()) ?? 'Unknown';
  const travelerName = (id: string) => travelerNames.get(id) ?? travelerNames.get(String(id).toLowerCase()) ?? payerName(id);

  const overviewTravelerIds = useMemo(
    () => groupMembers.map((m) => m.id).filter(Boolean),
    [groupMembers]
  );

  const buildOverviewLodgingDraft = useCallback(
    () =>
      createLodgingDraftForTrip({
        tripStartDate: trip?.startDate,
        existingLodgings: lodgings,
        defaultPayerId,
        defaultTravelerIds: overviewTravelerIds,
      }),
    [trip?.startDate, lodgings, defaultPayerId, overviewTravelerIds]
  );

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

  const displayStartDate = trip?.startDate ?? null;
  const displayEndDate = trip?.endDate ?? null;
  const eventDateBounds = useMemo(() => {
    const parseDateUtc = (value?: string | null): Date | null => {
      const text = String(value ?? '').trim();
      if (!text) return null;
      const iso = normalizeDateString(text);
      if (!iso) return null;
      const parts = iso.split('-').map((v) => Number(v));
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
      return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    };

    const dates = [
      ...flights.map((f) => f.departure_date),
      ...flights.map((f) => f.arrival_date),
      ...lodgings.map((l) => l.checkInDate),
      ...lodgings.map((l) => l.checkOutDate),
      ...tours.map((t) => t.date),
      ...carRentals.map((r) => r.pickupDate),
      ...carRentals.map((r) => r.dropoffDate),
    ]
      .map((value) => parseDateUtc(value))
      .filter(Boolean) as Date[];

    if (!dates.length) return null;
    const min = new Date(Math.min(...dates.map((d) => d.getTime()))).toISOString().slice(0, 10);
    const max = new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString().slice(0, 10);
    return { startDate: min, endDate: max };
  }, [flights, lodgings, tours, carRentals]);

  // Trips created via the wizard's "Flexible Timeline" mode (month + duration,
  // no exact dates) never get a startDate/endDate — synthesize a range from
  // startMonth/startYear/durationDays so the day-by-day view doesn't collapse
  // to a single fallback "today" entry.
  const monthDurationDates = useMemo(() => {
    const month = trip?.startMonth ?? null;
    const year = trip?.startYear ?? null;
    const days = trip?.durationDays ?? null;
    if (!month || !year || !days) return null;
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = computeEndDateFromDuration(startDate, days);
    return endDate ? { startDate, endDate } : null;
  }, [trip?.startMonth, trip?.startYear, trip?.durationDays]);

  const overviewStartDate = displayStartDate ?? monthDurationDates?.startDate ?? eventDateBounds?.startDate ?? null;
  const overviewEndDate = displayEndDate ?? monthDurationDates?.endDate ?? eventDateBounds?.endDate ?? null;
  const monthLabel = useMemo(
    () => formatMonthYear(trip?.startMonth ?? null, trip?.startYear ?? null),
    [trip?.startMonth, trip?.startYear]
  );

  const tripLength = useMemo(() => {
    if (trip?.startDate || trip?.endDate) {
      return computeTripDays(overviewStartDate ?? null, overviewEndDate ?? null);
    }
    return trip?.durationDays ?? null;
  }, [trip, overviewStartDate, overviewEndDate]);
  const currencyOptions = useMemo(
    () => ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'MXN'],
    []
  );
  const currentCurrency = trip?.currency ?? 'USD';
  const pendingInvites = group?.invites ?? [];

  const rows = useMemo<OverviewRow[]>(
    () =>
      buildOverviewRows({
        tripStartDate: trip?.startDate ?? null,
        tripMonthLabel: monthLabel,
        itineraryDetails,
        flights,
        lodgings,
        tours,
        rentals: carRentals,
      }),
    [trip?.startDate, monthLabel, itineraryDetails, flights, lodgings, tours, carRentals]
  );

  const allDates = useMemo(() => {
    const parseDateUtc = (value?: string | null): Date | null => {
      if (!value) return null;
      const parts = String(value).split('-').map((v) => Number(v));
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
        const d = new Date(value);
        return Number.isNaN(d.valueOf()) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      }
      return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    };
    const dates: string[] = [];
    const start = overviewStartDate;
    const end = overviewEndDate;
    if (start && end) {
      const s = parseDateUtc(start);
      const e = parseDateUtc(end);
      if (s && e) {
        for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
          dates.push(d.toISOString().slice(0, 10));
        }
      }
    } else if (flights.length || lodgings.length || tours.length || carRentals.length) {
      const all = [
        ...flights.map((f) => f.departure_date),
        ...flights.map((f) => f.arrival_date),
        ...lodgings.map((l) => l.checkInDate),
        ...lodgings.map((l) => l.checkOutDate),
        ...tours.map((t) => t.date),
        ...carRentals.map((r) => r.pickupDate),
        ...carRentals.map((r) => r.dropoffDate),
      ]
        .filter(Boolean)
        .map((d) => parseDateUtc(d as string))
        .filter(Boolean)
        .map((d) => (d as Date).getTime());
      if (all.length) {
        const min = new Date(Math.min(...all));
        const max = new Date(Math.max(...all));
        for (let d = new Date(min); d <= max; d.setUTCDate(d.getUTCDate() + 1)) {
          dates.push(d.toISOString().slice(0, 10));
        }
      }
    }
    if (!dates.length) {
      dates.push(new Date().toISOString().slice(0, 10));
    }
    return Array.from(new Set(dates));
  }, [overviewStartDate, overviewEndDate, flights, lodgings, tours, carRentals]);

  useEffect(() => {
    const buildDayCards = () => {
      const cards: DayCard[] = allDates.map((date, idx) => {
        const items: string[] = [];
        const flightsForDay = flights.filter((f) => flightMatchesDay(f, date));
        flightsForDay.forEach((f) =>
          items.push(`Transfer ${f.departure_location || f.departure_airport_code || 'DEP'} -> ${f.arrival_location || f.arrival_airport_code || 'ARR'} dep ${f.departure_time || '?'} arr ${f.arrival_time || '?'}`)
        );
        const lodgingsForDay = lodgings.filter((l) => lodgingCoversDay(l, date));
        lodgingsForDay.forEach((l) => items.push(`Lodging at ${l.name} (${l.checkInDate} - ${l.checkOutDate})`));
        const toursForDay = tours.filter((t) => tourMatchesDay(t, date));
        toursForDay.forEach((t) => items.push(`Activity: ${t.name} at ${t.startTime || 'time TBD'}`));
        const rentalsForDay = carRentals.filter((r) => rentalMatchesDay(r, date));
        rentalsForDay.forEach((r) => items.push(`Rental car (${r.vendor || 'vendor'}) ${r.pickupDate} -> ${r.dropoffDate}`));
        const label = `Day ${idx + 1}`;
        if (!items.length) items.push('Free Day');
        const location =
          buildDayWeatherLocation(
            {
              flights: flightsForDay,
              lodgings: lodgingsForDay,
              tours: toursForDay,
              rentals: rentalsForDay,
            },
            tripLocationLabel || trip?.destination || null
          ) || null;
        return { date, label, items, location };
      });
      setDayCards(cards);
      setSelectedDay((prev) => (prev && cards.some((card) => card.date === prev) ? prev : null));
    };
    buildDayCards();
  }, [allDates, flights, lodgings, tours, carRentals, tripLocationLabel, trip?.destination]);

  useEffect(() => {
    setDayImages({});
    setBlogDayImages({});
  }, [trip?.id]);

  // A traveler-selected blog cover is the canonical image for that day in the
  // overview. The blog endpoint also returns a fallback cover for days with
  // media, so only honor explicitly selected covers here; otherwise the
  // overview's existing generated destination image remains the fallback.
  useEffect(() => {
    let active = true;

    const getPhotoCoverUrl = (day: any): string | null => {
      if (!day?.coverIsExplicit || !day?.coverItemId) return null;
      const coverId = String(day.coverItemId);
      const items = Array.isArray(day.items) ? day.items : [];
      const media = items.flatMap((item: any) => (
        item?.kindKey === 'core.gallery' && Array.isArray(item.assets) ? item.assets : [item]
      ));
      const cover = media.find((item: any) => String(item?.id ?? '') === coverId || String(item?.assetId ?? '') === coverId);
      if (!cover || (cover.mediaKind !== 'photo' && cover.kindKey !== 'media.photo')) return null;
      const url = cover.primaryUrl || cover.thumbnailUrl;
      return typeof url === 'string' && url.trim() ? url : null;
    };

    const fetchBlogCovers = async () => {
      if (!trip?.id) {
        setBlogDayImages({});
        return;
      }

      const next: Record<string, string> = {};
      let cursor: string | null = null;
      const seenCursors = new Set<string>();

      try {
        do {
          const params = new URLSearchParams({ limit: '100' });
          if (cursor) params.set('cursor', cursor);
          const response = await fetch(`${backendUrl}/api/trips/${trip.id}/blog?${params.toString()}`, { headers });
          if (!response.ok) return;
          const data = await response.json().catch(() => ({}));
          const days = Array.isArray(data?.days) ? data.days : [];
          days.forEach((day: any) => {
            const url = getPhotoCoverUrl(day);
            if (url && day.localDate) next[String(day.localDate)] = url;
          });
          const lastDate = days.length ? String(days[days.length - 1]?.localDate ?? '') : '';
          if (days.length < 100 || !lastDate || seenCursors.has(lastDate)) break;
          seenCursors.add(lastDate);
          cursor = lastDate;
        } while (active);

        if (active) setBlogDayImages(next);
      } catch {
        // The blog is optional for overview rendering; keep generated images.
      }
    };

    fetchBlogCovers().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [backendUrl, headers, trip?.id, allDates]);

  // Lets App.tsx command "jump to Day 1" (e.g. when an AI itinerary finishes generating)
  // without lifting selectedDay state up. Mirrors the editSignal nonce-prop pattern.
  // dayCards is built asynchronously above, so the request is "armed" on signal change
  // and applied once dayCards actually has data, rather than racing it.
  const lastGoToDay1Signal = useRef(goToDay1Signal);
  const [pendingGoToDay1, setPendingGoToDay1] = useState(false);
  useEffect(() => {
    if (goToDay1Signal !== undefined && goToDay1Signal !== lastGoToDay1Signal.current) {
      lastGoToDay1Signal.current = goToDay1Signal;
      setPendingGoToDay1(true);
    }
  }, [goToDay1Signal]);
  useEffect(() => {
    if (pendingGoToDay1 && dayCards.length) {
      setSelectedDay(dayCards[0].date);
      setPendingGoToDay1(false);
    }
  }, [pendingGoToDay1, dayCards]);

  useEffect(() => {
    const cache = async () => {
      if (!trip?.id || !dayCards.length) return;
      const storage = await getAsyncStorage();
      if (!storage) return;
      await storage.setItem(`overview.cache.${trip.id}`, JSON.stringify(dayCards));
    };
    cache().catch(() => undefined);
  }, [dayCards, trip?.id]);

  useEffect(() => {
    const loadCache = async () => {
      if (!trip?.id) return;
      if (dayCards.length) return;
      try {
        const storage = await getAsyncStorage();
        if (!storage) return;
        const raw = await storage.getItem(`overview.cache.${trip.id}`);
        if (raw) {
          const parsed = JSON.parse(raw) as DayCard[];
          if (Array.isArray(parsed) && parsed.length) {
            const cachedDates = parsed.map((card) => String(card?.date ?? '')).filter(Boolean);
            const computedDates = allDates.map((date) => String(date ?? '')).filter(Boolean);
            const cacheMatchesComputedRange =
              cachedDates.length === computedDates.length &&
              cachedDates.every((date, idx) => date === computedDates[idx]);
            if (!cacheMatchesComputedRange) return;
            setDayCards(parsed);
            setSelectedDay((prev) => (prev && parsed.some((card) => card.date === prev) ? prev : null));
          }
        }
      } catch {
        // ignore
      }
    };
    loadCache().catch(() => undefined);
  }, [trip?.id, dayCards.length, allDates]);

  useEffect(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const shouldFetchWeather = isWithinOverviewWeatherWindow(todayIso, overviewStartDate, overviewEndDate);
    if (!shouldFetchWeather || !dayCards.length) {
      weatherRequestKeyRef.current = '';
      setDayWeather({});
      return;
    }

    const days = dayCards
      .map((card) => ({
        date: card.date,
        location: String(card.location || tripLocationLabel || trip?.destination || '').trim(),
      }))
      .filter((entry) => entry.date && entry.location);

    if (!days.length) {
      weatherRequestKeyRef.current = '';
      setDayWeather({});
      return;
    }

    const requestKey = JSON.stringify(days);
    if (weatherRequestKeyRef.current === requestKey) {
      return;
    }

    let active = true;
    weatherRequestKeyRef.current = requestKey;
    fetch(`${backendUrl}/api/itinerary/weather/overview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        tripId: trip?.id ?? null,
        days,
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        const next = Array.isArray(data?.weather)
          ? data.weather.reduce((acc: Record<string, OverviewWeather>, item: any) => {
              const date = String(item?.date ?? '').trim();
              if (!date) return acc;
              acc[date] = {
                date,
                icon: String(item?.icon ?? '🌤'),
                description: item?.description ? String(item.description) : null,
                temperatureHighC:
                  typeof item?.temperatureHighC === 'number' && Number.isFinite(item.temperatureHighC)
                    ? Math.round(item.temperatureHighC)
                    : null,
                resolvedLocation: item?.resolvedLocation ? String(item.resolvedLocation) : null,
              };
              return acc;
            }, {})
          : {};
        setDayWeather(next);
      })
      .catch(() => {
        if (active) {
          weatherRequestKeyRef.current = '';
          setDayWeather({});
        }
      });

    return () => {
      active = false;
    };
  }, [backendUrl, headers, dayCards, overviewStartDate, overviewEndDate, trip?.destination, trip?.id, tripLocationLabel]);

  useEffect(() => {
    let active = true;
    const fetchImages = async () => {
      if (!dayCards.length) return;
      const missingCards = dayCards.filter((card) => !blogDayImages[card.date] && !dayImages[card.date]);
      if (!missingCards.length) return;
      const days = missingCards.map((card) => ({
        date: card.date,
        dayIndex: dayCards.findIndex((candidate) => candidate.date === card.date) + 1,
        location: card.location || tripLocationLabel || trip?.destination || 'travel',
      }));
      try {
        const res = await fetch(`${backendUrl}/api/itinerary/images/batch`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ days }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(data?.images)) return;
        const next: Record<string, string> = {};
        data.images.forEach((entry: any) => {
          if (entry?.date && entry?.url) next[String(entry.date)] = String(entry.url);
        });
        if (active && Object.keys(next).length) setDayImages((prev) => ({ ...prev, ...next }));
      } catch {
        return;
      }
    };
    fetchImages().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [backendUrl, headers, blogDayImages, dayCards, tripLocationLabel, trip?.destination]);

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
      Alert.alert(validationError);
      return;
    }
    const payload: any = {
      description: descriptionDraft,
      dateMode: dateDraft.mode,
    };
    if (dateDraft.mode === 'range') {
      payload.startDate = dateDraft.startDate || null;
      payload.endDate = dateDraft.endDate || null;
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
      Alert.alert(data.error || 'Unable to update trip');
      return;
    }
    if (pendingRemovalIds.length && trip?.id) {
      const removalGroupId = group?.id ?? trip.groupId;
      if (!removalGroupId) {
        Alert.alert('Unable to remove member: missing group id');
        return;
      }
      for (const memberId of pendingRemovalIds) {
        const removeRes = await fetch(`${backendUrl}/api/groups/${removalGroupId}/members/${memberId}`, {
          method: 'DELETE',
          headers,
        });
        if (!removeRes.ok) {
          const removeData = await removeRes.json().catch(() => ({}));
          Alert.alert(removeData.error || 'Unable to remove member');
          return;
        }
      }
      setPendingRemovalIds([]);
      onRefreshGroups();
      onRefreshGroupMembers();
      onFlightDataChanged();
      onLodgingDataChanged();
      onTourDataChanged();
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
    setReturnToOverviewViewAfterItemEdit(false);
    setIsEditing(false);
  };

  const removeTraveler = (memberId: string) => {
    if (!isEditing) return;
    setPendingRemovalIds((prev) => (prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]));
  };

  const addTraveler = async () => {
    if (!trip?.id) return;
    const first = travelerDraft.firstName.trim();
    const last = travelerDraft.lastName.trim();
    const email = travelerDraft.email.trim();
    if (!first || !last) {
      Alert.alert('Enter first and last name');
      return;
    }
    const guestName = `${first} ${last}`.trim();
    const payload = email ? { email, firstName: first, lastName: last, guestName } : { guestName, firstName: first, lastName: last };
    const res = await fetch(`${backendUrl}/api/account/trips/${trip.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      Alert.alert(data.error || 'Unable to add member');
      return;
    }
    onRefreshGroupMembers();
    setTravelerDraft({ firstName: '', lastName: '', email: '' });
    setShowAddTraveler(false);
    onRefreshGroups();
  };

  const saveFlightDetails = async () => {
    if (!editingFlightId || !editingFlightDraft) return;
    if (!trip?.id) {
      Alert.alert('Select an active trip before editing a flight.');
      return;
    }
    if (!editingFlightDraft.passengerIds.length) {
      Alert.alert('Select at least one passenger');
      return;
    }
    const payload = buildFlightPayload(
      { ...editingFlightDraft, passengerName: buildPassengerName(editingFlightDraft.passengerIds) || editingFlightDraft.passengerName },
      trip.id,
      defaultPayerId
    );
    if (editingFlightId === 'new') {
      const res = await fetch(`${backendUrl}/api/transfers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        Alert.alert(data.error || 'Unable to save flight');
        return;
      }
      closeFlightEditor();
      onRefreshFlights();
      onFlightDataChanged();
      return;
    }
    const res = await fetch(`${backendUrl}/api/transfers/${editingFlightId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      Alert.alert(data.error || 'Unable to update flight');
      return;
    }
    closeFlightEditor();
    onFlightDataChanged();
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
      Alert.alert('Select an active trip before saving lodging.');
      return;
    }
    const { payload, error } = buildLodgingPayload(lodgingDraft, trip.id, defaultPayerId);
    if (error || !payload) {
      Alert.alert(error || 'Unable to save lodging');
      return;
    }
    if (editingLodgingId) {
      const result = await saveLodgingApi(backendUrl, jsonHeaders, payload, editingLodgingId);
      if (!result.ok) {
        Alert.alert(result.error || 'Unable to save lodging');
        return;
      }
      closeLodgingModal();
      onLodgingDataChanged();
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
      Alert.alert(result.error || 'Unable to save lodging');
      return;
    }
    closeLodgingModal();
    onLodgingDataChanged();
  };

  const saveTour = async () => {
    if (editingTourId) {
      const { payload, error } = buildActivityPayload(tourDraft, defaultPayerId);
      if (error || !payload) {
        Alert.alert(error || 'Unable to save activity');
        return;
      }
      const res = await fetch(`${backendUrl}/api/activities/${editingTourId}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ ...payload, tripId: trip?.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        Alert.alert(data.error || 'Unable to save activity');
        return;
      }
      closeTourModal();
      onTourDataChanged();
      return;
    }
    const result = await createActivityForTrip({
      backendUrl,
      jsonHeaders,
      draft: tourDraft,
      activeTripId: trip?.id ?? null,
      defaultPayerId,
    });
    if (!result.ok) {
      Alert.alert(result.error || 'Unable to save activity');
      return;
    }
    closeTourModal();
    onTourDataChanged();
  };

  const saveRental = async () => {
    if (editingRentalId) {
      const saved = await onUpdateCarRental?.(editingRentalId, rentalDraft);
      if (saved === false) return;
      closeRentalModal();
      return;
    }
    const result = buildCarRentalFromDraft(rentalDraft, defaultPayerId);
    if (!result.rental || result.error) {
      Alert.alert(result.error || 'Unable to save rental car');
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
    if (returnToOverviewViewAfterItemEdit) {
      setReturnToOverviewViewAfterItemEdit(false);
      setIsEditing(false);
    }
  };

  const closeLodgingModal = () => {
    setShowAddLodging(false);
    setEditingLodgingId(null);
    setLodgingDraft(buildOverviewLodgingDraft());
    if (returnToOverviewViewAfterItemEdit) {
      setReturnToOverviewViewAfterItemEdit(false);
      setIsEditing(false);
    }
  };

  const closeTourModal = () => {
    setShowAddTour(false);
    setEditingTourId(null);
    setTourDraft(createInitialActivityState(trip?.startDate ?? null));
    if (returnToOverviewViewAfterItemEdit) {
      setReturnToOverviewViewAfterItemEdit(false);
      setIsEditing(false);
    }
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
      setReturnToOverviewViewAfterItemEdit(false);
      setPendingRemovalIds([]);
    }
  }, [isEditing]);

  const openFlightEditor = (flight: Flight) => {
    if (!isEditing) {
      setSelectedFlight(flight);
      return;
    }
    setReturnToOverviewViewAfterItemEdit(false);
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
    setReturnToOverviewViewAfterItemEdit(false);
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
      if (featureStandardizedItemDialogs) setSelectedLodging(lodging);
      else openLodgingDetails(lodging);
      return;
    }
    setReturnToOverviewViewAfterItemEdit(false);
    setEditingLodgingId(lodging.id);
    setLodgingDraft(toLodgingDraft(lodging, { normalize: normalizeDateString, defaultPayerId }));
    setShowAddLodging(true);
  };

  const openAddLodging = () => {
    if (!isEditing) return;
    setReturnToOverviewViewAfterItemEdit(false);
    setEditingLodgingId(null);
    setLodgingDraft(buildOverviewLodgingDraft());
    setShowAddLodging(true);
  };

  const openAddTour = () => {
    if (!isEditing) return;
    setReturnToOverviewViewAfterItemEdit(false);
    setEditingTourId(null);
    setTourDraft(createInitialActivityState(trip?.startDate ?? null));
    setShowAddTour(true);
  };

  const openAddRental = () => {
    if (!isEditing) return;
    setEditingRentalId(null);
    setRentalDraft(createInitialCarRentalDraft());
    setShowAddRental(true);
  };

  const openTourEditor = (tour: Tour) => {
    if (!isEditing) {
      setSelectedTour(tour);
      return;
    }
    setReturnToOverviewViewAfterItemEdit(false);
    setEditingTourId(tour.id);
    setTourDraft(buildTourDraftFromRow({ ...tour, paidBy: (tour as any).paidBy ?? [] } as any));
    setShowAddTour(true);
  };

  const editFlightFromDetails = (flight: Flight) => {
    if (readOnly) return;
    setSelectedFlight(null);
    setReturnToOverviewViewAfterItemEdit(true);
    setEditingFlightId(flight.id);
    setEditingFlightDraft(toFlightEditDraft(flight));
    setShowFlightEditor(true);
  };

  const editLodgingFromDetails = (lodging: Lodging) => {
    if (readOnly) return;
    setSelectedLodging(null);
    setReturnToOverviewViewAfterItemEdit(true);
    setEditingLodgingId(lodging.id);
    setLodgingDraft(toLodgingDraft(lodging, { normalize: normalizeDateString, defaultPayerId }));
    setShowAddLodging(true);
  };

  const editActivityFromDetails = (tour: Tour) => {
    if (readOnly) return;
    setSelectedTour(null);
    setReturnToOverviewViewAfterItemEdit(true);
    setEditingTourId(tour.id);
    setTourDraft(buildTourDraftFromRow({ ...tour, paidBy: (tour as any).paidBy ?? [] } as any));
    setShowAddTour(true);
  };

  // Day-details "+ Add X" buttons — same add flow/fields as each type's own dedicated
  // page, just pre-seeded with the day currently being viewed and reachable without
  // switching into the overview's "edit everything" (isEditing) mode.
  const addFlightForDay = (dateIso: string) => {
    if (readOnly) return;
    setSelectedFlight(null);
    setReturnToOverviewViewAfterItemEdit(true);
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
    draft.departureDate = dateIso;
    draft.arrivalDate = dateIso;
    setEditingFlightDraft(draft);
    setShowFlightEditor(true);
  };

  const addLodgingForDay = (dateIso: string) => {
    if (readOnly) return;
    setSelectedLodging(null);
    setReturnToOverviewViewAfterItemEdit(true);
    setEditingLodgingId(null);
    const draft = buildOverviewLodgingDraft();
    draft.checkInDate = dateIso;
    draft.checkOutDate = addDaysToIso(dateIso, 1) || dateIso;
    setLodgingDraft(draft);
    setShowAddLodging(true);
  };

  const addTourForDay = (dateIso: string) => {
    if (readOnly) return;
    setSelectedTour(null);
    setReturnToOverviewViewAfterItemEdit(true);
    setEditingTourId(null);
    setTourDraft(createInitialActivityState(dateIso));
    setShowAddTour(true);
  };

  const addRentalForDay = (dateIso: string) => {
    if (readOnly) return;
    setEditingRentalId(null);
    const draft = createInitialCarRentalDraft();
    draft.pickupDate = dateIso;
    draft.dropoffDate = dateIso;
    setRentalDraft(draft);
    setShowAddRental(true);
  };

  const deleteItemFromDetails = () => {
    if (!itemToDelete) return;
    const { kind, id, name } = itemToDelete;
    // Close every dialog immediately on confirm so the UI never appears to hang
    // waiting on the network — the delete itself runs in the background below.
    setItemToDelete(null);
    setSelectedFlight(null);
    setSelectedLodging(null);
    setSelectedTour(null);
    setDetailModal(null);
    (async () => {
      try {
        const path = kind === 'flight' ? `/api/transfers/${id}` : kind === 'lodging' ? `/api/lodgings/${id}` : `/api/activities/${id}`;
        const res = await fetch(`${backendUrl}${path}`, { method: 'DELETE', headers });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Unable to delete ${name || kind}`);
        if (kind === 'flight') onFlightDataChanged();
        if (kind === 'lodging') onLodgingDataChanged();
        if (kind === 'activity') onTourDataChanged();
      } catch (err: any) {
        Alert.alert(err?.message || `Unable to delete ${name || kind}`);
      }
    })();
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
      Linking.openURL(url).catch((err) => Alert.alert('Could not open link', err?.message ?? String(err)));
    }
  };

  const formatRentalDetails = (rental: CarRental): DetailItem[] => [
    { label: 'Status', value: normalizeItineraryStatus((rental as any).status, LEGACY_ITINERARY_STATUS) },
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

  const renderDetailSectionsModal = (modal: DetailModalState) => {
    if (featureStandardizedItemDialogs && modal.kind && modal.item) {
      const rows = modal.sections.flatMap((section) => section.items);
      const itemName = modal.kind === 'flight'
        ? `${(modal.item as Flight).departure_airport_code || 'Departure'} → ${(modal.item as Flight).arrival_airport_code || 'Arrival'}`
        : String((modal.item as Lodging | Tour).name || modal.title);
      const status = String((modal.item as Flight | Lodging | Tour).status || '') || undefined;
      return (
        <TripItemDetailsDialog
          visible
          kind={modal.kind}
          title={itemName}
          subtitle={modal.sections.find((section) => section.subtitle)?.subtitle}
          status={status}
          rows={rows.map((item) => ({
            label: item.label,
            value: item.value,
            onPress: item.onPress ?? (item.linkUrl ? () => openDetailLink(item.linkUrl) : undefined),
          }))}
          styles={styles}
          theme={theme}
          readOnly={readOnly}
          onClose={() => setDetailModal(null)}
          onEdit={() => {
            if (modal.kind === 'flight') editFlightFromDetails(modal.item as Flight);
            if (modal.kind === 'lodging') editLodgingFromDetails(modal.item as Lodging);
            if (modal.kind === 'activity') editActivityFromDetails(modal.item as Tour);
            setDetailModal(null);
          }}
          onDelete={() => setItemToDelete({ kind: modal.kind!, id: modal.item!.id, name: itemName })}
          testID={`${modal.kind}-overview-details`}
        />
      );
    }

    return (
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
  };

  const renderSelectedItemDialogs = () => (
    <>
      {selectedFlight ? (
        <TripItemDetailsDialog
          visible
          kind="flight"
          title={`${selectedFlight.departure_airport_code || 'Departure'} → ${selectedFlight.arrival_airport_code || 'Arrival'}`}
          status={String((selectedFlight as any).status || '') || undefined}
          rows={formatFlightDetails(selectedFlight).map((item) => ({
            label: item.label,
            value: item.value,
            onPress: item.onPress ?? (item.linkUrl ? () => openDetailLink(item.linkUrl) : undefined),
          }))}
          styles={styles}
          theme={theme}
          readOnly={readOnly}
          onClose={() => setSelectedFlight(null)}
          onEdit={() => editFlightFromDetails(selectedFlight)}
          onDelete={() => setItemToDelete({ kind: 'flight', id: selectedFlight.id, name: selectedFlight.booking_reference || 'this transfer' })}
          testID="flight-overview-details"
        />
      ) : null}
      {selectedLodging ? (
        <TripItemDetailsDialog
          visible
          kind="lodging"
          title={selectedLodging.name}
          status={String(selectedLodging.status || '') || undefined}
          rows={[
            { label: 'Check-in', value: formatFriendlyDate(selectedLodging.checkInDate) || selectedLodging.checkInDate },
            { label: 'Check-out', value: formatFriendlyDate(selectedLodging.checkOutDate) || selectedLodging.checkOutDate },
            { label: 'Rooms', value: selectedLodging.rooms || '-' },
            { label: 'Refund by', value: selectedLodging.refundBy || '-' },
            { label: 'Total cost', value: selectedLodging.totalCost ? `$${selectedLodging.totalCost}` : '-' },
            { label: 'Address', value: selectedLodging.address || '-', onPress: selectedLodging.address ? () => onOpenAddress(selectedLodging.address) : undefined },
          ]}
          styles={styles}
          theme={theme}
          readOnly={readOnly}
          onClose={() => setSelectedLodging(null)}
          onEdit={() => editLodgingFromDetails(selectedLodging)}
          onDelete={() => setItemToDelete({ kind: 'lodging', id: selectedLodging.id, name: selectedLodging.name })}
          testID="lodging-overview-details"
        />
      ) : null}
      {selectedTour ? (
        <TripItemDetailsDialog
          visible
          kind="activity"
          title={selectedTour.name}
          status={String(selectedTour.status || '') || undefined}
          rows={formatTourDetails(selectedTour).map((item) => ({
            label: item.label,
            value: item.value,
            onPress: item.onPress ?? (item.linkUrl ? () => openDetailLink(item.linkUrl) : undefined),
          }))}
          styles={styles}
          theme={theme}
          readOnly={readOnly}
          onClose={() => setSelectedTour(null)}
          onEdit={() => editActivityFromDetails(selectedTour)}
          onDelete={() => setItemToDelete({ kind: 'activity', id: selectedTour.id, name: selectedTour.name })}
          testID="activity-overview-details"
        />
      ) : null}
      {itemToDelete ? (
        <ConfirmDialog
          visible
          title={`Delete ${itemToDelete.kind}`}
          message={`Delete ${itemToDelete.name}? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => void deleteItemFromDetails()}
          onCancel={() => setItemToDelete(null)}
          styles={styles}
        />
      ) : null}
    </>
  );

  const startLabel = formatFriendlyDate(overviewStartDate);
  const endLabel = formatFriendlyDate(overviewEndDate);
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
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const monthLabel = month.endsWith('.') ? month : `${month}.`;
    return `${weekdayLabel} ${monthLabel} ${date.getDate()}`;
  };

  const formatLongDayLabel = (dateStr: string): string => {
    const parts = dateStr.split('-').map((v) => Number(v));
    const date = parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(dateStr);
    if (Number.isNaN(date.valueOf())) return dateStr;
    const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const monthLabel = month.endsWith('.') ? month : `${month}.`;
    return `${weekday} ${monthLabel} ${date.getDate()}`;
  };

  const formatDayCardLabel = (card: DayCard): string => `${card.label} - ${formatLongDayLabel(card.date)}`;

  const allMemberIds = useMemo(() => groupMembers.map((m) => m.id), [groupMembers]);

  const dayDataByDate = useMemo(
    () =>
      buildDayEventsMap<Flight, Lodging, Tour, CarRental, ItineraryDetail>({
        dayCards,
        flights,
        lodgings,
        tours,
        rentals: carRentals,
        details: sortedItineraryDetails,
      }),
    [dayCards, flights, lodgings, tours, carRentals, sortedItineraryDetails],
  );

  const formatTravelerNames = (ids: string[]) =>
    ids
      .map((id) => memberNames.get(id) ?? memberNames.get(String(id).toLowerCase()))
      .filter(Boolean)
      .join(', ');

  const handlePrintItinerary = () => {
    if (!trip) return;
    const printed = openPrintableItinerary({
      trip,
      travelers: normalizedAttendees,
      locationLabel: tripLocationLabel,
      days: dayCards.map((card, idx) => {
        const info = dayDataByDate.get(card.date);
        return {
          date: card.date,
          dayNumber: idx + 1,
          details: info?.details ?? [],
          flights: info?.flights ?? [],
          lodgings: info?.lodgings ?? [],
          tours: info?.tours ?? [],
          rentals: info?.rentals ?? [],
        };
      }),
    });
    if (!printed && Platform.OS !== 'web') {
      Alert.alert('Printable itinerary', 'Open the Overview in a web browser to print the itinerary.');
    } else if (!printed) {
      Alert.alert('Printable itinerary', 'Allow pop-ups for WanderBunnies, then try again.');
    }
  };

  // Priority mirrors the day title rule: activities beat the transfer, which
  // beats lodging, so a lodging stay no longer masks a day that has activities
  // (or at least a transfer) happening on it.
  const buildDayStartLocation = (info?: { flights: Flight[]; lodgings: Lodging[]; tours: Tour[]; rentals: CarRental[] }) => {
    if (!info) return tripLocationLabel || 'Trip Day';
    const tour = info.tours[0];
    if (tour) return tour.startLocation || tour.name || tripLocationLabel || 'Trip Day';
    const flight = info.flights[0];
    if (flight) return flight.departure_location || flight.departure_airport_code || tripLocationLabel || 'Trip Day';
    const lodging = info.lodgings[0];
    if (lodging) return lodging.name || tripLocationLabel || 'Trip Day';
    const rental = info.rentals[0];
    if (rental) return rental.pickupLocation || rental.vendor || tripLocationLabel || 'Trip Day';
    return tripLocationLabel || 'Trip Day';
  };

  // startLocation and summary can end up describing the same activity (e.g. a
  // day with only a tour and no flight/lodging) — collapse them instead of
  // showing the same text twice, joined by " - ".
  const buildHeroTitle = (startLocation: string, summary: string) => {
    const parts = [startLocation, summary].filter(Boolean);
    if (parts.length === 2 && parts[0].trim().toLowerCase() === parts[1].trim().toLowerCase()) {
      return parts[0];
    }
    return parts.join(' - ');
  };

  const buildDaySummary = (info?: { flights: Flight[]; lodgings: Lodging[]; tours: Tour[]; rentals: CarRental[]; details: ItineraryDetail[] }) => {
    if (!info) return itineraryLoading ? 'Loading itinerary...' : 'Free day';
    const activityDetails = info.details.filter((d) => !d.kind || d.kind === 'activity');
    if (activityDetails.length) return activityDetails[0].activity;
    if (info.tours.length) return info.tours[0].name || 'Activity day';
    if (info.flights.length) return 'Travel day';
    if (info.lodgings.length) return `Stay at ${info.lodgings[0].name || 'lodging'}`;
    if (info.rentals.length) return 'Drive day';
    if (itineraryLoading) return 'Loading itinerary...';
    return 'Free day';
  };

  const buildDayNarrative = (info?: { details: ItineraryDetail[]; flights: Flight[]; tours: Tour[]; lodgings: Lodging[]; rentals: CarRental[] }) => {
    if (!info) return [itineraryLoading ? 'Loading itinerary...' : 'No itinerary details yet.'];
    const activityDetails = info.details.filter((d) => !d.kind || d.kind === 'activity');
    if (activityDetails.length) {
      return activityDetails.map((d) => (d.time ? `${d.time} · ${d.activity}` : d.activity));
    }
    if (info.flights.length) {
      return info.flights.map((f) => {
        const dep = f.departure_location || f.departure_airport_code || 'Departure';
        const arr = f.arrival_location || f.arrival_airport_code || 'Arrival';
        return `Transfer from ${dep} to ${arr}.`;
      });
    }
    if (info.lodgings.length) {
      return info.lodgings.map((l) => `Check-in at ${l.name}.`);
    }
    if (info.rentals.length) {
      return info.rentals.map((r) => `Pick up rental car from ${r.pickupLocation || r.vendor}.`);
    }
    if (info.tours.length) return [];
    return [itineraryLoading ? 'Loading itinerary...' : 'No itinerary details yet.'];
  };

  const renderOverviewFlightEditor = () => (
    <FlightEditingForm
      visible={!readOnly && Boolean(editingFlightDraft && editingFlightId)}
      flightId={editingFlightId}
      flight={editingFlightDraft}
      groupMembers={groupMembers}
      userMembers={userMembers}
      styles={styles}
      formatMemberName={formatMemberName}
      payerName={payerName}
      getLocationInputValue={getLocationInputValue}
      showAirportDropdown={showAirportDropdown}
      parseLayoverDuration={parseLayoverDuration}
      openTimePicker={openTimePicker}
      onAirportEnter={() => undefined}
      setFlight={setEditingFlightDraft}
      setPassengerIds={setEditingFlightPassengers}
      modalDepLocationRef={editDepLocationRef}
      modalArrLocationRef={editArrLocationRef}
      modalLayoverLocationRef={editLayoverLocationRef}
      onClose={closeFlightEditor}
      onSave={saveFlightDetails}
    />
  );

  const renderOverviewLodgingEditor = () => (
    <LodgingDialog
      visible={!readOnly && Boolean(showAddLodging)}
      styles={styles}
      title={editingLodgingId ? 'Lodging Details' : 'Add Lodging'}
      draft={lodgingDraft}
      setDraft={setLodgingDraft}
      groupMembers={groupMembers}
      formatMemberName={formatMemberName}
      defaultPayerId={defaultPayerId}
      payerName={payerName}
      onSave={saveLodging}
      onCancel={closeLodgingModal}
      onOpenDatePicker={(field) =>
        openModalDatePicker(
          field === 'checkIn' ? 'lodgingCheckIn' : field === 'checkOut' ? 'lodgingCheckOut' : 'lodgingRefundBy'
        )
      }
    />
  );

  // P0 (docs/implementation_plans/itinerary-narrative-depth-and-validation.md): the AI generation
  // pipeline's render stage already produces a fuller markdown write-up (destination narratives,
  // day-by-day prose, "why this fits your group" explanations) than the structured
  // flights/lodgings/activities/details the rest of this tab surfaces. Previously that markdown
  // was generated and then discarded; now it's persisted as `itinerary.planMarkdown` and shown
  // here, collapsed by default so it doesn't compete with the structured views.
  const renderItineraryPlanNotes = () => {
    if (!itineraryPlanMarkdown) return null;
    return (
      <View style={[styles.card, responsiveCardStyle]} testID="overview-plan-notes-card">
        <TouchableOpacity
          testID="overview-plan-notes-toggle"
          style={[styles.row, { justifyContent: 'space-between' }]}
          onPress={() => setShowItineraryPlanNotes((prev) => !prev)}
        >
          <Text style={styles.sectionTitle}>Trip Notes</Text>
          <Text style={styles.helperText}>{showItineraryPlanNotes ? 'Hide' : 'Show'}</Text>
        </TouchableOpacity>
        {showItineraryPlanNotes ? (
          <View testID="overview-plan-notes-body">
            {renderRichTextBlocks(itineraryPlanMarkdown, {
              base: styles.bodyText,
              bold: styles.headerText,
              italic: styles.helperText,
              link: styles.linkText ?? styles.buttonText,
              listItem: styles.helperText,
              heading2: styles.sectionTitle,
              heading3: styles.headerText,
            })}
          </View>
        ) : (
          <Text style={styles.helperText}>AI-written trip write-up, including destination background and day-by-day notes.</Text>
        )}
      </View>
    );
  };

  const bookingPriorityUrgencyLabel: Record<BookingPriorityUrgency, string> = {
    overdue: 'Past due',
    soon: 'Book soon',
    upcoming: 'Upcoming',
    unscheduled: 'No date yet',
  };
  const bookingPriorityKindLabel: Record<BookingPriorityItem['kind'], string> = {
    flight: 'Flight',
    lodging: 'Lodging',
    activity: 'Activity',
    carRental: 'Car rental',
  };
  const bookingPriorityUrgencyStyle: Record<BookingPriorityUrgency, any> = {
    overdue: styles.dangerButtonText ?? styles.helperText,
    soon: styles.headerText,
    upcoming: styles.helperText,
    unscheduled: styles.helperText,
  };

  const renderBookingPriorities = () => {
    if (!bookingPriorities.length) return null;
    return (
      <View style={[styles.card, responsiveCardStyle]} testID="overview-booking-priorities-card">
        <Text style={styles.sectionTitle}>What to book now</Text>
        {bookingPriorities.slice(0, 6).map((item) => (
          <View key={`${item.kind}-${item.id}`} style={[styles.row, { justifyContent: 'space-between' }]} testID={`overview-booking-priority-${item.kind}-${item.id}`}>
            <Text style={styles.bodyText}>
              {bookingPriorityKindLabel[item.kind]}: {item.label}
              {item.date ? ` (${item.date})` : ''}
            </Text>
            <Text style={bookingPriorityUrgencyStyle[item.urgency]}>
              {bookingPriorityUrgencyLabel[item.urgency]}
              {item.urgency === 'overdue' && item.daysUntil !== null ? ` · ${Math.abs(item.daysUntil)}d ago` : ''}
              {item.urgency === 'soon' && item.daysUntil !== null ? ` · ${item.daysUntil}d` : ''}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  const renderDayBar = (activeDate: string | null) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }} contentContainerStyle={{ paddingRight: 8 }}>
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

  const renderContent = () => {
    if (!trip) {
      return (
        <View style={[styles.card, responsiveCardStyle]}>
          <Text style={styles.sectionTitle}>Overview</Text>
          <Text style={styles.helperText}>Select a trip to view its overview.</Text>
        </View>
      );
    }

    if (!isEditing) {
      const activeDayInfo = selectedDay ? dayDataByDate.get(selectedDay) : null;
      const activeDayCard = selectedDay ? dayCards.find((card) => card.date === selectedDay) : null;
      const activeDayIndex =
        activeDayInfo?.index ?? (activeDayCard ? dayCards.findIndex((card) => card.date === activeDayCard.date) + 1 : null);
      const nextDayCard = activeDayIndex && activeDayIndex < dayCards.length ? dayCards[activeDayIndex] : null;

      const renderHeroCard = (card: DayCard, title: string, showAction: boolean, onPress?: () => void, testID?: string) => {
        const img = blogDayImages[card.date] ?? dayImages[card.date];
        const weather = dayWeather[card.date];
        const weatherLabel =
          weather && weather.temperatureHighC != null
            ? `${weather.icon} ${formatTemperatureFromCelsius(weather.temperatureHighC, normalizeTemperatureUnit(temperatureUnit))}`
            : null;
        return (
          <TouchableOpacity
            testID={testID}
            style={[
              styles.dayHeroCard,
              { height: dayHeroHeight },
            ]}
            onPress={onPress}
            disabled={!onPress}
          >
            {img ? (
              <Image style={dayHeroImageStyle} source={getImageSource(img)} resizeMode="cover" />
            ) : featureCoverPhotoFallbackV2 ? (
              <DestinationPlaceholderCard title={card.location || title} style={styles.dayHeroImageFallback} testID={`${testID || 'day-hero'}-placeholder`} />
            ) : (
              <View style={styles.dayHeroImageFallback} testID={`${testID || 'day-hero'}-fallback-legacy`} />
            )}
            <View style={styles.dayHeroOverlay} />
            <View style={styles.dayHeroBadge}>
              <Text style={styles.dayHeroBadgeText}>{formatDayCardLabel(card)}</Text>
            </View>
            {weatherLabel ? (
              <View
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: 'rgba(15, 23, 42, 0.74)',
                }}
                testID={`${testID || 'day-hero'}-weather`}
              >
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{weatherLabel}</Text>
              </View>
            ) : null}
            <View style={styles.dayHeroTextWrap}>
              <Text
                style={[
                  styles.dayHeroTitle,
                  isPhoneLayout ? { fontSize: 18, lineHeight: 23 } : isTabletLayout ? { fontSize: 20 } : null,
                ]}
                numberOfLines={isPhoneLayout ? 4 : 3}
                ellipsizeMode="tail"
              >
                {title}
              </Text>
              {showAction ? (
                <Text style={[styles.dayHeroAction, isPhoneLayout ? { fontSize: 11 } : null]}>View details</Text>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      };

      if (selectedDay && activeDayCard && activeDayInfo) {
        const startLocation = buildDayStartLocation(activeDayInfo);
        const summary = buildDaySummary(activeDayInfo);
        const heroTitle = buildHeroTitle(startLocation, summary);
        const narrativeLines = buildDayNarrative(activeDayInfo);
        const flightsForDay = activeDayInfo.flights;
        const activityTimeKey = (tour: Tour) => {
          const value = String(tour.startTime ?? '').trim();
          return /^\d{1,2}:\d{2}$/.test(value) ? value.padStart(5, '0') : '99:99';
        };
        const toursForDay = [...activeDayInfo.tours].sort((a, b) => {
          const byTime = activityTimeKey(a).localeCompare(activityTimeKey(b));
          if (byTime !== 0) return byTime;
          return String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' });
        });
        const lodgingsForDay = activeDayInfo.lodgings;
        const rentalsForDay = activeDayInfo.rentals;

        // Trip-day map points (see TripDayMap / GET /api/maps/trip-day). Plain
        // free-text addresses, not resolved coordinates — Google's Static Maps
        // API geocodes marker locations internally, so this deliberately
        // avoids adding a separate geocoding call. Order determines the A/B/C…
        // pin labels; the server independently caps + re-validates this list,
        // so an unusually packed day degrades (drops the tail) rather than
        // breaking the map entirely.
        const dayMapPoints: TripMapPoint[] = [];
        flightsForDay.forEach((f) => {
          if (f.departure_location) dayMapPoints.push({ kind: 'flight', address: f.departure_location });
          if (f.arrival_location) dayMapPoints.push({ kind: 'flight', address: f.arrival_location });
        });
        lodgingsForDay.forEach((l) => {
          if (l.address) dayMapPoints.push({ kind: 'lodging', address: l.address });
        });
        toursForDay.forEach((t) => {
          if (t.startLocation) dayMapPoints.push({ kind: 'activity', address: t.startLocation });
        });
        rentalsForDay.forEach((r) => {
          if (r.pickupLocation) dayMapPoints.push({ kind: 'car_rental', address: r.pickupLocation });
          if (r.dropoffLocation && r.dropoffLocation !== r.pickupLocation) {
            dayMapPoints.push({ kind: 'car_rental', address: r.dropoffLocation });
          }
        });

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
          <View style={[styles.card, responsiveCardStyle, { position: 'relative', flex: 1, minHeight: 0 }]}>
            <TouchableOpacity testID="day-details-back" style={styles.dayDetailsBackButton} onPress={() => setSelectedDay(null)}>
              <Text style={styles.dayDetailsBackText}>← Back</Text>
            </TouchableOpacity>
            <ScrollView
              ref={scrollRef}
              style={{ flex: 1, minHeight: 0 }}
              contentContainerStyle={{
                gap: isPhoneLayout ? 12 : 16,
                paddingTop: isPhoneLayout ? 48 : 56,
                paddingBottom: 24,
              }}
              onScroll={(e: any) => setScrollY(e.nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              nestedScrollEnabled
              contentInsetAdjustmentBehavior="automatic"
            >
              <Text style={styles.sectionTitle}>My itinerary</Text>
              <Text style={styles.flightTitle}>{trip.name}</Text>
              {renderDayBar(selectedDay)}
              {renderHeroCard(activeDayCard, heroTitle, false, undefined, 'day-details-hero')}
              {dayMapPoints.length ? (
                <TripDayMap points={dayMapPoints} backendUrl={backendUrl} requestHeaders={headers} testID="day-detail-map" />
              ) : null}
              {narrativeLines.length ? (
                <View style={styles.dayNarrativeBox}>
                  {narrativeLines.map((line, idx) => (
                    <Text key={`${activeDayCard.date}-narrative-${idx}`} style={styles.bodyText}>
                      {line}
                    </Text>
                  ))}
                </View>
              ) : null}

              {flightsForDay.length ? (
                <View style={styles.dayInfoCard}>
                  <Text style={styles.sectionTitle}>Your transfer</Text>
                  {flightsForDay.map((flight) => {
                    const dep = flight.departure_location || flight.departure_airport_code || 'DEP';
                    const arr = flight.arrival_location || flight.arrival_airport_code || 'ARR';
                    const passengers =
                      Array.isArray(flight.passenger_ids) && flight.passenger_ids.length
                        ? formatTravelerListDisplay(flight.passenger_ids, flight.passenger_name, groupMembers)
                        : formatTravelerListDisplay([], flight.passenger_name, groupMembers);
                    return (
                      <View key={flight.id} style={styles.dayInfoRow}>
                        <Text style={styles.dayInfoRoute}>{`${dep} → ${arr}`}</Text>
                        <Text style={styles.helperText}>{`${flight.departure_time || '--:--'} / ${
                          flight.arrival_time || '--:--'
                        }`}</Text>
                        {showFlightNames && passengers ? <Text style={styles.helperText}>Travelers: {passengers}</Text> : null}
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
                            ? formatTravelerListDisplay(flight.passenger_ids, flight.passenger_name, groupMembers)
                            : formatTravelerListDisplay([], flight.passenger_name, groupMembers);
                        return {
                          title: flightsForDay.length > 1 ? `Transfer ${idx + 1} · ${dep} → ${arr}` : undefined,
                          subtitle: showFlightNames && passengers ? `Travelers: ${passengers}` : undefined,
                          items: formatFlightDetails(flight),
                        };
                      });
                      if (featureStandardizedItemDialogs && flightsForDay.length === 1) {
                        setDetailModal({ title: 'Transfer Details', sections, kind: 'flight', item: flightsForDay[0] });
                      } else {
                        setDetailModal({ title: 'Transfer Details', sections });
                      }
                    }}
                  >
                    <Text style={styles.dayInfoButtonText}>See transfer details →</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="day-details-add-transfer-button"
                    accessibilityRole="button"
                    accessibilityLabel="Add transfer to this day"
                    style={[styles.dayInfoButton, { marginTop: 8 }]}
                    onPress={() => addFlightForDay(activeDayCard.date)}
                  >
                    <Text style={styles.dayInfoButtonText}>+ Add transfer</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {rentalsForDay.length ? (
                <View style={styles.dayInfoCard}>
                  <Text style={styles.sectionTitle}>Rental car</Text>
                  {rentalsForDay.map((rental) => (
                    <View key={rental.id} style={styles.dayInfoRow}>
                      <Text
                        style={styles.dayInfoRoute}
                      >{`${rental.vendor || 'Rental car'} · ${rental.model || 'Vehicle'}`}</Text>
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
                  <TouchableOpacity
                    testID="day-details-add-rental-button"
                    accessibilityRole="button"
                    accessibilityLabel="Add rental car to this day"
                    style={[styles.dayInfoButton, { marginTop: 8 }]}
                    onPress={() => addRentalForDay(activeDayCard.date)}
                  >
                    <Text style={styles.dayInfoButtonText}>+ Add rental car</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {toursForDay.length ? (
                <View style={styles.dayInfoCard}>
                  <Text style={styles.sectionTitle}>Activities</Text>
                  {toursForDay.map((tour) => {
                    const participants =
                      Array.isArray(tour.paidBy) && tour.paidBy.length
                        ? formatTravelerNames(tour.paidBy)
                        : formatTravelerNames(allMemberIds);
                    return (
                      <View key={tour.id} style={styles.dayInfoRow}>
                        <View style={styles.dayInfoText}>
                          <TouchableOpacity
                            testID={`day-details-activity-${tour.id}`}
                            onPress={() => {
                              if (featureStandardizedItemDialogs) {
                                setDetailModal({
                                  title: 'Activity Details',
                                  kind: 'activity',
                                  item: tour,
                                  sections: [
                                    {
                                      subtitle: showTourNames && participants ? `Travelers: ${participants}` : undefined,
                                      items: formatTourDetails(tour),
                                    },
                                  ],
                                });
                              } else {
                                setDetailModal({
                                  title: 'Activity Details',
                                  sections: [
                                    {
                                      subtitle: showTourNames && participants ? `Travelers: ${participants}` : undefined,
                                      items: formatTourDetails(tour),
                                    },
                                  ],
                                });
                              }
                            }}
                          >
                            <Text style={[styles.dayInfoRoute, styles.linkText]}>{tour.name}</Text>
                          </TouchableOpacity>
                          <Text
                            style={styles.helperText}
                          >{`${tour.startTime || 'Time TBD'} · ${tour.startLocation || 'Location TBD'}${tour.duration ? ` · ${tour.duration}` : ''}`}</Text>
                          {tour.notes ? <Text style={styles.helperText}>{tour.notes}</Text> : null}
                          {showTourNames && participants ? <Text style={styles.helperText}>Travelers: {participants}</Text> : null}
                          <GetYourGuideCta
                            backendUrl={backendUrl}
                            headers={headers}
                            activity={tour}
                            destination={trip?.destination}
                            theme={theme}
                            testID={`day-details-getyourguide-${tour.id}`}
                          />
                        </View>
                      </View>
                    );
                  })}
                  <TouchableOpacity
                    testID="day-details-add-activity-button"
                    accessibilityRole="button"
                    accessibilityLabel="Add activity to this day"
                    style={[styles.dayInfoButton, { marginTop: 8 }]}
                    onPress={() => addTourForDay(activeDayCard.date)}
                  >
                    <Text style={styles.dayInfoButtonText}>+ Add activity</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {lodgingsForDay.length ? (
                <View style={styles.dayInfoCard}>
                  <Text style={styles.sectionTitle}>Accommodation</Text>
                  {lodgingsForDay.map((lodging) => {
                    const participants =
                      Array.isArray(lodging.paidBy) && lodging.paidBy.length
                        ? formatTravelerNames(lodging.paidBy)
                        : formatTravelerNames(allMemberIds);
                    return (
                      <TouchableOpacity
                        key={lodging.id}
                        testID={`day-details-lodging-${lodging.id}`}
                        style={styles.dayInfoRow}
                        onPress={() => openLodgingEditor(lodging)}
                      >
                        {lodging.imageUrl ? (
                          <Image
                            style={[lodgingImageStyle, { width: lodgingThumbnailSize, height: lodgingThumbnailSize }]}
                            source={getImageSource(lodging.imageUrl)}
                            resizeMode="cover"
                          />
                        ) : (
                          <View
                            style={[
                              styles.lodgingImageFallback,
                              { width: lodgingThumbnailSize, height: lodgingThumbnailSize },
                            ]}
                          />
                        )}
                        <View style={styles.dayInfoText}>
                          <Text style={styles.dayInfoRoute}>{lodging.name}</Text>
                          <Text style={styles.helperText}>{`${lodging.checkInDate} → ${lodging.checkOutDate}`}</Text>
                          {showLodgingNames && participants ? (
                            <Text style={styles.helperText}>Travelers: {participants}</Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity
                    testID="day-details-add-accommodation-button"
                    accessibilityRole="button"
                    accessibilityLabel="Add accommodation to this day"
                    style={[styles.dayInfoButton, { marginTop: 8 }]}
                    onPress={() => addLodgingForDay(activeDayCard.date)}
                  >
                    <Text style={styles.dayInfoButtonText}>+ Add accommodation</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Phase 3: per-day itinerary items (place / note / checklist / custom activity). */}
              <View style={styles.dayInfoCard} testID="day-details-itinerary-items">
                <View style={[styles.sectionHeaderRow, { marginBottom: 0 }]}>
                  <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Locations, notes & checklists</Text>
                  <TouchableOpacity
                    testID={isEditingDayItems ? 'day-details-save-items-button' : 'day-details-edit-items-button'}
                    accessibilityRole="button"
                    accessibilityLabel={isEditingDayItems ? 'Save section edits' : 'Edit section'}
                    style={[styles.dayInfoButton, { marginLeft: 'auto', paddingVertical: 6 }]}
                    onPress={() => setIsEditingDayItems((prev) => !prev)}
                  >
                    <Text style={styles.dayInfoButtonText}>{isEditingDayItems ? 'Save' : 'Edit'}</Text>
                  </TouchableOpacity>
                </View>
                {(activeDayInfo.details ?? []).length === 0 ? (
                  <Text style={styles.helperText}>
                    {itineraryLoading ? 'Loading itinerary...' : 'No items yet for this day.'}
                  </Text>
                ) : (
                  (activeDayInfo.details ?? []).map((d) => {
                    const isActivity = !d.kind || d.kind === 'activity';
                    return (
                      <View key={d.id} style={[styles.dayInfoRow, { alignItems: 'flex-start', gap: 8 }]}>
                        <View style={{ flex: 1, gap: 4 }}>
                          {d.kind === 'place' ? (
                            <View>
                              <Text style={styles.dayInfoRoute}>{`📍 ${d.activity}`}</Text>
                              {d.noteBody ? (
                                <Text style={[styles.helperText, { fontStyle: 'italic' }]}>{d.noteBody}</Text>
                              ) : null}
                            </View>
                          ) : d.kind === 'note' ? (
                            <View>
                              <Text style={styles.dayInfoRoute}>{`📝 ${d.activity}`}</Text>
                              {d.noteBody ? (
                                <Text style={[styles.helperText, { fontStyle: 'italic' }]}>{d.noteBody}</Text>
                              ) : null}
                            </View>
                          ) : d.kind === 'checklist' ? (
                            <View style={{ width: '100%' }}>
                              <Text style={[styles.dayInfoRoute, { marginBottom: 4 }]}>{`📋 ${d.activity}`}</Text>
                              {(d.checklistItems ?? []).map((it) => {
                                const checked = !!it.checkedBy;
                                return (
                                  <TouchableOpacity
                                    key={it.id}
                                    testID={`overview-checklist-toggle-${it.id}`}
                                    accessibilityRole="checkbox"
                                    accessibilityState={{ checked, disabled: !featureItineraryItemKinds }}
                                    disabled={!featureItineraryItemKinds}
                                    onPress={() => toggleChecklistItem(d.id, it)}
                                    style={[
                                      { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
                                      !featureItineraryItemKinds && { opacity: 0.5 },
                                    ]}
                                  >
                                    <View
                                      style={[
                                        styles.checklistCheckbox,
                                        checked && styles.checklistCheckboxChecked,
                                      ]}
                                    >
                                      {checked ? <Text style={styles.checklistCheckboxMark}>✓</Text> : null}
                                    </View>
                                    <Text
                                      style={[
                                        styles.helperText,
                                        checked && { textDecorationLine: 'line-through', color: '#777' },
                                      ]}
                                    >
                                      {it.label}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          ) : (
                            <Text style={styles.dayInfoRoute}>{d.activity}</Text>
                          )}
                        </View>
                        {isActivity ? (
                          <View style={{ flexShrink: 0 }}>
                            <ReactionBar
                              detailId={d.id}
                              summary={d.reactions ?? emptyReactionSummary}
                              canReact={featureItineraryReactions}
                              onCast={castReactionForDetail}
                              onClear={clearReactionForDetail}
                              theme={theme}
                            />
                          </View>
                        ) : null}
                        {isEditingDayItems ? (
                          <TouchableOpacity
                            testID={`day-details-delete-${d.id}`}
                            accessibilityRole="button"
                            accessibilityLabel="Delete item"
                            onPress={() => deleteDetail(d.id)}
                            style={styles.detailDeleteButton}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Text style={styles.detailDeleteButtonText}>×</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })
                )}
                <TouchableOpacity
                  testID="day-details-add-item-button"
                  accessibilityRole="button"
                  accessibilityLabel="Add item to this day"
                  style={[styles.dayInfoButton, { marginTop: 8 }]}
                  onPress={() => {
                    setAddPopoverDay(activeDayInfo?.index ?? 1);
                    setAddPopoverOpen(true);
                  }}
                >
                  <Text style={styles.dayInfoButtonText}>+ Add item</Text>
                </TouchableOpacity>
              </View>

              {!flightsForDay.length || !rentalsForDay.length || !toursForDay.length || !lodgingsForDay.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {!flightsForDay.length ? (
                    <TouchableOpacity
                      testID="day-details-add-transfer-button"
                      accessibilityRole="button"
                      accessibilityLabel="Add transfer to this day"
                      style={styles.dayInfoButton}
                      onPress={() => addFlightForDay(activeDayCard.date)}
                    >
                      <Text style={styles.dayInfoButtonText}>+ Add transfer</Text>
                    </TouchableOpacity>
                  ) : null}
                  {!rentalsForDay.length ? (
                    <TouchableOpacity
                      testID="day-details-add-rental-button"
                      accessibilityRole="button"
                      accessibilityLabel="Add rental car to this day"
                      style={styles.dayInfoButton}
                      onPress={() => addRentalForDay(activeDayCard.date)}
                    >
                      <Text style={styles.dayInfoButtonText}>+ Add rental car</Text>
                    </TouchableOpacity>
                  ) : null}
                  {!toursForDay.length ? (
                    <TouchableOpacity
                      testID="day-details-add-activity-button"
                      accessibilityRole="button"
                      accessibilityLabel="Add activity to this day"
                      style={styles.dayInfoButton}
                      onPress={() => addTourForDay(activeDayCard.date)}
                    >
                      <Text style={styles.dayInfoButtonText}>+ Add activity</Text>
                    </TouchableOpacity>
                  ) : null}
                  {!lodgingsForDay.length ? (
                    <TouchableOpacity
                      testID="day-details-add-accommodation-button"
                      accessibilityRole="button"
                      accessibilityLabel="Add accommodation to this day"
                      style={styles.dayInfoButton}
                      onPress={() => addLodgingForDay(activeDayCard.date)}
                    >
                      <Text style={styles.dayInfoButtonText}>+ Add accommodation</Text>
                    </TouchableOpacity>
                  ) : null}
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
            {/* Selected-item dialogs (TripItemDetailsDialog/ConfirmDialog) are rendered once,
                unconditionally, by the top-level return below — this branch must not render
                a second copy, or two identical dialog instances mount simultaneously. */}
          </View>
        );
      }

      return (
        <ScrollView
          ref={scrollRef}
          style={[styles.card, responsiveCardStyle, { flex: 1, minHeight: 0 }]}
          contentContainerStyle={{ gap: isPhoneLayout ? 10 : 12, paddingBottom: 24 }}
          onScroll={(e: any) => setScrollY(e.nativeEvent.contentOffset.y)}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          nestedScrollEnabled
          contentInsetAdjustmentBehavior="automatic"
        >
          <View style={[styles.row, isPhoneLayout ? { rowGap: 8 } : null]}>
            <Text style={styles.sectionTitle}>Overview</Text>
            <View style={[styles.row, { marginLeft: 'auto', gap: 8 }, isPhoneLayout ? { marginLeft: 0, width: '100%' } : null]}>
              <TouchableOpacity testID="overview-print-itinerary" style={[styles.button, styles.smallButton]} onPress={handlePrintItinerary}>
                <Text style={styles.buttonText}>Print itinerary</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => setIsEditing(true)}>
                <Text style={styles.buttonText}>Edit</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.flightTitle}>{trip.name}</Text>

          {trip.description ? (
            <View>
              {renderRichTextBlocks(trip.description, {
                base: styles.bodyText,
                bold: styles.headerText,
                italic: styles.helperText,
                link: styles.linkText ?? styles.buttonText,
                listItem: styles.helperText,
              })}
            </View>
          ) : null}

          {renderBookingPriorities()}

          {renderItineraryPlanNotes()}

          {renderDayBar(null)}

          <View style={{ gap: 12 }}>
            {dayCards.map((card, idx) => {
              const info = dayDataByDate.get(card.date);
              const startLocation = buildDayStartLocation(info);
              const summary = buildDaySummary(info);
              const heroTitle = buildHeroTitle(startLocation, summary);
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
        style={[styles.card, responsiveCardStyle, { flex: 1, minHeight: 0 }]}
        contentContainerStyle={{ gap: isPhoneLayout ? 10 : 12, paddingBottom: 24 }}
        onScroll={(e: any) => setScrollY(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        nestedScrollEnabled
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={[styles.row, isPhoneLayout ? { rowGap: 8 } : null]}>
          <Text style={styles.sectionTitle}>Overview</Text>
          {isEditing ? (
            <View style={[styles.row, { marginLeft: 'auto', gap: 8 }, isPhoneLayout ? { marginLeft: 0 } : null]}>
              <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={saveOverviewEdits}>
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.smallButton, styles.dangerButton]}
                onPress={cancelOverviewEdits}
              >
                <Text style={styles.dangerButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]}
              onPress={() => setIsEditing(true)}
            >
              <Text style={styles.buttonText}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.flightTitle}>{trip.name}</Text>
        {tripLocationLabel ? <Text style={styles.helperText}>Locations: {tripLocationLabel}</Text> : null}
        {tripAttractionsLabel ? <Text style={styles.helperText}>Must-see: {tripAttractionsLabel}</Text> : null}
        {dateRange ? <Text style={styles.helperText}>Dates: {dateRange}</Text> : null}
        {!dateRange && monthLabel && trip.durationDays ? (
          <Text style={styles.helperText}>
            Dates: {monthLabel} - {trip.durationDays} day(s)
          </Text>
        ) : null}
        {tripLength ? <Text style={styles.helperText}>Trip length: {tripLength} day(s)</Text> : null}

        {renderBookingPriorities()}

        {renderItineraryPlanNotes()}

        {isEditing ? (
          <>
            <View style={styles.divider} />
            <Text style={styles.headerText}>Currency</Text>
            <View style={[styles.input, styles.dropdown, { marginTop: 6 }]}>
              <TouchableOpacity style={styles.selectButtonRow} onPress={() => setShowCurrencyDropdown((prev) => !prev)}>
                <Text style={styles.cellText}>{currentCurrency}</Text>
                <Text style={styles.selectCaret}>▾</Text>
              </TouchableOpacity>
              {showCurrencyDropdown ? (
                <View style={styles.dropdownList}>
                  {currencyOptions.map((currency) => (
                    <TouchableOpacity
                      key={currency}
                      style={styles.dropdownOption}
                      onPress={() => {
                        setShowCurrencyDropdown(false);
                        if (trip?.id && currency !== currentCurrency) {
                          onUpdateCurrency?.(trip.id, currency);
                        }
                      }}
                    >
                      <Text style={styles.cellText}>{currency}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
          </>
        ) : null}

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
                        aria-label="Start month"
                        value={parseDateParts(dateDraft.startDate).month}
                        onChange={(e) => setDatePart('start', 'month', e.target.value)}
                        className="dateSelect"
                      >
                        <option value="">Month</option>
                        {monthOptions.map((m) => (
                          <option key={`start-${m.value}`} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Start day"
                        value={parseDateParts(dateDraft.startDate).day}
                        onChange={(e) => setDatePart('start', 'day', e.target.value)}
                        className="dateSelect"
                      >
                        <option value="">Day</option>
                        {dayOptions.map((d) => (
                          <option key={`start-day-${d}`} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Start year"
                        value={parseDateParts(dateDraft.startDate).year}
                        onChange={(e) => setDatePart('start', 'year', e.target.value)}
                        className="dateSelect"
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
                      <TouchableOpacity
                        style={[styles.input, styles.dateTouchable, { maxWidth: 200 }]}
                        onPress={() => openDatePicker('start')}
                      >
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
                        aria-label="End month"
                        value={parseDateParts(dateDraft.endDate).month}
                        onChange={(e) => setDatePart('end', 'month', e.target.value)}
                        className="dateSelect"
                      >
                        <option value="">Month</option>
                        {monthOptions.map((m) => (
                          <option key={`end-${m.value}`} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="End day"
                        value={parseDateParts(dateDraft.endDate).day}
                        onChange={(e) => setDatePart('end', 'day', e.target.value)}
                        className="dateSelect"
                      >
                        <option value="">Day</option>
                        {dayOptions.map((d) => (
                          <option key={`end-day-${d}`} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="End year"
                        value={parseDateParts(dateDraft.endDate).year}
                        onChange={(e) => setDatePart('end', 'year', e.target.value)}
                        className="dateSelect"
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
                      <TouchableOpacity
                        style={[styles.input, styles.dateTouchable, { maxWidth: 200 }]}
                        onPress={() => openDatePicker('end')}
                      >
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
                        aria-label="Trip start month"
                        value={dateDraft.startMonth}
                        onChange={(e) => setDateDraft((prev) => ({ ...prev, startMonth: e.target.value }))}
                        className="dateSelect"
                      >
                        <option value="">Select month</option>
                        {monthOptions.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Trip start year"
                        value={dateDraft.startYear}
                        onChange={(e) => setDateDraft((prev) => ({ ...prev, startYear: e.target.value }))}
                        className="dateSelect"
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
                      aria-label="Trip duration in days"
                      value={dateDraft.durationDays}
                      onChange={(e) => setDateDraft((prev) => ({ ...prev, durationDays: e.target.value }))}
                      className="dateSelect durationSelect"
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
          <Text style={styles.headerText}>Travelers</Text>
          {isEditing && (
            <TouchableOpacity
              style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]}
              onPress={() => setShowAddTraveler((prev) => !prev)}
            >
              <Text style={styles.buttonText}>+ Add</Text>
            </TouchableOpacity>
          )}
        </View>
        {isEditing && showAddTraveler ? (
          <View style={styles.addTravelerForm}>
            <View style={[styles.row, { gap: 8 }]}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="First name"
                autoComplete="given-name"
                textContentType="givenName"
                value={travelerDraft.firstName}
                onChangeText={(text) => setTravelerDraft((prev) => ({ ...prev, firstName: text }))}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Last name"
                autoComplete="family-name"
                textContentType="familyName"
                value={travelerDraft.lastName}
                onChangeText={(text) => setTravelerDraft((prev) => ({ ...prev, lastName: text }))}
              />
            </View>
            <TextInput
              style={styles.input}
              placeholder="Email (optional)"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              keyboardType="email-address"
              value={travelerDraft.email}
              onChangeText={(text) => setTravelerDraft((prev) => ({ ...prev, email: text }))}
            />
            <View style={[styles.row, { justifyContent: 'flex-end', gap: 8 }]}>
              <TouchableOpacity
                style={[styles.button, styles.smallButton, styles.dangerButton]}
                onPress={() => setShowAddTraveler(false)}
              >
                <Text style={styles.dangerButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={addTraveler}>
                <Text style={styles.buttonText}>Save Traveler</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
        <View style={styles.attendeeList}>
          {attendees.map((member) => (
            <View
              key={member.id}
              testID={attendeeTestId(member)}
              style={[
                styles.attendeeChip,
                pendingRemovalIds.includes(member.id) && styles.attendeeChipRemoving,
                member.status === 'pending' && styles.attendeeChipPending,
              ]}
            >
              <Text style={styles.attendeeText} numberOfLines={1} ellipsizeMode="tail">{attendeeLabel(member)}</Text>
              {isEditing ? (
                <TouchableOpacity
                  style={styles.attendeeRemoveButton}
                  onPress={() => removeTraveler(member.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.attendeeRemoveText}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>
        {isEditing ? (
          <View style={{ marginTop: 10 }}>
            <Text style={styles.headerText}>Pending Invites</Text>
            {pendingInvites.length ? (
              pendingInvites.map((invite) => (
                <Text key={invite.id} style={styles.bodyText}>
                  {invite.inviteeEmail} ({invite.status || 'Pending'})
                </Text>
              ))
            ) : (
              <Text style={styles.helperText}>No pending invites.</Text>
            )}
          </View>
        ) : null}

        <View style={styles.divider} />

        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          <Text style={styles.headerText}>Transfers</Text>
          {isEditing && (
            <TouchableOpacity
              style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]}
              onPress={() => openFlightAdd()}
            >
              <Text style={styles.buttonText}>+ Add Transfer</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={{ gap: 8 }}>
          {rows
            .filter((r) => r.type === 'flight')
            .map((row, idx) => {
              const flight = row.meta as Flight;
              const isEditingFlight = showFlightEditor && editingFlightId === flight.id;
              if (isEditingFlight) {
                return (
                  <View
                    key={flight.id}
                    style={styles.flightEditorWrap}
                    onLayout={(e: LayoutChangeEvent) => {
                      // No-op; this is just here to satisfy TS
                    }}
                  >
                    {renderOverviewFlightEditor()}
                  </View>
                );
              }
              return (
                <TouchableOpacity
                  key={flight.id}
                  style={styles.flightRow}
                  onPress={() => openFlightEditor(flight)}
                  onLayout={(e: LayoutChangeEvent) => {
                    setFlightRowOffsets((prev) => ({ ...prev, [flight.id]: e.nativeEvent.layout.y }));
                  }}
                >
                  <Text style={styles.flightTitle}>
                    {flight.departure_airport_code} → {flight.arrival_airport_code}
                  </Text>
                  <Text style={styles.helperText}>
                    {formatFriendlyDate(flight.departure_date, flight.departure_time)}
                  </Text>
                  <Text style={styles.helperText}>Status: {normalizeItineraryStatus((flight as any).status, LEGACY_ITINERARY_STATUS)}</Text>
                  <Text style={styles.helperText}>{buildPassengerName((flight as any).passenger_ids ?? [])}</Text>
                </TouchableOpacity>
              );
            })}
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <Text style={styles.headerText}>Lodging</Text>
          {isEditing && (
            <TouchableOpacity
              style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]}
              onPress={() => openAddLodging()}
            >
              <Text style={styles.buttonText}>+ Add Lodging</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={{ gap: 8 }}>
          {rows
            .filter((r) => r.type === 'lodging')
            .map((row) => {
              const lodging = row.meta as Lodging;
              const isEditingThis = showAddLodging && editingLodgingId === lodging.id;
              if (isEditingThis) {
                return (
                  <View key={lodging.id}>
                    <LodgingDialog
                      visible
                      styles={styles}
                      title={editingLodgingId ? 'Lodging Details' : 'Add Lodging'}
                      draft={lodgingDraft}
                      setDraft={setLodgingDraft}
                      groupMembers={groupMembers}
                      formatMemberName={formatMemberName}
                      defaultPayerId={defaultPayerId}
                      payerName={payerName}
                      onSave={saveLodging}
                      onCancel={closeLodgingModal}
                      onOpenDatePicker={(field) =>
                        openModalDatePicker(
                          field === 'checkIn' ? 'lodgingCheckIn' : field === 'checkOut' ? 'lodgingCheckOut' : 'lodgingRefundBy'
                        )
                      }
                    />
                  </View>
                );
              }
              return (
                <TouchableOpacity key={lodging.id} style={styles.flightRow} onPress={() => openLodgingEditor(lodging)}>
                  <Text style={styles.flightTitle}>{lodging.name}</Text>
                  <Text style={styles.helperText}>
                    {formatFriendlyDate(lodging.checkInDate)} – {formatFriendlyDate(lodging.checkOutDate)}
                  </Text>
                  <Text style={styles.helperText}>Status: {normalizeItineraryStatus(lodging.status, LEGACY_ITINERARY_STATUS)}</Text>
                </TouchableOpacity>
              );
            })}
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <Text style={styles.headerText}>Activities</Text>
          {isEditing && (
            <TouchableOpacity style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]} onPress={openAddTour}>
              <Text style={styles.buttonText}>+ Add Activity</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={{ gap: 8 }}>
          {rows
            .filter((r) => r.type === 'tour')
            .map((row) => {
              const tour = row.meta as Tour;
              return (
                <View key={tour.id} style={styles.flightRow}>
                  <TouchableOpacity onPress={() => openTourEditor(tour)}>
                    <Text style={styles.flightTitle}>{tour.name}</Text>
                    <Text style={styles.helperText}>
                      {formatFriendlyDate(tour.date, tour.startTime)} @ {tour.startLocation}
                    </Text>
                    <Text style={styles.helperText}>Status: {normalizeItineraryStatus(tour.status, LEGACY_ITINERARY_STATUS)}</Text>
                  </TouchableOpacity>
                  <GetYourGuideCta
                    backendUrl={backendUrl}
                    headers={headers}
                    activity={tour}
                    destination={trip?.destination}
                    theme={theme}
                    testID={`overview-getyourguide-${tour.id}`}
                  />
                </View>
              );
            })}
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <Text style={styles.headerText}>Rental Cars</Text>
          {isEditing && (
            <TouchableOpacity style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]} onPress={openAddRental}>
              <Text style={styles.buttonText}>+ Add Rental</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={{ gap: 8 }}>
          {rows
            .filter((r) => r.type === 'rental')
            .map((row) => {
              const rental = row.meta as CarRental;
              return (
                <TouchableOpacity key={rental.id} style={styles.flightRow} onPress={() => openRentalEditor(rental)}>
                  <Text style={styles.flightTitle}>{rental.vendor}</Text>
                  <Text style={styles.helperText}>
                    {rental.pickupLocation} {formatFriendlyDate(rental.pickupDate)} – {rental.dropoffLocation}{' '}
                    {formatFriendlyDate(rental.dropoffDate)}
                  </Text>
                  <Text style={styles.helperText}>Status: {normalizeItineraryStatus((rental as any).status, LEGACY_ITINERARY_STATUS)}</Text>
                </TouchableOpacity>
              );
            })}
        </View>
      </ScrollView>
    );
  };

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      {trip && aiItineraryPending ? (
        <View
          style={[styles.card, { borderColor: '#93c5fd', borderWidth: 1, marginBottom: 10 }]}
          testID="ai-itinerary-pending-banner"
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator size="small" color="#2563eb" testID="ai-itinerary-pending-spinner" />
            <Text style={styles.sectionTitle}>AI Itinerary In Progress</Text>
          </View>
          <Text style={styles.helperText} testID="ai-itinerary-stage-label">
            {aiItineraryStageLabel || 'Starting up…'}
            {formatEtaSeconds(aiItineraryEtaSeconds) ? ` — about ${formatEtaSeconds(aiItineraryEtaSeconds)} left` : ''}
          </Text>
          <Text style={styles.helperText}>
            {aiItineraryStageDetail || 'Your AI trip plan is being generated and will appear here automatically.'}
          </Text>
        </View>
      ) : null}
      {trip && !aiItineraryPending && aiItineraryFailedMessage ? (
        <View style={[styles.card, { borderColor: '#fecaca', borderWidth: 1, marginBottom: 10, paddingVertical: 8 }]}>
          <Text
            style={[styles.helperText, { color: theme.colors.error }]}
          >
            AI itinerary generation failed: {aiItineraryFailedMessage}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <TouchableOpacity
              style={[styles.button, styles.smallButton]}
              disabled={retryingAiItineraryTripId === trip.id}
              onPress={() => {
                setRetryingAiItineraryTripId(trip.id);
                onRetryAiItinerary?.(trip.id);
              }}
              testID="ai-itinerary-retry-button"
            >
              <Text style={styles.buttonText}>
                {retryingAiItineraryTripId === trip.id ? 'Retrying…' : 'Retry'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.smallButton, styles.dangerButton]}
              onPress={() => onDismissAiItineraryError?.(trip.id)}
              testID="ai-itinerary-dismiss-button"
            >
              <Text style={styles.buttonText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {renderContent()}
      {!isEditing && showFlightEditor ? renderOverviewFlightEditor() : null}
      {!isEditing && showAddLodging ? renderOverviewLodgingEditor() : null}
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
            }
            setModalDateField(null);
          }}
        />
      ) : null}

      {showAddTour ? (
        <ActivityEditForm
          draft={tourDraft}
          onChange={setTourDraft}
          onSave={saveTour}
          onCancel={closeTourModal}
          isNew={!editingTourId}
          members={groupMembers}
          styles={styles}
          theme={theme}
        />
      ) : null}

      {showAddRental ? (
        <CarRentalEditForm
          draft={rentalDraft}
          onChange={setRentalDraft}
          onSave={saveRental}
          onCancel={closeRentalModal}
          isNew={!editingRentalId}
          members={userMembers}
          styles={styles}
          theme={theme}
        />
      ) : null}

      {addPopoverOpen ? (
        <AddItemPopover
          visible
          onSelect={handlePopoverSelect}
          onClose={() => setAddPopoverOpen(false)}
          theme={theme}
          hiddenKinds={featureItineraryItemKinds ? undefined : ['place', 'note', 'checklist']}
        />
      ) : null}
      {activeAddDialog === 'place' ? (
        <PlacePickerDialog
          visible
          defaultDay={addPopoverDay ?? 1}
          backendUrl={backendUrl}
          headers={headers}
          selectedLocationIds={tripLocationOptions.map((o) => o.id)}
          selectedLocationNames={locationNames}
          onSubmit={handleAddPlace}
          onCancel={closeAllAddDialogs}
          theme={theme}
        />
      ) : null}
      {activeAddDialog === 'note' ? (
        <NoteInputDialog
          visible
          defaultDay={addPopoverDay ?? 1}
          onSubmit={handleAddNote}
          onCancel={closeAllAddDialogs}
          theme={theme}
        />
      ) : null}
      {activeAddDialog === 'checklist' ? (
        <ChecklistInputDialog
          visible
          defaultDay={addPopoverDay ?? 1}
          onSubmit={handleAddChecklist}
          onCancel={closeAllAddDialogs}
          theme={theme}
        />
      ) : null}
      {featureStandardizedItemDialogs ? renderSelectedItemDialogs() : null}
    </View>
  );
};

export default OverviewTab;



