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
import { Image, Linking, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useColorScheme, useWindowDimensions } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { formatDateLong } from './utils/formatDateLong';
import { normalizeDateString } from './utils/normalizeDateString';
import { sanitizeCostInput } from './utils/sanitizeCost';
import { initializeAppCheck } from './utils/firebaseAppCheck';
import { FlightsTab, type Flight, fetchFlightsForTrip } from './tabs/transfers';
import { type Tour, ActivityTab, fetchActivitiesForTrip } from './tabs/activities';
import { type Trait } from './tabs/traits';
import { FollowTab, fetchFollowedTripsApi, loadFollowCodes, loadFollowPayloads, saveFollowCodes, saveFollowPayloads, type FollowedTrip } from './tabs/follow';
import FollowingTab from './tabs/following';
import ItinerariesTab from './tabs/itineraries';
import HomeTab from './tabs/HomeTab';
import DailyExpensesTab from './tabs/dailyExpenses';
import LedgerTab from './tabs/ledger';
import IngestionTab from './tabs/ingestion';
import OverviewTab from './tabs/overview';
import CreateTripWizard from './tabs/createTripWizard';
import { buildAllExpenses, calculateAllTotals, type UnifiedExpense, computePayerTotals } from './utils/costs';
import { rollUpTotals, validateCoveringRules } from './utils/coveredBy';
import TripDetailsTab from './tabs/tripDetails';
import AccountTab, { fetchAccountProfile, fetchFamilyRelationships, fetchFellowTravelers, type FellowTraveler } from './tabs/account';
import { CarRental, CarRentalDraft, buildCarRentalFromDraft, createInitialCarRentalDraft, fetchCarRentalsForTrip } from './tabs/carRentals';
import {
  DEFAULT_NEW_ITINERARY_STATUS,
  ITINERARY_STATUSES,
  LEGACY_ITINERARY_STATUS,
  normalizeItineraryStatus,
} from './utils/itineraryStatus';
import { Lodging, fetchLodgingsApi } from './tabs/lodging';
import { InvitePayload } from './utils/inviteCodes';
import { type MapApp, buildMapUrl, loadStoredMapPreference, persistMapPreference } from './utils/mapLinks';
import {
  type AppearancePreference,
  loadStoredAppearancePreference,
  persistAppearancePreference,
} from './utils/appearancePreference';
import { getAppTheme, type AppTheme } from './theme/theme';
import { FOLLOWED_TRIP_HIDDEN_PAGES, shouldAllowPageChange, shouldDisableTab } from './utils/wizardGuard';
import * as WebBrowser from 'expo-web-browser';
import { Buffer } from 'buffer';
import { loadSession, saveSession, clearSession } from './utils/session';
import LodgingDetailsDialog from './components/LodgingDetailsDialog';
import ConfirmDialog from './components/ConfirmDialog';
import { toWebStyle } from './utils/webStyle';
import { formatNetVotes, shouldShowRatingButtons, shouldShowVoteButtons } from './utils/votes';

import LodgingTab from './tabs/LodgingTab';
import AdminTab from './tabs/AdminTab';
import PresenceAvatars from './components/PresenceAvatars';
import ChatButton from './components/ChatButton';
import ChatPanel from './components/ChatPanel';
import {
  connectSocket,
  disconnectSocket,
  getSocket,
  CLIENT_EVENTS,
  SERVER_EVENTS,
} from './utils/socket';
import type { PresenceUser } from '../packages/messaging/src/types';

const TOP_BANNER_ICON = require('./assets/wanderbunnies-reference.png');

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
  groupName?: string | null;
  inviterEmail?: string | null;
  inviterFirstName?: string | null;
  inviterLastName?: string | null;
  inviteeEmail?: string | null;
  status?: 'pending' | 'accepted';
  createdAt?: string;
  tripId?: string | null;
  resolvedTripId?: string | null;
  resolvedTripName?: string | null;
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
  locationIds?: string[];
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

type AsyncItineraryTracker = {
  jobId: string;
  status: 'pending' | 'failed';
  error?: string;
};

interface GroupMemberOption {
  id: string;
  guestName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  status?: 'active' | 'pending' | 'removed';
  removedAt?: string | null;
}

const formatMemberName = (member: GroupMemberOption): string => {
  const norm = (val?: string | null) => {
    const t = String(val ?? '').trim();
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

type Page =
  | 'home'
  | 'overview'
  | 'flights'
  | 'lodging'
  | 'car'
  | 'tours'
  | 'expenses'
  | 'ledger'
  | 'ingest'
  | 'trips'
  | 'create-trip'
  | 'trip-details'
  | 'itinerary'
  | 'cost'
  | 'account'
  | 'follow'
  | 'following'
  | 'admin';

type AdminSectionRoute = 'overview' | 'users' | 'tiers' | 'features' | 'user-data' | 'audit-log' | 'ingestion' | 'api-limits';

type RootStackParamList = {
  Main: undefined;
  AdminOverview: undefined;
  AdminUsers: undefined;
  AdminTiers: undefined;
  AdminFeatures: undefined;
  AdminUserData: undefined;
  AdminAuditLog: undefined;
};

const RootStack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

const adminScreenBySection: Partial<Record<AdminSectionRoute, keyof RootStackParamList>> = {
  overview: 'AdminOverview',
  users: 'AdminUsers',
  tiers: 'AdminTiers',
  features: 'AdminFeatures',
  'user-data': 'AdminUserData',
  'audit-log': 'AdminAuditLog',
  // 'ingestion' and 'api-limits' are handled internally by AdminTab, no separate screen needed
};

const adminSectionByScreen: Record<Exclude<keyof RootStackParamList, 'Main'>, AdminSectionRoute> = {
  AdminOverview: 'overview',
  AdminUsers: 'users',
  AdminTiers: 'tiers',
  AdminFeatures: 'features',
  AdminUserData: 'user-data',
  AdminAuditLog: 'audit-log',
};

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [
    'wanderbunnies://',
    ...(Platform.OS === 'web' && typeof window !== 'undefined' ? [window.location.origin] : []),
  ],
  config: {
    screens: {
      Main: '',
      AdminOverview: 'admin',
      AdminUsers: 'admin/users',
      AdminTiers: 'admin/tiers',
      AdminFeatures: 'admin/features',
      AdminUserData: 'admin/user-data',
      AdminAuditLog: 'admin/audit-log',
    },
  },
};

// Resolve backend URL; keep Expo web on localhost hitting the local API over HTTP to avoid HTTPS upgrades/CORS issues.
const resolveBackendUrl = (): string => {
  const envConfigured =
    (typeof process !== 'undefined' &&
      (process.env.EXPO_PUBLIC_BACKEND_URL ??
        process.env.API_BASE_URL ??
        process.env.REACT_APP_BACKEND_URL ??
        process.env.REACT_NATIVE_APP_BACKEND_URL ??
        process.env.BACKEND_URL)) ||
    '';
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
  const remapLocalBackendHost = (raw: string, browserHostname: string): string => {
    const normalized = normalizeBackendUrl(raw, 'http');
    try {
      const parsed = new URL(normalized);
      if (!isLocalHost(parsed.hostname) || !isLocalHost(browserHostname)) {
        return normalized;
      }
      parsed.hostname = browserHostname;
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return normalized;
    }
  };
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const { hostname, protocol, port, origin } = window.location;
    if (isLocalHost(hostname)) {
      if (port === '4000') {
        return origin.replace(/\/$/, '');
      }
      if (configuredBackend) {
        return remapLocalBackendHost(configuredBackend, hostname);
      }
      return `${protocol}//${hostname}:4000`;
    }
  }
  if (process.env.NODE_ENV === 'development') {
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

const mapAuthErrorToMessage = (authError: string | null): string | null => {
  switch (authError) {
    case 'google_callback_failed':
      return 'Google sign-in could not be completed. Please try again.';
    case 'google_login_failed':
      return 'Google sign-in did not return a user account. Please try again.';
    case 'google_post_login_failed':
      return 'Google sign-in succeeded, but your account could not be finished on the server. Please try again.';
    default:
      return authError ? 'Sign-in failed. Please try again.' : null;
  }
};

// Capture auth params from the initial URL immediately, before React Navigation
// can process and strip them via history.replaceState during mount.
// Mutable so it can be consumed once and cleared.
let _capturedInitialAuthParams: {
  token: string | null;
  authError: string | null;
  requirePasswordSetup: boolean;
  isConfirm: boolean;
  isSecondaryConfirm: boolean;
  rawUrl: string;
} | null = (() => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('token');
    const authError = url.searchParams.get('auth_error');
    if (!token && !authError) return null;
    return {
      token,
      authError,
      requirePasswordSetup: url.searchParams.get('require_password_setup') === '1',
      isConfirm: url.pathname.endsWith('/confirm'),
      isSecondaryConfirm: url.pathname.endsWith('/confirm-email'),
      rawUrl: window.location.href,
    };
  } catch {
    return null;
  }
})();

const pendingFollowCodeStorageKey = 'stp.pendingFollowCode';

const extractFollowCodeFromUrl = (rawUrl: string): string | null => {
  try {
    const url = new URL(rawUrl);
    const followCode = url.searchParams.get('followCode');
    return followCode ? followCode.trim() : null;
  } catch {
    return null;
  }
};

let _capturedInitialFollowCode: string | null = (() => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  return extractFollowCodeFromUrl(window.location.href);
})();

const extractTokenFromUrl = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);
    const token = url.searchParams.get('token');
    const authError = url.searchParams.get('auth_error');
    const requirePasswordSetup = url.searchParams.get('require_password_setup') === '1';
    const isConfirm = url.pathname.endsWith('/confirm');
    const isSecondaryConfirm = url.pathname.endsWith('/confirm-email');
    if (token) {
      return { token, authError, url, source: 'query' as const, isConfirm, isSecondaryConfirm, requirePasswordSetup };
    }
    if (authError) {
      return { token: null, authError, url, source: 'query' as const, isConfirm, isSecondaryConfirm, requirePasswordSetup };
    }
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    if (hash) {
      const hashParams = new URLSearchParams(hash);
      const hashToken = hashParams.get('token');
      if (hashToken) {
        return { token: hashToken, authError: null, url, source: 'hash' as const, isConfirm, isSecondaryConfirm, requirePasswordSetup };
      }
    }
  } catch (e) {
    // ignore invalid URLs
  }
  return { token: null, authError: null, url: null, source: null, isConfirm: false, isSecondaryConfirm: false, requirePasswordSetup: false } as const;
};

const decodeTokenClaims = (
  token: string
): { firstName?: string; lastName?: string; email?: string; provider?: string; role?: string } | null => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString());
  } catch {
    return null;
  }
};

type AppShellProps = {
  initialAdminSection?: AdminSectionRoute;
  onOpenAdminSection?: (section: AdminSectionRoute) => void;
};

