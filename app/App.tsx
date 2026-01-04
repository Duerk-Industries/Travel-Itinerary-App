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
import { FlightsTab, type Flight, fetchFlightsForTrip } from './tabs/flights';
import { Tour, TourTab, fetchToursForTrip } from './tabs/tours';
import { computePayerTotals } from './tabs/costReport';
import { Trait, TraitsTab } from './tabs/traits';
import { FollowTab, fetchFollowedTripsApi, loadFollowCodes, loadFollowPayloads, saveFollowCodes, saveFollowPayloads, type FollowedTrip } from './tabs/follow';
import ItinerariesTab from './tabs/itineraries';
import CreateTripWizard from './tabs/createTripWizard';
import TripDetailsTab from './tabs/tripDetails';
import AccountTab, { fetchAccountProfile, fetchFamilyRelationships, fetchFellowTravelers, type FellowTraveler } from './tabs/account';
import {
  Lodging,
  LodgingDraft,
  buildLodgingPayload,
  calculateNights,
  createInitialLodgingState,
  fetchLodgingsApi,
  removeLodgingApi,
  saveLodgingApi,
  toLodgingDraft,
} from './tabs/lodging';
import { InvitePayload } from './utils/inviteCodes';

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
  createdAt: string;
}

interface GroupMemberOption {
  id: string;
  guestName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

type Page =
  | 'menu'
  | 'flights'
  | 'lodging'
  | 'tours'
  | 'groups'
  | 'trips'
  | 'create-trip'
  | 'trip-details'
  | 'traits'
  | 'itinerary'
  | 'cost'
  | 'account'
  | 'follow';

const backendUrl = Constants.expoConfig?.extra?.backendUrl ?? 'http://localhost:4000';
const sessionKey = 'stp.session';
const sessionDurationMs = 12 * 60 * 60 * 1000;

const loadSession = (): { token: string; name: string; email?: string; page?: string } | null => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(sessionKey);
    if (!raw) return null;
    const data = JSON.parse(raw) as { token: string; name: string; email?: string; expiresAt: number; page?: string };
    if (!data?.token || !data?.name || !data?.expiresAt) return null;
    if (Date.now() > data.expiresAt) {
      window.localStorage.removeItem(sessionKey);
      return null;
    }
    return { token: data.token, name: data.name, email: data.email, page: data.page };
  } catch {
    return null;
  }
};

