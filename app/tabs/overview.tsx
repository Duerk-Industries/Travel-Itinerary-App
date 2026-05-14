// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
  type LayoutChangeEvent,
  useWindowDimensions,
} from 'react-native';
import { computeTripDays, validateTripDates } from '../utils/createTripWizard';
import { renderRichTextBlocks } from '../utils/richText';
import {
  buildOverviewRows,
  type DetailItem,
  formatFlightDetails,
  formatTourDetails,
  type OverviewRow,
} from '../utils/overviewBuilder';
import { type MapApp } from '../utils/mapLinks';
import {
  formatMonthYear,
} from '../utils/tripDates';
import { buildMemberDisplayLookup, dedupeMembersByIdentity, formatMemberDisplayName, formatTravelerListDisplay } from '../utils/memberDisplay';
import { normalizeDateString } from '../utils/normalizeDateString';
import { sanitizeCostInput } from '../utils/sanitizeCost';
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
import { buildRentalDraftFromRow, buildTourDraftFromRow, getOverviewSaveFlags } from '../utils/overviewEditing';
import {
  buildDayEventsMap,
  flightMatchesDay,
  lodgingCoversDay,
  rentalMatchesDay,
  tourMatchesDay,
} from '../utils/overviewDayEvents';
import { FlightEditingForm } from '../components/TransferEditingForm';
import ConfirmDialog from '../components/ConfirmDialog';
import LodgingDialog from '../components/LodgingDialog';
import LodgingDetailsDialog from '../components/LodgingDetailsDialog';
import ReactionBar, { type ReactionSummary, type ReactionValue } from '../components/ReactionBar';
import AddItemPopover, { type AddItemKind } from '../components/AddItemPopover';
import PlacePickerDialog, { type PlacePickerSubmit } from '../components/PlacePickerDialog';
import NoteInputDialog, { type NoteSubmit } from '../components/NoteInputDialog';
import ChecklistInputDialog, { type ChecklistSubmit } from '../components/ChecklistInputDialog';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LEGACY_ITINERARY_STATUS, normalizeItineraryStatus } from '../utils/itineraryStatus';
import { useImageSourceGetter } from '../utils/imageSource';
import { formatTemperatureFromCelsius, normalizeTemperatureUnit, type TemperatureUnit } from '../utils/temperatureUnit';

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
  aiItineraryFailedMessage?: string | null;
  editSignal?: number;
  onUpdateCurrency?: (tripId: string, currency: string) => void;
  onOpenAddress: (address: string) => void;
  onRefreshTrips: () => void;
  onRefreshGroups: () => void;
  onRefreshGroupMembers: () => void;
  onFlightDataChanged: () => void;
  onLodgingDataChanged: () => void;
  onTourDataChanged: () => void;
  onAddCarRental: (rental: CarRental) => void;
  openFlightInFlightsTab: (flightId: string) => void;
  openLodgingDetails: (lodging: Lodging) => void;
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
  aiItineraryFailedMessage,
  editSignal,
  onUpdateCurrency,
  onOpenAddress,
  onRefreshTrips,
  onRefreshGroups,
  onRefreshGroupMembers,
  onFlightDataChanged,
  onLodgingDataChanged,
  onTourDataChanged,
  onAddCarRental,
  openFlightInFlightsTab: _openFlightInFlightsTab,
  openLodgingDetails,
}) => {
  const { width: viewportWidth } = useWindowDimensions();
  const isPhoneLayout = viewportWidth < 700;
  const isTabletLayout = viewportWidth >= 700 && viewportWidth < 1100;
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
  const [detailModal, setDetailModal] = useState<{ title: string; sections: DetailSection[] } | null>(null);
  const [showAddTraveler, setShowAddTraveler] = useState(false);
  const [travelerDraft, setTravelerDraft] = useState({ firstName: '', lastName: '', email: '' });
  const [pendingRemovalIds, setPendingRemovalIds] = useState<string[]>([]);
  const [showAddLodging, setShowAddLodging] = useState(false);
  const [locationNames, setLocationNames] = useState<string[]>([]);

  useEffect(() => {
    const ids = Array.isArray(trip?.locationIds) ? trip!.locationIds : [];
    if (!ids.length) {
      setLocationNames([]);
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
        const names = Array.isArray(data) ? data.map((item: any) => String(item?.name ?? '')).filter(Boolean) : [];
        setLocationNames(names);
      })
      .catch(() => {
        if (active) setLocationNames([]);
      });
    return () => {
      active = false;
    };
  }, [backendUrl, headers, trip?.id, trip?.locationIds]);
  const tripLocationLabel = locationNames.length ? locationNames.join(', ') : trip?.destination || '';
  const [showAddTour, setShowAddTour] = useState(false);
  const [showAddRental, setShowAddRental] = useState(false);
  const [lodgingDraft, setLodgingDraft] = useState<LodgingDraft>(createInitialLodgingState());
  const [tourDraft, setTourDraft] = useState<TourDraft>(createInitialActivityState(trip?.startDate ?? null));
  const [rentalDraft, setRentalDraft] = useState<CarRentalDraft>(createInitialCarRentalDraft());
  const [editingFlightId, setEditingFlightId] = useState<string | null>(null);
  const [editingFlightDraft, setEditingFlightDraft] = useState<FlightEditDraft | null>(null);
  const [showFlightEditor, setShowFlightEditor] = useState(false);
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
        return;
      }
      setItineraryLoading(true);
      try {
        const res = await fetch(`${backendUrl}/api/itineraries`, { headers });
        if (!res.ok) {
          setItineraryDetails([]);
          setItineraryId(null);
          return;
        }
        const data = await res.json();
        const records = (Array.isArray(data) ? data : []).filter((i) => i.tripId === trip.id);
        if (!records.length) {
          setItineraryDetails([]);
          setItineraryId(null);
          return;
        }
        // Use the most-recently-updated record per trip, falling back to createdAt
        // when the server doesn't surface updatedAt yet. Per
        // docs/implementation-plan-itinerary-collab.md §B2.
        const recordTs = (r: any) =>
          new Date((r?.updatedAt ?? r?.createdAt) ?? 0).getTime();
        const latest = [...records].sort((a, b) => recordTs(b) - recordTs(a))[0];
        setItineraryId(latest.id ?? null);
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
      alert('Activity is required.');
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
        alert(data.error || 'Could not create itinerary record');
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
        alert(data.error || 'Could not add item');
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
    [backendUrl, jsonHeaders, updateLocalChecklistItem]
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
        alert((data as any)?.error || 'Could not delete item');
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

  const overviewStartDate = displayStartDate ?? eventDateBounds?.startDate ?? null;
  const overviewEndDate = displayEndDate ?? eventDateBounds?.endDate ?? null;
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
    const cache = async () => {
      if (!trip?.id || !dayCards.length) return;
      await AsyncStorage.setItem(`overview.cache.${trip.id}`, JSON.stringify(dayCards));
    };
    cache().catch(() => undefined);
  }, [dayCards, trip?.id]);

  useEffect(() => {
    const loadCache = async () => {
      if (!trip?.id) return;
      if (dayCards.length) return;
      try {
        const raw = await AsyncStorage.getItem(`overview.cache.${trip.id}`);
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
    const fetchImages = async () => {
      if (!dayCards.length) return;
      const missingCards = dayCards.filter((card) => !dayImages[card.date]);
      if (!missingCards.length) return;
      const next: Record<string, string> = {};
      for (let idx = 0; idx < missingCards.length; idx += 1) {
        const card = missingCards[idx];
        const dayNumber = Math.max(1, dayCards.findIndex((candidate) => candidate.date === card.date) + 1);
        const activities = itineraryDetails
          .filter((detail) => detail.day === dayNumber)
          .map((detail) => detail.activity)
          .filter(Boolean);
        const tourNames = tours
          .filter((tour) => tour.date === card.date)
          .map((tour) => tour.name)
          .filter(Boolean);
        const contextParts = [...activities, ...tourNames].filter(Boolean);
        const context = contextParts.join(' | ').slice(0, 200);
        try {
          const baseLocation = card.location || tripLocationLabel || trip?.destination || 'travel';
          const query = [
            `location=${encodeURIComponent(baseLocation)}`,
            `day=${encodeURIComponent(card.date)}`,
            context ? `context=${encodeURIComponent(context)}` : '',
          ]
            .filter(Boolean)
            .join('&');
          const res = await fetch(`${backendUrl}/api/itinerary/images?${query}`, { headers });
          const data = await res.json().catch(() => ({}));
          if (data?.url) {
            next[card.date] = data.url;
          }
        } catch {
          // ignore
        }
      }
      if (Object.keys(next).length) {
        setDayImages((prev) => ({ ...prev, ...next }));
      }
    };
    fetchImages().catch(() => undefined);
  }, [backendUrl, headers, dayCards, dayImages, itineraryDetails, tours, tripLocationLabel, trip?.destination]);

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
      alert(validationError);
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
      alert(data.error || 'Unable to update trip');
      return;
    }
    if (pendingRemovalIds.length && trip?.id) {
      const removalGroupId = group?.id ?? trip.groupId;
      if (!removalGroupId) {
        alert('Unable to remove member: missing group id');
        return;
      }
      for (const memberId of pendingRemovalIds) {
        const removeRes = await fetch(`${backendUrl}/api/groups/${removalGroupId}/members/${memberId}`, {
          method: 'DELETE',
          headers,
        });
        if (!removeRes.ok) {
          const removeData = await removeRes.json().catch(() => ({}));
          alert(removeData.error || 'Unable to remove member');
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
      alert('Enter first and last name');
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
      alert(data.error || 'Unable to add member');
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
    if (editingFlightId === 'new') {
      const res = await fetch(`${backendUrl}/api/transfers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Unable to save flight');
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
      alert(data.error || 'Unable to update flight');
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
      alert(result.error || 'Unable to save lodging');
      return;
    }
    closeLodgingModal();
    onLodgingDataChanged();
  };

  const saveTour = async () => {
    if (editingTourId) {
      const { payload, error } = buildActivityPayload(tourDraft, defaultPayerId);
      if (error || !payload) {
        alert(error || 'Unable to save activity');
        return;
      }
      const res = await fetch(`${backendUrl}/api/activities/${editingTourId}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ ...payload, tripId: trip?.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Unable to save activity');
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
      alert(result.error || 'Unable to save activity');
      return;
    }
    closeTourModal();
    onTourDataChanged();
  };

  const saveRental = () => {
    if (editingRentalId) {
      // Editing rentals is not supported in this view; just close.
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
    setLodgingDraft(buildOverviewLodgingDraft());
  };

  const closeTourModal = () => {
    setShowAddTour(false);
    setEditingTourId(null);
    setTourDraft(createInitialActivityState(trip?.startDate ?? null));
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
      setPendingRemovalIds([]);
    }
  }, [isEditing]);

  const openFlightEditor = (flight: Flight) => {
    if (!isEditing) {
      setSelectedFlight(flight);
      return;
    }
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
      openLodgingDetails(lodging);
      return;
    }
    setEditingLodgingId(lodging.id);
    setLodgingDraft(toLodgingDraft(lodging, { normalize: normalizeDateString, defaultPayerId }));
    setShowAddLodging(true);
  };

  const openAddLodging = () => {
    if (!isEditing) return;
    setEditingLodgingId(null);
    setLodgingDraft(buildOverviewLodgingDraft());
    setShowAddLodging(true);
  };

  const openAddTour = () => {
    if (!isEditing) return;
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
    setEditingTourId(tour.id);
    setTourDraft(buildTourDraftFromRow({ ...tour, paidBy: (tour as any).paidBy ?? [] } as any));
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

  const renderDetailSectionsModal = (modal: { title: string; sections: DetailSection[] }) => (
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
    return `${weekdayLabel} ${date.getDate()}`;
  };

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

  const buildDayStartLocation = (info?: { flights: Flight[]; lodgings: Lodging[]; tours: Tour[]; rentals: CarRental[] }) => {
    if (!info) return tripLocationLabel || 'Trip Day';
    const flight = info.flights[0];
    if (flight) return flight.departure_location || flight.departure_airport_code || tripLocationLabel || 'Trip Day';
    const lodging = info.lodgings[0];
    if (lodging) return lodging.name || tripLocationLabel || 'Trip Day';
    const tour = info.tours[0];
    if (tour) return tour.startLocation || tour.name || tripLocationLabel || 'Trip Day';
    const rental = info.rentals[0];
    if (rental) return rental.pickupLocation || rental.vendor || tripLocationLabel || 'Trip Day';
    return tripLocationLabel || 'Trip Day';
  };

  const buildDaySummary = (info?: { flights: Flight[]; lodgings: Lodging[]; tours: Tour[]; rentals: CarRental[]; details: ItineraryDetail[] }) => {
    if (!info) return 'Free day';
    const activityDetails = info.details.filter((d) => !d.kind || d.kind === 'activity');
    if (activityDetails.length) return activityDetails[0].activity;
    if (info.tours.length) return info.tours[0].name || 'Activity day';
    if (info.flights.length) return 'Travel day';
    if (info.lodgings.length) return `Stay at ${info.lodgings[0].name || 'lodging'}`;
    if (info.rentals.length) return 'Drive day';
    return 'Free day';
  };

  const buildDayNarrative = (info?: { details: ItineraryDetail[]; flights: Flight[]; tours: Tour[]; lodgings: Lodging[]; rentals: CarRental[] }) => {
    if (!info) return ['No itinerary details yet.'];
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
    return ['No itinerary details yet.'];
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
        const img = dayImages[card.date];
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
              isPhoneLayout ? { height: 150 } : isTabletLayout ? { height: 170 } : null,
            ]}
            onPress={onPress}
            disabled={!onPress}
          >
            {img ? (
              <Image style={dayHeroImageStyle} source={getImageSource(img)} resizeMode="cover" />
            ) : (
              <View style={styles.dayHeroImageFallback} />
            )}
            <View style={styles.dayHeroOverlay} />
            <View style={styles.dayHeroBadge}>
              <Text style={styles.dayHeroBadgeText}>{card.label.toUpperCase()}</Text>
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
                  isPhoneLayout ? { fontSize: 18 } : isTabletLayout ? { fontSize: 20 } : null,
                ]}
                numberOfLines={2}
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
        const heroTitle = [startLocation, summary].filter(Boolean).join(' - ');
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
              contentContainerStyle={{ gap: isPhoneLayout ? 12 : 16, paddingTop: isPhoneLayout ? 48 : 56 }}
              onScroll={(e: any) => setScrollY(e.nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
            >
              <Text style={styles.sectionTitle}>My itinerary</Text>
              <Text style={styles.flightTitle}>{trip.name}</Text>
              {tripLocationLabel ? <Text style={styles.helperText}>{tripLocationLabel}</Text> : null}
              {renderDayBar(selectedDay)}
              {renderHeroCard(activeDayCard, heroTitle, false, undefined, 'day-details-hero')}
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
                      setDetailModal({ title: 'Transfer Details', sections });
                    }}
                  >
                    <Text style={styles.dayInfoButtonText}>See transfer details →</Text>
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
                              setDetailModal({
                                title: 'Activity Details',
                                sections: [
                                  {
                                    subtitle: showTourNames && participants ? `Travelers: ${participants}` : undefined,
                                    items: formatTourDetails(tour),
                                  },
                                ],
                              });
                            }}
                          >
                            <Text style={[styles.dayInfoRoute, styles.linkText]}>{tour.name}</Text>
                          </TouchableOpacity>
                          <Text
                            style={styles.helperText}
                          >{`${tour.startTime || 'Time TBD'} · ${tour.startLocation || 'Location TBD'}`}</Text>
                          {tour.notes ? <Text style={styles.helperText}>{tour.notes}</Text> : null}
                          {showTourNames && participants ? <Text style={styles.helperText}>Travelers: {participants}</Text> : null}
                        </View>
                      </View>
                    );
                  })}
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
                        onPress={() => openLodgingDetails(lodging)}
                      >
                        {lodging.imageUrl ? (
                          <Image style={lodgingImageStyle} source={getImageSource(lodging.imageUrl)} resizeMode="cover" />
                        ) : (
                          <View style={styles.lodgingImageFallback} />
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
                  <Text style={styles.helperText}>No items yet for this day.</Text>
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
                              <Text style={styles.dayInfoRoute}>{`✅ ${d.activity}`}</Text>
                              {(d.checklistItems ?? []).map((it) => {
                                const checked = !!it.checkedBy;
                                return (
                                  <TouchableOpacity
                                    key={it.id}
                                    testID={`overview-checklist-toggle-${it.id}`}
                                    accessibilityRole="checkbox"
                                    accessibilityState={{ checked }}
                                    onPress={() => toggleChecklistItem(d.id, it)}
                                    style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 }}
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
                              canReact
                              onCast={castReactionForDetail}
                              onClear={clearReactionForDetail}
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
          </View>
        );
      }

      return (
        <ScrollView
          ref={scrollRef}
          style={[styles.card, responsiveCardStyle, { flex: 1, minHeight: 0 }]}
          contentContainerStyle={{ gap: isPhoneLayout ? 10 : 12 }}
          onScroll={(e: any) => setScrollY(e.nativeEvent.contentOffset.y)}
          scrollEventThrottle={16}
        >
          <View style={[styles.row, isPhoneLayout ? { rowGap: 8 } : null]}>
            <Text style={styles.sectionTitle}>Overview</Text>
            <TouchableOpacity
              style={[styles.button, styles.smallButton, { marginLeft: 'auto' }, isPhoneLayout ? { marginLeft: 0 } : null]}
              onPress={() => setIsEditing(true)}
            >
              <Text style={styles.buttonText}>Edit</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.flightTitle}>{trip.name}</Text>
          {tripLocationLabel ? <Text style={styles.helperText}>Locations: {tripLocationLabel}</Text> : null}
          {dateRange ? <Text style={styles.helperText}>Dates: {dateRange}</Text> : null}
          {!dateRange && monthLabel && trip.durationDays ? (
            <Text style={styles.helperText}>
              Dates: {monthLabel} - {trip.durationDays} day(s)
            </Text>
          ) : null}
          {tripLength ? <Text style={styles.helperText}>Trip length: {tripLength} day(s)</Text> : null}

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

          {renderDayBar(null)}

          <View style={{ gap: 12 }}>
            {dayCards.map((card, idx) => {
              const info = dayDataByDate.get(card.date);
              const startLocation = buildDayStartLocation(info);
              const summary = buildDaySummary(info);
              const heroTitle = [startLocation, summary].filter(Boolean).join(' - ');
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
        contentContainerStyle={{ gap: isPhoneLayout ? 10 : 12 }}
        onScroll={(e: any) => setScrollY(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
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
        {dateRange ? <Text style={styles.helperText}>Dates: {dateRange}</Text> : null}
        {!dateRange && monthLabel && trip.durationDays ? (
          <Text style={styles.helperText}>
            Dates: {monthLabel} - {trip.durationDays} day(s)
          </Text>
        ) : null}
        {tripLength ? <Text style={styles.helperText}>Trip length: {tripLength} day(s)</Text> : null}

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
              <Text style={styles.attendeeText}>{attendeeLabel(member)}</Text>
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
              const isEditingFlight = isEditing && editingFlightId === flight.id;
              if (isEditingFlight) {
                return (
                  <View
                    key={flight.id}
                    style={styles.flightEditorWrap}
                    onLayout={(e: LayoutChangeEvent) => {
                      // No-op; this is just here to satisfy TS
                    }}
                  >
                    <FlightEditingForm
                      draft={editingFlightDraft}
                      setDraft={setEditingFlightDraft}
                      styles={styles}
                      onSave={saveFlightEdit}
                      onCancel={closeFlightEditor}
                      groupMembers={groupMembers}
                      defaultPayerId={defaultPayerId}
                      payerName={payerName}
                      onSetPassengers={setEditingFlightPassengers}
                      openModalDate={(field, current) => openModalDatePicker(field as ModalDateField, current)}
                    />
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
              const isEditingThis = isEditing && editingLodgingId === lodging.id;
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
                <TouchableOpacity key={tour.id} style={styles.flightRow} onPress={() => openTourEditor(tour)}>
                  <Text style={styles.flightTitle}>{tour.name}</Text>
                  <Text style={styles.helperText}>
                    {formatFriendlyDate(tour.date, tour.startTime)} @ {tour.startLocation}
                  </Text>
                  <Text style={styles.helperText}>Status: {normalizeItineraryStatus(tour.status, LEGACY_ITINERARY_STATUS)}</Text>
                </TouchableOpacity>
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
        <View style={[styles.card, { borderColor: '#93c5fd', borderWidth: 1, marginBottom: 10 }]}>
          <Text style={styles.sectionTitle}>AI Itinerary In Progress</Text>
          <Text style={styles.helperText}>Your AI trip plan is being generated and will appear here automatically.</Text>
        </View>
      ) : null}
      {trip && !aiItineraryPending && aiItineraryFailedMessage ? (
        <View style={[styles.card, { borderColor: '#fecaca', borderWidth: 1, marginBottom: 10, paddingVertical: 8 }]}>
          <Text style={[styles.helperText, { color: '#7f1d1d' }]}>
            AI itinerary failed. You can retry from the Itinerary tab.
          </Text>
        </View>
      ) : null}
      {renderContent()}
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

      {showAddTour ? (
        <View style={styles.modalOverlay} testID="activity-form-modal">
          <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={closeTourModal} />
          <View style={[styles.modalCard, { marginTop: 0 }]}>
            <Text style={styles.sectionTitle}>{editingTourId ? 'Edit Activity' : 'Add Activity'}</Text>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingRight: 12 }}>
              <Text style={styles.modalLabel}>Date</Text>
              {Platform.OS === 'web' ? (
                <TextInput
                  style={styles.input}
                  placeholder="YYYY-MM-DD"
                  value={tourDraft.date}
                  onChangeText={(text) => setTourDraft((prev) => ({ ...prev, date: text }))}
                />
              ) : (
                <TouchableOpacity style={styles.input} onPress={() => openModalDatePicker('tourDate', tourDraft.date)}>
                  <Text style={styles.cellText}>{tourDraft.date || 'YYYY-MM-DD'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.modalLabel}>Activity</Text>
              <TextInput
                style={styles.input}
                placeholder="Activity name"
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
              <TextInput
                style={styles.input}
                placeholder="HH:MM"
                value={tourDraft.startTime}
                onChangeText={(text) => setTourDraft((prev) => ({ ...prev, startTime: text }))}
              />
              <Text style={styles.modalLabel}>Duration</Text>
              <TextInput
                style={styles.input}
                placeholder="Duration"
                value={tourDraft.duration}
                onChangeText={(text) => setTourDraft((prev) => ({ ...prev, duration: text }))}
              />
              <Text style={styles.modalLabel}>Cost</Text>
              <TextInput
                style={styles.input}
                placeholder="Cost"
                keyboardType="numeric"
                value={tourDraft.cost}
                onChangeText={(text) => setTourDraft((prev) => ({ ...prev, cost: sanitizeCostInput(text) }))}
              />
              <Text style={styles.modalLabel}>Description</Text>
              <TextInput
                style={[styles.input, { minHeight: 96, textAlignVertical: 'top' }]}
                placeholder="Description"
                value={tourDraft.notes}
                onChangeText={(text) => setTourDraft((prev) => ({ ...prev, notes: text }))}
                multiline
              />
            </ScrollView>
            <View style={[styles.tableFooter, { justifyContent: 'space-between' }]}>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={closeTourModal} testID="activity-cancel">
                <Text style={styles.dangerButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={saveTour} testID="activity-save">
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      {addPopoverOpen ? (
        <AddItemPopover
          visible
          onSelect={handlePopoverSelect}
          onClose={() => setAddPopoverOpen(false)}
        />
      ) : null}
      {activeAddDialog === 'place' ? (
        <PlacePickerDialog
          visible
          defaultDay={addPopoverDay ?? 1}
          onSubmit={handleAddPlace}
          onCancel={closeAllAddDialogs}
        />
      ) : null}
      {activeAddDialog === 'note' ? (
        <NoteInputDialog
          visible
          defaultDay={addPopoverDay ?? 1}
          onSubmit={handleAddNote}
          onCancel={closeAllAddDialogs}
        />
      ) : null}
      {activeAddDialog === 'checklist' ? (
        <ChecklistInputDialog
          visible
          defaultDay={addPopoverDay ?? 1}
          onSubmit={handleAddChecklist}
          onCancel={closeAllAddDialogs}
        />
      ) : null}
    </View>
  );
};

export default OverviewTab;



