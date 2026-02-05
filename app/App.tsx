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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import { formatDateLong } from './utils/formatDateLong';
import { normalizeDateString } from './utils/normalizeDateString';
import { sanitizeCostInput } from './utils/sanitizeCost';
import { FlightsTab, type Flight, fetchFlightsForTrip } from './tabs/flights';
import { type Tour, TourTab, fetchToursForTrip } from './tabs/tours';
import { type Trait } from './tabs/traits';
import { FollowTab, fetchFollowedTripsApi, loadFollowCodes, loadFollowPayloads, saveFollowCodes, saveFollowPayloads, type FollowedTrip } from './tabs/follow';
import ItinerariesTab from './tabs/itineraries';
import HomeTab from './tabs/HomeTab';
import DailyExpensesTab from './tabs/dailyExpenses';
import LedgerTab from './tabs/ledger';
import OverviewTab from './tabs/overview';
import CreateTripWizard from './tabs/createTripWizard';
import { buildAllExpenses, calculateAllTotals, type UnifiedExpense, computePayerTotals } from './utils/costs';
import { rollUpTotals, validateCoveringRules } from './utils/coveredBy';
import TripDetailsTab from './tabs/tripDetails';
import AccountTab, { fetchAccountProfile, fetchFamilyRelationships, fetchFellowTravelers, type FellowTraveler } from './tabs/account';
import { CarRental, CarRentalDraft, buildCarRentalFromDraft, createInitialCarRentalDraft } from './tabs/carRentals';
import { Lodging, fetchLodgingsApi } from './tabs/lodging';
import { InvitePayload } from './utils/inviteCodes';
import { type MapApp, buildMapUrl, loadStoredMapPreference, persistMapPreference } from './utils/mapLinks';
import { shouldAllowPageChange, shouldDisableTab } from './utils/wizardGuard';
import * as WebBrowser from 'expo-web-browser';
import { Buffer } from 'buffer';
import { loadSession, saveSession, clearSession } from './utils/session';
import LodgingDetailsDialog from './components/LodgingDetailsDialog';
import ConfirmDialog from './components/ConfirmDialog';

import LodgingTab from './tabs/LodgingTab';

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
  description?: string | null;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  startMonth?: number | null;
  startYear?: number | null;
  durationDays?: number | null;
  currency?: string | null;
  createdAt: string;
}

interface Expense {
  id: string;
  tripId: string;
  groupId: string;
  userId: string;
  expenseDate: string;
  category: string;
  amount: number;
  currency: string;
  amountInTripCurrency?: number | null;
  exchangeRateToTripCurrency?: number | null;
  exchangeRateDate?: string | null;
  payerIds: string[];
  forIds: string[];
  sourceType?: string | null;
  sourceId?: string | null;
  notes?: string | null;
  createdAt: string;
}

interface GroupMemberOption {
  id: string;
  guestName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  status?: 'active' | 'pending' | 'removed';
  removedAt?: string | null;
}

type Page =
  | 'home'
  | 'overview'
  | 'flights'
  | 'lodging'
  | 'car'
  | 'tours'
  | 'expenses'
  | 'ledger'
  | 'trips'
  | 'create-trip'
  | 'trip-details'
  | 'traits'
  | 'itinerary'
  | 'cost'
  | 'account'
  | 'follow';

// Resolve backend URL; keep Expo web on localhost hitting the local API over HTTP to avoid HTTPS upgrades/CORS issues.
const resolveBackendUrl = (): string => {
  const envConfigured =
    (typeof process !== 'undefined' && (process.env.EXPO_PUBLIC_BACKEND_URL ?? process.env.REACT_NATIVE_APP_BACKEND_URL)) || '';
  const appConfigured = Constants.expoConfig?.extra?.backendUrl;
  const configuredBackend = [envConfigured, appConfigured].find(
    (val) => typeof val === 'string' && val.trim().length > 0
  ) as string | undefined;
  const isLocalHost = (value: string) => /^(localhost|127\.0\.0\.1)$/i.test(value);
  const normalizeBackendUrl = (raw: string, defaultProtocol: 'http' | 'https'): string => {
    const trimmed = raw.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    return `${defaultProtocol}://${trimmed}`;
  };
  if (process.env.NODE_ENV === 'development') {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const { hostname, protocol } = window.location;
      if (isLocalHost(hostname)) {
        if (configuredBackend && isLocalHost(new URL(normalizeBackendUrl(configuredBackend, 'http')).hostname)) {
          return normalizeBackendUrl(configuredBackend, 'http');
        }
        return `${protocol}//${hostname}:4000`;
      }
    }
    if (configuredBackend) {
      return normalizeBackendUrl(configuredBackend, 'http');
    }
  }
  if (process.env.NODE_ENV === 'development') {
    if (configuredBackend) {
      return normalizeBackendUrl(configuredBackend, 'http');
    }
    return 'http://localhost:4000';
  }
  const raw = configuredBackend ?? 'https://duerk.org';
  return normalizeBackendUrl(raw, 'https');
};

const resolveRefreshIntervalMs = (): number => {
  const raw = Constants.expoConfig?.extra?.refreshIntervalMs;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value <= 0) return 60000;
  return Math.floor(value);
};

const backendUrl = resolveBackendUrl();
const refreshIntervalMs = resolveRefreshIntervalMs();
const sessionKey = 'stp.session';
const sessionDurationMs = 12 * 60 * 60 * 1000;