const saveSession = (token: string, name: string, page?: string, email?: string | null) => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const payload = {
    token,
    name,
    email: email ?? undefined,
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
  const [userName, setUserName] = useState<string | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
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
  const [lodgingDraft, setLodgingDraft] = useState<LodgingDraft>(createInitialLodgingState());
  const [editingLodgingId, setEditingLodgingId] = useState<string | null>(null);
  const [editingLodging, setEditingLodging] = useState<LodgingDraft | null>(null);
  const [lodgingDateField, setLodgingDateField] = useState<'checkIn' | 'checkOut' | 'refund' | null>(null);
  const [lodgingDateContext, setLodgingDateContext] = useState<'draft' | 'edit'>('draft');
  const [lodgingDateValue, setLodgingDateValue] = useState<Date>(new Date());
  const lodgingCheckInRef = useRef<HTMLInputElement | null>(null);
  const lodgingCheckOutRef = useRef<HTMLInputElement | null>(null);
  const editLodgingCheckInRef = useRef<HTMLInputElement | null>(null);
  const editLodgingCheckOutRef = useRef<HTMLInputElement | null>(null);

  const [tours, setTours] = useState<Tour[]>([]);
  const [traits, setTraits] = useState<Trait[]>([]);
  const [newTraitName, setNewTraitName] = useState('');
  const [selectedTraitNames, setSelectedTraitNames] = useState<Set<string>>(new Set());
  const [activePage, setActivePage] = useState<Page>('menu');
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
  const [familyRelationships, setFamilyRelationships] = useState<any[]>([]);
  const [fellowTravelers, setFellowTravelers] = useState<FellowTraveler[]>([]);
  const [showRelationshipDropdown, setShowRelationshipDropdown] = useState(false);
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

  const flightsTotal = useMemo(
    () => flights.reduce((sum, f) => sum + (Number(f.cost) || 0), 0),
    [flights]
  );

  const lodgingTotal = useMemo(
    () => lodgings.reduce((sum, l) => sum + (Number(l.totalCost) || 0), 0),
    [lodgings]
  );

  const toursTotal = useMemo(() => tours.reduce((sum, t) => sum + (Number(t.cost) || 0), 0), [tours]);

  const overallCost = useMemo(() => flightsTotal + lodgingTotal + toursTotal, [flightsTotal, lodgingTotal, toursTotal]);

  const openMaps = (address: string) => {
    if (!address) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  const applyLodgingDate = (field: 'checkIn' | 'checkOut', value: string, context: 'draft' | 'edit') => {
    if (context === 'edit') {
      setEditingLodging((prev) => (prev ? { ...prev, [field === 'checkIn' ? 'checkInDate' : 'checkOutDate']: value } : prev));
    } else {
      setLodgingDraft((prev) => ({ ...prev, [field === 'checkIn' ? 'checkInDate' : 'checkOutDate']: value }));
    }
  };

  const openLodgingDatePicker = (field: 'checkIn' | 'checkOut', context: 'draft' | 'edit', current?: string) => {
    setLodgingDateContext(context);
    if (Platform.OS !== 'web' && NativeDateTimePicker) {
      const base = current && current.trim() ? new Date(current) : new Date();
      setLodgingDateValue(base);
      setLodgingDateField(field);
      return;
    }
    const ref =
      context === 'edit'
        ? field === 'checkIn'
          ? editLodgingCheckInRef.current
          : editLodgingCheckOutRef.current
        : field === 'checkIn'
          ? lodgingCheckInRef.current
          : lodgingCheckOutRef.current;
    if (ref?.showPicker) {
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

  const userMembers = useMemo(() => groupMembers.filter((m) => !m.guestName), [groupMembers]);

  // Per-user tour totals via shared helper. Note: if a tour has an explicit empty payer list,
  // we leave it unsplit (no cost assigned) so non-payers stay at $0.
  const payerTotals = useMemo(
    () =>
      computePayerTotals(
        tours,
        (t) => Number(t.cost) || 0,
        (t) => (Array.isArray(t.paidBy) ? t.paidBy : []),
        userMembers.map((m) => m.id),
        { fallbackOnEmpty: false }
      ),
    [tours, userMembers]
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

  // Per-user flight totals via shared helper. Explicitly empty paidBy means no split, so removed users go to $0.
  const flightsPayerTotals = useMemo(
    () =>
      computePayerTotals(
        flights,
        (f) => Number((f as any).cost) || 0,
        (f) => {
          const paidBy = (f as any).paidBy ?? (f as any).paid_by;
          return Array.isArray(paidBy) ? paidBy : [];
        },
        userMembers.map((m) => m.id),
        { fallbackOnEmpty: false }
      ),
    [flights, userMembers]
  );

  // Per-user lodging totals via shared helper. Explicitly empty paidBy means no split, so removed users go to $0.
  const lodgingPayerTotals = useMemo(
    () =>
      computePayerTotals(
        lodgings,
        (l) => Number(l.totalCost) || 0,
        (l) => (Array.isArray(l.paidBy) ? l.paidBy : []),
        userMembers.map((m) => m.id),
        { fallbackOnEmpty: false }
      ),
    [lodgings, userMembers]
  );

  const lodgingTotalsBalanced = useMemo(() => {
    const totals: Record<string, number> = {};
    userMembers.forEach((m) => {
      totals[m.id] = lodgingPayerTotals[m.id] ?? 0;
    });
    const assigned = Object.values(totals).reduce((sum, v) => sum + v, 0);
    const remainder = lodgingTotal - assigned;
    if (userMembers.length && Math.abs(remainder) > 1e-6) {
      const evenShare = remainder / userMembers.length;
      userMembers.forEach((m) => {
        totals[m.id] = (totals[m.id] ?? 0) + evenShare;
      });
      const afterEven = Object.values(totals).reduce((sum, v) => sum + v, 0);
      const adjust = lodgingTotal - afterEven;
      if (Math.abs(adjust) > 1e-6) {
        const first = userMembers[0]?.id;
        if (first) totals[first] = (totals[first] ?? 0) + adjust;
      }
    }
    return totals;
  }, [lodgingPayerTotals, lodgingTotal, userMembers]);

  const lodgingBreakdownSum = useMemo(
    () => Object.values(lodgingTotalsBalanced).reduce((sum, v) => sum + v, 0),
    [lodgingTotalsBalanced]
  );

  useEffect(() => {
    if (defaultPayerId && (!lodgingDraft.paidBy || lodgingDraft.paidBy.length === 0)) {
      setLodgingDraft((p) => ({ ...p, paidBy: [defaultPayerId] }));
    }
  }, [defaultPayerId]);

  useEffect(() => {
    const nights = calculateNights(lodgingDraft.checkInDate, lodgingDraft.checkOutDate);
    const totalNum = Number(lodgingDraft.totalCost) || 0;
    const computed = nights > 0 && totalNum ? (totalNum / nights).toFixed(2) : '';
    setLodgingDraft((prev) => ({ ...prev, costPerNight: computed }));
  }, [lodgingDraft.checkInDate, lodgingDraft.checkOutDate, lodgingDraft.totalCost]);

  useEffect(() => {
    if (!editingLodging) return;
    const nights = calculateNights(editingLodging.checkInDate, editingLodging.checkOutDate);
    const totalNum = Number(editingLodging.totalCost) || 0;
    const computed = nights > 0 && totalNum ? (totalNum / nights).toFixed(2) : '';
    if (computed !== editingLodging.costPerNight) {
      setEditingLodging((prev) => (prev ? { ...prev, costPerNight: computed } : prev));
    }
  }, [editingLodging?.checkInDate, editingLodging?.checkOutDate, editingLodging?.totalCost]);

  // Create or update a lodging; computes cost-per-night and applies default payer.
  const saveLodging = async (draft: LodgingDraft, lodgingId?: string | null) => {
    if (!activeTripId) {
      alert('Please enter a lodging name and select an active trip.');
      return;
    }
    const { payload, error } = buildLodgingPayload(draft, activeTripId, defaultPayerId);
    if (error || !payload) {
      alert(error);
      return;
    }
    const result = await saveLodgingApi(backendUrl, jsonHeaders, payload, lodgingId);
    if (!result.ok) {
      alert(result.error || 'Unable to save lodging');
      return;
    }
    if (lodgingId) {
      setEditingLodgingId(null);
      setEditingLodging(null);
    } else {
      setLodgingDraft(createInitialLodgingState());
    }
    fetchLodgings();
  };

  const removeLodging = async (id: string) => {
    const result = await removeLodgingApi(backendUrl, jsonHeaders, id);
    if (!result.ok) {
      alert(result.error || 'Unable to delete lodging');
      return;
    }
    fetchLodgings();
  };

  // Populate the lodging edit modal with the selected row.
  const openLodgingEditor = (lodging: Lodging) => {
    setEditingLodgingId(lodging.id);
    setEditingLodging(toLodgingDraft(lodging, { normalize: normalizeDateString, defaultPayerId }));
  };

  // Close the lodging edit modal.
  const closeLodgingEditor = () => {
    setEditingLodgingId(null);
    setEditingLodging(null);
  };

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
    setUserEmail(null);
    setFlights([]);
    setTours([]);
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
    setAccountProfile({ firstName: '', lastName: '', email: '' });
    setFamilyRelationships([]);
    setFellowTravelers([]);
    setActivePage('menu');
    clearSession();
  };

  const loadAccountProfile = useCallback(
    (token?: string) =>
      fetchAccountProfile({
        backendUrl,
        token: token ?? userToken,
        logout,
        setAccountProfile,
        setUserName,
        setUserEmail,
      }),
    [backendUrl, logout, setAccountProfile, setUserEmail, setUserName, userToken]
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
      const email = authForm.email.trim();
      setUserToken(data.token);
      setUserName(name);
      setUserEmail(email);
      setAccountProfile({
        firstName: data.user.firstName ?? '',
        lastName: data.user.lastName ?? '',
        email,
      });
      saveSession(data.token, name, 'menu', email);
      fetchFlights(data.token);
      fetchLodgings(data.token);
      fetchTours(data.token);
      fetchInvites(data.token);
      loadAccountProfile(data.token);
      loadFamilyRelationships(data.token);
      loadFellowTravelers(data.token);
      setActivePage('menu');
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
      const name = `${data.user.firstName} ${data.user.lastName}`;
      const email = authForm.email.trim();
      setUserToken(data.token);
      setUserName(name);
      setUserEmail(email);
      setAccountProfile({
        firstName: data.user.firstName ?? '',
        lastName: data.user.lastName ?? '',
        email,
      });
      saveSession(data.token, name, 'menu', email);
      fetchFlights(data.token);
      fetchLodgings(data.token);
      fetchTours(data.token);
      fetchInvites(data.token);
      loadAccountProfile(data.token);
      loadFamilyRelationships(data.token);
      loadFellowTravelers(data.token);
      setActivePage('menu');
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
      }));
      setGroupMembers(normalized);
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
    const data = await res.json().catch(() => ({}));
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

  useEffect(() => {
    if (userToken) {
      (async () => {
        const ok = await loadAccountProfile();
        if (!ok) return;
        fetchFlights();
        fetchLodgings();
        fetchTours();
        fetchInvites();
        fetchGroups();
        fetchTrips();
        try {
          const trips = await fetchFollowedTripsApi(backendUrl, headers);
          setFollowedTrips(trips);
        } catch (err) {
          if ((err as any).code === 'UNAUTHORIZED') {
            logout();
            return;
          }
          setFollowedTrips([]);
        }
        fetchTraits();
        fetchTraitProfile();
        fetchItineraries();
      })();
    }
  }, [headers, loadAccountProfile, userToken]);

  useEffect(() => {
    if (userToken) return;
    const session = loadSession();
    if (session) {
      setUserToken(session.token);
      setUserName(session.name);
      setUserEmail(session.email ?? null);
      const sessionPage = session.page;
      if (sessionPage === 'flights' || sessionPage === 'lodging' || sessionPage === 'groups' || sessionPage === 'trips' || sessionPage === 'create-trip' || sessionPage === 'trip-details' || sessionPage === 'traits' || sessionPage === 'itinerary' || sessionPage === 'tours' || sessionPage === 'cost' || sessionPage === 'account' || sessionPage === 'follow') {
        setActivePage(sessionPage as Page);
      } else {
        setActivePage('menu');
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
    saveSession(userToken, userName ?? 'Traveler', activePage, userEmail);
  }, [userToken, userName, userEmail, activePage]);

  useEffect(() => {
    if (userToken) {
      fetchFlights();
      fetchLodgings();
      fetchTours();
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

  const findActiveTrip = () => trips.find((t) => t.id === activeTripId);

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
      payload = { email };
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
                <TouchableOpacity style={[styles.button, activePage === 'lodging' && styles.toggleActive]} onPress={() => setActivePage('lodging')}>
                  <Text style={styles.buttonText}>Lodging</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, activePage === 'tours' && styles.toggleActive]} onPress={() => setActivePage('tours')}>
                  <Text style={styles.buttonText}>Tours</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, activePage === 'cost' && styles.toggleActive]} onPress={() => setActivePage('cost')}>
                  <Text style={styles.buttonText}>Cost Report</Text>
                </TouchableOpacity>
              <TouchableOpacity style={[styles.button, activePage === 'groups' && styles.toggleActive]} onPress={() => setActivePage('groups')}>
                <Text style={styles.buttonText}>Groups</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, activePage === 'trips' && styles.toggleActive]} onPress={() => setActivePage('trips')}>
                <Text style={styles.buttonText}>Trips</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, activePage === 'create-trip' && styles.toggleActive]} onPress={() => setActivePage('create-trip')}>
                <Text style={styles.buttonText}>Create Trip</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, activePage === 'account' && styles.toggleActive]} onPress={() => setActivePage('account')}>
                <Text style={styles.buttonText}>Account</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, activePage === 'traits' && styles.toggleActive]} onPress={() => setActivePage('traits')}>
                <Text style={styles.buttonText}>Traits</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, activePage === 'follow' && styles.toggleActive]} onPress={() => setActivePage('follow')}>
                <Text style={styles.buttonText}>Follow Trip</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, activePage === 'itinerary' && styles.toggleActive]} onPress={() => setActivePage('itinerary')}>
                <Text style={styles.buttonText}>Create Itinerary</Text>
              </TouchableOpacity>
            </View>
          </View>

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

      {activePage === 'traits' ? (
        <TraitsTab
          backendUrl={backendUrl}
          userToken={userToken}
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
          headers={headers}
          jsonHeaders={jsonHeaders}
          fetchTraits={fetchTraits}
          fetchTraitProfile={fetchTraitProfile}
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
              userMembers={userMembers}
              jsonHeaders={jsonHeaders}
              payerTotals={payerTotals}
              toursTotal={toursTotal}
              styles={styles}
              nativeDateTimePicker={NativeDateTimePicker}
              fetchTours={fetchTours}
            />
          ) : null}

          {activePage === 'cost' ? (
            <View style={[styles.card, styles.flightsSection]}>
              <Text style={styles.sectionTitle}>Cost Report</Text>
              <Text style={styles.helperText}>Combined totals by category and user.</Text>
              <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
                <View style={styles.table}>
                  <View style={[styles.tableRow, styles.tableHeader]}>
                    <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                      <Text style={styles.headerText}>Category</Text>
                    </View>
                    {userMembers.map((m) => (
                      <View key={m.id} style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                        <Text style={styles.headerText}>{formatMemberName(m)}</Text>
                      </View>
                    ))}
                    <View style={[styles.cell, styles.lastCell, { minWidth: 120, flex: 1 }]}>
                      <Text style={styles.headerText}>Total</Text>
                    </View>
                  </View>
                  {[
                    { label: 'Flights', total: flightsTotal },
                    { label: 'Lodging', total: lodgingTotal },
                    { label: 'Tours', total: toursTotal },
                  ].map((row, idx, arr) => (
                    <View key={row.label} style={[styles.tableRow, idx === arr.length - 1 && styles.lastRow]}>
                      <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                        <Text style={styles.cellText}>{row.label}</Text>
                      </View>
                      {userMembers.map((m) => {
                        let share = 0;
                        if (row.label === 'Tours') {
                          share = payerTotals[m.id] || 0;
                        } else if (row.label === 'Flights') {
                          const pay = flightsPayerTotals[m.id];
                          share = typeof pay === 'number' && pay > 0 ? pay : row.total / (userMembers.length || 1);
                        } else if (row.label === 'Lodging') {
                          const pay = lodgingTotalsBalanced[m.id];
                          share = typeof pay === 'number' ? pay : row.total / (userMembers.length || 1);
                        }
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
                    {userMembers.map((m) => {
                      const divisor = userMembers.length || 1;
                      const flightsShare = (() => {
                        const pay = flightsPayerTotals[m.id];
                        return typeof pay === 'number' && pay > 0 ? pay : flightsTotal / divisor;
                      })();
                      const lodgingShare = (() => {
                        const pay = lodgingTotalsBalanced[m.id];
                        return typeof pay === 'number' ? pay : lodgingTotal / divisor;
                      })();
                      const tourShare = payerTotals[m.id] || 0;
                      const total = flightsShare + lodgingShare + tourShare;
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
              saveSession={saveSession}
              headers={headers}
              jsonHeaders={jsonHeaders}
              logout={logout}
              styles={styles}
            />
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
                  const allMembers = group.members;
                  const acceptedRelationships = familyRelationships.filter((r) => r.status === 'accepted');
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
                        <Text style={styles.headerText}>Members & Relationships</Text>
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
                        {allMembers.map((m) => (
                          <View key={m.id} style={styles.memberPill}>
                            <Text style={styles.cellText}>{m.userEmail ?? m.email ?? m.guestName ?? 'Member'}</Text>
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
                            <Text style={styles.buttonText}>Invite by Email</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.addRow}>
                          <View style={[styles.input, styles.inlineInput, styles.dropdown, { flex: 1 }]}>
                            <TouchableOpacity onPress={() => setShowRelationshipDropdown((s) => !s)}>
                              <View style={styles.selectButtonRow}>
                                <Text style={styles.cellText}>
                                  {(() => {
                                    const relId = groupAddRelationship[group.id];
                                    const rel = acceptedRelationships.find((r) => r.id === relId);
                                    if (!rel) return 'Select Relationship';
                                    const name = `${rel.relative?.firstName ?? ''} ${rel.relative?.middleName ?? ''} ${rel.relative?.lastName ?? ''}`
                                      .replace(/\s+/g, ' ')
                                      .trim();
                                    return name || rel.relative?.email || 'Relationship';
                                  })()}
                                </Text>
                                <Text style={styles.selectCaret}>v</Text>
                              </View>
                            </TouchableOpacity>
                            {showRelationshipDropdown ? (
                              <View style={styles.dropdownList}>
                                {acceptedRelationships.map((rel) => {
                                  const name = `${rel.relative?.firstName ?? ''} ${rel.relative?.middleName ?? ''} ${rel.relative?.lastName ?? ''}`
                                    .replace(/\s+/g, ' ')
                                    .trim() || rel.relative?.email || 'Relationship';
                                  return (
                                    <TouchableOpacity
                                      key={rel.id}
                                      style={styles.dropdownOption}
                                      onPress={() => setGroupAddRelationship((prev) => ({ ...prev, [group.id]: rel.id }))}
                                    >
                                      <Text style={styles.cellText}>{name}</Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            ) : null}
                          </View>
                          <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => addMemberToGroup(group.id, 'relationship')}>
                            <Text style={styles.buttonText}>Add Relationship</Text>
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
                  placeholder="Add relationships by name (comma separated)"
                  value={groupGuestNames}
                  onChangeText={setGroupGuestNames}
                />
                <TouchableOpacity style={styles.button} onPress={createGroup}>
                  <Text style={styles.buttonText}>Create Group</Text>
                </TouchableOpacity>
                <Text style={styles.helperText}>
                  Users found in the system will receive an invite email (if SMTP is configured) or see it above after logging in.
                  Relationships are added directly without needing a login.
                </Text>
          </View>
        </>
      ) : null}

      {activePage === 'lodging' ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Lodging</Text>
          <Text style={styles.helperText}>Track stays for your active trip.</Text>
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

              {lodgings.map((l) => (
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
                    <Text style={[styles.cellText, styles.cellTextWrap]}>{l.paidBy?.length ? l.paidBy.map(payerName).join(', ') : '-'}</Text>
                  </View>
                  <View style={[styles.cell, styles.lodgingAddressCol]}>
                    <Text style={[styles.cellText, styles.cellTextWrap]}>{l.address || '-'}</Text>
                  </View>
                  <View style={[styles.cell, styles.actionCell, styles.lodgingActionCol, styles.lastCell]}>
                    {l.address ? (
                      <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => openMaps(l.address)}>
                        <Text style={styles.buttonText}>Map</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => openLodgingEditor(l)}>
                      <Text style={styles.buttonText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => removeLodging(l.id)}>
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
                    value={lodgingDraft.name}
                    onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, name: text }))}
                  />
                </View>
                <View style={[styles.cell, styles.lodgingDateCol]}>
                  <View style={styles.dateInputWrap}>
                    {Platform.OS === 'web' ? (
                      <input
                        ref={lodgingCheckInRef as any}
                        type="date"
                        value={lodgingDraft.checkInDate}
                        onChange={(e) =>
                          setLodgingDraft((prev) => ({ ...prev, checkInDate: normalizeDateString(e.target.value) }))
                        }
                        style={styles.input as any}
                      />
                    ) : (
                      <TouchableOpacity
                        style={[styles.input, styles.dateTouchable]}
                        onPress={() => openLodgingDatePicker('checkIn', 'draft', lodgingDraft.checkInDate)}
                      >
                        <Text style={styles.cellText}>{lodgingDraft.checkInDate || 'YYYY-MM-DD'}</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.dateIcon}
                      onPress={() => openLodgingDatePicker('checkIn', 'draft', lodgingDraft.checkInDate)}
                    >
                      <Text style={styles.selectCaret}>📅</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={[styles.cell, styles.lodgingDateCol]}>
                  <View style={styles.dateInputWrap}>
                    {Platform.OS === 'web' ? (
                      <input
                        ref={lodgingCheckOutRef as any}
                        type="date"
                        value={lodgingDraft.checkOutDate}
                        onChange={(e) =>
                          setLodgingDraft((prev) => ({ ...prev, checkOutDate: normalizeDateString(e.target.value) }))
                        }
                        style={styles.input as any}
                      />
                    ) : (
                      <TouchableOpacity
                        style={[styles.input, styles.dateTouchable]}
                        onPress={() => openLodgingDatePicker('checkOut', 'draft', lodgingDraft.checkOutDate)}
                      >
                        <Text style={styles.cellText}>{lodgingDraft.checkOutDate || 'YYYY-MM-DD'}</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.dateIcon}
                      onPress={() => openLodgingDatePicker('checkOut', 'draft', lodgingDraft.checkOutDate)}
                    >
                      <Text style={styles.selectCaret}>📅</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={[styles.cell, styles.lodgingRoomsCol]}>
                  <TextInput
                    style={styles.input}
                    placeholder="Rooms"
                    keyboardType="numeric"
                    value={lodgingDraft.rooms}
                    onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, rooms: text }))}
                  />
                </View>
                <View style={[styles.cell, styles.lodgingRefundCol]}>
                  <TextInput
                    style={styles.input}
                    placeholder="Refund by (YYYY-MM-DD)"
                    value={lodgingDraft.refundBy}
                    onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, refundBy: normalizeDateString(text) }))}
                  />
                </View>
                <View style={[styles.cell, styles.lodgingCostCol]}>
                  <TextInput
                    style={styles.input}
                    placeholder="Total $"
                    keyboardType="numeric"
                    value={lodgingDraft.totalCost}
                    onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, totalCost: text }))}
                  />
                </View>
                <View style={[styles.cell, styles.lodgingCostCol]}>
                  <Text style={styles.cellText}>{lodgingDraft.costPerNight ? `$${lodgingDraft.costPerNight}` : '-'}</Text>
                </View>
                <View style={[styles.cell, styles.lodgingPayerCol]}>
                  <View style={styles.payerChips}>
                    {lodgingDraft.paidBy.map((id) => (
                      <View key={id} style={styles.payerChip}>
                        <Text style={styles.cellText}>{payerName(id)}</Text>
                        <TouchableOpacity onPress={() => setLodgingDraft((prev) => ({ ...prev, paidBy: prev.paidBy.filter((x) => x !== id) }))}>
                          <Text style={styles.removeText}>x</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                  <View style={styles.payerOptions}>
                    {userMembers
                      .filter((m) => !lodgingDraft.paidBy.includes(m.id))
                      .map((m) => (
                        <TouchableOpacity
                          key={m.id}
                          style={styles.smallButton}
                          onPress={() => setLodgingDraft((prev) => ({ ...prev, paidBy: [...prev.paidBy, m.id] }))}
                        >
                          <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                        </TouchableOpacity>
                      ))}
                  </View>
                </View>
                <View style={[styles.cell, styles.lodgingAddressCol]}>
                  <TextInput
                    style={styles.input}
                    placeholder="Address"
                    value={lodgingDraft.address}
                    onChangeText={(text) => setLodgingDraft((prev) => ({ ...prev, address: text }))}
                  />
                </View>
                <View style={[styles.cell, styles.actionCell, styles.lodgingActionCol, styles.lastCell]}>
                  <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => saveLodging(lodgingDraft)}>
                    <Text style={styles.buttonText}>Add</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </ScrollView>
          <View style={{ marginTop: 12 }}>
            <Text style={styles.flightTitle}>Total lodging cost: ${lodgingTotal.toFixed(2)}</Text>
            <Text style={styles.helperText}>Breakdown (aligned with total even when no payers are set):</Text>
            {userMembers.map((m) => (
              <Text key={m.id} style={styles.helperText}>
                {formatMemberName(m)}: ${Number(lodgingTotalsBalanced[m.id] ?? 0).toFixed(2)}
              </Text>
            ))}
            <Text style={[styles.helperText, { marginTop: 4 }]}>Subtotal across payers: ${lodgingBreakdownSum.toFixed(2)}</Text>
          </View>
          {Platform.OS !== 'web' && lodgingDateField && NativeDateTimePicker ? (
            <NativeDateTimePicker
              value={lodgingDateValue}
              mode="date"
              onChange={(_, date) => {
                if (!date) {
                  setLodgingDateField(null);
                  return;
                }
                const iso = date.toISOString().slice(0, 10);
                applyLodgingDate(lodgingDateField, iso, lodgingDateContext);
                setLodgingDateField(null);
              }}
            />
          ) : null}
        </View>
      ) : null}

      {editingLodging && editingLodgingId ? (
        <View style={styles.passengerOverlay}>
          <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={closeLodgingEditor} />
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>Edit Lodging</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.modalLabel}>Name</Text>
              <TextInput
                style={styles.input}
                value={editingLodging.name}
                onChangeText={(text) => setEditingLodging((prev) => (prev ? { ...prev, name: text } : prev))}
              />
              <Text style={styles.modalLabel}>Check-in</Text>
              <View style={styles.dateInputWrap}>
                {Platform.OS === 'web' ? (
                  <input
                    ref={editLodgingCheckInRef as any}
                    type="date"
                    value={editingLodging.checkInDate}
                    onChange={(e) =>
                      setEditingLodging((prev) => (prev ? { ...prev, checkInDate: normalizeDateString(e.target.value) } : prev))
                    }
                    style={styles.input as any}
                  />
                ) : (
                  <TouchableOpacity
                    style={[styles.input, styles.dateTouchable]}
                    onPress={() => openLodgingDatePicker('checkIn', 'edit', editingLodging.checkInDate)}
                  >
                    <Text style={styles.cellText}>{editingLodging.checkInDate || 'YYYY-MM-DD'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.dateIcon}
                  onPress={() => openLodgingDatePicker('checkIn', 'edit', editingLodging.checkInDate)}
                >
                  <Text style={styles.selectCaret}>📅</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.modalLabel}>Check-out</Text>
              <View style={styles.dateInputWrap}>
                {Platform.OS === 'web' ? (
                  <input
                    ref={editLodgingCheckOutRef as any}
                    type="date"
                    value={editingLodging.checkOutDate}
                    onChange={(e) =>
                      setEditingLodging((prev) => (prev ? { ...prev, checkOutDate: normalizeDateString(e.target.value) } : prev))
                    }
                    style={styles.input as any}
                  />
                ) : (
                  <TouchableOpacity
                    style={[styles.input, styles.dateTouchable]}
                    onPress={() => openLodgingDatePicker('checkOut', 'edit', editingLodging.checkOutDate)}
                  >
                    <Text style={styles.cellText}>{editingLodging.checkOutDate || 'YYYY-MM-DD'}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.dateIcon}
                  onPress={() => openLodgingDatePicker('checkOut', 'edit', editingLodging.checkOutDate)}
                >
                  <Text style={styles.selectCaret}>📅</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.modalLabel}>Rooms</Text>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                value={editingLodging.rooms}
                onChangeText={(text) => setEditingLodging((prev) => (prev ? { ...prev, rooms: text } : prev))}
              />
              <Text style={styles.modalLabel}>Refund by</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={editingLodging.refundBy}
                  onChange={(e) => setEditingLodging((prev) => (prev ? { ...prev, refundBy: e.target.value } : prev))}
                  style={styles.input as any}
                />
              ) : (
                <TextInput
                  style={styles.input}
                  value={editingLodging.refundBy}
                  placeholder="YYYY-MM-DD"
                  onChangeText={(text) => setEditingLodging((prev) => (prev ? { ...prev, refundBy: normalizeDateString(text) } : prev))}
                />
              )}
              <Text style={styles.modalLabel}>Total cost</Text>
              <TextInput
                style={styles.input}
                value={editingLodging.totalCost}
                keyboardType="numeric"
                onChangeText={(text) => setEditingLodging((prev) => (prev ? { ...prev, totalCost: text } : prev))}
              />
              <Text style={styles.modalLabel}>Cost per night</Text>
              <Text style={styles.helperText}>{editingLodging.costPerNight ? `$${editingLodging.costPerNight}` : '-'}</Text>

              <Text style={styles.modalLabel}>Paid by</Text>
              <View style={[styles.input, styles.payerBox]}>
                <View style={styles.payerChips}>
                  {editingLodging.paidBy.map((id) => (
                    <View key={id} style={styles.payerChip}>
                      <Text style={styles.cellText}>{payerName(id)}</Text>
                      <TouchableOpacity
                        onPress={() =>
                          setEditingLodging((p) =>
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
                    .filter((m) => !editingLodging.paidBy.includes(m.id))
                    .map((m) => (
                      <TouchableOpacity
                        key={m.id}
                        style={styles.smallButton}
                        onPress={() => setEditingLodging((p) => (p ? { ...p, paidBy: [...p.paidBy, m.id] } : p))}
                      >
                        <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                      </TouchableOpacity>
                    ))}
                </View>
              </View>

              <Text style={styles.modalLabel}>Address</Text>
              <TextInput
                style={styles.input}
                value={editingLodging.address}
                onChangeText={(text) => setEditingLodging((prev) => (prev ? { ...prev, address: text } : prev))}
              />
            </ScrollView>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={closeLodgingEditor}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.button}
                onPress={() => editingLodging && saveLodging(editingLodging, editingLodgingId)}
              >
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
      {activePage === 'flights' ? (
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
        />
      ) : null}
      {activePage === 'trips' ? (
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.sectionTitle}>Trips</Text>
                <TouchableOpacity
                  style={[styles.button, styles.smallButton, { marginLeft: 'auto' }]}
                  onPress={() => setActivePage('create-trip')}
                >
                  <Text style={styles.buttonText}>Open Wizard</Text>
                </TouchableOpacity>
              </View>
              {(() => {
                const inviteEmails = groups.flatMap((g) => g.invites.map((inv) => inv.inviteeEmail));
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
                        setActivePage('trip-details');
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

          {activePage === 'create-trip' ? (
            <CreateTripWizard
              backendUrl={backendUrl}
              userToken={userToken}
              headers={headers}
              traits={traits}
              styles={styles}
              onCancel={() => setActivePage('trips')}
              onTripCreated={(tripId) => {
                setActiveTripId(tripId);
                setSelectedTripId(tripId);
                fetchTrips();
                fetchGroups();
                fetchInvites();
                setActivePage('trip-details');
              }}
            />
          ) : null}

          {activePage === 'trip-details' ? (
            <TripDetailsTab
              trip={trips.find((t) => t.id === selectedTripId) ?? null}
              group={groups.find((g) => g.id === trips.find((t) => t.id === selectedTripId)?.groupId) ?? null}
              styles={styles}
              onBack={() => setActivePage('trips')}
              onSetActive={(tripId) => setActiveTripId(tripId)}
              onOpenItinerary={(tripId) => {
                setActiveTripId(tripId);
                setActivePage('itinerary');
              }}
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
  divider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 12,
  },
  accountSection: {
    gap: 6,
  },
  button: {
    backgroundColor: '#0d6efd',
    padding: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginVertical: 6,
  },
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  budgetIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#0d6efd',
    backgroundColor: 'transparent',
  },
  budgetIndicatorActive: {
    backgroundColor: '#fff',
    borderColor: '#fff',
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
  familyRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
    gap: 4,
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
  formGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  totalRow: {
    marginTop: 8,
  },
  summaryRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryOverall: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
    marginTop: 12,
  },
  summaryBreakdown: {
    marginTop: 6,
    gap: 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  payerBox: {
    display: 'flex',
    gap: 6,
  },
  payerChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  payerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#e5e7eb',
    borderRadius: 12,
  },
  payerOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    marginTop: 4,
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
  followTripItem: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  lodgingNameCol: { minWidth: 120, maxWidth: 320, flex: 1 },
  lodgingDateCol: { minWidth: 120, maxWidth: 320, flex: 1 },
  lodgingRoomsCol: { minWidth: 80, maxWidth: 320, flex: 1 },
  lodgingRefundCol: { minWidth: 120, maxWidth: 320, flex: 1 },
  lodgingCostCol: { minWidth: 100, maxWidth: 320, flex: 1 },
  lodgingPayerCol: { minWidth: 140, maxWidth: 320, flex: 1 },
  lodgingAddressCol: { minWidth: 140, maxWidth: 320, flex: 1 },
  lodgingActionCol: { minWidth: 140, maxWidth: 320, flex: 1 },
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
    zIndex: 11000,
    elevation: 18,
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
    pointerEvents: 'auto',
    elevation: 40, // keep above other inputs on native
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
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
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
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
});

export default App;