const AppShell: React.FC<AppShellProps> = ({ initialAdminSection = 'overview', onOpenAdminSection }) => {
  const { width: viewportWidth } = useWindowDimensions();
  const systemColorScheme = useColorScheme();
  const isNarrowLayout = viewportWidth < 980;
  const isPhoneLayout = viewportWidth < 680;
  const isWebIOSSafari = useMemo(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const isIOS =
      /iP(hone|ad|od)/i.test(ua) ||
      ((navigator as any).platform === 'MacIntel' && Number((navigator as any).maxTouchPoints || 0) > 1);
    const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/i.test(ua);
    return isIOS && isSafari;
  }, []);
  const [webViewportHeight, setWebViewportHeight] = useState<number | null>(null);

  useEffect(() => {
    initializeAppCheck();
  }, []);

  useEffect(() => {
    if (!isWebIOSSafari || typeof window === 'undefined') return;
    const updateViewport = () => {
      const vv = window.visualViewport;
      const next = Math.round(vv?.height ?? window.innerHeight ?? 0);
      if (next > 0) setWebViewportHeight(next);
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('scroll', updateViewport);
    return () => {
      window.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('scroll', updateViewport);
    };
  }, [isWebIOSSafari]);

  const iosSafariSafeAreaStyle = useMemo(
    () =>
      isWebIOSSafari
        ? ({
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            minHeight: webViewportHeight ? `${webViewportHeight}px` : '100dvh',
          } as any)
        : null,
    [isWebIOSSafari, webViewportHeight]
  );

  const iosSafariContentInsetStyle = useMemo(
    () =>
      isWebIOSSafari
        ? ({
            paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
          } as any)
        : null,
    [isWebIOSSafari]
  );

  const [userToken, setUserToken] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInFlightRef = useRef(false);
  const autoRedeemedFollowCodeRef = useRef<string | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [externalFlightEditId, setExternalFlightEditId] = useState<string | null>(null);
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [pendingInviteModalOpen, setPendingInviteModalOpen] = useState(false);
  const [invitesLoaded, setInvitesLoaded] = useState(false);
  const [deferFirstLoginRedirect, setDeferFirstLoginRedirect] = useState(false);
  const [showResendConfirmation, setShowResendConfirmation] = useState(false);
  const [resendConfirmationLoading, setResendConfirmationLoading] = useState(false);
  const [requirePasswordSetup, setRequirePasswordSetup] = useState(false);
  const [passwordSetupLoading, setPasswordSetupLoading] = useState(false);
  const [passwordSetupForm, setPasswordSetupForm] = useState({ newPassword: '', newPasswordConfirm: '' });
  const [isFirstLogin, setIsFirstLogin] = useState(false);
  const [emailConfirmationMessage, setEmailConfirmationMessage] = useState<string | null>(null);
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
  const [followInviteCode, setFollowInviteCode] = useState('');
  const [followLoading, setFollowLoading] = useState(false);
  const [followError, setFollowError] = useState('');
  const [followedTrips, setFollowedTrips] = useState<FollowedTrip[]>([]);
  const [followCodes, setFollowCodes] = useState<Record<string, string>>({});
  const [followCodeLoading, setFollowCodeLoading] = useState<Record<string, boolean>>({});
  const [followCodeError, setFollowCodeError] = useState<string | null>(null);
  const [followCodePayloads, setFollowCodePayloads] = useState<Record<string, InvitePayload>>({});
  const [pendingFollowCode, setPendingFollowCode] = useState<string | null>(null);
  const [selectedFollowedTripId, setSelectedFollowedTripId] = useState<string | null>(null);
  const [selectedFollowedTripDetails, setSelectedFollowedTripDetails] = useState<Trip | null>(null);
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
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'user' | 'admin'>('user');
  const [showActiveTripDropdown, setShowActiveTripDropdown] = useState(false);
  const [openShareFromHeaderSignal, setOpenShareFromHeaderSignal] = useState(0);
  const [groupMembers, setGroupMembers] = useState<GroupMemberOption[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [lodgings, setLodgings] = useState<Lodging[]>([]);
  const [selectedLodging, setSelectedLodging] = useState<Lodging | null>(null);
  const [showLodgingDetails, setShowLodgingDetails] = useState(false);
  const [lodgingToDelete, setLodgingToDelete] = useState<Lodging | null>(null);

  // Socket.IO / presence / chat
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);

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
  const [accountProfile, setAccountProfile] = useState({
    firstName: '',
    lastName: '',
    email: '',
    homeAddress: '',
    preferredAirport: '',
    appearancePreference: 'auto' as AppearancePreference,
  });
  const [mapApp, setMapApp] = useState<MapApp>(() => loadStoredMapPreference('google'));
  const [appearancePreference, setAppearancePreference] = useState<AppearancePreference>(() =>
    loadStoredAppearancePreference('auto')
  );
  const theme = useMemo(() => getAppTheme(appearancePreference, systemColorScheme), [appearancePreference, systemColorScheme]);
  const styles = useMemo(() => buildStyles(theme), [theme]);
  const [familyRelationships, setFamilyRelationships] = useState<any[]>([]);
  const [coveredBy, setCoveredBy] = useState<Record<string, string>>({});
  const [fellowTravelers, setFellowTravelers] = useState<FellowTraveler[]>([]);
  const [showRelationshipDropdown, setShowRelationshipDropdown] = useState(false);
  const [asyncItineraryByTrip, setAsyncItineraryByTrip] = useState<Record<string, AsyncItineraryTracker>>({});

  const headers = useMemo<Record<string, string>>(
    () => (userToken ? { Authorization: `Bearer ${userToken}` } : ({} as Record<string, string>)),
    [userToken]
  );
  const jsonHeaders = useMemo<Record<string, string>>(
    () => ({ 'Content-Type': 'application/json', ...(userToken ? { Authorization: `Bearer ${userToken}` } : {}) }),
    [userToken]
  );

  const userMembers = useMemo(
    () => groupMembers.filter((m) => !m.guestName && m.status !== 'removed'),
    [groupMembers]
  );

  const memberIds = useMemo(() => userMembers.map((m) => m.id), [userMembers]);

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

  const updateAppearancePreference = useCallback(
    (pref: AppearancePreference) => {
      setAppearancePreference(pref);
      persistAppearancePreference(pref);
      setAccountProfile((prev) => ({ ...prev, appearancePreference: pref }));
    },
    [setAccountProfile]
  );

  const activeTrip = useMemo(() => trips.find((t) => t.id === activeTripId) ?? null, [trips, activeTripId]);
  const tripById = useMemo(() => new Map(trips.map((trip) => [trip.id, trip] as const)), [trips]);
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group] as const)), [groups]);
  const followedTripById = useMemo(
    () => new Map(followedTrips.map((trip) => [trip.tripId, trip] as const)),
    [followedTrips]
  );
  const activeGroup = useMemo(
    () => (activeTrip?.groupId ? groupById.get(activeTrip.groupId) ?? null : null),
    [activeTrip?.groupId, groupById]
  );
  const selectedTrip = useMemo(
    () => (selectedTripId ? tripById.get(selectedTripId) ?? null : null),
    [selectedTripId, tripById]
  );
  const selectedTripGroup = useMemo(
    () => (selectedTrip?.groupId ? groupById.get(selectedTrip.groupId) ?? null : null),
    [selectedTrip?.groupId, groupById]
  );
  const selectedFollowedTrip = useMemo(
    () => (selectedFollowedTripId ? followedTripById.get(selectedFollowedTripId) ?? null : null),
    [followedTripById, selectedFollowedTripId]
  );
  const isFollowingMode = Boolean(selectedFollowedTripId);
  const followedTripFallback = useMemo<Trip | null>(
    () =>
      selectedFollowedTrip
        ? {
            id: selectedFollowedTrip.tripId,
            groupId: '',
            groupName: '',
            name: selectedFollowedTrip.tripName,
            destination: selectedFollowedTrip.destination ?? selectedFollowedTrip.tripName,
            startDate: null,
            endDate: null,
            durationDays: null,
            createdAt: '',
          }
        : null,
    [selectedFollowedTrip]
  );
  const activeTripForHome = selectedFollowedTripDetails ?? followedTripFallback;
  const activeTripSelectorLabel = useMemo(() => {
    if (isFollowingMode && selectedFollowedTrip?.tripName) {
      return `${selectedFollowedTrip.tripName} (Following)`;
    }
    return activeTrip?.name ?? 'Select';
  }, [activeTrip?.name, isFollowingMode, selectedFollowedTrip?.tripName]);

  const isTripWizardOpen = activePage === 'create-trip';
  const requestPageChange = useCallback((page: Page, opts?: { skipHistory?: boolean }) => {
    if (!shouldAllowPageChange(activePage, page, { isFollowedTrip: isFollowingMode })) return;
    if (page === activePage) return;
    setPageForwardHistory([]);
    if (!opts?.skipHistory) {
      setPageHistory((prev) => {
        const next = [...prev, activePage];
        return next.slice(-25);
      });
    }
    setActivePage(page);
  }, [activePage, isFollowingMode]);

  const handleSelectOwnedTrip = useCallback((tripId: string) => {
    setSelectedFollowedTripId(null);
    setActiveTripId(tripId);
  }, []);

  const handleSelectFollowedTrip = useCallback((tripId: string) => {
    setActiveTripId(tripId);
    setSelectedFollowedTripId(tripId);
    setShowActiveTripDropdown(false);
    requestPageChange('home');
  }, [requestPageChange]);

  const openAdminSection = useCallback((section: AdminSectionRoute = initialAdminSection) => {
    if (userRole !== 'admin') return;
    onOpenAdminSection?.(section);
  }, [initialAdminSection, onOpenAdminSection, userRole]);

  useEffect(() => {
    if (!navigationRef.isReady()) return;
    const routeName = navigationRef.getCurrentRoute()?.name;
    if (userRole !== 'admin' && routeName && routeName !== 'Main') {
      navigationRef.navigate('Main');
    }
  }, [userRole]);

  const openMaps = useCallback((address: string) => {
    const url = buildMapUrl(address, mapApp);
    if (!url) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  }, [mapApp]);

  const openFlightInFlightsTab = useCallback((flightId: string) => {
    setExternalFlightEditId(flightId);
  }, []);

  const applyCarDate = useCallback((field: 'pickup' | 'dropoff', value: string) => {
    setCarDraft((prev) => ({ ...prev, [field === 'pickup' ? 'pickupDate' : 'dropoffDate']: value }));
  }, []);

  const addCarRental = useCallback(async () => {
    if (isFollowingMode) return;
    if (!activeTripId) {
      alert('Select an active trip before adding a car rental.');
      return;
    }
    const result = buildCarRentalFromDraft(carDraft, defaultPayerId, memberIds);
    if (result.error || !result.rental) {
      alert(result.error || 'Unable to add car rental.');
      return;
    }
    const res = await fetch(`${backendUrl}/api/car-rentals`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        ...result.rental,
        tripId: activeTripId,
        cost: Number(result.rental.cost) || 0,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to add car rental.');
      return;
    }
    if (activeTripId && userToken) {
      const expRes = await fetch(`${backendUrl}/api/expenses?tripId=${activeTripId}`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      if (expRes.ok) {
        const expData = await expRes.json().catch(() => []);
        setExpenses(Array.isArray(expData) ? expData : []);
      }
    }
    if (activeTripId && userToken) {
      const cars = await fetchCarRentalsForTrip({ backendUrl, activeTripId, token: userToken });
      setCarRentals(cars);
    }
    setCarDraft(createInitialCarRentalDraft());
  }, [activeTripId, carDraft, defaultPayerId, memberIds, backendUrl, jsonHeaders, userToken, isFollowingMode]);

  const addCarRentalFromOverview = useCallback(async (rental: CarRental) => {
    if (isFollowingMode) return;
    if (!activeTripId) {
      alert('Select an active trip before adding a car rental.');
      return;
    }
    const res = await fetch(`${backendUrl}/api/car-rentals`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        ...rental,
        tripId: activeTripId,
        status: normalizeItineraryStatus((rental as any).status, DEFAULT_NEW_ITINERARY_STATUS),
        cost: Number(rental.cost) || 0,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to add car rental.');
      return;
    }
    if (activeTripId && userToken) {
      const expRes = await fetch(`${backendUrl}/api/expenses?tripId=${activeTripId}`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      if (expRes.ok) {
        const expData = await expRes.json().catch(() => []);
        setExpenses(Array.isArray(expData) ? expData : []);
      }
    }
    if (activeTripId && userToken) {
      const cars = await fetchCarRentalsForTrip({ backendUrl, activeTripId, token: userToken });
      setCarRentals(cars);
    }
  }, [activeTripId, backendUrl, jsonHeaders, userToken, isFollowingMode]);

  const removeCarRental = useCallback(async (id: string) => {
    if (isFollowingMode) return;
    const res = await fetch(`${backendUrl}/api/car-rentals/${id}`, { method: 'DELETE', headers: jsonHeaders });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to delete car rental.');
      return;
    }
    if (activeTripId && userToken) {
      const expRes = await fetch(`${backendUrl}/api/expenses?tripId=${activeTripId}`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      if (expRes.ok) {
        const expData = await expRes.json().catch(() => []);
        setExpenses(Array.isArray(expData) ? expData : []);
      }
    }
    if (activeTripId && userToken) {
      const cars = await fetchCarRentalsForTrip({ backendUrl, activeTripId, token: userToken });
      setCarRentals(cars);
    }
  }, [backendUrl, jsonHeaders, activeTripId, userToken, isFollowingMode]);

  const voteOnCarRental = useCallback(async (id: string, value: 1 | -1) => {
    if (isFollowingMode) return;
    const res = await fetch(`${backendUrl}/api/car-rentals/${id}/vote`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to submit vote');
      return;
    }
    if (activeTripId && userToken) {
      const cars = await fetchCarRentalsForTrip({ backendUrl, activeTripId, token: userToken });
      setCarRentals(cars);
    }
  }, [backendUrl, jsonHeaders, activeTripId, userToken, isFollowingMode]);

  const rateOnCarRental = useCallback(async (id: string, value: 1 | -1) => {
    if (isFollowingMode) return;
    const res = await fetch(`${backendUrl}/api/car-rentals/${id}/rating`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to submit rating');
      return;
    }
    if (activeTripId && userToken) {
      const cars = await fetchCarRentalsForTrip({ backendUrl, activeTripId, token: userToken });
      setCarRentals(cars);
    }
  }, [backendUrl, jsonHeaders, activeTripId, userToken, isFollowingMode]);

  const openCarDatePicker = useCallback((field: 'pickup' | 'dropoff') => {
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
  }, [carDraft.dropoffDate, carDraft.pickupDate]);

  // Resolve a member id to a human-friendly name for payer chips.
  const memberNameById = useMemo(
    () => new Map(groupMembers.map((member) => [member.id, formatMemberName(member)] as const)),
    [groupMembers]
  );
  const payerName = useCallback((id: string): string => {
    return memberNameById.get(id) ?? 'Unknown';
  }, [memberNameById]);

  const saveCoveredBy = useCallback(async () => {
    if (!activeTrip?.id) {
      alert('An active trip is required.');
      return;
    }

    const validation = validateCoveringRules(coveredBy);
    if (!validation.ok) {
      alert(validation.error);
      return;
    }

    try {
      const res = await fetch(`${backendUrl}/api/trips/${activeTrip.id}/covered-by`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify(coveredBy),
      });
      if (!res.ok) throw new Error('Failed to save covering rules.');
      alert('Covering rules saved.');
    } catch (err) {
      alert((err as Error).message);
    }
  }, [activeTrip?.id, backendUrl, coveredBy, jsonHeaders]);

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
    () => buildAllExpenses(flights, lodgings, tours, carRentals, expenses, activeTrip?.currency ?? 'USD', allMemberIds),
    [flights, lodgings, tours, carRentals, expenses, allMemberIds, activeTrip?.currency]
  );

  const { ledgerPaidTotals, ledgerUsedTotals, finalBalances } = useMemo(
    () => calculateAllTotals(allExpenses, allMemberIds, reportableMemberIds, coveredBy),
    [allExpenses, allMemberIds, reportableMemberIds, coveredBy]
  );

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

  const logout = useCallback(() => {
    setUserToken(null);
    setUserName(null);
    setUserEmail(null);
    setUserId(null);
    setUserRole('user');
    setTrips([]);
    setActiveTripId(null);
    setFlights([]);
    setTours([]);
    setExpenses([]);
    setInvites([]);
    setFollowedTrips([]);
    setFollowInviteCode('');
    setFollowError('');
    setFollowCodes({});
    setSelectedFollowedTripId(null);
    setGroups([]);
    setGroupMembers([]);
    setGroupAddEmail({});
    setGroupAddRelationship({});
    setTraits([]);
    setSelectedTraitNames(new Set());
    setTraitAge('');
    setTraitGender('prefer-not');
    setAccountProfile({ firstName: '', lastName: '', email: '', homeAddress: '', preferredAirport: '', appearancePreference: 'auto' });
    setFamilyRelationships([]);
    setFellowTravelers([]);
    setRequirePasswordSetup(false);
    setPasswordSetupLoading(false);
    setPasswordSetupForm({ newPassword: '', newPasswordConfirm: '' });
    setPageForwardHistory([]);
    setActivePage('home');
    setPageHistory([]);
    setLastRefreshAt(null);
    setIsRefreshing(false);
    refreshInFlightRef.current = false;
    disconnectSocket();
    setPresenceUsers([]);
    setChatOpen(false);
    setChatUnread(0);
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
        setAppearancePreference: updateAppearancePreference,
        setUserName,
        setUserEmail,
      }),
    [backendUrl, logout, setAccountProfile, setUserEmail, setUserName, updateAppearancePreference, updateMapPreference, userToken]
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

    if (typeof Linking?.createURL !== 'function') {
      // This should not happen in a standard Expo/React Native environment.
      console.error('Linking.createURL is not available. OAuth redirect will likely fail.');
      // Fallback to a URL that is unlikely to work for a native app redirect.
      return `${backendUrl}/login`;
    }

    const scheme =
      Constants.expoConfig?.scheme ||
      (Constants as any)?.manifest2?.extra?.expoClient?.scheme ||
      undefined;
    return Linking.createURL('login', scheme ? { scheme } : undefined);
  };

  const loginWithGoogle = async () => {
    setAuthErrorMessage(null);
    const redirectUrl = buildLoginRedirectUrl();
    const authUrl = `${backendUrl}/api/auth/google?redirect_uri=${encodeURIComponent(redirectUrl)}`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.assign(authUrl);
      return;
    }
    try {
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (result.type === 'success' && result.url) {
        const { token, requirePasswordSetup } = extractTokenFromUrl(result.url);
        if (token) {
          handleAuthSuccess(token, undefined, { requirePasswordSetup });
        }
      }
    } catch (err) {
      console.log('Auth session cancelled or failed', err);
    }
  };

  const handleAuthSuccess = useCallback(
    (token: string, firstLoginOverride?: boolean, options?: { requirePasswordSetup?: boolean }) => {
    const decoded = decodeTokenClaims(token);
    const name =
      `${decoded?.firstName ?? ''} ${decoded?.lastName ?? ''}`.trim() || decoded?.email || 'Traveler';
    const decodedRole: 'user' | 'admin' = decoded?.role === 'admin' ? 'admin' : 'user';
    const decodedUserId = (decoded as any)?.userId ?? null;
    setUserToken(token);
    setUserName(name);
    setUserRole(decodedRole);
    setUserId(decodedUserId);
    setInvitesLoaded(false);
    connectSocket(token);
    if (decoded?.email) {
      setUserEmail(decoded.email);
    }
    setAccountProfile({
      firstName: decoded?.firstName ?? '',
      lastName: decoded?.lastName ?? '',
      email: decoded?.email ?? '',
      homeAddress: '',
      preferredAirport: '',
      appearancePreference: 'auto',
    });
    const previousSession = loadSession();
    const restoredTripId = previousSession?.tripId ?? activeTripId ?? null;
    setActiveTripId(restoredTripId);
    const firstLogin = Boolean(firstLoginOverride);
    setIsFirstLogin(firstLogin);
    const mustSetPassword = Boolean(options?.requirePasswordSetup);
    setRequirePasswordSetup(mustSetPassword);
    if (mustSetPassword) {
      setPasswordSetupForm({ newPassword: '', newPasswordConfirm: '' });
    }
    if (firstLogin) {
      setDeferFirstLoginRedirect(true);
      setActivePage('home');
    } else {
      setActivePage('overview');
    }
    setPageForwardHistory([]);
    setPageHistory([]);
    saveSession(token, name, firstLogin ? 'home' : 'overview', decoded?.email, restoredTripId, [], decodedRole);
    },
    [activeTripId]
  );

  useEffect(() => {
    const handleDeepLink = (event: { url: string }) => {
      const { token, authError, isConfirm, isSecondaryConfirm, requirePasswordSetup } = extractTokenFromUrl(event.url);
      if (token && isConfirm) {
        confirmEmailToken(token, event.url);
        return;
      }
      if (token && isSecondaryConfirm) {
        confirmSecondaryEmailToken(token, event.url);
        return;
      }
      if (token) {
        handleAuthSuccess(token, undefined, { requirePasswordSetup });
        return;
      }
      if (authError) {
        const message = mapAuthErrorToMessage(authError);
        if (message) {
          setAuthErrorMessage(message);
        }
      }
    };

    const confirmEmailToken = async (token: string, rawUrl: string) => {
      try {
        const res = await fetch(`${backendUrl}/api/web-auth/confirm?token=${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        const message = res.ok ? (data.message ?? 'Email confirmed. You can now log in.') : (data.error ?? 'Email confirmation failed.');
        setEmailConfirmationMessage(message);
        alert(message);
      } catch {
        alert('Email confirmation failed.');
      } finally {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const url = new URL(rawUrl);
          url.searchParams.delete('token');
          window.history.replaceState({}, '', url.toString());
        }
      }
    };

    const confirmSecondaryEmailToken = async (token: string, rawUrl: string) => {
      try {
        const res = await fetch(`${backendUrl}/api/web-auth/confirm-email?token=${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        const message = res.ok ? (data.message ?? 'Email confirmed.') : (data.error ?? 'Email confirmation failed.');
        setEmailConfirmationMessage(message);
        alert(message);
      } catch {
        alert('Email confirmation failed.');
      } finally {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const url = new URL(rawUrl);
          url.searchParams.delete('token');
          window.history.replaceState({}, '', url.toString());
        }
      }
    };

    const subscription = Linking.addEventListener('url', handleDeepLink);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // Use params captured at module load time (before React Navigation could strip them),
      // falling back to the current URL for deep links that arrive later.
      // Consume once so re-runs of this effect don't re-process the same params.
      const captured = _capturedInitialAuthParams;
      _capturedInitialAuthParams = null;
      const source = captured ?? extractTokenFromUrl(window.location.href);
      const token = 'token' in source ? source.token : null;
      const authError = 'authError' in source ? source.authError : null;
      const requirePasswordSetup = source.requirePasswordSetup;
      const isConfirm = source.isConfirm;
      const isSecondaryConfirm = source.isSecondaryConfirm;
      const rawUrl = captured?.rawUrl ?? window.location.href;
      if (token && isConfirm) {
        confirmEmailToken(token, rawUrl);
      } else if (token && isSecondaryConfirm) {
        confirmSecondaryEmailToken(token, rawUrl);
      } else if (token) {
        handleAuthSuccess(token, undefined, { requirePasswordSetup });
        try {
          const cleanUrl = new URL(rawUrl);
          cleanUrl.searchParams.delete('token');
          cleanUrl.searchParams.delete('require_password_setup');
          if (cleanUrl.hash) {
            const hashParams = new URLSearchParams(cleanUrl.hash.slice(1));
            hashParams.delete('token');
            const newHash = hashParams.toString();
            cleanUrl.hash = newHash ? `#${newHash}` : '';
          }
          window.history.replaceState({}, '', cleanUrl.toString());
        } catch { /* ignore */ }
      } else if (authError) {
        const message = mapAuthErrorToMessage(authError);
        if (message) {
          setAuthErrorMessage(message);
        }
        try {
          const cleanUrl = new URL(rawUrl);
          cleanUrl.searchParams.delete('auth_error');
          window.history.replaceState({}, '', cleanUrl.toString());
        } catch { /* ignore */ }
      }
    }
    return () => {
      subscription.remove();
    };
  }, [handleAuthSuccess]);

  const completeInitialPasswordSetup = async () => {
    if (!userToken) return;
    if (passwordSetupForm.newPassword !== passwordSetupForm.newPasswordConfirm) {
      alert('Passwords do not match');
      return;
    }
    if (passwordSetupForm.newPassword.trim().length < 6) {
      alert('New password must be at least 6 characters');
      return;
    }
    try {
      setPasswordSetupLoading(true);
      const res = await fetch(`${backendUrl}/api/account/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({
          newPassword: passwordSetupForm.newPassword,
          newPasswordConfirm: passwordSetupForm.newPasswordConfirm,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Unable to set password');
        return;
      }
      setRequirePasswordSetup(false);
      setPasswordSetupForm({ newPassword: '', newPasswordConfirm: '' });
      alert('Password set. You can now sign in with email/password too.');
    } catch (err) {
      alert((err as Error).message || 'Unable to set password');
    } finally {
      setPasswordSetupLoading(false);
    }
  };

  const loginWithPassword = async () => {
    setAuthErrorMessage(null);
    try {
      const res = await fetch(`${backendUrl}/api/web-auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: authForm.email.trim(), password: authForm.password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = String(data.error ?? '');
        if (res.status === 403 && /confirm/i.test(message)) {
          setShowResendConfirmation(true);
        }
        setAuthErrorMessage(data.error || 'Login failed');
        return;
      }
      setShowResendConfirmation(false);
      if (!data?.user || typeof data.token !== 'string') {
        setAuthErrorMessage(data.error || 'Login failed');
        return;
      }
      handleAuthSuccess(data.token, Boolean(data.firstLogin));
    } catch (err) {
      const message = (err as Error).message || 'Login failed';
      setAuthErrorMessage(`${message} (backend: ${backendUrl})`);
    }
  };

  const resendConfirmationEmail = async () => {
    const email = authForm.email.trim();
    if (!email) {
      alert('Enter your email or username first.');
      return;
    }
    try {
      setResendConfirmationLoading(true);
      const res = await fetch(`${backendUrl}/api/web-auth/resend-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Failed to resend confirmation email.');
        return;
      }
      alert(data.message || 'If an account exists for this email, a confirmation link has been sent.');
    } catch (err) {
      alert((err as Error).message || 'Failed to resend confirmation email.');
    } finally {
      setResendConfirmationLoading(false);
    }
  };

  const register = async () => {
    setAuthErrorMessage(null);
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
      if (data?.verificationRequired) {
        alert(data.message || 'Check your email to confirm your account.');
        setAuthMode('login');
        return;
      }
      if (!data?.user || typeof data.token !== 'string') {
        alert(data.error || 'Registration failed');
        return;
      }
      handleAuthSuccess(data.token, Boolean(data.firstLogin));
    } catch (err) {
      alert((err as Error).message || 'Registration failed');
    }
  };

  // Fetch flights for the active trip; normalize paidBy casing.
  const fetchFlights = useCallback(async (token?: string) => {
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
  }, [activeTripId, backendUrl, userToken]);

  // Fetch lodgings for the active trip; normalize nullable fields.
  const fetchLodgings = useCallback(async (token?: string) => {
    if (!activeTripId || !(token ?? userToken)) {
      setLodgings([]);
      return;
    }
    const data = await fetchLodgingsApi(backendUrl, activeTripId, (token ?? userToken) as string);
    setLodgings(data);
  }, [activeTripId, backendUrl, userToken]);

  // Fetch tours for the active trip; normalize string fields.
  const fetchTours = useCallback(async (token?: string) => {
    if (!activeTripId || !(token ?? userToken)) {
      setTours([]);
      return;
    }
    const data = await fetchActivitiesForTrip({ backendUrl, activeTripId, token: token ?? userToken });
    setTours(data);
  }, [activeTripId, backendUrl, userToken]);

  const fetchCarRentals = useCallback(async (token?: string) => {
    if (!activeTripId || !(token ?? userToken)) {
      setCarRentals([]);
      return;
    }
    const data = await fetchCarRentalsForTrip({ backendUrl, activeTripId, token: token ?? userToken });
    setCarRentals(data);
  }, [activeTripId, backendUrl, userToken]);

  const fetchExpenses = useCallback(async (token?: string) => {
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
  }, [activeTripId, backendUrl, userToken]);

  // Fetch itineraries for the current user; ItinerariesTab also fetches within its own lifecycle,
  // but this keeps the call from blowing up when invoked from shared effects.
  const fetchItineraries = useCallback(async (token?: string) => {
    const authToken = token ?? userToken;
    if (!authToken) return;
    await fetch(`${backendUrl}/api/itineraries`, { headers }).catch(() => undefined);
  }, [backendUrl, headers, userToken]);

  const fetchInvites = useCallback(async (token?: string) => {
    const authToken = token ?? userToken;
    if (!authToken) {
      setInvites([]);
      setInvitesLoaded(true);
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
    } finally {
      setInvitesLoaded(true);
    }
  }, [backendUrl, userToken]);

  const fetchGroups = useCallback(async (sort?: 'created' | 'name') => {
    const res = await fetch(`${backendUrl}/api/groups?sort=${sort ?? groupSort}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (res.status === 401 || (res.status === 403 && !requirePasswordSetup)) {
      logout();
      return;
    }
    if (res.status === 403) return;
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
  }, [backendUrl, groupSort, newTripGroupId, userToken, logout, requirePasswordSetup]);

  const fetchTrips = useCallback(async (tokenOverride?: string): Promise<Trip[]> => {
    const authToken = tokenOverride ?? userToken;
    if (!authToken) {
      setTrips([]);
      return [];
    }
    try {
      const res = await fetch(`${backendUrl}/api/trips`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.status === 401 || (res.status === 403 && !requirePasswordSetup)) {
        logout();
        return [];
      }
      if (res.status === 403) return [];
      if (!res.ok) return [];
      const data = await res.json();
      setTrips(data);
      if (!activeTripId && data.length) {
        setActiveTripId(data[0].id);
      } else if (activeTripId && !isFollowingMode && !data.find((t: Trip) => t.id === activeTripId)) {
        setActiveTripId(data[0]?.id ?? null);
      }
      return data;
    } catch {
      return [];
    }
  }, [activeTripId, backendUrl, isFollowingMode, logout, userToken, requirePasswordSetup]);

  const fetchGroupMembersForActiveTrip = useCallback(async () => {
    if (!userToken || !activeTripId) {
      setGroupMembers([]);
      return;
    }
    const trip = isFollowingMode ? selectedFollowedTripDetails : trips.find((t) => t.id === activeTripId);
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
  }, [activeTripId, backendUrl, isFollowingMode, selectedFollowedTripDetails, trips, userToken]);

  const fetchTraits = useCallback(async () => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/traits`, { headers: { Authorization: `Bearer ${userToken}` } });
    if (!res.ok) return;
    const data = (await res.json()) as Trait[];
    setTraits(data);
    setSelectedTraitNames(new Set(data.map((t) => t.name)));
  }, [backendUrl, userToken]);

  const fetchTraitProfile = useCallback(async () => {
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
  }, [backendUrl, headers, userToken]);

  const fetchFlightAirports = useCallback(async (q: string) => {
    if (!userToken || !q.trim()) {
      setFlightAirportOptions([]);
      return;
    }
    try {
      const res = await fetch(`${backendUrl}/api/transfers/locations?q=${encodeURIComponent(q.trim())}`, {
        headers: { Authorization: `Bearer ${userToken}` },
        cache: 'no-store',
      });
      if (res.status === 304) {
        // Keep existing options when the browser serves a conditional-cache hit.
        return;
      }
      if (!res.ok) {
        setFlightAirportOptions([]);
        return;
      }
      const data = await res.json();
      setFlightAirportOptions(data);
    } catch {
      setFlightAirportOptions([]);
    }
  }, [backendUrl, userToken]);

  const acceptInvite = async (invite: GroupInvite) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/groups/invites/${invite.id}/accept`, {
      method: 'POST',
      headers: headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to accept invite');
      return;
    }
    const nextTripId = invite.tripId ?? invite.resolvedTripId ?? null;
    if (nextTripId) {
      setActiveTripId(nextTripId);
    }
    if (isFirstLogin) {
      setDeferFirstLoginRedirect(false);
      setActivePage('account');
    } else {
      setActivePage('overview');
    }
    fetchInvites();
    fetchGroups();
    fetchTrips();
  };

  const rejectInvite = async (invite: GroupInvite) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/groups/invites/${invite.id}/reject`, {
      method: 'POST',
      headers: headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to reject invite');
      return;
    }
    fetchInvites();
    fetchGroups();
    fetchTrips();
  };

  const refreshAllData = useCallback(async (tokenOverride?: string) => {
    const authToken = tokenOverride ?? userToken;
    if (!authToken || refreshInFlightRef.current || requirePasswordSetup) return;
    refreshInFlightRef.current = true;
    setIsRefreshing(true);
    try {
      const ok = await loadAccountProfile(authToken);
      if (!ok) return;
      await Promise.all([
        fetchFlights(authToken),
        fetchLodgings(authToken),
        fetchTours(authToken),
        fetchCarRentals(authToken),
        fetchExpenses(authToken),
        fetchInvites(authToken),
        fetchGroups(),
        fetchTrips(),
        fetchTraits(),
        fetchTraitProfile(),
        fetchItineraries(authToken),
        loadFamilyRelationships(authToken),
        loadFellowTravelers(authToken),
        (async () => {
          try {
            const trips = await fetchFollowedTripsApi(backendUrl, { Authorization: `Bearer ${authToken}` });
            setFollowedTrips(trips);
          } catch (err) {
            if ((err as any).code === 'UNAUTHORIZED') {
              logout();
            } else {
              setFollowedTrips([]);
            }
          }
        })()
      ]);
    } finally {
      refreshInFlightRef.current = false;
      setIsRefreshing(false);
      setLastRefreshAt(Date.now());
    }
  }, [
    userToken,
    loadAccountProfile,
    fetchFlights,
    fetchLodgings,
    fetchTours,
    fetchCarRentals,
    fetchExpenses,
    fetchInvites,
    fetchGroups,
    fetchTrips,
    fetchTraits,
    fetchTraitProfile,
    fetchItineraries,
    loadFamilyRelationships,
    loadFellowTravelers,
    backendUrl,
    logout,
    requirePasswordSetup
  ]);

  useEffect(() => {
    if (userToken && !requirePasswordSetup) {
      refreshAllData();
    }
  }, [userToken, requirePasswordSetup, refreshAllData]);

  // Socket.IO: join trip room when active trip changes
  useEffect(() => {
    if (!userToken || !activeTripId) return;
    const socket = getSocket();

    const onPresence = (list: PresenceUser[]) => setPresenceUsers(list);
    const onUnread = (data: { tripId: string; count: number }) => {
      if (data.tripId === activeTripId) setChatUnread(data.count);
    };

    socket.on(SERVER_EVENTS.PRESENCE_UPDATE, onPresence);
    socket.on(SERVER_EVENTS.UNREAD_COUNT, onUnread);

    if (socket.connected) {
      socket.emit(CLIENT_EVENTS.JOIN_TRIP, activeTripId);
    } else {
      socket.once('connect', () => {
        socket.emit(CLIENT_EVENTS.JOIN_TRIP, activeTripId);
      });
    }

    return () => {
      socket.off(SERVER_EVENTS.PRESENCE_UPDATE, onPresence);
      socket.off(SERVER_EVENTS.UNREAD_COUNT, onUnread);
    };
  }, [userToken, activeTripId]);

  useEffect(() => {
    if (!userToken) return;
    const pendingEntries = Object.entries(asyncItineraryByTrip).filter(([, tracker]) => tracker.status === 'pending');
    if (!pendingEntries.length) return;

    let cancelled = false;
    const poll = async () => {
      const nextEntries = await Promise.all(
        pendingEntries.map(async ([tripId, tracker]) => {
          try {
            const res = await fetch(`${backendUrl}/api/itinerary/async/${encodeURIComponent(tracker.jobId)}`, {
              headers,
              cache: 'no-store',
            });
            if (!res.ok) return [tripId, { ...tracker, status: 'failed', error: `status ${res.status}` }] as const;
            const data = await res.json().catch(() => ({}));
            const status = String((data as any).status ?? '').toLowerCase();
            if (status === 'completed') return [tripId, null] as const;
            if (status === 'failed') {
              return [tripId, { ...tracker, status: 'failed', error: String((data as any).error ?? 'generation failed') }] as const;
            }
            return [tripId, tracker] as const;
          } catch (err) {
            return [tripId, { ...tracker, status: 'failed', error: (err as Error).message }] as const;
          }
        })
      );
      if (cancelled) return;

      let changed = false;
      let completedCount = 0;
      const nextState = { ...asyncItineraryByTrip };
      for (const [tripId, nextTracker] of nextEntries) {
        if (nextTracker === null) {
          if (nextState[tripId]) {
            delete nextState[tripId];
            changed = true;
            completedCount += 1;
          }
          continue;
        }
        const prev = asyncItineraryByTrip[tripId];
        if (!prev || prev.status !== nextTracker.status || prev.error !== nextTracker.error || prev.jobId !== nextTracker.jobId) {
          nextState[tripId] = nextTracker;
          changed = true;
        }
      }
      if (changed) {
        setAsyncItineraryByTrip(nextState);
      }
      if (completedCount > 0) {
        await refreshAllData();
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [asyncItineraryByTrip, backendUrl, headers, refreshAllData, userToken]);

  useEffect(() => {
    if (!userToken) {
      setPendingInviteModalOpen(false);
      setInvitesLoaded(false);
      return;
    }
    setPendingInviteModalOpen(invites.length > 0);
  }, [invites, userToken]);

  useEffect(() => {
    if (!userToken || !deferFirstLoginRedirect) return;
    if (!invitesLoaded) return;
    if (pendingInviteModalOpen || invites.length) return;
    setDeferFirstLoginRedirect(false);
    setActivePage('account');
    saveSession(userToken, userName ?? 'Traveler', 'account', userEmail ?? undefined, activeTripId ?? null, pageHistory, userRole);
  }, [
    activeTripId,
    deferFirstLoginRedirect,
    invites.length,
    invitesLoaded,
    pageHistory,
    pendingInviteModalOpen,
    userEmail,
    userName,
    userRole,
    userToken,
  ]);

  useEffect(() => {
    if (userToken && !requirePasswordSetup) {
      fetchTrips();
      fetchGroups();
      fetchInvites();
    }
  }, [userToken, requirePasswordSetup, fetchTrips, fetchGroups, fetchInvites]);

  useEffect(() => {
    if (userToken) return;
    const session = loadSession();
    if (session) {
      const decoded = decodeTokenClaims(session.token);
      const restoredRole: 'user' | 'admin' =
        session.role === 'admin' || decoded?.role === 'admin' ? 'admin' : 'user';
      setUserToken(session.token);
      setUserName(session.name);
      setUserEmail(session.email ?? null);
      setUserRole(restoredRole);
      const sessionHistory = Array.isArray(session.pageHistory)
        ? session.pageHistory.filter((p) => typeof p === 'string') as Page[]
        : [];
      setPageHistory(sessionHistory);
      const sessionForwardHistory = (Array.isArray((session as any).pageForwardHistory)
        ? (session as any).pageForwardHistory.filter((p: any) => typeof p === 'string')
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
          sessionPage === 'ingest' ||
          sessionPage === 'cost' ||
          sessionPage === 'account' ||
          sessionPage === 'follow' ||
          sessionPage === 'following'
        ) {
          setActivePage(sessionPage as Page);
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
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const storedPending = window.localStorage.getItem(pendingFollowCodeStorageKey)?.trim() || null;
      const initialFollowCode = _capturedInitialFollowCode ?? extractFollowCodeFromUrl(window.location.href) ?? storedPending;
      _capturedInitialFollowCode = null;
      if (initialFollowCode) {
        setPendingFollowCode(initialFollowCode);
        setFollowInviteCode(initialFollowCode);
        try {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('followCode');
          window.history.replaceState({}, '', cleanUrl.toString());
        } catch {
          // ignore cleanup failures
        }
      }
    }
  }, []);

  useEffect(() => {
    saveFollowCodes(followCodes);
  }, [followCodes]);

  useEffect(() => {
    saveFollowPayloads(followCodePayloads);
  }, [followCodePayloads]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (pendingFollowCode) {
      window.localStorage.setItem(pendingFollowCodeStorageKey, pendingFollowCode);
    } else {
      window.localStorage.removeItem(pendingFollowCodeStorageKey);
    }
  }, [pendingFollowCode]);

  useEffect(() => {
    if (!selectedFollowedTripId) return;
    if (!followedTrips.some((trip) => trip.tripId === selectedFollowedTripId)) {
      setSelectedFollowedTripId(null);
    }
  }, [followedTrips, selectedFollowedTripId]);

  useEffect(() => {
    if (!selectedFollowedTripId || !userToken) {
      setSelectedFollowedTripDetails(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${backendUrl}/api/trips/${selectedFollowedTripId}`, {
          headers: { Authorization: `Bearer ${userToken}` },
        });
        if (!res.ok) {
          if (!cancelled) setSelectedFollowedTripDetails(null);
          return;
        }
        const data = await res.json().catch(() => null);
        if (!cancelled && data?.id) {
          setSelectedFollowedTripDetails({
            id: data.id,
            groupId: data.groupId ?? '',
            groupName: data.groupName ?? '',
            name: data.name ?? selectedFollowedTrip?.tripName ?? 'Trip',
            description: data.description ?? null,
            destination: data.destination ?? selectedFollowedTrip?.destination ?? null,
            locationIds: Array.isArray(data.locationIds) ? data.locationIds : [],
            startDate: data.startDate ?? null,
            endDate: data.endDate ?? null,
            startMonth: data.startMonth ?? null,
            startYear: data.startYear ?? null,
            durationDays: data.durationDays ?? null,
            currency: data.currency ?? null,
            createdAt: data.createdAt ?? '',
          });
        }
      } catch {
        if (!cancelled) setSelectedFollowedTripDetails(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendUrl, selectedFollowedTrip?.destination, selectedFollowedTrip?.tripName, selectedFollowedTripId, userToken]);

  useEffect(() => {
    if (!userToken || requirePasswordSetup) return;
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
  }, [activeTripId, lastRefreshAt, userToken, requirePasswordSetup, refreshIntervalMs, refreshAllData]);

  useEffect(() => {
    if (userToken && !requirePasswordSetup) {
      fetchFlights();
      fetchLodgings();
      fetchTours();
      fetchExpenses();
    }
  }, [activeTripId, fetchFlights, fetchLodgings, fetchTours, fetchExpenses, userToken, requirePasswordSetup]);

  useEffect(() => {
    if (userToken && !requirePasswordSetup) {
      loadFamilyRelationships();
      loadFellowTravelers();
    }
  }, [loadFamilyRelationships, loadFellowTravelers, userToken, requirePasswordSetup]);

  useEffect(() => {
    if (!userToken || requirePasswordSetup || !pendingFollowCode) return;
    const redemptionKey = `${userToken}:${pendingFollowCode}`;
    if (autoRedeemedFollowCodeRef.current === redemptionKey) return;
    autoRedeemedFollowCodeRef.current = redemptionKey;

    let cancelled = false;
    const redeemFollowCode = async () => {
      try {
        const res = await fetch(`${backendUrl}/api/trips/follow`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
          body: JSON.stringify({ inviteCode: pendingFollowCode }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          logout();
          return;
        }
        if (!res.ok) {
          setFollowError(data.error || 'Unable to follow trip');
          return;
        }
        try {
          const trips = await fetchFollowedTripsApi(backendUrl, { Authorization: `Bearer ${userToken}` });
          if (!cancelled) {
            setFollowedTrips(trips);
          }
        } catch {
          // Ignore refresh failures after a successful follow.
        }
        setFollowError('');
        setPendingFollowCode(null);
        setFollowInviteCode('');
      } catch (err) {
        if (!cancelled) {
          setFollowError((err as Error).message || 'Unable to follow trip');
        }
      }
    };

    void redeemFollowCode();
    return () => {
      cancelled = true;
    };
  }, [backendUrl, logout, pendingFollowCode, requirePasswordSetup, userToken]);

  useEffect(() => {
    if (userToken && !requirePasswordSetup) {
      fetchGroupMembersForActiveTrip();
    }
  }, [userToken, requirePasswordSetup, activeTripId, trips, fetchGroupMembersForActiveTrip]);

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
    setPageForwardHistory([]);
    setPageHistory((prev) => prev.slice(-25));
    setActivePage('overview');
  };

  const onAiItineraryQueued = useCallback((tripId: string, jobId: string) => {
    setAsyncItineraryByTrip((prev) => ({
      ...prev,
      [tripId]: {
        jobId,
        status: 'pending',
      },
    }));
  }, []);

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

  const openLodgingDetails = useCallback((lodging: Lodging) => {
    setSelectedLodging(lodging);
    setShowLodgingDetails(true);
  }, []);

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

  const goBack = useCallback(() => {
    if (pageHistory.length === 0) return;
    const previousPage = pageHistory[pageHistory.length - 1];
    if (shouldAllowPageChange(activePage, previousPage, { isFollowedTrip: isFollowingMode })) {
      setPageForwardHistory((prev) => [activePage, ...prev].slice(0, 25));
      setPageHistory((prev) => prev.slice(0, -1));
      setActivePage(previousPage);
    }
  }, [pageHistory, activePage, isFollowingMode]);

  const closeTripWizard = useCallback(() => {
    setPageForwardHistory([]);
    setActivePage('home');
  }, []);

  const goForward = useCallback(() => {
    if (pageForwardHistory.length === 0) return;
    const nextPage = pageForwardHistory[0];
    if (shouldAllowPageChange(activePage, nextPage, { isFollowedTrip: isFollowingMode })) {
      setPageHistory((prev) => [...prev, activePage].slice(-25));
      setPageForwardHistory((prev) => prev.slice(1));
      setActivePage(nextPage);
    }
  }, [pageForwardHistory, activePage, isFollowingMode]);

  useEffect(() => {
    if (!userToken) return;
    saveSession(userToken, userName ?? 'Traveler', activePage, userEmail, activeTripId, pageHistory, userRole);
  }, [userToken, userName, userEmail, activePage, activeTripId, pageHistory, userRole]);

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
      'following',
      'itinerary',
      'ingest',
    ];
    return new Set(pages.filter((page) => shouldDisableTab(activePage, page, { isFollowedTrip: isFollowingMode })));
  }, [activePage, isFollowingMode]);
  const hiddenPages = useMemo(
    () => new Set<string>(isFollowingMode ? FOLLOWED_TRIP_HIDDEN_PAGES : []),
    [isFollowingMode]
  );
  const activeTripName = useMemo(
    () => activeTrip?.name?.replace(/\s/g, '_') ?? 'export',
    [activeTrip?.name]
  );
  const getActiveTrip = useCallback(
    () => activeTripForHome ?? activeTrip ?? undefined,
    [activeTrip, activeTripForHome]
  );
  const handleHomeNavigate = useCallback((page: string) => requestPageChange(page as Page), [requestPageChange]);
  const handleFlightsDataChanged = useCallback(() => {
    fetchFlights();
    fetchExpenses();
  }, [fetchExpenses, fetchFlights]);
  const handleLodgingsDataChanged = useCallback(() => {
    fetchLodgings();
    fetchExpenses();
  }, [fetchExpenses, fetchLodgings]);

  const handleIngestionAssignmentApplied = useCallback(
    async ({ tripId }: { itemType: string; tripId: string }) => {
      if (!tripId || tripId !== activeTripId) return;
      await Promise.all([
        fetchFlights(),
        fetchLodgings(),
        fetchTours(),
        fetchCarRentals(),
        fetchExpenses(),
      ]);
    },
    [activeTripId, fetchCarRentals, fetchExpenses, fetchFlights, fetchLodgings, fetchTours]
  );
  const handleToursDataChanged = useCallback(() => {
    fetchTours();
    fetchExpenses();
  }, [fetchExpenses, fetchTours]);
  const handleExternalEditHandled = useCallback(() => setExternalFlightEditId(null), []);
  const handleOpenTripItinerary = useCallback((tripId: string) => {
    setActiveTripId(tripId);
    requestPageChange('itinerary');
  }, [requestPageChange]);
  const handleUnfollowTrip = useCallback(
    async (tripId: string) => {
      const res = await fetch(`${backendUrl}/api/trips/${tripId}/follow`, {
        method: 'DELETE',
        headers,
      });
      if (res.status === 401 || res.status === 403) {
        logout();
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Unable to unfollow trip');
        return;
      }
      setFollowedTrips((prev) => prev.filter((trip) => trip.tripId !== tripId));
      setSelectedFollowedTripId((prev) => (prev === tripId ? null : prev));
    },
    [backendUrl, headers, logout]
  );

  const renderSharedPageScroll = (content: React.ReactNode) => (
    <ScrollView
      style={styles.pageScroll}
      contentContainerStyle={[styles.pageScrollContent, iosSafariContentInsetStyle]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.pageScrollInner}>{content}</View>
    </ScrollView>
  );

  const renderBoundedPage = (content: React.ReactNode) => (
    <View style={styles.pageViewport}>
      <View style={[styles.pageViewportInner, iosSafariContentInsetStyle]}>{content}</View>
    </View>
  );

  const mainWorkspace = (
    <SafeAreaView style={[styles.container, iosSafariSafeAreaStyle]}>
      <View style={[styles.topBar, isNarrowLayout && styles.topBarStacked]}>
        <View style={[styles.topBarLeft, isNarrowLayout && styles.topBarLeftNarrow]}>
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
          <Image source={TOP_BANNER_ICON} style={styles.brandIcon} accessibilityLabel="WanderBunnies logo" />
          <Text style={[styles.title, isPhoneLayout && styles.titleNarrow]} numberOfLines={1} ellipsizeMode="tail">
            WanderBunnies
          </Text>
        </View>
        {userToken ? (
          <View style={styles.topRightWrapper}>
            {activeTripId ? (
              <TouchableOpacity
                style={[styles.button, styles.smallButton, styles.topBarActionButton]}
                onPress={() => {
                  setSelectedTripId(activeTripId);
                  requestPageChange('trip-details');
                  setOpenShareFromHeaderSignal((prev) => prev + 1);
                }}
              >
                <Text style={styles.buttonText}>Share</Text>
              </TouchableOpacity>
            ) : null}
            {trips.length || followedTrips.length ? (
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={isTripWizardOpen}
                style={[
                  styles.input,
                  styles.inlineInput,
                  styles.dropdown,
                  styles.activeTrip,
                  styles.topBarTripControl,
                  isNarrowLayout && styles.activeTripNarrow,
                  isTripWizardOpen && styles.buttonDisabled,
                ]}
                onPress={() => setShowActiveTripDropdown((s) => !s)}
              >
                <Text style={styles.cellText} numberOfLines={1} ellipsizeMode="tail">
                  Active Trip: {activeTripSelectorLabel}
                </Text>
                {showActiveTripDropdown && (
                  <View style={styles.dropdownList}>
                    {trips.map((trip) => (
                      <TouchableOpacity
                        key={trip.id}
                        style={styles.dropdownOption}
                        onPress={() => {
                          handleSelectOwnedTrip(trip.id);
                          setShowActiveTripDropdown(false);
                        }}
                      >
                        <Text style={styles.cellText}>{trip.name}</Text>
                      </TouchableOpacity>
                    ))}
                    {followedTrips.length ? (
                      <View>
                        <Text style={styles.modalLabelSmall}>Followed Trips</Text>
                        {followedTrips.map((trip) => (
                          <TouchableOpacity
                            key={`followed-${trip.tripId}`}
                            style={styles.dropdownOption}
                            onPress={() => {
                              handleSelectFollowedTrip(trip.tripId);
                            }}
                          >
                            <Text style={styles.cellText}>{trip.tripName} (Following)</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                  </View>
                )}
              </TouchableOpacity>
            ) : null}
            <View style={[styles.topRight, isNarrowLayout && styles.topRightNarrow]}>
              {!isPhoneLayout ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {activeTripId && (
                    <PresenceAvatars
                      currentUserId={userId ?? ''}
                      presenceUsers={presenceUsers}
                      theme={theme}
                    />
                  )}
                  <TouchableOpacity
                    style={[styles.userNameButton, styles.smallButton, styles.topBarActionButton]}
                    onPress={() => requestPageChange('account')}
                  >
                    <Text style={styles.userNameButtonText}>{userName ?? 'Traveler'}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {userRole === 'admin' ? (
                <TouchableOpacity
                  style={[styles.button, styles.smallButton, styles.topBarActionButton]}
                  onPress={() => openAdminSection('overview')}
                >
                  <Text style={styles.buttonText}>Admin</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.button, styles.smallButton, styles.topBarActionButton]}
                onPress={logout}
                testID="topbar-logout"
              >
                <Text style={styles.buttonText}>Logout</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>
      {userToken ? (
        <View style={styles.contentViewport}>
          {activePage === 'home'
            ? renderBoundedPage(
                <HomeTab
                  backendUrl={backendUrl}
                  headers={headers}
                  activeTripId={activeTripId}
                  trips={trips}
                  followedTrips={followedTrips}
                  activeTripOverride={activeTripForHome}
                  styles={styles}
                  onSelectTrip={handleSelectOwnedTrip}
                  onSelectFollowedTrip={handleSelectFollowedTrip}
                  onNavigate={handleHomeNavigate}
                  disabledPages={disabledPages}
                  hiddenPages={hiddenPages}
                />
              )
            : null}

          {activePage === 'itinerary'
            ? renderSharedPageScroll(
                <ItinerariesTab
                  backendUrl={backendUrl}
                  userToken={userToken}
                  activeTripId={activeTripId}
                  activeTrip={activeTrip}
                  traits={traits}
                  headers={headers}
                  setActiveTripId={setActiveTripId}
                  onAiItineraryQueued={onAiItineraryQueued}
                  styles={styles}
                />
              )
            : null}

          {activePage === 'tours'
            ? renderSharedPageScroll(
                <ActivityTab
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
                  theme={theme}
                  nativeDateTimePicker={NativeDateTimePicker}
                  fetchTours={fetchTours}
                  readOnly={isFollowingMode}
                />
              )
            : null}

          {activePage === 'expenses'
            ? renderSharedPageScroll(
                <DailyExpensesTab
                  backendUrl={backendUrl}
                  headers={headers}
                  jsonHeaders={jsonHeaders}
                  trip={activeTrip}
                  groupMembers={groupMembers}
                  expenses={expenses}
                  setExpenses={setExpenses}
                  defaultPayerId={defaultPayerId}
                  styles={styles}
                />
              )
            : null}

          {activePage === 'ledger'
            ? renderSharedPageScroll(
                <LedgerTab
                  trip={activeTripForHome ?? activeTrip}
                  groupMembers={groupMembers}
                  reportableMembers={reportableMembers}
                  paidTotals={ledgerPaidTotals}
                  usedTotals={ledgerUsedTotals}
                  styles={styles}
                  onNavigate={requestPageChange}
                  downloadCsv={downloadCsv}
                  findActiveTrip={getActiveTrip}
                  coveredBy={coveredBy}
                  setCoveredBy={setCoveredBy}
                  formatMemberName={formatMemberName}
                  payerName={payerName}
                  saveCoveredBy={saveCoveredBy}
                  readOnly={isFollowingMode}
                />
              )
            : null}

          {activePage === 'ingest'
            ? renderSharedPageScroll(
                <IngestionTab
                  backendUrl={backendUrl}
                  headers={headers}
                  styles={styles}
                  onNavigate={handleHomeNavigate}
                  onAssignmentApplied={handleIngestionAssignmentApplied}
                />
              )
            : null}

          {activePage === 'cost' ? renderSharedPageScroll(
            <View style={[styles.card, styles.flightsSection]}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Cost Report</Text>
                <View style={[styles.row, styles.sectionActions]}>
                  <TouchableOpacity
                    style={[styles.button, styles.smallButton]}
                    onPress={() => {
                      const csv = convertExpensesToCsv('paid');
                      const fileName = `paid-expenses-${activeTripName}.csv`;
                      downloadCsv(csv, fileName);
                    }}
                  >
                    <Text style={styles.buttonText}>Export Paid CSV</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.button, styles.smallButton]}
                    onPress={() => {
                      const csv = convertExpensesToCsv('incurred');
                      const fileName = `incurred-expenses-${activeTripName}.csv`;
                      downloadCsv(csv, fileName);
                    }}
                  >
                    <Text style={styles.buttonText}>Export Incurred CSV</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.button, styles.smallButton]}
                    onPress={() => requestPageChange('ledger')}
                  >
                    <Text style={styles.buttonText}>📒 Ledger</Text>
                  </TouchableOpacity>
                </View>
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

          {activePage === 'account'
            ? renderSharedPageScroll(
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
                  appearancePreference={appearancePreference}
                  onChangeAppearancePreference={updateAppearancePreference}
                  saveSession={saveSession}
                  headers={headers}
                  jsonHeaders={jsonHeaders}
                  airportOptions={flightAirportOptions}
                  onSearchAirports={fetchFlightAirports}
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
              )
            : null}

      {activePage === 'lodging'
        ? renderBoundedPage(
            <LodgingTab
              backendUrl={backendUrl}
              jsonHeaders={jsonHeaders}
              requestHeaders={headers}
              trip={activeTripForHome ?? activeTrip}
              lodgings={lodgings}
              groupMembers={groupMembers}
              defaultPayerId={defaultPayerId}
              styles={styles}
              onRefreshLodgings={fetchLodgings}
              onOpenMap={openMaps}
              formatMemberName={formatMemberName}
              payerName={payerName}
              readOnly={isFollowingMode}
            />
          )
        : null}

      {activePage === 'car' ? renderSharedPageScroll(
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Car Rentals</Text>
          </View>
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeaderRow]}>
              <View style={[styles.tableHeaderCell, { flex: 2, minWidth: 240 }]}>
                <Text style={styles.headerText}>Route</Text>
              </View>
              <View style={[styles.tableHeaderCell, { minWidth: 120 }]}>
                <Text style={styles.headerText}>Pick-up</Text>
              </View>
              <View style={[styles.tableHeaderCell, { minWidth: 120 }]}>
                <Text style={styles.headerText}>Drop-off</Text>
              </View>
              <View style={[styles.tableHeaderCell, { minWidth: 110 }]}>
                <Text style={styles.headerText}>Status</Text>
              </View>
              <View style={[styles.tableHeaderCell, { minWidth: 110 }]}>
                <Text style={styles.headerText}>Votes</Text>
              </View>
              <View style={[styles.tableHeaderCell, { minWidth: 110 }]}>
                <Text style={styles.headerText}>Rating</Text>
              </View>
              <View style={[styles.tableHeaderCell, { minWidth: 180 }, styles.lastCell]}>
                <Text style={styles.headerText}>Actions</Text>
              </View>
            </View>

            {carRentals.map((car, idx, arr) => (
              <View key={car.id} style={[styles.tableRow, idx === arr.length - 1 && styles.lastRow]}>
                <View style={[styles.tableCell, { flex: 2, minWidth: 240 }]}>
                  <Text style={styles.cellText}>
                    {`${car.pickupLocation || 'Pickup'} → ${car.dropoffLocation || 'Drop-off'}`}
                  </Text>
                  {(car.vendor || car.model || car.reference) ? (
                    <Text style={styles.helperText}>
                      {[car.vendor, car.model, car.reference].filter(Boolean).join(' • ')}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.tableCell, { minWidth: 120 }]}>
                  <Text style={styles.cellText}>{car.pickupDate || '-'}</Text>
                </View>
                <View style={[styles.tableCell, { minWidth: 120 }]}>
                  <Text style={styles.cellText}>{car.dropoffDate || '-'}</Text>
                </View>
                <View style={[styles.tableCell, { minWidth: 110 }]}>
                  <Text style={styles.cellText}>
                    {normalizeItineraryStatus((car as any).status, LEGACY_ITINERARY_STATUS)}
                  </Text>
                </View>
                <View style={[styles.tableCell, { minWidth: 110 }]}>
                  <Text style={styles.cellText}>{formatNetVotes((car as any).netVotes ?? 0)}</Text>
                </View>
                <View style={[styles.tableCell, { minWidth: 110 }]}>
                  {normalizeItineraryStatus((car as any).status, LEGACY_ITINERARY_STATUS) === 'Completed' ? (
                    <Text style={styles.cellText}>{formatNetVotes((car as any).netRating ?? 0)}</Text>
                  ) : (
                    <Text style={styles.cellText}>-</Text>
                  )}
                </View>
                <View style={[styles.tableCell, { minWidth: 180 }, styles.lastCell]}>
                  <View style={styles.actionCell}>
                    {!isFollowingMode && shouldShowVoteButtons((car as any).status, (car as any).userVote) ? (
                      <>
                        <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => voteOnCarRental(car.id, 1)}>
                          <Text style={styles.buttonText}>👍</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => voteOnCarRental(car.id, -1)}>
                          <Text style={styles.buttonText}>👎</Text>
                        </TouchableOpacity>
                      </>
                    ) : null}
                    {!isFollowingMode && shouldShowRatingButtons((car as any).status, (car as any).userRating) ? (
                      <>
                        <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => rateOnCarRental(car.id, 1)}>
                          <Text style={styles.buttonText}>⭐</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => rateOnCarRental(car.id, -1)}>
                          <Text style={styles.buttonText}>✖</Text>
                        </TouchableOpacity>
                      </>
                    ) : null}
                    {!isFollowingMode ? (
                      <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => removeCarRental(car.id)} testID={`car-rental-delete-${car.id}`}>
                        <Text style={styles.dangerButtonText}>Delete</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.cellText}>View only</Text>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>

          {!isFollowingMode ? (
            <View style={styles.carFormSection}>
              <Text style={styles.helperText}>Add Car Rental</Text>
              <View style={styles.carFormGrid}>
              <TextInput
                style={[styles.input, styles.carFormField]}
                placeholder="Pick up location"
                value={carDraft.pickupLocation}
                onChangeText={(text: string) => setCarDraft((p) => ({ ...p, pickupLocation: text }))}
              />
              <View style={[styles.dateInputWrap, styles.carFormField]}>
                {Platform.OS === 'web' ? (
                  <input
                    ref={carPickupDateRef as any}
                    type="date"
                    value={carDraft.pickupDate}
                    onChange={(e) => setCarDraft((p) => ({ ...p, pickupDate: e.target.value }))}
                    style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box', marginBottom: 0 })}
                  />
                ) : (
                  <TouchableOpacity
                    style={[styles.input, styles.dateTouchable, { marginBottom: 0 }]}
                    onPress={() => openCarDatePicker('pickup')}
                  >
                    <Text style={styles.cellText}>{carDraft.pickupDate || 'YYYY-MM-DD'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.dateIcon} onPress={() => openCarDatePicker('pickup')}>
                  <Text style={styles.selectCaret}>📅</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={[styles.input, styles.carFormField]}
                placeholder="Drop off location"
                value={carDraft.dropoffLocation}
                onChangeText={(text: string) => setCarDraft((p) => ({ ...p, dropoffLocation: text }))}
              />
              <View style={[styles.dateInputWrap, styles.carFormField]}>
                {Platform.OS === 'web' ? (
                  <input
                    ref={carDropoffDateRef as any}
                    type="date"
                    value={carDraft.dropoffDate}
                    onChange={(e) => setCarDraft((p) => ({ ...p, dropoffDate: e.target.value }))}
                    style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box', marginBottom: 0 })}
                  />
                ) : (
                  <TouchableOpacity
                    style={[styles.input, styles.dateTouchable, { marginBottom: 0 }]}
                    onPress={() => openCarDatePicker('dropoff')}
                  >
                    <Text style={styles.cellText}>{carDraft.dropoffDate || 'YYYY-MM-DD'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.dateIcon} onPress={() => openCarDatePicker('dropoff')}>
                  <Text style={styles.selectCaret}>📅</Text>
                </TouchableOpacity>
              </View>
              {Platform.OS === 'web' ? (
                <select
                  value={normalizeItineraryStatus(carDraft.status, DEFAULT_NEW_ITINERARY_STATUS)}
                  onChange={(e) => setCarDraft((p) => ({ ...p, status: normalizeItineraryStatus(e.target.value, DEFAULT_NEW_ITINERARY_STATUS) }))}
                  style={toWebStyle(styles.input, { width: '100%', maxWidth: '100%', boxSizing: 'border-box', marginBottom: 0 })}
                >
                  {ITINERARY_STATUSES.map((opt) => (
                    <option key={`car-status-${opt}`} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <Text style={styles.cellText}>{normalizeItineraryStatus(carDraft.status, DEFAULT_NEW_ITINERARY_STATUS)}</Text>
              )}
              <TextInput
                style={[styles.input, styles.carFormField]}
                placeholder="Reference"
                value={carDraft.reference}
                onChangeText={(text: string) => setCarDraft((p) => ({ ...p, reference: text }))}
              />
              <TextInput
                style={[styles.input, styles.carFormField]}
                placeholder="Vendor"
                value={carDraft.vendor}
                onChangeText={(text: string) => setCarDraft((p) => ({ ...p, vendor: text }))}
              />
              <View style={[styles.dropdown, styles.carFormField]}>
                <TouchableOpacity
                  style={[
                    styles.input,
                    styles.selectButtonRow,
                    styles.prepaidSelectorButton,
                    carDraft.prepaid ? styles.prepaidSelectorButtonSelected : null,
                  ]}
                  onPress={() => setCarPrepaidOpen((s) => !s)}
                >
                  <Text style={[styles.cellText, styles.prepaidSelectorText]}>
                    {carDraft.prepaid ? `Prepaid: ${carDraft.prepaid}` : 'Prepaid? Select Yes or No'}
                  </Text>
                  <Text style={styles.selectCaret}>▾</Text>
                </TouchableOpacity>
                {carPrepaidOpen ? (
                  <View style={[styles.dropdownList, styles.prepaidDropdownList]}>
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
              <TextInput
                style={[styles.input, styles.carFormField]}
                placeholder="Cost"
                keyboardType="numeric"
                value={carDraft.cost}
                onChangeText={(text: string) => setCarDraft((p) => ({ ...p, cost: sanitizeCostInput(text) }))}
              />
              <TextInput
                style={[styles.input, styles.carFormField]}
                placeholder="Car model"
                value={carDraft.model}
                onChangeText={(text: string) => setCarDraft((p) => ({ ...p, model: text }))}
              />
              <TextInput
                style={[styles.input, styles.carFormWideField, styles.cellTextWrap]}
                placeholder="Notes"
                value={carDraft.notes}
                onChangeText={(text: string) => setCarDraft((p) => ({ ...p, notes: text }))}
                multiline
              />
              </View>
              <View style={styles.carMemberRow}>
                <View style={[styles.carMemberField, { flex: 1 }]}>
                  <Text style={styles.modalLabelSmall}>For</Text>
                  <View style={styles.payerChips}>
                    {carDraft.travelerIds.map((id) => (
                      <View key={`car-traveler-${id}`} style={styles.payerChip}>
                        <Text style={styles.cellText}>{payerName(id)}</Text>
                        <TouchableOpacity onPress={() => setCarDraft((prev) => ({ ...prev, travelerIds: prev.travelerIds.filter((x) => x !== id) }))}>
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
                <View style={[styles.carMemberField, { flex: 1 }]}>
                  <Text style={styles.modalLabelSmall}>Paid By</Text>
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
                <TouchableOpacity style={[styles.button, styles.carAddButton]} onPress={addCarRental} testID="car-rental-add">
                  <Text style={styles.buttonText}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {Platform.OS !== 'web' && carDateField && NativeDateTimePicker ? (
        <NativeDateTimePicker
          value={carDateValue}
          mode="date"
          onChange={(_: any, date: Date | undefined) => {
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

      
      {activePage === 'flights'
        ? renderSharedPageScroll(
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
              findActiveTrip={getActiveTrip}
              fetchGroupMembersForActiveTrip={fetchGroupMembersForActiveTrip}
              styles={styles}
              airportOptions={flightAirportOptions}
              onSearchAirports={fetchFlightAirports}
              externalEditFlightId={externalFlightEditId}
              onDataChanged={handleFlightsDataChanged}
              onExternalEditHandled={handleExternalEditHandled}
              showList={true}
              readOnly={isFollowingMode}
            />
          )
        : null}
      {activePage !== 'flights' && externalFlightEditId ? (
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
          findActiveTrip={getActiveTrip}
          fetchGroupMembersForActiveTrip={fetchGroupMembersForActiveTrip}
          styles={styles}
          airportOptions={flightAirportOptions}
          onSearchAirports={fetchFlightAirports}
          externalEditFlightId={externalFlightEditId}
          onDataChanged={handleFlightsDataChanged}
          onExternalEditHandled={handleExternalEditHandled}
          showList={false}
          readOnly={isFollowingMode}
        />
      ) : null}
      {activePage === 'trips' ? renderSharedPageScroll(
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
                        ? groupById.get(newTripGroupId)?.name ?? 'Select group'
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
                        const group = groupById.get(trip.groupId);
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
                      <Text style={styles.dangerButtonText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {activePage === 'overview'
            ? renderBoundedPage(
                <OverviewTab
                  backendUrl={backendUrl}
                  headers={headers}
                  jsonHeaders={jsonHeaders}
                  trip={activeTripForHome ?? activeTrip}
                  group={activeGroup}
                  attendees={groupMembers}
                  flights={flights}
                  lodgings={lodgings}
                  tours={tours}
                  carRentals={carRentals}
                  defaultPayerId={defaultPayerId}
                  styles={styles}
                  mapApp={mapApp}
                  aiItineraryPending={Boolean(activeTripId && asyncItineraryByTrip[activeTripId]?.status === 'pending')}
                  aiItineraryFailedMessage={
                    activeTripId && asyncItineraryByTrip[activeTripId]?.status === 'failed'
                      ? asyncItineraryByTrip[activeTripId]?.error ?? 'generation failed'
                      : null
                  }
                  onOpenAddress={openMaps}
                  onRefreshTrips={fetchTrips}
                  onRefreshGroups={fetchGroups}
                  onRefreshGroupMembers={fetchGroupMembersForActiveTrip}
                  onFlightDataChanged={handleFlightsDataChanged}
                  onLodgingDataChanged={handleLodgingsDataChanged}
                  onTourDataChanged={handleToursDataChanged}
                  onAddCarRental={addCarRentalFromOverview}
                  openFlightInFlightsTab={openFlightInFlightsTab}
                  openLodgingDetails={(lodging) => openLodgingDetails(lodging as Lodging)}
                />
              )
            : null}

      {activePage === 'trip-details'
        ? renderBoundedPage(
            <TripDetailsTab
              backendUrl={backendUrl}
              headers={headers}
              trip={selectedTrip}
              group={selectedTripGroup}
              styles={styles}
              openShareSignal={openShareFromHeaderSignal}
              onSetActive={(tripId) => setActiveTripId(tripId)}
              onOpenItinerary={handleOpenTripItinerary}
              onUpdateCurrency={updateTripCurrency}
            />
          )
        : null}

          {activePage === 'follow'
            ? renderSharedPageScroll(
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
                  onOpenFollowedTrip={(tripId) => {
                    setSelectedFollowedTripId(tripId);
                    requestPageChange('following');
                  }}
                />
              )
            : null}

          {activePage === 'following'
            ? renderSharedPageScroll(
                <FollowingTab
                  backendUrl={backendUrl}
                  headers={headers}
                  followedTrips={followedTrips}
                  styles={styles}
                  onRequireLogin={logout}
                  selectedTripId={selectedFollowedTripId}
                  onSelectTrip={setSelectedFollowedTripId}
                  onUnfollowTrip={handleUnfollowTrip}
                />
              )
            : null}

        </View>
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
                autoComplete="given-name"
                textContentType="givenName"
                value={authForm.firstName}
                onChangeText={(text: string) => setAuthForm((p) => ({ ...p, firstName: text }))}
              />
              <TextInput
                style={styles.input}
                placeholder="Last name"
                autoComplete="family-name"
                textContentType="familyName"
                value={authForm.lastName}
                onChangeText={(text: string) => setAuthForm((p) => ({ ...p, lastName: text }))}
              />
            </>
          ) : null}

          <TextInput
            style={styles.input}
            placeholder="Email or Username"
            autoCapitalize="none"
            autoComplete={authMode === 'register' ? 'email' : 'username'}
            textContentType={authMode === 'register' ? 'emailAddress' : 'username'}
            inputMode="email"
            nativeID="email"
            value={authForm.email}
            onChangeText={(text: string) => setAuthForm((p) => ({ ...p, email: text }))}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            secureTextEntry
            autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
            textContentType={authMode === 'register' ? 'newPassword' : 'password'}
            nativeID="password"
            value={authForm.password}
            onChangeText={(text: string) => setAuthForm((p) => ({ ...p, password: text }))}
          />
          {authMode === 'register' ? (
            <TextInput
              style={styles.input}
              placeholder="Confirm password"
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              nativeID="password-confirm"
              value={authForm.passwordConfirm}
              onChangeText={(text: string) => setAuthForm((p) => ({ ...p, passwordConfirm: text }))}
            />
          ) : null}
          {authMode === 'login' && showResendConfirmation ? (
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.button, styles.smallButton, resendConfirmationLoading && styles.buttonDisabled]}
                onPress={resendConfirmationEmail}
                disabled={resendConfirmationLoading}
              >
                <Text style={styles.buttonText}>{resendConfirmationLoading ? 'Resending...' : 'Resend confirmation'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.smallButton]}
                onPress={() => setShowResendConfirmation(false)}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {authErrorMessage ? (
            <View style={styles.authErrorBanner}>
              <Text style={styles.authErrorBannerText}>{authErrorMessage}</Text>
            </View>
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
      {userToken && requirePasswordSetup ? (
        <View style={styles.wizardOverlay}>
          <View style={[styles.wizardModal, styles.pendingInviteModal]}>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Set Your Password</Text>
              <Text style={styles.helperText}>
                This is your first Google sign-in for this account. Set a password now to finish account setup.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="New password"
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                nativeID="new-password"
                value={passwordSetupForm.newPassword}
                onChangeText={(text: string) => setPasswordSetupForm((p) => ({ ...p, newPassword: text }))}
              />
              <TextInput
                style={styles.input}
                placeholder="Confirm new password"
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                nativeID="new-password-confirm"
                value={passwordSetupForm.newPasswordConfirm}
                onChangeText={(text: string) => setPasswordSetupForm((p) => ({ ...p, newPasswordConfirm: text }))}
              />
              <TouchableOpacity
                style={[styles.button, passwordSetupLoading && styles.buttonDisabled]}
                onPress={completeInitialPasswordSetup}
                disabled={passwordSetupLoading}
              >
                <Text style={styles.buttonText}>{passwordSetupLoading ? 'Saving...' : 'Set Password'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
      {userToken && pendingInviteModalOpen ? (
        <View style={styles.wizardOverlay}>
          <View style={[styles.wizardModal, styles.pendingInviteModal]} testID="invite-modal">
            <View style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Trip Invites</Text>
                <TouchableOpacity
                  style={[styles.button, styles.smallButton]}
                  onPress={() => setPendingInviteModalOpen(false)}
                >
                  <Text style={styles.buttonText}>Close</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.helperText}>Choose which trips you want to join.</Text>
              <ScrollView style={styles.inviteList} contentContainerStyle={styles.inviteListContent}>
                {invites.map((invite) => {
                  const tripLabel = invite.resolvedTripName ?? invite.groupName ?? 'Upcoming Trip';
                  const inviterName = `${invite.inviterFirstName ?? ''} ${invite.inviterLastName ?? ''}`.trim();
                  const inviterLine = inviterName || invite.inviterEmail || 'Someone';
                  return (
                    <View key={invite.id} style={styles.inviteCard}>
                      <Text style={styles.bodyText}>{tripLabel}</Text>
                      <Text style={styles.helperText}>Invited by {inviterLine}</Text>
                      <View style={styles.row}>
                        <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => acceptInvite(invite)} testID={`invite-join-${invite.id}`}>
                          <Text style={styles.buttonText}>Join</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.button, styles.smallButton, styles.dangerButton]}
                          onPress={() => rejectInvite(invite)}
                          testID={`invite-decline-${invite.id}`}
                        >
                          <Text style={styles.dangerButtonText}>Decline</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </View>
      ) : null}
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
              theme={theme}
              onCancel={closeTripWizard}
              onTripCreated={onTripCreated}
              onAiItineraryQueued={onAiItineraryQueued}
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
          visible={true}
          title="Delete Lodging"
          message={`Are you sure you want to delete ${lodgingToDelete.name}? This cannot be undone.`}
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
          theme={theme}
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
      {/* Chat FAB — only when logged in and a trip is active */}
      {userToken && activeTripId && !chatOpen && (
        <ChatButton
          onPress={() => { setChatOpen(true); setChatMinimized(false); }}
          unreadCount={chatUnread}
        />
      )}
      {/* Chat Panel */}
      {userToken && activeTripId && chatOpen && !chatMinimized && (
        <ChatPanel
          socket={getSocket()}
          tripId={activeTripId}
          currentUserId={userId ?? ''}
          currentUserName={userName ?? 'Traveler'}
          onClose={() => setChatOpen(false)}
          onMinimize={() => setChatMinimized(true)}
          unreadCount={chatUnread}
          onUnreadChange={setChatUnread}
          theme={theme}
        />
      )}
      {/* Minimized chat badge */}
      {userToken && activeTripId && chatOpen && chatMinimized && (
        <ChatButton
          onPress={() => setChatMinimized(false)}
          unreadCount={chatUnread}
        />
      )}
    </SafeAreaView>
  );

  const renderAdminScreen = (section: AdminSectionRoute) => (
    <AdminTab
      backendUrl={backendUrl}
      headers={headers}
      initialSection={section}
      onSectionChange={(nextSection) => {
        if (nextSection === 'user-detail') return;
        openAdminSection(nextSection as AdminSectionRoute);
      }}
    />
  );

  return (
    <NavigationContainer ref={navigationRef} linking={linking}>
      <RootStack.Navigator>
        <RootStack.Screen name="Main" options={{ headerShown: false }}>
          {() => mainWorkspace}
        </RootStack.Screen>
        <RootStack.Group
          screenOptions={{
            headerShown: true,
            headerBackTitle: 'Back',
          }}
        >
          <RootStack.Screen
            name="AdminOverview"
            options={{ title: 'Admin' }}
          >
            {() => renderAdminScreen('overview')}
          </RootStack.Screen>
          <RootStack.Screen
            name="AdminUsers"
            options={{ title: 'Admin Users' }}
          >
            {() => renderAdminScreen('users')}
          </RootStack.Screen>
          <RootStack.Screen
            name="AdminTiers"
            options={{ title: 'Admin Tiers' }}
          >
            {() => renderAdminScreen('tiers')}
          </RootStack.Screen>
          <RootStack.Screen
            name="AdminFeatures"
            options={{ title: 'Admin Features' }}
          >
            {() => renderAdminScreen('features')}
          </RootStack.Screen>
          <RootStack.Screen
            name="AdminUserData"
            options={{ title: 'Admin User Data' }}
          >
            {() => renderAdminScreen('user-data')}
          </RootStack.Screen>
          <RootStack.Screen
            name="AdminAuditLog"
            options={{ title: 'Admin Audit Log' }}
          >
            {() => renderAdminScreen('audit-log')}
          </RootStack.Screen>
        </RootStack.Group>
      </RootStack.Navigator>
    </NavigationContainer>
  );
};

const App: React.FC = () => {
  const openAdminSection = useCallback((section: AdminSectionRoute) => {
    const screen = adminScreenBySection[section];
    if (screen && navigationRef.isReady()) {
      navigationRef.navigate(screen);
    }
  }, []);

  return (
    <AppShell
      initialAdminSection="overview"
      onOpenAdminSection={openAdminSection}
    />
  );
};

const buildStyles = (theme: AppTheme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.backgroundAlt,
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
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  },
  topBarStacked: {
    alignItems: 'stretch',
    rowGap: 8,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  topBarLeftNarrow: {
    flexWrap: 'wrap',
    minWidth: 0,
  },
  brandIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  homeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  homeButtonText: {
    color: theme.colors.onPrimary,
    fontSize: theme.typography.body,
    fontWeight: theme.typography.weightBold,
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    color: theme.colors.onPrimary,
    fontSize: theme.typography.body,
    fontWeight: theme.typography.weightBold,
  },
  topRightWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  topRightWrapperNarrow: {
    width: '100%',
    justifyContent: 'space-between',
    gap: 8,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topRightNarrow: {
    marginLeft: 'auto',
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
  contentViewport: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    position: 'relative',
  },
  pageScroll: {
    flex: 1,
    width: '100%',
    minHeight: 0,
  },
  pageScrollContent: {
    flexGrow: 1,
    padding: 16,
  },
  pageScrollInner: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    gap: 16,
  },
  pageViewport: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    padding: 16,
    alignItems: 'center',
  },
  pageViewportInner: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    maxWidth: 1200,
  },
  card: {
    width: '100%',
    maxWidth: 1200,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  homeScrollContent: {
    gap: 16,
  },
  homeTitle: {
    fontSize: theme.typography.h1,
    fontWeight: theme.typography.weightSemibold,
    color: theme.colors.text,
    marginBottom: 4,
  },
  homeHeroCard: {
    position: 'relative',
    borderRadius: 20,
    overflow: 'hidden',
    height: 180,
    backgroundColor: theme.colors.surfaceMuted,
  },
  homeHeroCardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.995 }],
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
    backgroundColor: theme.colors.surfaceMuted,
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
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  homeNavButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  homeNavButtonPressed: {
    backgroundColor: theme.colors.surfaceMuted,
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
    color: theme.colors.text,
  },
  homeNavArrow: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '600',
  },
  homeModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.background,
    zIndex: 30000,
    padding: 16,
  },
  homeModalCard: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
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
    color: theme.colors.text,
  },
  homeModalClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeModalClosePressed: {
    backgroundColor: theme.colors.backgroundAlt,
  },
  homeModalCloseText: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
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
    borderColor: theme.colors.border,
  },
  homeModalRowPressed: {
    backgroundColor: theme.colors.surfaceMuted,
  },
  homeModalRowActive: {
    backgroundColor: theme.colors.backgroundAlt,
  },
  homeModalRowText: {
    flex: 1,
  },
  homeModalRowTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
  },
  homeModalRowMeta: {
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  homeModalActiveBadge: {
    color: '#047857',
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    fontSize: theme.typography.h2,
    fontWeight: theme.typography.weightBold,
    color: theme.colors.text,
    flexShrink: 1,
  },
  titleNarrow: {
    fontSize: 18,
  },
  auth: {
    width: '100%',
    maxWidth: 420,
    marginTop: 40,
    padding: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  toggleRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  toggleButton: {
    flex: 1,
    padding: 10,
    borderBottomWidth: 2,
    borderColor: theme.colors.border,
  },
  toggleActive: {
    borderColor: theme.colors.link,
  },
  toggleText: {
    textAlign: 'center',
    fontWeight: theme.typography.weightSemibold,
    color: theme.colors.textMuted,
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
    borderColor: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
  expenseToggleSelected: {
    backgroundColor: theme.mode === 'dark' ? '#1A3A50' : '#DDE8F0',
    borderColor: theme.colors.link,
  },
  expenseToggleUnselected: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.text,
  },
  expenseToggleText: {
    fontWeight: '600',
    color: theme.colors.text,
  },
  expenseToggleTextSelected: {
    color: theme.colors.text,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
    width: '100%',
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
  },
  button: {
    backgroundColor: theme.colors.cta,
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  buttonText: {
    color: '#0B1726',
    fontWeight: theme.typography.weightBold,
  },
  topBarActionButton: {
    minHeight: 38,
    justifyContent: 'center',
    marginBottom: 0,
  },
  topBarTripControl: {
    minHeight: 38,
    marginBottom: 0,
    justifyContent: 'center',
    paddingVertical: 0,
  },
  userNameButton: {
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  userNameButtonText: {
    color: theme.colors.text,
    fontWeight: theme.typography.weightSemibold,
  },
  smallButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dangerButton: {
    backgroundColor: theme.colors.error,
  },
  dangerButtonText: {
    color: '#FFFFFF',
    fontWeight: theme.typography.weightBold,
  },
  toggleOption: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  toggleOptionSelected: {
    backgroundColor: theme.mode === 'dark' ? '#1A3A50' : '#DDE8F0',
    borderColor: theme.colors.link,
  },
  toggleOptionText: {
    color: theme.colors.text,
    fontWeight: theme.typography.weightSemibold,
  },
  toggleOptionTextSelected: {
    color: theme.colors.link,
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
    backgroundColor: theme.colors.surfaceMuted,
  },
  navButtonActive: {
    backgroundColor: theme.colors.primary,
  },
  navButtonText: {
    color: theme.colors.text,
    fontWeight: theme.typography.weightSemibold,
  },
  navButtonActiveText: {
    color: theme.colors.onPrimary,
  },
  section: {
    width: '100%',
    maxWidth: 1200,
    padding: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sectionTitle: {
    fontSize: theme.typography.h3,
    fontWeight: theme.typography.weightBold,
    color: theme.colors.text,
    marginBottom: 8,
  },
  helperText: {
    color: theme.colors.textMuted,
    marginBottom: 8,
    fontSize: theme.typography.small,
  },
  authErrorBanner: {
    width: '100%',
    backgroundColor: theme.colors.error,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  authErrorBannerText: {
    color: theme.colors.onPrimary,
    fontWeight: theme.typography.weightSemibold,
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
  sectionActions: {
    marginLeft: 'auto',
    flexWrap: 'wrap',
    gap: 8,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    gap: 8,
  },
  groupRowLast: {
    borderBottomWidth: 0,
  },
  table: {
    width: '100%',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 6,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  },
  tableHeaderRow: {
    backgroundColor: theme.colors.surfaceMuted,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  tableHeader: {
    backgroundColor: theme.colors.surfaceMuted,
  },
  cell: {
    padding: 8,
    borderRightWidth: 1,
    borderColor: theme.colors.border,
  },
  tableHeaderCell: {
    padding: 8,
    borderRightWidth: 1,
    borderColor: theme.colors.border,
  },
  tableCell: {
    padding: 8,
    borderRightWidth: 1,
    borderColor: theme.colors.border,
  },
  lastCell: {
    borderRightWidth: 0,
  },
  headerText: {
    fontWeight: theme.typography.weightBold,
    color: theme.colors.text,
  },
  cellText: {
    flexWrap: 'wrap',
    color: theme.colors.text,
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
    backgroundColor: theme.colors.link,
  },
  tableActionButtonDanger: {
    backgroundColor: theme.colors.error,
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
    fontSize: theme.typography.small,
    color: theme.colors.text,
  },
  flightsSection: {
    gap: 12,
  },
  flightsList: {
    gap: 8,
  },
  flightCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  flightTitle: {
    fontSize: theme.typography.body,
    fontWeight: theme.typography.weightSemibold,
    color: theme.colors.text,
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
    backgroundColor: theme.colors.surfaceMuted,
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
    fontWeight: theme.typography.weightSemibold,
    color: theme.colors.text,
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
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    gap: 8,
  },
  flightEditorWrap: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 12,
    marginVertical: 4,
  },
  flightRow: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: 12,
  },
  dayPill: {
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 8,
  },
  dayPillActive: {
    backgroundColor: theme.colors.primary,
  },
  dayPillText: {
    fontWeight: theme.typography.weightSemibold,
    color: theme.colors.text,
  },
  dayPillActiveText: {
    color: '#fff',
  },
  dayPillNumber: {
    fontWeight: theme.typography.weightBold,
    color: theme.colors.text,
    fontSize: theme.typography.caption,
  },
  dayPillDate: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
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
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
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
    backgroundColor: theme.colors.primary,
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
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 8,
  },
  dayInfoRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 6,
    alignItems: 'flex-start',
  },
  dayInfoText: {
    flex: 1,
    minWidth: 0,
  },
  lodgingImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceMuted,
  },
  lodgingImageFallback: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayInfoRoute: {
    fontSize: theme.typography.body,
    fontWeight: theme.typography.weightSemibold,
    color: theme.colors.text,
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  dayInfoButton: {
    alignSelf: 'center',
    paddingVertical: 6,
  },
  dayInfoButtonText: {
    color: theme.colors.text,
    fontWeight: theme.typography.weightSemibold,
  },
  dayNextButton: {
    backgroundColor: theme.colors.surfaceMuted,
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
    color: theme.colors.error,
    fontWeight: theme.typography.weightSemibold,
  },
  linkText: {
    color: theme.colors.link,
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
  carFormSection: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 12,
    gap: 10,
  },
  carFormGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'flex-start',
  },
  carFormField: {
    flex: 1,
    minWidth: 210,
    marginBottom: 0,
  },
  carFormWideField: {
    flexBasis: '100%',
    minWidth: 210,
    marginBottom: 0,
  },
  carMemberRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'flex-start',
  },
  carMemberField: {
    minWidth: 260,
  },
  carAddButton: {
    minHeight: 38,
    alignSelf: 'flex-end',
    marginLeft: 'auto',
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
    color: theme.colors.textMuted,
  },
  selectCaret: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    marginLeft: 8,
  },
  dropdownList: {
    position: 'absolute',
    top: 40,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 6,
    zIndex: 20000,
    elevation: 24,
  },
  dropdownOption: {
    padding: 10,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  prepaidSelectorButton: {
    marginBottom: 0,
    minHeight: 42,
    borderColor: theme.colors.cta,
    backgroundColor: theme.colors.surfaceMuted,
  },
  prepaidSelectorButtonSelected: {
    backgroundColor: theme.colors.surface,
  },
  prepaidSelectorText: {
    fontWeight: theme.typography.weightSemibold,
  },
  prepaidDropdownList: {
    top: '100%',
    marginTop: 6,
    zIndex: 24000,
    elevation: 28,
  },
  dateInputWrap: {
    position: 'relative',
    justifyContent: 'center',
    flex: 1,
    minWidth: 220,
    maxWidth: '100%',
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
  activeTripNarrow: {
    flex: 1,
    minWidth: 0,
    maxWidth: '72%',
  },
  warningText: {
    color: theme.colors.error,
    fontWeight: theme.typography.weightSemibold,
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
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 6,
    zIndex: 13000,
    elevation: 32,
  },
  modalCard: {
    backgroundColor: theme.colors.surface,
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
    fontSize: theme.typography.caption,
    color: theme.colors.textMuted,
    marginTop: 8,
  },
  modalLabelSmall: {
    fontSize: theme.typography.caption,
    color: theme.colors.textMuted,
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
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
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
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
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
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  traitChipSelected: {
    backgroundColor: theme.colors.link,
    borderColor: theme.colors.link,
  },
  traitChipText: {
    color: theme.colors.text,
    fontWeight: theme.typography.weightSemibold,
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
    backgroundColor: theme.mode === 'dark' ? theme.colors.surface : '#e0e0e0',
  },
  badgePending: {
    backgroundColor: '#f6c851',
  },
  badgeRemoved: {
    backgroundColor: theme.mode === 'dark' ? theme.colors.surfaceMuted : '#c7c7c7',
  },
  badgeText: {
    fontSize: theme.typography.caption,
    fontWeight: theme.typography.weightSemibold,
    color: theme.colors.text,
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
  pendingInviteModal: {
    maxWidth: 720,
  },
  inviteList: {
    maxHeight: 360,
  },
  inviteListContent: {
    gap: 12,
  },
  inviteCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: theme.colors.surface,
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
    backgroundColor: theme.colors.surface,
    padding: 16,
    borderRadius: 10,
    width: '100%',
    maxWidth: 420,
    boxShadow: '0 4px 10px rgba(0,0,0,0.25)',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  payerChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 8,
  },
  payerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: 16,
    paddingVertical: 2,
    paddingHorizontal: 8,
    gap: 4,
  },
  mapOptionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  mapOptionActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary,
  },
  mapOptionText: {
    color: theme.colors.text,
    fontSize: theme.typography.small,
    fontWeight: theme.typography.weightSemibold,
  },
  mapOptionActiveText: {
    color: theme.colors.onPrimary,
  },
  payerOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
});

export default App;