const App: React.FC = () => {
  const [userToken, setUserToken] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInFlightRef = useRef(false);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [externalFlightEditId, setExternalFlightEditId] = useState<string | null>(null);
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [followInviteCode, setFollowInviteCode] = useState('');
  const [followLoading, setFollowLoading] = useState(false);
  const [followError, setFollowError] = useState('');
  const [followedTrips, setFollowedTrips] = useState<FollowedTrip[]>([]);
  const [followCodes, setFollowCodes] = useState<Record<string, string>>({});
  const [followCodeLoading, setFollowCodeLoading] = useState<Record<string, boolean>>({});
  const [followCodeError, setFollowCodeError] = useState<string | null>(null);
  const [followCodePayloads, setFollowCodePayloads] = useState<Record<string, InvitePayload>>({});
  const [groupName, setGroupName] = useState('');
  const [groupUserEmails, setGroupUserEmails] = useState('');
  const [groupGuestNames, setGroupGuestNames] = useState('');
  const [groupAddEmail, setGroupAddEmail] = useState<Record<string, string>>({});
  const [groupAddRelationship, setGroupAddRelationship] = useState<Record<string, string>>({});
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
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [lodgings, setLodgings] = useState<Lodging[]>([]);
  const [selectedLodging, setSelectedLodging] = useState<Lodging | null>(null);
  const [showLodgingDetails, setShowLodgingDetails] = useState(false);
  const [lodgingToDelete, setLodgingToDelete] = useState<Lodging | null>(null);

  const [tours, setTours] = useState<Tour[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [carRentals, setCarRentals] = useState<CarRental[]>([]);
  const [carDraft, setCarDraft] = useState<CarRentalDraft>(createInitialCarRentalDraft());
  const [carDateField, setCarDateField] = useState<'pickup' | 'dropoff' | null>(null);
  const [carDateValue, setCarDateValue] = useState<Date>(new Date());
  const [carPrepaidOpen, setCarPrepaidOpen] = useState(false);
  const carPickupDateRef = useRef<HTMLInputElement | null>(null);
  const carDropoffDateRef = useRef<HTMLInputElement | null>(null);
  const [traits, setTraits] = useState<Trait[]>([]);
  const [newTraitName, setNewTraitName] = useState('');
  const [selectedTraitNames, setSelectedTraitNames] = useState<Set<string>>(new Set());
  const [activePage, setActivePage] = useState<Page>('home');
  const [pageHistory, setPageHistory] = useState<Page[]>([]);
  const [pageForwardHistory, setPageForwardHistory] = useState<Page[]>([]);
  const [flightAirportOptions, setFlightAirportOptions] = useState<string[]>([]);
  const [traitAge, setTraitAge] = useState('');
  const [traitGender, setTraitGender] = useState<'female' | 'male' | 'nonbinary' | 'prefer-not'>('prefer-not');
  const [showGenderDropdown, setShowGenderDropdown] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    passwordConfirm: '',
  });
  const [accountProfile, setAccountProfile] = useState({ firstName: '', lastName: '', email: '' });
  const [mapApp, setMapApp] = useState<MapApp>(() => loadStoredMapPreference('google'));
  const [familyRelationships, setFamilyRelationships] = useState<any[]>([]);
  const [coveredBy, setCoveredBy] = useState<Record<string, string>>({});
  const [fellowTravelers, setFellowTravelers] = useState<FellowTraveler[]>([]);
  const [showRelationshipDropdown, setShowRelationshipDropdown] = useState(false);
  const formatMemberName = (member: GroupMemberOption): string => {
    const norm = (val?: string | null) => {
      const t = val?.trim();
      if (!t || t.toLowerCase() === 'unknown') return '';
      return t;
    };
    const first = norm(member.firstName);
    const last = norm(member.lastName);
    const email = member.email?.trim();
    const status = member.status;
    if (first || last) return `${first ?? ''} ${last ?? ''}`.trim();
    if (member.guestName) return member.guestName;
    if (email) {
      const local = email.split('@')[0] ?? '';
      const parts = local.split(/[._-]+/).filter(Boolean);
      const base = parts.length >= 2 ? `${parts[0]} ${parts.slice(1).join(' ')}`.trim() : email;
      return status === 'pending' ? `${base} (pending)` : base;
    }
    return status === 'pending' ? 'Pending member' : 'Member';
  };

  const userMembers = useMemo(
    () => groupMembers.filter((m) => !m.guestName && m.status !== 'removed'),
    [groupMembers]
  );

  const memberIds = useMemo(() => userMembers.map((m) => m.id), [userMembers]);

  const flightsTotal = useMemo(
    () => flights.reduce((sum, f) => sum + (Number(f.cost) || 0), 0),
    [flights]
  );

  const lodgingTotal = useMemo(
    () => lodgings.reduce((sum, l) => sum + (Number(l.totalCost) || 0), 0),
    [lodgings]
  );

  const toursTotal = useMemo(() => tours.reduce((sum, t) => sum + (Number(t.cost) || 0), 0), [tours]);
  const tourPayerTotals = useMemo(
    () => computePayerTotals(tours, (t) => Number(t.cost) || 0, (t) => t.paidBy, memberIds, { fallbackOnEmpty: true }),
    [tours, memberIds]
  );

  const expenseCategories = useMemo(
    () => ['Breakfast', 'Lunch', 'Dinner', 'Other Food', 'Rides', 'Souvenirs', 'Other'],
    []
  );
  const expenseItems = useMemo(
    () => expenses.filter((e) => expenseCategories.includes(e.category)),
    [expenses, expenseCategories]
  );
  const getExpenseAmount = useCallback(
    (expense: Expense) => Number(expense.amountInTripCurrency ?? expense.amount) || 0,
    []
  );
  const expenseTotalsByCategory = useMemo(() => {
    const totals: Record<string, number> = {};
    expenseCategories.forEach((cat) => {
      totals[cat] = 0;
    });
    expenseItems.forEach((expense) => {
      totals[expense.category] = (totals[expense.category] ?? 0) + getExpenseAmount(expense);
    });
    return totals;
  }, [expenseItems, expenseCategories, getExpenseAmount]);
  const expensesTotal = useMemo(
    () => expenseCategories.reduce((sum, cat) => sum + (expenseTotalsByCategory[cat] ?? 0), 0),
    [expenseCategories, expenseTotalsByCategory]
  );
  const carRentalsTotal = useMemo(
    () => carRentals.reduce((sum, rental) => sum + (Number(rental.cost) || 0), 0),
    [carRentals]
  );

  const updateMapPreference = useCallback(
    (pref: MapApp) => {
      setMapApp(pref);
      persistMapPreference(pref);
      setAccountProfile((prev) => ({ ...prev, mapPreference: pref }));
    },
    [setAccountProfile]
  );

  const findActiveTrip = useCallback(
    () => trips.find((t) => t.id === activeTripId),
    [trips, activeTripId]
  );

  const isTripWizardOpen = activePage === 'create-trip';
  const requestPageChange = (page: Page, opts?: { skipHistory?: boolean }) => {
    if (!shouldAllowPageChange(activePage, page)) return;
    if (page === activePage) return;
    setPageForwardHistory([]);
    if (!opts?.skipHistory) {
      setPageHistory((prev) => {
        const next = [...prev, activePage];
        return next.slice(-25);
      });
    }
    setActivePage(page);
  };

  const openMaps = (address: string) => {
    const url = buildMapUrl(address, mapApp);
    if (!url) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  const openFlightInFlightsTab = (flightId: string) => {
    setExternalFlightEditId(flightId);
  };

  const applyCarDate = (field: 'pickup' | 'dropoff', value: string) => {
    setCarDraft((prev) => ({ ...prev, [field === 'pickup' ? 'pickupDate' : 'dropoffDate']: value }));
  };

  const addCarRental = () => {
    if (!activeTripId) {
      alert('Select an active trip before adding a car rental.');
      return;
    }
    const result = buildCarRentalFromDraft(carDraft, defaultPayerId, memberIds);
    if (result.error || !result.rental) {
      alert(result.error || 'Unable to add car rental.');
      return;
    }
    setCarRentals((prev) => [...prev, result.rental as CarRental]);
    setCarDraft(createInitialCarRentalDraft());
  };

  const addCarRentalFromOverview = (rental: CarRental) => {
    if (!activeTripId) {
      alert('Select an active trip before adding a car rental.');
      return;
    }
    setCarRentals((prev) => [...prev, rental]);
  };

  const removeCarRental = (id: string) => {
    setCarRentals((prev) => prev.filter((c) => c.id !== id));
  };

  const openCarDatePicker = (field: 'pickup' | 'dropoff') => {
    if (Platform.OS !== 'web' && NativeDateTimePicker) {
      const base = (field === 'pickup' ? carDraft.pickupDate : carDraft.dropoffDate) || '';
      const date = base ? new Date(base) : new Date();
      setCarDateValue(date);
      setCarDateField(field);
      return;
    }
    const ref = field === 'pickup' ? carPickupDateRef.current : carDropoffDateRef.current;
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

  // Resolve a member id to a human-friendly name for payer chips.
  const payerName = (id: string): string => {
    const member = groupMembers.find((m) => m.id === id);
    return member ? formatMemberName(member) : 'Unknown';
  };

  const saveCoveredBy = async () => {
    const trip = findActiveTrip();
    if (!trip?.id) {
      alert('An active trip is required.');
      return;
    }

    const validation = validateCoveringRules(coveredBy);
    if (!validation.ok) {
      alert(validation.error);
      return;
    }

    try {
      const res = await fetch(`${backendUrl}/api/trips/${trip.id}/covered-by`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify(coveredBy),
      });
      if (!res.ok) throw new Error('Failed to save covering rules.');
      alert('Covering rules saved.');
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const coveredTravelerIds = useMemo(() => new Set(Object.keys(coveredBy)), [coveredBy]);

  const reportableMembers = useMemo(
    () => groupMembers.filter(m => !coveredTravelerIds.has(m.id)),
    [groupMembers, coveredTravelerIds]
  );

  const reportableMemberIds = useMemo(
    () => reportableMembers.map(m => m.id),
    [reportableMembers]
  );

  const allMemberIds = useMemo(() => groupMembers.map(m => m.id), [groupMembers]);

  const allExpenses = useMemo(
    () => buildAllExpenses(flights, lodgings, tours, carRentals, expenses, findActiveTrip()?.currency ?? 'USD', allMemberIds),
    [flights, lodgings, tours, carRentals, expenses, allMemberIds, findActiveTrip]
  );

  const { ledgerPaidTotals, ledgerUsedTotals, finalBalances } = useMemo(
    () => calculateAllTotals(allExpenses, allMemberIds, reportableMemberIds, coveredBy),
    [allExpenses, allMemberIds, reportableMemberIds, coveredBy]
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

  const overallCost = useMemo(() => allExpenses.reduce((sum, e) => sum + e.amount, 0), [allExpenses]);

  const costReportRows = useMemo(() => {
    const categories = [...new Set(allExpenses.map(e => e.category))].sort();
    return categories.map(category => {
      const categoryExpenses = allExpenses.filter(e => e.category === category);
      const total = categoryExpenses.reduce((sum, e) => sum + e.amount, 0);
      const rawPaid = computePayerTotals(categoryExpenses, e => e.amount, e => e.payerIds, allMemberIds, { fallbackOnEmpty: true });
      const shares = rollUpTotals(rawPaid, coveredBy);
      return { label: category, total, shares };
    });
  }, [allExpenses, allMemberIds, coveredBy]);

  const convertCostReportToCsv = (
    reportRows: Array<{ label: string; total: number; shares: Record<string, number> }>,
    members: GroupMemberOption[],
    paidTotals: Record<string, number>,
    finalCost: number,
    getMemberName: (member: GroupMemberOption) => string
  ): string => {
    const escapeCsvCell = (cell: string) => {
      if (/[",\n]/.test(cell)) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    };

    const header = ['Category', ...members.map(getMemberName), 'Total'].map(escapeCsvCell);
    const rows = reportRows.map(row => {
        const shares = members.map(m => row.shares[m.id]?.toFixed(2) ?? '0.00');
        return [row.label, ...shares, row.total.toFixed(2)].map(escapeCsvCell);
    });

    const overallRow = [
      'Overall',
      ...members.map((m) => paidTotals[m.id]?.toFixed(2) ?? '0.00'),
      finalCost.toFixed(2),
    ].map(escapeCsvCell);

    const allRows = [header, ...rows, overallRow];
    return allRows.map(row => row.join(',')).join('\n');
  };

  const allExpensesForCsv = useMemo(() => {
    return allExpenses;
  }, [allExpenses]);

  const convertExpensesToCsv = (expenseType: 'paid' | 'incurred'): string => {
    const escapeCsvCell = (cell: any) => {
      const cellStr = String(cell ?? '');
      if (/[",\n]/.test(cellStr)) {
        return `"${cellStr.replace(/"/g, '""')}"`;
      }
      return cellStr;
    };

    const members = reportableMembers;
    const memberIds = reportableMemberIds;

    const header = ['Date', 'Category', ...members.map(formatMemberName)];
    const rows = allExpensesForCsv.map(expense => {
        const row: (string | number)[] = [expense.date, expense.category];
        const ids = expenseType === 'paid' ? expense.payerIds : expense.forIds;
        const rolledUpIds = (ids || []).map(id => coveredBy[id] || id);

        const totals = computePayerTotals(
            [{ amount: expense.amount, ids: rolledUpIds }],
            item => item.amount,
            item => item.ids,
            memberIds,
            { fallbackOnEmpty: true }
        );

        memberIds.forEach(id => {
            row.push(totals[id]?.toFixed(2) || '0.00');
        });
        return row.map(escapeCsvCell).join(',');
    });
    return [header.map(escapeCsvCell).join(','), ...rows].join('\n');
  };

  const downloadCsv = (csvContent: string, fileName: string) => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      alert('CSV export is only available on web.');
      return;
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const headers = useMemo<Record<string, string>>(
    () => (userToken ? { Authorization: `Bearer ${userToken}` } : ({} as Record<string, string>)),
    [userToken]
  );
  const jsonHeaders = useMemo<Record<string, string>>(
    () => ({ 'Content-Type': 'application/json', ...(userToken ? { Authorization: `Bearer ${userToken}` } : {}) }),
    [userToken]
  );
  const logout = useCallback(() => {
    setUserToken(null);
    setUserName(null);
    setUserEmail(null);
    setFlights([]);
    setTours([]);
    setExpenses([]);
    setInvites([]);
    setFollowedTrips([]);
    setFollowInviteCode('');
    setFollowError('');
    setFollowCodes({});
    setGroups([]);
    setGroupMembers([]);
    setGroupAddEmail({});
    setGroupAddRelationship({});
    setTraits([]);
    setSelectedTraitNames(new Set());
    setTraitAge('');
    setTraitGender('prefer-not');
    setAccountProfile({ firstName: '', lastName: '', email: '', mapPreference: mapApp });
    setFamilyRelationships([]);
    setFellowTravelers([]);
    setPageForwardHistory([]);
    setActivePage('home');
    setPageHistory([]);
    setLastRefreshAt(null);
    setIsRefreshing(false);
    refreshInFlightRef.current = false;
    clearSession();
  }, []);

  const loadAccountProfile = useCallback(
    (token?: string) =>
      fetchAccountProfile({
        backendUrl,
        token: token ?? userToken,
        logout,
        setAccountProfile,
        setMapPreference: updateMapPreference,
        setUserName,
        setUserEmail,
      }),
    [backendUrl, logout, setAccountProfile, setUserEmail, setUserName, updateMapPreference, userToken]
  );

  const loadFamilyRelationships = useCallback(
    (token?: string) =>
      fetchFamilyRelationships({
        backendUrl,
        token: token ?? userToken,
        setFamilyRelationships,
      }),
    [backendUrl, setFamilyRelationships, userToken]
  );

  const loadFellowTravelers = useCallback(
    (token?: string) =>
      fetchFellowTravelers({
        backendUrl,
        token: token ?? userToken,
        setFellowTravelers,
      }),
    [backendUrl, setFellowTravelers, userToken]
  );

  const buildLoginRedirectUrl = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return `${window.location.origin}/login`;
    }
    if (typeof Linking?.createURL === 'function') {
      return Linking.createURL('/login');
    }
    const base = typeof window !== 'undefined' ? window.location.origin : backendUrl;
    return `${base}/login`;
  };

  const loginWithGoogle = async () => {
    const redirectUrl = buildLoginRedirectUrl();
    const authUrl = `${backendUrl}/api/auth/google?redirect_uri=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.assign(authUrl);
      return;
    }
    await WebBrowser.openBrowserAsync(authUrl);
  };

  const handleAuthSuccess = (token: string) => {
    let decoded: { firstName?: string; lastName?: string; email?: string; provider?: string } | null = null;
    try {
      const payload = token.split('.')[1];
      if (payload) {
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
        decoded = JSON.parse(Buffer.from(padded, 'base64').toString());
      }
    } catch {
      decoded = null;
    }
    const name =
      `${decoded?.firstName ?? ''} ${decoded?.lastName ?? ''}`.trim() || decoded?.email || 'Traveler';
    setUserToken(token);
    setUserName(name);
    if (decoded?.email) {
      setUserEmail(decoded.email);
    }
    setAccountProfile({
      firstName: decoded?.firstName ?? '',
      lastName: decoded?.lastName ?? '',
      email: decoded?.email ?? '',
    });
    const previousSession = loadSession();
    const restoredTripId = previousSession?.tripId ?? activeTripId ?? null;
    setActiveTripId(restoredTripId);
    setActivePage('home');
    setPageForwardHistory([]);
    setPageHistory([]);
    saveSession(token, name, 'home', decoded?.email, restoredTripId, [], []);
    fetchFlights(token);
    fetchLodgings(token);
    fetchTours(token);
    fetchInvites(token);
    loadAccountProfile(token);
    loadFamilyRelationships(token);
    loadFellowTravelers(token);
    setActivePage('home');
  }

  useEffect(() => {
    const extractTokenFromUrl = (rawUrl: string) => {
      const url = new URL(rawUrl);
      const token = url.searchParams.get('token');
      if (token) {
        return { token, url, source: 'query' as const };
      }
      const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
      if (hash) {
        const hashParams = new URLSearchParams(hash);
        const hashToken = hashParams.get('token');
        if (hashToken) {
          return { token: hashToken, url, source: 'hash' as const };
        }
      }
      return { token: null, url, source: null as const };
    };

    const handleDeepLink = (event: { url: string }) => {
      const { token } = extractTokenFromUrl(event.url);
      if (token) {
        handleAuthSuccess(token);
      }
    };

    const subscription = Linking.addEventListener('url', handleDeepLink);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const { token, url } = extractTokenFromUrl(window.location.href);
      if (token) {
        handleAuthSuccess(token);
        url.searchParams.delete('token');
        if (url.hash) {
          const hashParams = new URLSearchParams(url.hash.slice(1));
          hashParams.delete('token');
          const newHash = hashParams.toString();
          url.hash = newHash ? `#${newHash}` : '';
        }
        window.history.replaceState({}, '', url.toString());
      }
    }
    return () => {
      subscription.remove();
    };
  }, []);

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
      if (!data?.user || typeof data.token !== 'string') {
        alert(data.error || 'Login failed');
        return;
      }
      handleAuthSuccess(data.token);
    } catch (err) {
      alert((err as Error).message || 'Login failed');
    }
  };

  const register = async () => {
    if (authForm.password !== authForm.passwordConfirm) {
      alert('Passwords do not match');
      return;
    }
    try {
      const res = await fetch(`${backendUrl}/api/web-auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: authForm.firstName.trim(),
          lastName: authForm.lastName.trim(),
          email: authForm.email.trim(),
          password: authForm.password,
          passwordConfirm: authForm.passwordConfirm,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Registration failed');
        return;
      }
      if (!data?.user || typeof data.token !== 'string') {
        alert(data.error || 'Registration failed');
        return;
      }
      handleAuthSuccess(data.token);
    } catch (err) {
      alert((err as Error).message || 'Registration failed');
    }
  };

  // Fetch flights for the active trip; normalize paidBy casing.
  const fetchFlights = async (token?: string) => {
    if (!activeTripId) {
      setFlights([]);
      return;
    }
    try {
      const data = await fetchFlightsForTrip({
        backendUrl,
        activeTripId,
        token: token ?? userToken,
      });
      setFlights(data);
    } catch {
      setFlights([]);
    }
  };

  // Fetch lodgings for the active trip; normalize nullable fields.
  const fetchLodgings = async (token?: string) => {
    if (!activeTripId) {
      setLodgings([]);
      return;
    }
    const data = await fetchLodgingsApi(backendUrl, activeTripId, token ?? userToken);
    setLodgings(data);
  };

  // Fetch tours for the active trip; normalize string fields.
  const fetchTours = async (token?: string) => {
    if (!activeTripId || !(token ?? userToken)) {
      setTours([]);
      return;
    }
    const data = await fetchToursForTrip({ backendUrl, activeTripId, token: token ?? userToken });
    setTours(data);
  };

  const fetchExpenses = async (token?: string) => {
    const authToken = token ?? userToken;
    if (!activeTripId || !authToken) {
      setExpenses([]);
      return;
    }
    try {
      const res = await fetch(`${backendUrl}/api/expenses?tripId=${activeTripId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        setExpenses([]);
        return;
      }
      const data = await res.json();
      setExpenses(Array.isArray(data) ? data : []);
    } catch {
      setExpenses([]);
    }
  };

  // Fetch itineraries for the current user; ItinerariesTab also fetches within its own lifecycle,
  // but this keeps the call from blowing up when invoked from shared effects.
  const fetchItineraries = async (token?: string) => {
    const authToken = token ?? userToken;
    if (!authToken) return;
    await fetch(`${backendUrl}/api/itineraries`, { headers }).catch(() => undefined);
  };

  const fetchInvites = async (token?: string) => {
    const authToken = token ?? userToken;
    if (!authToken) {
      setInvites([]);
      return;
    }
    try {
      const res = await fetch(`${backendUrl}/api/groups/invites`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        setInvites([]);
        return;
      }
      const data = await res.json();
      setInvites(data);
    } catch {
      setInvites([]);
    }
  };

  const fetchGroups = async (sort?: 'created' | 'name') => {
    const res = await fetch(`${backendUrl}/api/groups?sort=${sort ?? groupSort}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (res.status === 401 || res.status === 403) {
      logout();
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    const normalized = (Array.isArray(data) ? data : []).map((group: GroupView) => ({
      ...group,
      invites: Array.isArray(group.invites) ? group.invites : [],
    }));
    setGroups(normalized);
    if (!newTripGroupId && normalized.length) {
      setNewTripGroupId(normalized[0].id);
    }
  };

  const fetchTrips = async (tokenOverride?: string): Promise<Trip[]> => {
    const authToken = tokenOverride ?? userToken;
    if (!authToken) {
      setTrips([]);
      return [];
    }
    try {
      const res = await fetch(`${backendUrl}/api/trips`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.status === 401 || res.status === 403) {
        logout();
        return [];
      }
      if (!res.ok) return [];
      const data = await res.json();
      setTrips(data);
      if (!activeTripId && data.length) {
        setActiveTripId(data[0].id);
      } else if (activeTripId && !data.find((t: Trip) => t.id === activeTripId)) {
        setActiveTripId(data[0]?.id ?? null);
      }
      return data;
    } catch {
      return [];
    }
  };

  const fetchGroupMembersForActiveTrip = async () => {
    if (!userToken || !activeTripId) {
      setGroupMembers([]);
      return;
    }
    const trip = trips.find((t) => t.id === activeTripId);
    const groupId = trip?.groupId;
    if (!groupId) {
      setGroupMembers([]);
      return;
    }
    try {
      const res = await fetch(`${backendUrl}/api/groups/${groupId}/members`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      if (!res.ok) {
        setGroupMembers([]);
        return;
      }
      const data = await res.json();
      const normalized = (Array.isArray(data) ? data : []).map((m) => ({
        id: m.id,
        guestName: m.guestName ?? m.guest_name ?? undefined,
        email: m.email ?? undefined,
        firstName: m.firstName ?? m.first_name ?? undefined,
        lastName: m.lastName ?? m.last_name ?? undefined,
        status: m.status ?? undefined,
        removedAt: m.removedAt ?? undefined,
      }));
      setGroupMembers(normalized.filter((m) => m.status !== 'removed'));
    } catch {
      setGroupMembers([]);
    }
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
    const raw = await res.json().catch(() => ({}));
    const data = raw ?? {};
    if (data.age != null) setTraitAge(String(data.age));
    if (data.gender) {
      if (data.gender === 'female' || data.gender === 'male' || data.gender === 'nonbinary' || data.gender === 'prefer-not') {
        setTraitGender(data.gender);
      }
    }
  };

  const fetchFlightAirports = async (q: string) => {
    if (!userToken || !q.trim()) {
      setFlightAirportOptions([]);
      return;
    }
    try {
      const res = await fetch(`${backendUrl}/api/flights/locations?q=${encodeURIComponent(q.trim())}`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      if (!res.ok) {
        setFlightAirportOptions([]);
        return;
      }
      const data = await res.json();
      setFlightAirportOptions(data);
    } catch {
      setFlightAirportOptions([]);
    }
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

  const refreshAllData = async (tokenOverride?: string) => {
    const authToken = tokenOverride ?? userToken;
    if (!authToken || refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setIsRefreshing(true);
    try {
      const ok = await loadAccountProfile(authToken);
      if (!ok) return;
      fetchFlights(authToken);
      fetchLodgings(authToken);
      fetchTours(authToken);
      fetchExpenses(authToken);
      fetchInvites(authToken);
      fetchGroups();
      fetchTrips();
      fetchTraits();
      fetchTraitProfile();
      fetchItineraries(authToken);
      loadFamilyRelationships(authToken);
      loadFellowTravelers(authToken);
      try {
        const trips = await fetchFollowedTripsApi(backendUrl, { Authorization: `Bearer ${authToken}` });
        setFollowedTrips(trips);
      } catch (err) {
        if ((err as any).code === 'UNAUTHORIZED') {
          logout();
          return;
        }
        setFollowedTrips([]);
      }
    } finally {
      refreshInFlightRef.current = false;
      setIsRefreshing(false);
      setLastRefreshAt(Date.now());
    }
  };

  useEffect(() => {
    if (userToken) {
      refreshAllData();
    }
  }, [userToken]);

  useEffect(() => {
    if (userToken) {
      fetchTrips();
      fetchGroups();
      fetchInvites();
    }
  }, [userToken]);

  useEffect(() => {
    if (userToken) return;
    const session = loadSession();
    if (session) {
      setUserToken(session.token);
      setUserName(session.name);
      setUserEmail(session.email ?? null);
      const sessionHistory = Array.isArray(session.pageHistory)
        ? session.pageHistory.filter((p) => typeof p === 'string') as Page[]
        : [];
      setPageHistory(sessionHistory);
      const sessionForwardHistory = (Array.isArray(session.pageForwardHistory)
        ? session.pageForwardHistory.filter((p) => typeof p === 'string')
        : []) as Page[];
      setPageForwardHistory(sessionForwardHistory);
      const tripId = session.tripId ?? null;
      if (tripId) {
        setActiveTripId(tripId);
        setActivePage('overview');
      } else {
        const sessionPage = session.page;
        if (
          sessionPage === 'home' ||
          sessionPage === 'overview' ||
          sessionPage === 'flights' ||
          sessionPage === 'lodging' ||
          sessionPage === 'trips' ||
          sessionPage === 'create-trip' ||
          sessionPage === 'trip-details' ||
          sessionPage === 'itinerary' ||
          sessionPage === 'tours' ||
          sessionPage === 'expenses' ||
          sessionPage === 'ledger' ||
          sessionPage === 'cost' ||
          sessionPage === 'account' ||
          sessionPage === 'follow'
        ) {
          setActivePage(sessionPage === 'menu' ? 'home' : (sessionPage as Page));
        } else {
          setActivePage('home');
        }
      }
    }
  }, [userToken]);

  useEffect(() => {
    const stored = loadFollowCodes();
    if (Object.keys(stored).length) {
      setFollowCodes(stored);
    }
    const storedPayloads = loadFollowPayloads();
    if (Object.keys(storedPayloads).length) {
      setFollowCodePayloads(storedPayloads);
    }
  }, []);

  useEffect(() => {
    saveFollowCodes(followCodes);
  }, [followCodes]);

  useEffect(() => {
    saveFollowPayloads(followCodePayloads);
  }, [followCodePayloads]);

  useEffect(() => {
    if (!userToken) return;
    if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs <= 0) return;
    const now = Date.now();
    const last = lastRefreshAt ?? now;
    const delay = Math.max(0, refreshIntervalMs - (now - last));
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshAllData();
    }, delay);
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [activeTripId, lastRefreshAt, userToken, refreshIntervalMs]);

  useEffect(() => {
    if (userToken) {
      fetchFlights();
      fetchLodgings();
      fetchTours();
      fetchExpenses();
    }
  }, [activeTripId]);

  useEffect(() => {
    if (userToken) {
      loadFamilyRelationships();
      loadFellowTravelers();
    }
  }, [loadFamilyRelationships, loadFellowTravelers, userToken]);

  useEffect(() => {
    if (userToken) {
      fetchGroupMembersForActiveTrip();
    }
  }, [userToken, activeTripId, trips]);

  useEffect(() => {
    if (!userToken || !activeTripId) {
      setCoveredBy({});
      return;
    }
    const fetchCoveredBy = async () => {
      try {
        const res = await fetch(`${backendUrl}/api/trips/${activeTripId}/covered-by`, { headers });
        if (!res.ok) throw new Error('Failed to fetch covering rules.');
        const data = await res.json();
        setCoveredBy(data || {});
      } catch (err) {
        setCoveredBy({});
      }
    };
    fetchCoveredBy();
  }, [userToken, activeTripId, headers]);

  const addMemberToGroup = async (groupId: string, type: 'user' | 'relationship') => {
    if (!userToken) return;
    const email = groupAddEmail[groupId] ?? '';
    const relationshipId = groupAddRelationship[groupId] ?? '';

    if (type === 'user' && !email.trim()) {
      alert('Enter an email to add a user');
      return;
    }
    if (type === 'relationship' && !relationshipId) {
      alert('Select a relationship');
      return;
    }

    let payload: any = {};
    if (type === 'user') {
      const normalized = email.trim();
      const local = normalized.split('@')[0] ?? '';
      const parts = local.split(/[._-]+/).filter(Boolean);
      const derivedGuestName = parts.length >= 2 ? `${parts[0]} ${parts.slice(1).join(' ')}`.trim() : '';
      payload = { email: normalized, ...(derivedGuestName ? { guestName: derivedGuestName } : {}) };
    } else {
      const rel = familyRelationships.find((r) => r.id === relationshipId);
      if (!rel) {
        alert('Select a relationship');
        return;
      }
      const relEmail = rel.relative?.email?.trim();
      const relName = `${rel.relative?.firstName ?? ''} ${rel.relative?.middleName ?? ''} ${rel.relative?.lastName ?? ''}`
        .replace(/\s+/g, ' ')
        .trim();
      payload = relEmail ? { email: relEmail } : { guestName: relName || 'Relationship' };
    }

    const res = await fetch(`${backendUrl}/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to add member');
      return;
    }
    setGroupAddEmail((prev) => ({ ...prev, [groupId]: '' }));
    setGroupAddRelationship((prev) => ({ ...prev, [groupId]: '' }));
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
    if (res.status === 401 || res.status === 403) {
      logout();
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to create trip');
      return;
    }
    setNewTripName('');
    if (data?.id) setActiveTripId(data.id as string);
    fetchTrips();
  };

  const onTripCreated = (tripId: string) => {
    setActiveTripId(tripId);
    fetchTrips();
    fetchGroups();
    fetchInvites();
    requestPageChange('overview', { skipHistory: true });
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

  const updateTripCurrency = async (tripId: string, currency: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/trips/${tripId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ currency }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to update currency');
      return;
    }
    fetchTrips();
    fetchExpenses();
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

  const openLodgingDetails = (lodging: Lodging) => {
    setSelectedLodging(lodging);
    setShowLodgingDetails(true);
  };

  const deleteLodging = async (lodgingId: string) => {
    if (!activeTripId) return;
    const res = await fetch(`${backendUrl}/api/lodgings/${lodgingId}`, {
        method: 'DELETE',
        headers,
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Unable to delete lodging');
        return;
    }
    fetchLodgings();
  };

  const goBack = () => {
    if (pageHistory.length === 0) return;
    const previousPage = pageHistory[pageHistory.length - 1];
    if (shouldAllowPageChange(activePage, previousPage)) {
      setPageForwardHistory((prev) => [activePage, ...prev].slice(0, 25));
      setPageHistory((prev) => prev.slice(0, -1));
      setActivePage(previousPage);
    }
  };

  const closeTripWizard = () => {
    setPageForwardHistory([]);
    setActivePage('home');
  };

  const goForward = () => {
    if (pageForwardHistory.length === 0) return;
    const nextPage = pageForwardHistory[0];
    if (shouldAllowPageChange(activePage, nextPage)) {
      setPageHistory((prev) => [...prev, activePage].slice(-25));
      setPageForwardHistory((prev) => prev.slice(1));
      setActivePage(nextPage);
    }
  };

  useEffect(() => {
    if (!userToken) return;
    saveSession(userToken, userName ?? 'Traveler', activePage, userEmail, activeTripId, pageHistory, pageForwardHistory);
  }, [userToken, userName, userEmail, activePage, activeTripId, pageHistory, pageForwardHistory]);

  const disabledPages = useMemo(() => {
    const pages: Page[] = [
      'overview',
      'flights',
      'lodging',
      'car',
      'tours',
      'expenses',
      'ledger',
      'cost',
      'trips',
      'create-trip',
      'account',
      'follow',
      'itinerary',
    ];
    return new Set(pages.filter((page) => shouldDisableTab(activePage, page)));
  }, [activePage]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          {userToken && activePage !== 'home' ? (
            <TouchableOpacity
              style={styles.homeButton}
              onPress={() => requestPageChange('home')}
              accessibilityLabel="Home"
            >
              <Text style={styles.homeButtonText}>⌂</Text>
            </TouchableOpacity>
          ) : null}
          {userToken ? (
            <TouchableOpacity
              style={[styles.backButton, pageHistory.length === 0 && styles.buttonDisabled]}
              onPress={goBack}
              disabled={pageHistory.length === 0}
              accessibilityLabel="Back"
            >
              <Text style={styles.backButtonText}>{'<'}</Text>
            </TouchableOpacity>
          ) : null}
          {userToken ? (
            <TouchableOpacity
              style={[styles.backButton, pageForwardHistory.length === 0 && styles.buttonDisabled]}
              onPress={goForward}
              disabled={pageForwardHistory.length === 0}
              accessibilityLabel="Forward"
            >
              <Text style={styles.backButtonText}>{'>'}</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.title}>Shared Trip Planner</Text>
        </View>
        {userToken ? (
          <View style={styles.topRightWrapper}>
            {trips.length ? (
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={isTripWizardOpen}
                style={[
                  styles.input,
                  styles.inlineInput,
                  styles.dropdown,
                  styles.activeTrip,
                  isTripWizardOpen && styles.buttonDisabled,
                ]}
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
          {activePage === 'home' ? (
            <HomeTab
              backendUrl={backendUrl}
              headers={headers}
              activeTripId={activeTripId}
              trips={trips}
              styles={styles}
              onSelectTrip={setActiveTripId}
              onNavigate={(page) => requestPageChange(page as Page)}
              disabledPages={disabledPages}
            />
          ) : null}

          {activePage === 'itinerary' ? (
            <ItinerariesTab
              backendUrl={backendUrl}
              userToken={userToken}
              activeTripId={activeTripId}
              activeTrip={findActiveTrip() ?? null}
              traits={traits}
              headers={headers}
              setActiveTripId={setActiveTripId}
              styles={styles}
            />
          ) : null}

          {activePage === 'tours' ? (
            <TourTab
              backendUrl={backendUrl}
              userToken={userToken}
              activeTripId={activeTripId}
              tours={tours}
              setTours={setTours}
              defaultPayerId={defaultPayerId}
              payerName={payerName}
              formatMemberName={formatMemberName}
              groupMembers={groupMembers}
              jsonHeaders={jsonHeaders}
              payerTotals={tourPayerTotals}
              toursTotal={toursTotal}
              styles={styles}
              nativeDateTimePicker={NativeDateTimePicker}
              fetchTours={fetchTours}
            />
          ) : null}

          {activePage === 'expenses' ? (
            <DailyExpensesTab
              backendUrl={backendUrl}
              headers={headers}
              jsonHeaders={jsonHeaders}
              trip={findActiveTrip() ?? null}
              groupMembers={groupMembers}
              expenses={expenses}
              setExpenses={setExpenses}
              defaultPayerId={defaultPayerId}
              styles={styles}
            />
          ) : null}

          {activePage === 'ledger' ? (
            <LedgerTab
              trip={findActiveTrip() ?? null}
              groupMembers={groupMembers}
              reportableMembers={reportableMembers}
              paidTotals={ledgerPaidTotals}
              usedTotals={ledgerUsedTotals}
              styles={styles}
              onNavigate={requestPageChange}
              downloadCsv={downloadCsv}
              findActiveTrip={findActiveTrip}
              coveredBy={coveredBy}
              setCoveredBy={setCoveredBy}
              formatMemberName={formatMemberName}
              payerName={payerName}
              saveCoveredBy={saveCoveredBy}
            />
          ) : null}

          {activePage === 'cost' ? (
            <View style={[styles.card, styles.flightsSection]}>
              <View style={styles.row}>
                <Text style={styles.sectionTitle}>Cost Report</Text>
                <View style={[styles.row, { marginLeft: 'auto' }]}>
                  <TouchableOpacity
                    style={[styles.button, styles.smallButton]}
                    onPress={() => {
                      const csv = convertExpensesToCsv('paid');
                      const fileName = `paid-expenses-${findActiveTrip()?.name?.replace(/\s/g, '_') ?? 'export'}.csv`;
                      downloadCsv(csv, fileName);
                    }}
                  >
                    <Text style={styles.buttonText}>Export Paid CSV</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.button, styles.smallButton]}
                    onPress={() => {
                      const csv = convertExpensesToCsv('incurred');
                      const fileName = `incurred-expenses-${findActiveTrip()?.name?.replace(/\s/g, '_') ?? 'export'}.csv`;
                      downloadCsv(csv, fileName);
                    }}
                  >
                    <Text style={styles.buttonText}>Export Incurred CSV</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]}
                  onPress={() => requestPageChange('ledger')}
                >
                  <Text style={styles.buttonText}>📒 Ledger</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.helperText}>Combined totals by category and user.</Text>
              <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
                <View style={styles.table}>
                  <View style={[styles.tableRow, styles.tableHeader]}>
                    <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                      <Text style={styles.headerText}>Category</Text>
                    </View>
                    {reportableMembers.map((m) => (
                      <View key={m.id} style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                        <Text style={styles.headerText}>{formatMemberName(m)}</Text>
                      </View>
                    ))}
                    <View style={[styles.cell, styles.lastCell, { minWidth: 120, flex: 1 }]}>
                      <Text style={styles.headerText}>Total</Text>
                    </View>
                  </View>
                  {costReportRows.map((row, idx, arr) => (
                    <View key={row.label} style={[styles.tableRow, idx === arr.length - 1 && styles.lastRow]}>
                      <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                        <Text style={styles.cellText}>{row.label}</Text>
                      </View>
                      {reportableMembers.map((m) => {
                        const share = row.shares[m.id] ?? 0;
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
                    {reportableMembers.map((m) => {
                      const total = ledgerPaidTotals[m.id] ?? 0;
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
            <AccountTab
              backendUrl={backendUrl}
              userToken={userToken}
              activePage={activePage}
              accountProfile={accountProfile}
              setAccountProfile={setAccountProfile}
              familyRelationships={familyRelationships}
              setFamilyRelationships={setFamilyRelationships}
              fellowTravelers={fellowTravelers}
              setFellowTravelers={setFellowTravelers}
              showRelationshipDropdown={showRelationshipDropdown}
              setShowRelationshipDropdown={setShowRelationshipDropdown}
              setUserToken={setUserToken}
              setUserName={setUserName}
              setUserEmail={setUserEmail}
              mapApp={mapApp}
              onChangeMapApp={updateMapPreference}
              saveSession={saveSession}
              headers={headers}
              jsonHeaders={jsonHeaders}
              logout={logout}
              styles={styles}
              traits={traits}
              setTraits={setTraits}
              selectedTraitNames={selectedTraitNames}
              setSelectedTraitNames={setSelectedTraitNames}
              traitAge={traitAge}
              setTraitAge={setTraitAge}
              traitGender={traitGender}
              setTraitGender={setTraitGender}
              newTraitName={newTraitName}
              setNewTraitName={setNewTraitName}
              fetchTraits={fetchTraits}
              fetchTraitProfile={fetchTraitProfile}
            />
          ) : null}

      {activePage === 'lodging' ? (
        <LodgingTab
          backendUrl={backendUrl}
          jsonHeaders={jsonHeaders}
          requestHeaders={headers}
          trip={findActiveTrip() ?? null}
          lodgings={lodgings}
          groupMembers={groupMembers}
          defaultPayerId={defaultPayerId}
          styles={styles}
          onRefreshLodgings={fetchLodgings}
          onOpenMap={openMaps}
          formatMemberName={formatMemberName}
          payerName={payerName}
        />
      ) : null}

      {activePage === 'car' ? (
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Car Rentals</Text>
          </View>
          <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeader]}>
                {['Pick Up Location', 'Pick Up Date', 'Drop Off Location', 'Drop Off Date', 'Reference', 'Vendor', 'Prepaid?', 'Cost', 'Car Model', 'Notes', 'For', 'Paid By', 'Actions'].map((label, idx, arr) => (
                  <View
                    key={label}
                    style={[styles.cell, { minWidth: 140, flex: 1 }, idx === arr.length - 1 && styles.lastCell]}
                  >
                    <Text style={styles.headerText}>{label}</Text>
                  </View>
                ))}
              </View>
              {carRentals.map((car) => (
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
                    <Text style={styles.cellText}>
                      {(car.travelerIds ?? []).length ? (car.travelerIds ?? []).map(payerName).join(', ') : '-'}
                    </Text>
                  </View>
                  <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                    <Text style={styles.cellText}>{car.paidBy.length ? car.paidBy.map(payerName).join(', ') : '-'}</Text>
                  </View>
                  <View style={[styles.cell, styles.actionCell, { minWidth: 160, flex: 1 }, styles.lastCell]}>
                    <TouchableOpacity style={[styles.smallButton, styles.dangerButton]} onPress={() => removeCarRental(car.id)}>
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
                    value={carDraft.pickupLocation}
                    onChangeText={(text) => setCarDraft((p) => ({ ...p, pickupLocation: text }))}
                  />
                </View>
                <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                  <View style={styles.dateInputWrap}>
                    {Platform.OS === 'web' ? (
                      <input
                        ref={carPickupDateRef as any}
                        type="date"
                        value={carDraft.pickupDate}
                        onChange={(e) => setCarDraft((p) => ({ ...p, pickupDate: e.target.value }))}
                        style={styles.input as any}
                      />
                    ) : (
                      <TouchableOpacity
                        style={[styles.input, styles.dateTouchable]}
                        onPress={() => openCarDatePicker('pickup')}
                      >
                        <Text style={styles.cellText}>{carDraft.pickupDate || 'YYYY-MM-DD'}</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.dateIcon}
                      onPress={() => openCarDatePicker('pickup')}
                    >
                      <Text style={styles.selectCaret}>📅</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                  <TextInput
                    style={styles.input}
                    placeholder="Drop off location"
                    value={carDraft.dropoffLocation}
                    onChangeText={(text) => setCarDraft((p) => ({ ...p, dropoffLocation: text }))}
                  />
                </View>
                <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                  <View style={styles.dateInputWrap}>
                    {Platform.OS === 'web' ? (
                      <input
                        ref={carDropoffDateRef as any}
                        type="date"
                        value={carDraft.dropoffDate}
                        onChange={(e) => setCarDraft((p) => ({ ...p, dropoffDate: e.target.value }))}
                        style={styles.input as any}
                      />
                    ) : (
                      <TouchableOpacity
                    style={[styles.input, styles.dateTouchable]}
                    onPress={() => openCarDatePicker('dropoff')}
                  >
                    <Text style={styles.cellText}>{carDraft.dropoffDate || 'YYYY-MM-DD'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.dateIcon}
                  onPress={() => openCarDatePicker('dropoff')}
                >
                  <Text style={styles.selectCaret}>📅</Text>
                </TouchableOpacity>
              </View>
            </View>
                <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                  <TextInput
                    style={styles.input}
                    placeholder="Reference"
                    value={carDraft.reference}
                    onChangeText={(text) => setCarDraft((p) => ({ ...p, reference: text }))}
                  />
                </View>
                <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                  <TextInput
                    style={styles.input}
                    placeholder="Vendor"
                    value={carDraft.vendor}
                    onChangeText={(text) => setCarDraft((p) => ({ ...p, vendor: text }))}
                  />
                </View>
                <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                  <View style={[styles.dropdown, { width: '100%' }]}>
                    <TouchableOpacity
                      style={[styles.input, styles.selectButtonRow]}
                      onPress={() => setCarPrepaidOpen((s) => !s)}
                    >
                      <Text style={styles.cellText}>{carDraft.prepaid || 'Select Yes/No'}</Text>
                      <Text style={styles.selectCaret}>▾</Text>
                    </TouchableOpacity>
                    {carPrepaidOpen ? (
                      <View style={[styles.dropdownList, { position: 'relative', top: 0 }]}>
                        {['Yes', 'No'].map((opt) => (
                          <TouchableOpacity
                            key={opt}
                            style={styles.dropdownOption}
                            onPress={() => {
                              setCarDraft((p) => ({ ...p, prepaid: opt }));
                              setCarPrepaidOpen(false);
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
                    value={carDraft.cost}
                    onChangeText={(text) => setCarDraft((p) => ({ ...p, cost: sanitizeCostInput(text) }))}
                  />
                </View>
                <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                  <TextInput
                    style={styles.input}
                    placeholder="Car model"
                    value={carDraft.model}
                    onChangeText={(text) => setCarDraft((p) => ({ ...p, model: text }))}
                  />
                </View>
                <View style={[styles.cell, { minWidth: 220, flex: 1 }]}>
                  <TextInput
                    style={[styles.input, styles.cellTextWrap]}
                    placeholder="Notes"
                    value={carDraft.notes}
                    onChangeText={(text) => setCarDraft((p) => ({ ...p, notes: text }))}
                    multiline
                  />
                </View>
                <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                  <View style={styles.payerChips}>
                    {carDraft.travelerIds.map((id) => (
                      <View key={`car-traveler-${id}`} style={styles.payerChip}>
                        <Text style={styles.cellText}>{payerName(id)}</Text>
                        <TouchableOpacity
                          onPress={() =>
                            setCarDraft((prev) => ({
                              ...prev,
                              travelerIds: prev.travelerIds.filter((x) => x !== id),
                            }))
                          }
                        >
                          <Text style={styles.removeText}>x</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                  <View style={styles.payerOptions}>
                    {userMembers
                      .filter((m) => !carDraft.travelerIds.includes(m.id))
                      .map((m) => (
                        <TouchableOpacity
                          key={`car-traveler-add-${m.id}`}
                          style={styles.smallButton}
                          onPress={() =>
                            setCarDraft((prev) => ({
                              ...prev,
                              travelerIds: [...prev.travelerIds, m.id],
                            }))
                          }
                        >
                          <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                        </TouchableOpacity>
                      ))}
                  </View>
                </View>
                <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                  <View style={styles.payerChips}>
                    {carDraft.paidBy.map((id) => (
                      <View key={id} style={styles.payerChip}>
                        <Text style={styles.cellText}>{payerName(id)}</Text>
                        <TouchableOpacity onPress={() => setCarDraft((prev) => ({ ...prev, paidBy: prev.paidBy.filter((x) => x !== id) }))}>
                          <Text style={styles.removeText}>x</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                  <View style={styles.payerOptions}>
                    {userMembers
                      .filter((m) => !carDraft.paidBy.includes(m.id))
                      .map((m) => (
                        <TouchableOpacity
                          key={m.id}
                          style={styles.smallButton}
                          onPress={() => setCarDraft((prev) => ({ ...prev, paidBy: [...prev.paidBy, m.id] }))}
                        >
                          <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                        </TouchableOpacity>
                      ))}
                  </View>
                </View>
                <View style={[styles.cell, styles.actionCell, { minWidth: 160, flex: 1 }, styles.lastCell]}>
                  <TouchableOpacity style={styles.button} onPress={addCarRental}>
                    <Text style={styles.buttonText}>Add</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      ) : null}

      {Platform.OS !== 'web' && carDateField && NativeDateTimePicker ? (
        <NativeDateTimePicker
          value={carDateValue}
          mode="date"
          onChange={(_, date) => {
            if (!date) {
              setCarDateField(null);
              return;
            }
            const iso = date.toISOString().slice(0, 10);
            applyCarDate(carDateField, iso);
            setCarDateField(null);
          }}
        />
      ) : null}

      
      {activePage === 'flights' || externalFlightEditId ? (
        <FlightsTab
          backendUrl={backendUrl}
          userToken={userToken}
          activeTripId={activeTripId}
          flights={flights}
          setFlights={setFlights}
          groupMembers={groupMembers}
          defaultPayerId={defaultPayerId}
          formatMemberName={formatMemberName}
          payerName={payerName}
          headers={headers}
          jsonHeaders={jsonHeaders}
          findActiveTrip={findActiveTrip}
          fetchGroupMembersForActiveTrip={fetchGroupMembersForActiveTrip}
          styles={styles}
          airportOptions={flightAirportOptions}
          onSearchAirports={fetchFlightAirports}
          externalEditFlightId={externalFlightEditId}
          onDataChanged={() => {
            fetchFlights();
            fetchExpenses();
          }}
          onExternalEditHandled={() => setExternalFlightEditId(null)}
          showList={activePage === 'flights'}
        />
      ) : null}
      {activePage === 'trips' ? (
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.sectionTitle}>Trips</Text>
                <TouchableOpacity
                  style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]}
                  onPress={() => requestPageChange('create-trip')}
                >
                  <Text style={styles.buttonText}>Open Wizard</Text>
                </TouchableOpacity>
              </View>
              {(() => {
                const inviteEmails = groups.flatMap((g) => (g.invites ?? []).map((inv) => inv.inviteeEmail));
                if (!inviteEmails.length) return null;
                return (
                  <View style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}>
                    <Text style={styles.helperText}>Pending invites:</Text>
                    {inviteEmails.map((email) => (
                      <View key={email} style={[styles.memberPill, { paddingHorizontal: 8, paddingVertical: 2 }]}>
                        <Text style={styles.cellText}>{email}</Text>
                      </View>
                    ))}
                  </View>
                );
              })()}
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
                      {(() => {
                        const group = groups.find((g) => g.id === trip.groupId);
                        const pending = group?.invites ?? [];
                        if (!pending.length) return null;
                        return (
                          <Text style={styles.helperText}>
                            Pending invites: {pending.map((p) => p.inviteeEmail).join(', ')}
                          </Text>
                        );
                      })()}
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
                    <TouchableOpacity
                      style={[styles.button, styles.smallButton]}
                      onPress={() => {
                        setSelectedTripId(trip.id);
                        requestPageChange('trip-details');
                      }}
                    >
                      <Text style={styles.buttonText}>View</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={() => deleteTrip(trip.id)}>
                      <Text style={styles.buttonText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {activePage === 'overview' ? (
            <OverviewTab
              backendUrl={backendUrl}
              headers={headers}
              jsonHeaders={jsonHeaders}
              trip={findActiveTrip() ?? null}
              group={groups.find((g) => g.id === findActiveTrip()?.groupId) ?? null}
              attendees={groupMembers}
              flights={flights}
              lodgings={lodgings}
              tours={tours}
              carRentals={carRentals}
              defaultPayerId={defaultPayerId}
              styles={styles}
              mapApp={mapApp}
              onOpenAddress={openMaps}
              onRefreshTrips={fetchTrips}
              onRefreshGroups={fetchGroups}
              onRefreshGroupMembers={fetchGroupMembersForActiveTrip}
              onFlightDataChanged={() => {
                fetchFlights();
                fetchExpenses();
              }}
              onLodgingDataChanged={() => {
                fetchLodgings();
                fetchExpenses();
              }}
              onTourDataChanged={() => {
                fetchTours();
                fetchExpenses();
              }}
              onAddCarRental={addCarRentalFromOverview}
              openFlightInFlightsTab={openFlightInFlightsTab}
              openLodgingDetails={openLodgingDetails}
            />
          ) : null}

      {activePage === 'trip-details' ? (
        <TripDetailsTab
          trip={trips.find((t) => t.id === selectedTripId) ?? null}
          group={groups.find((g) => g.id === trips.find((t) => t.id === selectedTripId)?.groupId) ?? null}
          styles={styles}
          onSetActive={(tripId) => setActiveTripId(tripId)}
          onOpenItinerary={(tripId) => {
            setActiveTripId(tripId);
            requestPageChange('itinerary');
          }}
          onUpdateCurrency={updateTripCurrency}
        />
      ) : null}

          {activePage === 'follow' ? (
            <FollowTab
              backendUrl={backendUrl}
              userToken={userToken}
              trips={trips}
              headers={headers}
              followInviteCode={followInviteCode}
              setFollowInviteCode={setFollowInviteCode}
              followLoading={followLoading}
              setFollowLoading={setFollowLoading}
              followError={followError}
              setFollowError={setFollowError}
              followedTrips={followedTrips}
              setFollowedTrips={setFollowedTrips}
              followCodes={followCodes}
              setFollowCodes={setFollowCodes}
              followCodeLoading={followCodeLoading}
              setFollowCodeLoading={setFollowCodeLoading}
              followCodeError={followCodeError}
              setFollowCodeError={setFollowCodeError}
              followCodePayloads={followCodePayloads}
              setFollowCodePayloads={setFollowCodePayloads}
              styles={styles}
              logout={logout}
            />
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
          {authMode === 'register' ? (
            <TextInput
              style={styles.input}
              placeholder="Confirm password"
              secureTextEntry
              value={authForm.passwordConfirm}
              onChangeText={(text) => setAuthForm((p) => ({ ...p, passwordConfirm: text }))}
            />
          ) : null}
                      <TouchableOpacity
                        style={styles.button}
                        onPress={authMode === 'login' ? loginWithPassword : register}
                      >
                        <Text style={styles.buttonText}>{authMode === 'login' ? 'Login' : 'Create account'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.button, { marginTop: 12, backgroundColor: '#4285F4' }]} onPress={loginWithGoogle}>
                        <Text style={styles.buttonText}>Sign in with Google</Text>
                      </TouchableOpacity>
                    </View>
                  )}
      {userToken && isTripWizardOpen ? (
        <View style={styles.wizardOverlay}>
          <View style={styles.wizardModal}>
            <CreateTripWizard
              backendUrl={backendUrl}
              userToken={userToken}
              headers={headers}
              traits={traits}
              airportOptions={flightAirportOptions}
              onSearchAirports={fetchFlightAirports}
              styles={styles}
              onCancel={closeTripWizard}
              onTripCreated={onTripCreated}
              onUnauthorized={logout}
              onWizardCarRentals={setCarRentals}
              currentUserName={userName}
              currentUserEmail={userEmail}
            />
          </View>
        </View>
      ) : null}
      {lodgingToDelete ? (
        <ConfirmDialog
          title="Delete Lodging"
          prompt={`Are you sure you want to delete ${lodgingToDelete.name}? This cannot be undone.`}
          onConfirm={() => {
            deleteLodging(lodgingToDelete.id);
            setLodgingToDelete(null);
          }}
          onCancel={() => setLodgingToDelete(null)}
          styles={styles}
        />
      ) : null}
      {showLodgingDetails && selectedLodging ? (
        <LodgingDetailsDialog
          visible={showLodgingDetails}
          lodging={selectedLodging}
          attendees={groupMembers}
          backendUrl={backendUrl}
          requestHeaders={headers}
          styles={styles}
          payerName={payerName}
          travelerName={payerName}
          onClose={() => setShowLodgingDetails(false)}
          onEdit={() => {
            if (!selectedLodging) return;
            setShowLodgingDetails(false);
            // openLodgingEditor(selectedLodging);
          }}
          onDelete={() => {
            if (selectedLodging) {
              setLodgingToDelete(selectedLodging);
            }
          }}
          onOpenMap={openMaps}
        />
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: '100%',
  },
  topBar: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderColor: '#d1d5db',
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  homeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  homeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  topRightWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contentScroll: {
    flex: 1,
    width: '100%',
  },
  contentScrollContent: {
    alignItems: 'center',
    padding: 16,
    gap: 16,
  },
  card: {
    width: '100%',
    maxWidth: 1200,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  homeScrollContent: {
    gap: 16,
  },
  homeTitle: {
    fontSize: 28,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  homeHeroCard: {
    position: 'relative',
    borderRadius: 20,
    overflow: 'hidden',
    height: 180,
    backgroundColor: '#e5e7eb',
  },
  homeHeroImage: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  homeHeroFallback: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: '#d1d5db',
  },
  homeHeroOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  homeHeroTextWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 20,
  },
  homeHeroSubtitle: {
    color: '#e5e7eb',
    fontSize: 16,
  },
  homeHeroTitle: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
  },
  homeNavList: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden',
  },
  homeNavButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  homeNavButtonDisabled: {
    opacity: 0.5,
  },
  homeNavIcon: {
    width: 24,
    textAlign: 'center',
    fontSize: 18,
  },
  homeNavLabel: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
  },
  homeNavArrow: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '600',
  },
  homeModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#f8fafc',
    zIndex: 30000,
    padding: 16,
  },
  homeModalCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 16,
  },
  homeModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  homeModalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  homeModalClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeModalCloseText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  homeModalList: {
    flex: 1,
  },
  homeModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
  },
  homeModalRowActive: {
    backgroundColor: '#f1f5f9',
  },
  homeModalRowText: {
    flex: 1,
  },
  homeModalRowTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  homeModalRowMeta: {
    color: '#6b7280',
    fontSize: 13,
  },
  homeModalActiveBadge: {
    color: '#047857',
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  auth: {
    width: '100%',
    maxWidth: 420,
    marginTop: 40,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  toggleButton: {
    flex: 1,
    padding: 10,
    borderBottomWidth: 2,
    borderColor: '#d1d5db',
  },
  toggleActive: {
    borderColor: '#0d6efd',
  },
  toggleText: {
    textAlign: 'center',
    fontWeight: '600',
    color: '#6b7280',
  },
  toggleGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    position: 'relative',
    zIndex: 1,
  },
  expenseToggleButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#111',
    backgroundColor: '#fff',
  },
  expenseToggleSelected: {
    backgroundColor: '#e5e7eb',
    borderColor: '#111',
  },
  expenseToggleUnselected: {
    backgroundColor: '#fff',
    borderColor: '#111',
  },
  expenseToggleText: {
    fontWeight: '600',
    color: '#111',
  },
  expenseToggleTextSelected: {
    color: '#111',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
    width: '100%',
  },
  button: {
    backgroundColor: '#0d6efd',
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  smallButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dangerButton: {
    backgroundColor: '#dc3545',
  },
  navRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  navButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#e9ecef',
  },
  navButtonActive: {
    backgroundColor: '#0d6efd',
  },
  navButtonText: {
    color: '#000',
    fontWeight: '600',
  },
  navButtonActiveText: {
    color: '#fff',
  },
  section: {
    width: '100%',
    maxWidth: 1200,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  helperText: {
    color: '#6b7280',
    marginBottom: 8,
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
    flexWrap: 'wrap',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
    gap: 8,
  },
  groupRowLast: {
    borderBottomWidth: 0,
  },
  table: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#dee2e6',
    borderRadius: 6,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#dee2e6',
  },
  tableHeaderRow: {
    backgroundColor: '#f8f9fa',
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  tableHeader: {
    backgroundColor: '#f8f9fa',
  },
  cell: {
    padding: 8,
    borderRightWidth: 1,
    borderColor: '#dee2e6',
  },
  tableHeaderCell: {
    padding: 8,
    borderRightWidth: 1,
    borderColor: '#dee2e6',
  },
  tableCell: {
    padding: 8,
    borderRightWidth: 1,
    borderColor: '#dee2e6',
  },
  lastCell: {
    borderRightWidth: 0,
  },
  headerText: {
    fontWeight: 'bold',
  },
  cellText: {
    flexWrap: 'wrap',
  },
  actionCell: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  tableActionButton: {
    minWidth: 72,
    height: 32,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  tableActionButtonPrimary: {
    backgroundColor: '#2563eb',
  },
  tableActionButtonDanger: {
    backgroundColor: '#dc2626',
  },
  tableNameButton: {
    alignSelf: 'flex-start',
  },
  roundButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bodyText: {
    fontSize: 14,
  },
  flightsSection: {
    gap: 12,
  },
  flightsList: {
    gap: 8,
  },
  flightCard: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  flightTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  attendeeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  attendeeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e9ecef',
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 10,
    gap: 6,
  },
  attendeeChipRemoving: {
    backgroundColor: '#f8d7da',
  },
  attendeeChipPending: {
    backgroundColor: '#fff3cd',
  },
  attendeeText: {
    fontWeight: '600',
  },
  attendeeRemoveButton: {
    marginLeft: 4,
  },
  attendeeRemoveText: {
    color: '#dc3545',
    fontWeight: 'bold',
  },
  addTravelerForm: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    gap: 8,
  },
  flightEditorWrap: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    marginVertical: 4,
  },
  flightRow: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 12,
  },
  dayPill: {
    backgroundColor: '#e5e7eb',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 8,
  },
  dayPillActive: {
    backgroundColor: '#111827',
  },
  dayPillText: {
    fontWeight: '600',
  },
  dayPillActiveText: {
    color: '#fff',
  },
  dayPillNumber: {
    fontWeight: '800',
    color: '#111827',
    fontSize: 13,
  },
  dayPillDate: {
    color: '#4b5563',
    fontSize: 13,
  },
  dayHeroCard: {
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayHeroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  dayHeroImageFallback: {
    flex: 1,
    backgroundColor: '#e5e7eb',
  },
  dayHeroOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  dayHeroBadge: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  dayHeroBadgeText: {
    backgroundColor: '#fff',
    color: '#111827',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 999,
    fontWeight: '700',
    fontSize: 12,
    overflow: 'hidden',
  },
  dayHeroTextWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  dayHeroTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  dayHeroAction: {
    color: '#fff',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  dayDetailsBackButton: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 10,
    backgroundColor: '#111827',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  dayDetailsBackText: {
    color: '#fff',
    fontWeight: '600',
  },
  dayNarrativeBox: {
    gap: 8,
  },
  dayInfoCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 8,
  },
  dayInfoRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 6,
  },
  dayInfoText: {
    flex: 1,
  },
  lodgingImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
  },
  lodgingImageFallback: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayInfoRoute: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  dayInfoButton: {
    alignSelf: 'center',
    paddingVertical: 6,
  },
  dayInfoButtonText: {
    color: '#111827',
    fontWeight: '600',
  },
  dayNextButton: {
    backgroundColor: '#e5e7eb',
    borderRadius: 16,
    padding: 12,
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
  lodgingNameCol: { minWidth: 120, maxWidth: 320, flex: 1 },
  lodgingDateCol: { minWidth: 120, maxWidth: 320, flex: 1 },
  lodgingRoomsCol: { minWidth: 80, maxWidth: 320, flex: 1 },
  lodgingRefundCol: { minWidth: 120, maxWidth: 320, flex: 1 },
  lodgingCostCol: { minWidth: 100, maxWidth: 320, flex: 1 },
  lodgingPayerCol: { minWidth: 140, maxWidth: 320, flex: 1 },
  lodgingAddressCol: { minWidth: 140, maxWidth: 320, flex: 1 },
  lodgingActionCol: { minWidth: 140, maxWidth: 320, flex: 1 },
  lodgingTabNameCol: { flex: 1, minWidth: 160 },
  lodgingTabDateCol: { flexGrow: 0, flexShrink: 0, minWidth: 110 },
  lodgingTabActionsCol: { flexGrow: 0, flexShrink: 0, minWidth: 168 },
  cellTextWrap: {
    flexWrap: 'wrap',
    whiteSpace: 'normal',
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
    zIndex: 20,
  },
  selectButton: {
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  placeholderText: {
    color: '#9ca3af',
  },
  selectCaret: {
    color: '#6b7280',
    fontSize: 12,
    marginLeft: 8,
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
    zIndex: 20000,
    elevation: 24,
  },
  dropdownOption: {
    padding: 10,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  dateInputWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  dateIcon: {
    position: 'absolute',
    right: 8,
    top: 10,
    padding: 6,
    zIndex: 2,
  },
  dateTouchable: {
    justifyContent: 'center',
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
  expenseModalCard: {
    maxWidth: 760,
    maxHeight: 640,
    overflow: 'visible',
  },
  expenseModalScroll: {
    maxHeight: 520,
    marginBottom: 8,
    overflow: 'visible',
  },
  detailModal: {
    maxHeight: 520,
    maxWidth: 520,
    width: '100%',
  },
  expenseFieldRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    position: 'relative',
    zIndex: 10,
  },
  expenseFieldDate: {
    minWidth: 160,
    flexGrow: 1,
    flexBasis: 160,
    zIndex: 1,
  },
  expenseFieldCategory: {
    minWidth: 150,
    flexGrow: 1,
    flexBasis: 150,
    zIndex: 3,
  },
  expenseFieldCurrency: {
    minWidth: 110,
    flexGrow: 0,
    flexBasis: 110,
    zIndex: 2,
  },
  expenseFieldAmount: {
    minWidth: 120,
    flexGrow: 0,
    flexBasis: 120,
  },
  detailModalScroll: {
    maxHeight: 420,
    marginBottom: 8,
  },
  detailSection: {
    marginTop: 8,
    gap: 4,
  },
  detailActionsRow: {
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
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
    flexWrap: 'wrap',
  },
  modalField: {
    flex: 1,
    position: 'relative',
    minWidth: 200,
    maxWidth: '100%',
    flexBasis: 0,
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
    elevation: 40, // keep above other inputs on native
    boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
  },
  locationField: {
    position: 'relative',
  },
  tableScroll: {
    overflow: 'visible',
  },
  tableScrollContent: {
    overflow: 'visible',
  },  rangeContainer: {
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
  dropdownOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.98)',
    zIndex: 40000,
    elevation: 40,
  },
  dropdownBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  dropdownPortal: {
    position: 'absolute',
    top: 80,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 8,
    maxHeight: 360,
    zIndex: 41000,
    boxShadow: '0 6px 10px rgba(0,0,0,0.2)',
    elevation: 60,
  },
  dropdownScroll: {
    maxHeight: 300,
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
  attendeeChipContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: '#e0e0e0',
  },
  badgePending: {
    backgroundColor: '#f6c851',
  },
  badgeRemoved: {
    backgroundColor: '#c7c7c7',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2b2b2b',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  wizardOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,23,42,0.55)',
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 30000,
  },
  wizardModal: {
    width: '100%',
    maxWidth: 1200,
    maxHeight: '90%',
    alignSelf: 'center',
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
    boxShadow: '0 4px 10px rgba(0,0,0,0.25)',
  },
});

export default App;
