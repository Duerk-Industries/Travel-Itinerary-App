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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import { formatDateLong } from './utils/formatDateLong';
import { normalizeDateString } from './utils/normalizeDateString';
import { FlightsTab, type Flight, fetchFlightsForTrip } from './tabs/flights';
import { computePayerTotals } from './tabs/costReport';
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
import { encodeInviteCode, generateInviteGuid, InvitePayload } from './utils/inviteCodes';

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
  createdAt: string;
}

interface FollowedTrip {
  tripId: string;
  tripName: string;
  inviterName?: string;
  destination?: string;
  todayDetails: Array<{ id?: string; day?: number; time?: string | null; activity: string }>;
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

type Page = 'menu' | 'flights' | 'lodging' | 'tours' | 'groups' | 'trips' | 'traits' | 'itinerary' | 'cost' | 'account' | 'follow';

type Tour = {
  id: string;
  date: string;
  name: string;
  startLocation: string;
  startTime: string;
  duration: string;
  cost: string;
  freeCancelBy: string;
  bookedOn: string;
  reference: string;
  paidBy: string[];
};

type TourDraft = {
  date: string;
  name: string;
  startLocation: string;
  startTime: string;
  duration: string;
  cost: string;
  freeCancelBy: string;
  bookedOn: string;
  reference: string;
  paidBy: string[];
};

// Build a blank tour draft with today's date and zero cost.
const createInitialTourState = (): TourDraft => ({
  date: new Date().toISOString().slice(0, 10),
  name: '',
  startLocation: '',
  startTime: '',
  duration: '',
  cost: '0',
  freeCancelBy: new Date().toISOString().slice(0, 10),
  bookedOn: '',
  reference: '',
  paidBy: [],
});

const countryOptions = [
  'Afghanistan',
  'Albania',
  'Algeria',
  'Andorra',
  'Angola',
  'Antigua and Barbuda',
  'Argentina',
  'Armenia',
  'Australia',
  'Austria',
  'Azerbaijan',
  'Bahamas',
  'Bahrain',
  'Bangladesh',
  'Barbados',
  'Belarus',
  'Belgium',
  'Belize',
  'Benin',
  'Bhutan',
  'Bolivia',
  'Bosnia and Herzegovina',
  'Botswana',
  'Brazil',
  'Brunei',
  'Bulgaria',
  'Burkina Faso',
  'Burundi',
  'Cabo Verde',
  'Cambodia',
  'Cameroon',
  'Canada',
  'Central African Republic',
  'Chad',
  'Chile',
  'China',
  'Colombia',
  'Comoros',
  'Congo',
  'Costa Rica',
  'Cote d Ivoire',
  'Croatia',
  'Cuba',
  'Cyprus',
  'Czechia',
  'Democratic Republic of the Congo',
  'Denmark',
  'Djibouti',
  'Dominica',
  'Dominican Republic',
  'Ecuador',
  'Egypt',
  'El Salvador',
  'Equatorial Guinea',
  'Eritrea',
  'Estonia',
  'Eswatini',
  'Ethiopia',
  'Fiji',
  'Finland',
  'France',
  'Gabon',
  'Gambia',
  'Georgia',
  'Germany',
  'Ghana',
  'Greece',
  'Grenada',
  'Guatemala',
  'Guinea',
  'Guinea-Bissau',
  'Guyana',
  'Haiti',
  'Honduras',
  'Hungary',
  'Iceland',
  'India',
  'Indonesia',
  'Iran',
  'Iraq',
  'Ireland',
  'Israel',
  'Italy',
  'Jamaica',
  'Japan',
  'Jordan',
  'Kazakhstan',
  'Kenya',
  'Kiribati',
  'Kuwait',
  'Kyrgyzstan',
  'Laos',
  'Latvia',
  'Lebanon',
  'Lesotho',
  'Liberia',
  'Libya',
  'Liechtenstein',
  'Lithuania',
  'Luxembourg',
  'Madagascar',
  'Malawi',
  'Malaysia',
  'Maldives',
  'Mali',
  'Malta',
  'Marshall Islands',
  'Mauritania',
  'Mauritius',
  'Mexico',
  'Micronesia',
  'Moldova',
  'Monaco',
  'Mongolia',
  'Montenegro',
  'Morocco',
  'Mozambique',
  'Myanmar',
  'Namibia',
  'Nauru',
  'Nepal',
  'Netherlands',
  'New Zealand',
  'Nicaragua',
  'Niger',
  'Nigeria',
  'North Korea',
  'North Macedonia',
  'Norway',
  'Oman',
  'Pakistan',
  'Palau',
  'Panama',
  'Papua New Guinea',
  'Paraguay',
  'Peru',
  'Philippines',
  'Poland',
  'Portugal',
  'Qatar',
  'Romania',
  'Russia',
  'Rwanda',
  'Saint Kitts and Nevis',
  'Saint Lucia',
  'Saint Vincent and the Grenadines',
  'Samoa',
  'San Marino',
  'Sao Tome and Principe',
  'Saudi Arabia',
  'Senegal',
  'Serbia',
  'Seychelles',
  'Sierra Leone',
  'Singapore',
  'Slovakia',
  'Slovenia',
  'Solomon Islands',
  'Somalia',
  'South Africa',
  'South Korea',
  'South Sudan',
  'Spain',
  'Sri Lanka',
  'Sudan',
  'Suriname',
  'Sweden',
  'Switzerland',
  'Syria',
  'Taiwan',
  'Tajikistan',
  'Tanzania',
  'Thailand',
  'Timor-Leste',
  'Togo',
  'Tonga',
  'Trinidad and Tobago',
  'Tunisia',
  'Turkey',
  'Turkmenistan',
  'Tuvalu',
  'Uganda',
  'Ukraine',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
  'Uruguay',
  'Uzbekistan',
  'Vanuatu',
  'Vatican City',
  'Venezuela',
  'Vietnam',
  'Yemen',
  'Zambia',
  'Zimbabwe',
];

const countryRegions: Record<string, string[]> = {
  'United States': [
    'Alabama',
    'Alaska',
    'Arizona',
    'Arkansas',
    'California',
    'Colorado',
    'Connecticut',
    'Delaware',
    'Florida',
    'Georgia',
    'Hawaii',
    'Idaho',
    'Illinois',
    'Indiana',
    'Iowa',
    'Kansas',
    'Kentucky',
    'Louisiana',
    'Maine',
    'Maryland',
    'Massachusetts',
    'Michigan',
    'Minnesota',
    'Mississippi',
    'Missouri',
    'Montana',
    'Nebraska',
    'Nevada',
    'New Hampshire',
    'New Jersey',
    'New Mexico',
    'New York',
    'North Carolina',
    'North Dakota',
    'Ohio',
    'Oklahoma',
    'Oregon',
    'Pennsylvania',
    'Rhode Island',
    'South Carolina',
    'South Dakota',
    'Tennessee',
    'Texas',
    'Utah',
    'Vermont',
    'Virginia',
    'Washington',
    'West Virginia',
    'Wisconsin',
    'Wyoming',
  ],
  Canada: [
    'Alberta',
    'British Columbia',
    'Manitoba',
    'New Brunswick',
    'Newfoundland and Labrador',
    'Northwest Territories',
    'Nova Scotia',
    'Nunavut',
    'Ontario',
    'Prince Edward Island',
    'Quebec',
    'Saskatchewan',
    'Yukon',
  ],
  Australia: ['Australian Capital Territory', 'New South Wales', 'Northern Territory', 'Queensland', 'South Australia', 'Tasmania', 'Victoria', 'Western Australia'],
  India: [
    'Andhra Pradesh',
    'Assam',
    'Bihar',
    'Chhattisgarh',
    'Delhi',
    'Goa',
    'Gujarat',
    'Haryana',
    'Himachal Pradesh',
    'Jammu and Kashmir',
    'Jharkhand',
    'Karnataka',
    'Kerala',
    'Madhya Pradesh',
    'Maharashtra',
    'Manipur',
    'Meghalaya',
    'Mizoram',
    'Nagaland',
    'Odisha',
    'Punjab',
    'Rajasthan',
    'Sikkim',
    'Tamil Nadu',
    'Telangana',
    'Tripura',
    'Uttar Pradesh',
    'Uttarakhand',
    'West Bengal',
  ],
  'United Kingdom': ['England', 'Northern Ireland', 'Scotland', 'Wales'],
};

const backendUrl = Constants.expoConfig?.extra?.backendUrl ?? 'http://localhost:4000';
const sessionKey = 'stp.session';
const sessionDurationMs = 12 * 60 * 60 * 1000;
const followCodesKey = 'stp.followCodes';
const followPayloadsKey = 'stp.followPayloads';

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

const loadFollowCodes = (): Record<string, string> => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(followCodesKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
};

const saveFollowCodes = (codes: Record<string, string>) => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.localStorage.setItem(followCodesKey, JSON.stringify(codes));
};

const loadFollowPayloads = (): Record<string, InvitePayload> => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(followPayloadsKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, InvitePayload>;
    }
    return {};
  } catch {
    return {};
  }
};

const saveFollowPayloads = (payloads: Record<string, InvitePayload>) => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  window.localStorage.setItem(followPayloadsKey, JSON.stringify(payloads));
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
  const [editingTour, setEditingTour] = useState<TourDraft | null>(null);
  const [editingTourId, setEditingTourId] = useState<string | null>(null);
  const [tourDateField, setTourDateField] = useState<'date' | 'bookedOn' | 'freeCancel' | 'startTime' | null>(null);
  const [tourDateValue, setTourDateValue] = useState<Date>(new Date());
  const [traits, setTraits] = useState<Trait[]>([]);
  const [newTraitName, setNewTraitName] = useState('');
  const [selectedTraitNames, setSelectedTraitNames] = useState<Set<string>>(new Set());
  const [activePage, setActivePage] = useState<Page>('menu');
  const [itineraryCountry, setItineraryCountry] = useState('');
  const [itineraryRegion, setItineraryRegion] = useState('');
  const [countrySearch, setCountrySearch] = useState('');
  const [regionSearch, setRegionSearch] = useState('');
  const [showItineraryCountryDropdown, setShowItineraryCountryDropdown] = useState(false);
  const [showItineraryRegionDropdown, setShowItineraryRegionDropdown] = useState(false);
  const [itineraryDays, setItineraryDays] = useState('5');
  const [budgetMin, setBudgetMin] = useState(500);
  const [budgetMax, setBudgetMax] = useState(2500);
  const [budgetLevel, setBudgetLevel] = useState<'cheap' | 'middle' | 'expensive'>('middle');
  const [itineraryAirport, setItineraryAirport] = useState('');
  const [itineraryAirportOptions, setItineraryAirportOptions] = useState<string[]>([]);
  const [showItineraryAirportDropdown, setShowItineraryAirportDropdown] = useState(false);
  const [flightAirportOptions, setFlightAirportOptions] = useState<string[]>([]);
  const [itineraryPlan, setItineraryPlan] = useState('');
  const [itineraryTripStyle, setItineraryTripStyle] = useState('');
  const [itineraryLoading, setItineraryLoading] = useState(false);
  const [itineraryError, setItineraryError] = useState('');
  const [itineraryRecords, setItineraryRecords] = useState<ItineraryRecord[]>([]);
  const [itineraryDetails, setItineraryDetails] = useState<Record<string, ItineraryDetailRecord[]>>({});
  const [selectedItineraryId, setSelectedItineraryId] = useState<string | null>(null);
  const [editingItineraryId, setEditingItineraryId] = useState<string | null>(null);
  const [editingDetailId, setEditingDetailId] = useState<string | null>(null);
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
    passwordConfirm: '',
  });
  const [accountProfile, setAccountProfile] = useState({ firstName: '', lastName: '', email: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', newPasswordConfirm: '' });
  const [showPasswordEditor, setShowPasswordEditor] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [familyRelationships, setFamilyRelationships] = useState<any[]>([]);
  const [familyForm, setFamilyForm] = useState({ givenName: '', middleName: '', familyName: '', email: '', relationship: 'Not Applicable' });
  const [editingFamilyId, setEditingFamilyId] = useState<string | null>(null);
  const [editingFamilyDraft, setEditingFamilyDraft] = useState<{ givenName: string; middleName: string; familyName: string; email: string; relationship: string } | null>(null);
  const [showRelationshipDropdown, setShowRelationshipDropdown] = useState(false);
  const relationshipOptions = [
    'Not Applicable',
    'Parent',
    'Child',
    'Sibling',
    'Spouse/Partner',
    'Grandparent',
    'Grandchild',
    'Aunt/Uncle',
    'Niece/Nephew',
    'Cousin',
    'Friend',
  ];
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

  const filteredCountries = useMemo(() => {
    const query = (showItineraryCountryDropdown ? countrySearch : itineraryCountry).trim().toLowerCase();
    if (!query) return countryOptions;
    return countryOptions.filter((c) => c.toLowerCase().includes(query));
  }, [countrySearch, itineraryCountry, showItineraryCountryDropdown]);

  const regionOptions = useMemo(() => countryRegions[itineraryCountry] ?? [], [itineraryCountry]);

  const filteredRegions = useMemo(() => {
    if (!regionOptions.length) return [];
    const query = (showItineraryRegionDropdown ? regionSearch : itineraryRegion).trim().toLowerCase();
    if (!query) return regionOptions;
    return regionOptions.filter((r) => r.toLowerCase().includes(query));
  }, [itineraryRegion, regionOptions, regionSearch, showItineraryRegionDropdown]);

  const findExistingItinerary = (
    tripId: string,
    destination: string,
    days: number,
    excludeId?: string | null,
    budget?: number | null
  ) => {
    const dest = destination.trim().toLowerCase();
    const normalizedBudget = budget != null ? Number(budget) : null;
    return itineraryRecords.find(
      (i) =>
        i.id !== excludeId &&
        i.tripId === tripId &&
        i.destination.trim().toLowerCase() === dest &&
        i.days === days &&
        (i.budget ?? null) === (normalizedBudget ?? null)
    );
  };

  const beginEditItinerary = (it: ItineraryRecord) => {
    setEditingItineraryId(it.id);
    setSelectedItineraryId(it.id);
    setActiveTripId(it.tripId);
    setItineraryCountry(it.destination);
    setItineraryDays(String(it.days));
    if (it.budget != null) setBudgetMax(Number(it.budget));
    fetchItineraryDetails(it.id);
  };

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

  useEffect(() => {
    const presets: Record<typeof budgetLevel, { min: number; max: number }> = {
      cheap: { min: 500, max: 1500 },
      middle: { min: 1500, max: 4000 },
      expensive: { min: 4000, max: 8000 },
    };
    const preset = presets[budgetLevel];
    setBudgetMin(preset.min);
    setBudgetMax(preset.max);
  }, [budgetLevel]);

  useEffect(() => {
    const presets: Record<typeof budgetLevel, { min: number; max: number }> = {
      cheap: { min: 500, max: 1500 },
      middle: { min: 1500, max: 4000 },
      expensive: { min: 4000, max: 8000 },
    };
    const preset = presets[budgetLevel];
    setBudgetMin(preset.min);
    setBudgetMax(preset.max);
  }, [budgetLevel]);

  useEffect(() => {
    setItineraryRegion('');
    setRegionSearch('');
    setShowItineraryRegionDropdown(false);
  }, [itineraryCountry]);

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

  // Set which tour date/time picker to edit and seed the current value.
  const openTourDatePicker = (field: 'date' | 'bookedOn' | 'freeCancel' | 'startTime') => {
    setTourDateField(field);
    const current = editingTour
      ? field === 'date'
        ? editingTour.date
        : field === 'bookedOn'
          ? editingTour.bookedOn
          : field === 'freeCancel'
            ? editingTour.freeCancelBy
            : editingTour.startTime
      : null;
    if (field === 'startTime') {
      const base = new Date();
      if (current && /^\d{1,2}:\d{2}/.test(current)) {
        const [h, m] = current.split(':').map(Number);
        if (!Number.isNaN(h) && !Number.isNaN(m)) {
          base.setHours(h, m, 0, 0);
        }
      }
      setTourDateValue(base);
    } else {
      setTourDateValue(current ? new Date(current) : new Date());
    }
  };

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

  const openTourEditor = (tour?: Tour) => {
    if (!activeTripId) {
      alert('Select an active trip before adding a tour.');
      return;
    }
    const base = tour ? { ...tour } : createInitialTourState();
    if (!tour && defaultPayerId && !base.paidBy.includes(defaultPayerId)) {
      base.paidBy = [...base.paidBy, defaultPayerId];
    }
    setEditingTour(base);
    setEditingTourId(tour?.id ?? null);
    const baseDate = tour?.date ?? new Date().toISOString().slice(0, 10);
    setTourDateValue(baseDate ? new Date(baseDate) : new Date());
  };

  const closeTourEditor = () => {
    setEditingTour(null);
    setEditingTourId(null);
    setTourDateField(null);
  };

  const saveTour = () => {
    if (!editingTour) return;
    if (!editingTour.name.trim()) {
      alert('Please enter a tour name.');
      return;
    }
    const cleanCost = (editingTour.cost || '').replace(/[^0-9.]/g, '');
    let payload: TourDraft = { ...editingTour, cost: cleanCost };
    if ((!payload.paidBy || payload.paidBy.length === 0) && defaultPayerId) {
      payload = { ...payload, paidBy: [defaultPayerId] };
    }
    if (!activeTripId) {
      alert('Select an active trip before saving a tour.');
      return;
    }
    const method = editingTourId ? 'PUT' : 'POST';
    const url = editingTourId ? `${backendUrl}/api/tours/${editingTourId}` : `${backendUrl}/api/tours`;
    (async () => {
      try {
        const res = await fetch(url, {
          method,
          headers: jsonHeaders,
          body: JSON.stringify({
            ...payload,
            tripId: activeTripId,
            freeCancelBy: payload.freeCancelBy?.trim() || null,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Unable to save tour (status ${res.status})`);
        }
        await fetchTours();
        closeTourEditor();
      } catch (err: any) {
        console.error('saveTour failed', err);
        alert(err.message || 'Unable to save tour');
      }
    })();
  };

  const removeTour = (id: string) => {
    fetch(`${backendUrl}/api/tours/${id}`, { method: 'DELETE', headers: jsonHeaders })
      .then((res) => {
        if (!res.ok) throw new Error('Unable to delete tour');
        fetchTours();
      })
      .catch((err) => alert(err.message));
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
    setGroupAddEmail({});
    setGroupAddRelationship({});
    setTraits([]);
    setSelectedTraitNames(new Set());
    setTraitAge('');
    setTraitGender('prefer-not');
    setItineraryCountry('');
    setItineraryRegion('');
    setCountrySearch('');
    setRegionSearch('');
    setShowItineraryCountryDropdown(false);
    setShowItineraryRegionDropdown(false);
    setItineraryDays('5');
    setBudgetMin(500);
    setBudgetMax(2500);
    setItineraryAirport('');
    setItineraryAirportOptions([]);
    setShowItineraryAirportDropdown(false);
    setItineraryPlan('');
    setItineraryError('');
    setItineraryLoading(false);
    setAccountProfile({ firstName: '', lastName: '', email: '' });
    setPasswordForm({ currentPassword: '', newPassword: '', newPasswordConfirm: '' });
    setAccountMessage(null);
    setShowDeleteConfirm(false);
    setShowPasswordEditor(false);
    setFamilyRelationships([]);
    setFamilyForm({ givenName: '', middleName: '', familyName: '', email: '', relationship: 'Not Applicable' });
    setEditingFamilyId(null);
    setEditingFamilyDraft(null);
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
      fetchAccountProfile(data.token);
      fetchFamilyRelationships(data.token);
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
      fetchAccountProfile(data.token);
      fetchFamilyRelationships(data.token);
      setActivePage('menu');
    } catch (err) {
      alert((err as Error).message || 'Registration failed');
    }
  };

  const fetchAccountProfile = async (token?: string): Promise<boolean> => {
    const auth = token ?? userToken;
    if (!auth) return false;
    try {
      const res = await fetch(`${backendUrl}/api/account`, {
        headers: { Authorization: `Bearer ${auth}` },
      });
      if (res.status === 401 || res.status === 403) {
        logout();
        return false;
      }
      if (!res.ok) return false;
      const data = await res.json();
      const fullName = `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim() || 'Traveler';
      setAccountProfile({
        firstName: data.firstName ?? '',
        lastName: data.lastName ?? '',
        email: data.email ?? '',
      });
      setUserName(fullName);
      setUserEmail(data.email ?? null);
      return true;
    } catch {
      return false;
    }
  };

  const updateAccountProfile = async () => {
    if (!userToken) return;
    setAccountMessage(null);
    const res = await fetch(`${backendUrl}/api/account/profile`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(accountProfile),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to update profile');
      return;
    }
    const updatedUser = data.user ?? accountProfile;
    const fullName = `${updatedUser.firstName ?? ''} ${updatedUser.lastName ?? ''}`.trim() || 'Traveler';
    if (data.token) {
      setUserToken(data.token);
      saveSession(data.token, fullName, activePage, updatedUser.email ?? accountProfile.email);
    }
    setUserName(fullName);
    setUserEmail(updatedUser.email ?? null);
    setAccountProfile({
      firstName: updatedUser.firstName ?? '',
      lastName: updatedUser.lastName ?? '',
      email: updatedUser.email ?? '',
    });
    setAccountMessage('Profile updated');
  };

  const updateAccountPassword = async () => {
    if (!userToken) return;
    if (passwordForm.newPassword !== passwordForm.newPasswordConfirm) {
      alert('New passwords do not match');
      return;
    }
    setAccountMessage(null);
    const res = await fetch(`${backendUrl}/api/account/password`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(passwordForm),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to update password');
      return;
    }
    setAccountMessage('Password updated');
    setPasswordForm({ currentPassword: '', newPassword: '', newPasswordConfirm: '' });
    setShowPasswordEditor(false);
  };

  const deleteAccount = async () => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/account`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to delete account');
      return;
    }
    setShowDeleteConfirm(false);
    logout();
  };

  const fetchFamilyRelationships = async (token?: string) => {
    const auth = token ?? userToken;
    if (!auth) return;
    try {
      const res = await fetch(`${backendUrl}/api/account/family`, { headers: { Authorization: `Bearer ${auth}` } });
      if (!res.ok) return;
      const data = await res.json();
      setFamilyRelationships(data);
    } catch {
      // ignore
    }
  };

  const addFamilyMember = async () => {
    if (!userToken) return;
    const { givenName, familyName, relationship } = familyForm;
    if (!givenName.trim() || !familyName.trim()) {
      alert('Fill out given and family name');
      return;
    }
    const payload = {
      ...familyForm,
      relationship: relationship?.trim() || 'Not Applicable',
    };
    const res = await fetch(`${backendUrl}/api/account/family`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      alert((data as any).error || 'Unable to add family member');
      return;
    }
    setFamilyRelationships(data);
    setFamilyForm({ givenName: '', middleName: '', familyName: '', email: '', relationship: 'Not Applicable' });
    setShowRelationshipDropdown(false);
  };

  const acceptFamilyLink = async (id: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/account/family/${id}/accept`, { method: 'PATCH', headers });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      alert((data as any).error || 'Unable to accept relationship');
      return;
    }
    setFamilyRelationships(data);
  };

  const rejectFamilyLink = async (id: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/account/family/${id}/reject`, { method: 'PATCH', headers });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      alert((data as any).error || 'Unable to reject relationship');
      return;
    }
    setFamilyRelationships(data);
  };

  const removeFamilyLink = async (id: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/account/family/${id}`, { method: 'DELETE', headers });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      alert((data as any).error || 'Unable to remove relationship');
      return;
    }
    setFamilyRelationships(data);
    if (editingFamilyId === id) {
      setEditingFamilyId(null);
      setEditingFamilyDraft(null);
    }
  };

  const saveFamilyProfile = async () => {
    if (!userToken || !editingFamilyId || !editingFamilyDraft) return;
    const res = await fetch(`${backendUrl}/api/account/family/${editingFamilyId}/profile`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(editingFamilyDraft),
    });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) {
      alert((data as any).error || 'Unable to update family profile');
      return;
    }
    setFamilyRelationships(data);
    setEditingFamilyId(null);
    setEditingFamilyDraft(null);
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
    if (!activeTripId) {
      setTours([]);
      return;
    }
    const res = await fetch(`${backendUrl}/api/tours?tripId=${activeTripId}`, {
      headers: { Authorization: `Bearer ${token ?? userToken}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    setTours(
      (data as any[]).map((t) => ({
        ...t,
        cost: String(t.cost ?? ''),
        paidBy: Array.isArray(t.paidBy) ? t.paidBy : [],
        bookedOn: t.bookedOn ?? '',
        freeCancelBy: t.freeCancelBy ?? '',
      }))
    );
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
      const activity = line.replace(/^[-*ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢]\s*/, '').trim();
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

  const createTrait = async () => {
    if (!userToken) return;
    const name = newTraitName.trim();
    if (!name) {
      alert('Enter a trait name');
      return;
    }
    const res = await fetch(`${backendUrl}/api/traits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ name, level: 3 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to save trait');
      return;
    }
    setTraits((prev) => [...prev, { id: data.id ?? name, name } as Trait]);
    setSelectedTraitNames((prev) => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });
    setNewTraitName('');
    fetchTraits();
  };

  const deleteTrait = async (traitId: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/traits/${traitId}`, { method: 'DELETE', headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to delete trait');
      return;
    }
    fetchTraits();
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

  const generateItinerary = async () => {
    if (!userToken) return;
    const country = itineraryCountry.trim();
    const days = itineraryDays.trim();
    if (!country || !days || !activeTripId) {
      alert('Enter a country, number of days, and select an active trip.');
      return;
    }
    setShowItineraryCountryDropdown(false);
    setShowItineraryRegionDropdown(false);
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
        tripStyle: itineraryTripStyle.trim() || undefined,
        tripId: activeTripId,
        traits: traits.map((t) => ({ name: t.name })),
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
    const destination = itineraryCountry.trim();
    const daysNum = Number(itineraryDays);
    const existing = findExistingItinerary(activeTripId, destination, daysNum, editingItineraryId, budgetMax);
    if (existing) {
      alert('Itinerary already exists for this trip');
      return;
    }
    const method = editingItineraryId ? 'PUT' : 'POST';
    const url = editingItineraryId ? `${backendUrl}/api/itineraries/${editingItineraryId}` : `${backendUrl}/api/itineraries`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        tripId: activeTripId,
        destination,
        days: daysNum,
        budget: budgetMax, // store upper budget bound
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to save itinerary');
      return;
    }
    if (data.id) {
      setSelectedItineraryId(data.id);
      fetchItineraryDetails(data.id);
    }
    setEditingItineraryId(null);
    fetchItineraries();
  };

  const saveDetail = async () => {
    if (!userToken || !selectedItineraryId) {
      alert('Select an itinerary to add details');
      return;
    }
    if (!detailDraft.activity.trim()) {
      alert('Enter an activity');
      return;
    }
    const payload = {
      day: Number(detailDraft.day || '1'),
      time: detailDraft.time || null,
      activity: detailDraft.activity.trim(),
      cost: detailDraft.cost ? Number(detailDraft.cost) : null,
    };
    const url = editingDetailId
      ? `${backendUrl}/api/itineraries/details/${editingDetailId}`
      : `${backendUrl}/api/itineraries/${selectedItineraryId}/details`;
    const method = editingDetailId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Unable to save detail');
      return;
    }
    setDetailDraft({ day: '1', time: '', activity: '', cost: '' });
    setEditingDetailId(null);
    fetchItineraryDetails(selectedItineraryId);
  };

  const saveGeneratedItinerary = async (plan: string) => {
    if (!activeTripId) {
      setItineraryError('Select an active trip before saving the itinerary.');
      return;
    }
    const destination = itineraryCountry.trim() || 'Unknown';
    const daysNum = Number(itineraryDays || '1');
    const existing = findExistingItinerary(activeTripId, destination, daysNum, null, budgetMax);
    let itineraryId = existing?.id;
    if (!itineraryId) {
      const createRes = await fetch(`${backendUrl}/api/itineraries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          tripId: activeTripId,
          destination,
          days: daysNum,
          budget: budgetMax,
        }),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        const message = (created.error || '').toLowerCase();
        if (message.includes('already exists')) {
          const existingRecord = itineraryRecords.find((i) => i.tripId === activeTripId);
          itineraryId = existingRecord?.id;
        }
        if (!itineraryId) {
          setItineraryError(created.error || 'Unable to save itinerary');
          return;
        }
      } else {
        itineraryId = created.id as string;
        fetchItineraries();
      }
      setSelectedItineraryId(itineraryId);
    } else {
      setItineraryError('');
      setSelectedItineraryId(itineraryId);
    }
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

  const toggleTrait = async (name: string) => {
    const isBase = traitOptions.includes(name);
    const existing = traits.find((t) => t.name === name);
    let removed = false;
    setSelectedTraitNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        removed = true;
        if (!isBase) {
          setTraits((list) => list.filter((t) => t.name !== name));
        }
      } else {
        next.add(name);
      }
      return next;
    });
    if (removed && existing?.id) {
      await deleteTrait(existing.id);
    }
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

  const fetchFollowedTrips = async () => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/trips/followed`, { headers });
    if (res.status === 401 || res.status === 403) {
      logout();
      return;
    }
    if (!res.ok) {
      setFollowedTrips([]);
      return;
    }
    const data = await res.json().catch(() => []);
    if (!Array.isArray(data)) {
      setFollowedTrips([]);
      return;
    }
    const mapped: FollowedTrip[] = data.map((item: any) => ({
      tripId: item.tripId ?? item.id ?? '',
      tripName: item.tripName ?? item.name ?? 'Trip',
      inviterName: item.inviterName ?? item.invitedBy,
      destination: item.destination,
      todayDetails: Array.isArray(item.todayDetails) ? item.todayDetails : [],
    }));
    setFollowedTrips(mapped.filter((t) => t.tripId));
  };

  const followTripByInvite = async () => {
    if (!userToken) return;
    const code = followInviteCode.trim();
    if (!code) {
      setFollowError('Enter an invite code');
      return;
    }
    // Decode invite payload (local or shared)
    const decoded = decodeInviteCode(code);
    const payload =
      followCodePayloads[code] ??
      decoded ??
      null;
    const resolvedTripId =
      Object.entries(followCodes).find(([, c]) => c === code)?.[0] ??
      payload?.tripId ??
      null;
    const resolvedName =
      payload?.tripName ?? trips.find((t) => t.id === resolvedTripId)?.name ?? 'Trip';
    if (resolvedTripId) {
      setFollowedTrips((prev) => {
        const filtered = prev.filter((t) => t.tripId !== resolvedTripId);
        return [
          ...filtered,
          {
            tripId: resolvedTripId,
            tripName: resolvedName,
            destination: payload?.destination,
            inviterName: payload ? 'Shared' : 'You',
            todayDetails: [],
          },
        ];
      });
      if (payload && payload.tripId) {
        setFollowCodes((prev) => {
          const next = { ...prev, [payload.tripId]: code };
          saveFollowCodes(next);
          return next;
        });
        setFollowCodePayloads((prev) => {
          const next = { ...prev, [code]: payload };
          saveFollowPayloads(next);
          return next;
        });
      }
      setFollowInviteCode('');
      setFollowError('');
      return;
    }
    setFollowLoading(true);
    setFollowError('');
    try {
      const res = await fetch(`${backendUrl}/api/trips/follow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ inviteCode: code }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        logout();
        return;
      }
      if (!res.ok) {
        setFollowError(data.error || 'Unable to follow trip');
        return;
      }
      const tripData = data.trip ?? data;
      const todayDetailsRaw = Array.isArray(data.todayDetails)
        ? data.todayDetails
        : Array.isArray(data.details)
          ? data.details
          : [];
      const normalizeDetails = todayDetailsRaw
        .filter((d: any) => d && d.activity)
        .map((d: any, idx: number) => ({
          id: d.id ?? `${tripData.id ?? code}-${idx}`,
          day: d.day,
          time: d.time,
          activity: d.activity,
        }));
      const tripId = tripData.id ?? tripData.tripId ?? code;
      if (!tripId) {
        setFollowError('Missing trip id from invite');
        return;
      }
      const tripName = tripData.name ?? tripData.tripName ?? 'Trip';
      setFollowedTrips((prev) => {
        const filtered = prev.filter((t) => t.tripId !== tripId);
        return [
          ...filtered,
          {
            tripId,
            tripName,
            inviterName: data.inviterName ?? tripData.inviterName,
            destination: tripData.destination,
            todayDetails: normalizeDetails,
          },
        ];
      });
      setFollowInviteCode('');
    } catch (err) {
      setFollowError((err as Error).message);
    } finally {
      setFollowLoading(false);
    }
  };

  const fetchFollowCode = async (tripId: string) => {
    if (!userToken) return;
    setFollowCodeError(null);
    setFollowCodeLoading((prev) => ({ ...prev, [tripId]: true }));
    const extractCode = (data: any, text?: string) => {
      return (
        data?.inviteCode ??
        data?.invite_code ??
        data?.code ??
        data?.followCode ??
        (typeof text === 'string' && text.trim() ? text.trim() : '')
      );
    };
    // Try only the most likely endpoints; if none work, surface a single clear error instead of spamming requests.
    const attempts: Array<{ url: string; method: 'GET'; body?: any }> = [
      { url: `${backendUrl}/api/trips/${tripId}/invite-code`, method: 'GET' },
      { url: `${backendUrl}/api/trips/${tripId}/invite`, method: 'GET' },
      { url: `${backendUrl}/api/trips/${tripId}/follow-code`, method: 'GET' },
    ];
    try {
      let code: string | null = null;
      let lastError: Error | null = null;
      for (const att of attempts) {
        try {
          const res = await fetch(att.url, { headers });
          const text = await res.text();
          let data: any = {};
          try {
            data = JSON.parse(text);
          } catch {
            data = {};
          }
          if (res.status === 401 || res.status === 403) {
            logout();
            throw new Error('Unauthorized');
          }
          if (!res.ok) {
            throw new Error(data.error || text || 'Unable to fetch invite code');
          }
          const extracted =
            extractCode(data, text) ||
            (typeof text === 'string'
              ? (text.match(/[A-Z0-9]{6,}/)?.[0] ?? '')
              : '');
          if (!extracted) {
            throw new Error('No invite code returned');
          }
          code = extracted;
          break;
        } catch (err) {
          lastError = err as Error;
          continue;
        }
      }
      if (code) {
        setFollowCodes((prev) => ({ ...prev, [tripId]: code }));
      } else {
        throw lastError ?? new Error('Invite codes are not enabled for this server.');
      }
    } catch (err) {
      const msg = (err as Error).message;
      setFollowCodeError(msg);
    } finally {
      setFollowCodeLoading((prev) => ({ ...prev, [tripId]: false }));
    }
  };

  const generateLocalFollowCode = (tripId: string, tripName: string) => {
    const destination = trips.find((t) => t.id === tripId)?.name;
    const payload: InvitePayload = { tripId, tripName, destination };
    const code = encodeInviteCode(payload);
    setFollowCodeError(null);
    setFollowCodes((prev) => {
      const next = { ...prev, [tripId]: code };
      saveFollowCodes(next);
      return next;
    });
    setFollowCodePayloads((prev) => {
      const next = { ...prev, [code]: payload };
      saveFollowPayloads(next);
      return next;
    });
    return code;
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

  const deleteItinerary = async (itineraryId: string) => {
    if (!userToken) return;
    const res = await fetch(`${backendUrl}/api/itineraries/${itineraryId}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Unable to delete itinerary');
      return;
    }
    setItineraryRecords((prev) => prev.filter((i) => i.id !== itineraryId));
    setItineraryDetails((prev) => {
      const next = { ...prev };
      delete next[itineraryId];
      return next;
    });
    if (selectedItineraryId === itineraryId) {
      setSelectedItineraryId(null);
    }
    if (editingItineraryId === itineraryId) {
      setEditingItineraryId(null);
    }
    setEditingDetailId(null);
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
        const ok = await fetchAccountProfile();
        if (!ok) return;
        fetchFlights();
        fetchLodgings();
        fetchTours();
        fetchInvites();
        fetchGroups();
        fetchTrips();
        fetchFollowedTrips();
        fetchTraits();
        fetchTraitProfile();
        fetchItineraries();
      })();
    }
  }, [userToken]);

  useEffect(() => {
    if (userToken) return;
    const session = loadSession();
    if (session) {
      setUserToken(session.token);
      setUserName(session.name);
      setUserEmail(session.email ?? null);
      const sessionPage = session.page;
      if (sessionPage === 'flights' || sessionPage === 'lodging' || sessionPage === 'groups' || sessionPage === 'trips' || sessionPage === 'traits' || sessionPage === 'itinerary' || sessionPage === 'tours' || sessionPage === 'cost' || sessionPage === 'account' || sessionPage === 'follow') {
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
      fetchFamilyRelationships();
    }
  }, [userToken]);

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
            <View style={[styles.card, styles.itinerarySection]}>
              <Text style={styles.sectionTitle}>Create Itinerary</Text>
              <Text style={styles.helperText}>Capture the basics and we'll use your traits to shape trip ideas.</Text>

              <View>
                <TouchableOpacity
                  style={[styles.input, styles.selectButton]}
                  onPress={() => {
                    setCountrySearch('');
                    setShowItineraryCountryDropdown(true);
                    setShowItineraryRegionDropdown(false);
                  }}
                >
                  <View style={styles.selectButtonRow}>
                    <Text style={itineraryCountry ? styles.cellText : styles.placeholderText}>
                      {itineraryCountry || 'Select a country'}
                    </Text>
                    <Text style={styles.selectCaret}>v</Text>
                  </View>
                </TouchableOpacity>
                {regionOptions.length ? (
                  <TouchableOpacity
                    style={[styles.input, styles.selectButton]}
                    onPress={() => {
                      setRegionSearch('');
                      setShowItineraryRegionDropdown(true);
                      setShowItineraryCountryDropdown(false);
                    }}
                  >
                    <View style={styles.selectButtonRow}>
                      <Text style={itineraryRegion ? styles.cellText : styles.placeholderText}>
                        {itineraryRegion || 'Select a region / state'}
                      </Text>
                      <Text style={styles.selectCaret}>v</Text>
                    </View>
                  </TouchableOpacity>
                ) : null}
              </View>

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
              <TextInput
                style={styles.input}
                placeholder="What kind of trip do you want? (e.g., foodie weekend, outdoor adventure, museum crawl)"
                value={itineraryTripStyle}
                onChangeText={setItineraryTripStyle}
                multiline
              />

              <Text style={styles.modalLabel}>Budget</Text>
              <View style={styles.addRow}>
                {(['cheap', 'middle', 'expensive'] as const).map((level) => (
                  <TouchableOpacity
                    key={level}
                    style={[
                      styles.button,
                      styles.smallButton,
                      budgetLevel === level && styles.toggleActive,
                      { flex: 1 },
                    ]}
                    onPress={() => setBudgetLevel(level)}
                  >
                    <View style={styles.budgetRow}>
                      <Text style={styles.buttonText}>
                        {level === 'cheap' ? 'Cheap' : level === 'middle' ? 'Middle' : 'Expensive'}
                      </Text>
                      <View style={[styles.budgetIndicator, budgetLevel === level && styles.budgetIndicatorActive]} />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.helperText}>Cheap ~$500-$1,500 | Middle ~$1,500-$4,000 | Expensive ~$4,000-$8,000</Text>

              <TouchableOpacity style={styles.button} onPress={generateItinerary} disabled={itineraryLoading}>
                <Text style={styles.buttonText}>{itineraryLoading ? 'Generating...' : 'Generate Itinerary'}</Text>
              </TouchableOpacity>
          {itineraryPlan ? (
            <View style={styles.planBox}>
              <Text style={styles.sectionTitle}>Suggested Plan</Text>
              <Text style={styles.bodyText}>{itineraryPlan}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {activePage === 'itinerary' ? (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Saved Itineraries</Text>
            {!itineraryRecords.length ? (
              <Text style={styles.helperText}>No itineraries saved yet.</Text>
            ) : (
              itineraryRecords.map((it) => {
                const isSelected = selectedItineraryId === it.id;
                return (
                  <TouchableOpacity
                    key={it.id}
                    style={[styles.row, { alignItems: 'center', paddingVertical: 6 }]}
                    onPress={() => {
                      setEditingItineraryId(null);
                      setSelectedItineraryId(it.id);
                      if (!itineraryDetails[it.id]) {
                        fetchItineraryDetails(it.id);
                      }
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.flightTitle}>{it.tripName || 'Trip'}</Text>
                                            <Text style={styles.helperText}>
                        {`${it.destination || 'Destination'} | ${it.days} days | Budget ${it.budget ?? 'N/A'} | Created ${formatDateLong(it.createdAt)}`}
                      </Text>
                    </View>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => beginEditItinerary(it)}>
                      <Text style={styles.buttonText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, styles.smallButton, styles.dangerButton]} onPress={() => deleteItinerary(it.id)}>
                      <Text style={styles.buttonText}>Delete</Text>
                    </TouchableOpacity>
                    <View style={[styles.button, isSelected && styles.toggleActive]}>
                      <Text style={styles.buttonText}>{isSelected ? 'Selected' : 'View'}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          {selectedItineraryId ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Itinerary Details</Text>
              <View style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeader]}>
                  <View style={[styles.cell, { flex: 1 }]}>
                    <Text style={styles.headerText}>Day</Text>
                  </View>
                  <View style={[styles.cell, { flex: 1 }]}>
                    <Text style={styles.headerText}>Time</Text>
                  </View>
                  <View style={[styles.cell, { flex: 2 }]}>
                    <Text style={styles.headerText}>Activity</Text>
                  </View>
                  <View style={[styles.cell, { flex: 1 }]}>
                    <Text style={styles.headerText}>Cost</Text>
                  </View>
                  <View style={[styles.cell, styles.actionCell, { flex: 1 }]}>
                    <Text style={styles.headerText}>Actions</Text>
                  </View>
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
                    <View style={[styles.cell, styles.actionCell, { flex: 1 }]}>
                      <TouchableOpacity
                        style={[styles.button, styles.smallButton]}
                        onPress={() => {
                          setEditingDetailId(d.id);
                          setDetailDraft({
                            day: String(d.day ?? '1'),
                            time: d.time ?? '',
                            activity: d.activity ?? '',
                            cost: d.cost != null ? String(d.cost) : '',
                          });
                        }}
                      >
                        <Text style={styles.buttonText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.button, styles.smallButton, styles.dangerButton]}
                        onPress={async () => {
                          await fetch(`${backendUrl}/api/itineraries/details/${d.id}`, {
                            method: 'DELETE',
                            headers,
                          });
                          if (editingDetailId === d.id) setEditingDetailId(null);
                          fetchItineraryDetails(selectedItineraryId);
                        }}
                      >
                        <Text style={styles.buttonText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                <View style={[styles.tableRow, styles.inputRow]}>
                  <View style={[styles.cell, { flex: 1 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Day"
                      keyboardType="numeric"
                      value={detailDraft.day}
                      onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, day: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { flex: 1 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Time"
                      value={detailDraft.time}
                      onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, time: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { flex: 2 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Activity"
                      value={detailDraft.activity}
                      onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, activity: text }))}
                    />
                  </View>
                  <View style={[styles.cell, { flex: 1 }]}>
                    <TextInput
                      style={styles.input}
                      placeholder="Cost"
                      keyboardType="numeric"
                      value={detailDraft.cost}
                      onChangeText={(text) => setDetailDraft((prev) => ({ ...prev, cost: text }))}
                    />
                  </View>
                  <View style={[styles.cell, styles.actionCell, { flex: 1 }]}>
                    <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={saveDetail}>
                      <Text style={styles.buttonText}>{editingDetailId ? 'Update' : 'Add'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          ) : null}
        </>
      ) : null}

      {activePage === 'traits' ? (
        <>
          <View style={[styles.card, styles.traitsSection]}>
            <Text style={styles.sectionTitle}>Traits</Text>
            <Text style={styles.helperText}>Capture travel personality markers to tailor itinerary ideas (e.g., Adventurous, Coffee Lover, Beach Bum).</Text>
            <TextInput
              style={styles.input}
              placeholder="Trait name"
              value={newTraitName}
              onChangeText={setNewTraitName}
            />
            <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={createTrait}>
              <Text style={styles.buttonText}>Save Trait</Text>
            </TouchableOpacity>
          </View>

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
              {[...traitOptions, ...traits.filter((t) => !traitOptions.includes(t.name)).map((t) => t.name)].map((name) => {
                const selected = selectedTraitNames.has(name);
                const isCustom = !traitOptions.includes(name);
                return (
                  <TouchableOpacity
                    key={name}
                    style={[styles.traitChip, selected && styles.traitChipSelected]}
                    onPress={() => toggleTrait(name)}
                  >
                    <Text style={[styles.traitChipText, selected && styles.traitChipTextSelected]}>
                      {isCustom ? `${name} (custom*)` : name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity style={styles.button} onPress={saveTraitSelections}>
              <Text style={styles.buttonText}>Save Traits</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

          {activePage === 'tours' ? (
            <View style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Tours</Text>
                <TouchableOpacity style={styles.button} onPress={() => openTourEditor()}>
                  <Text style={styles.buttonText}>+ Add Tour</Text>
                </TouchableOpacity>
              </View>
              {Platform.OS !== 'web' && tourDateField && editingTour && NativeDateTimePicker ? (
                <NativeDateTimePicker
                  value={tourDateValue}
                  mode={tourDateField === 'startTime' ? 'time' : 'date'}
                  onChange={(_, date) => {
                    if (!date) {
                      setTourDateField(null);
                      return;
                    }
                    const iso = date.toISOString().slice(0, 10);
                    setEditingTour((prev) => {
                      if (!prev) return prev;
                      if (tourDateField === 'startTime') {
                        const hours = String(date.getHours()).padStart(2, '0');
                        const mins = String(date.getMinutes()).padStart(2, '0');
                        return { ...prev, startTime: `${hours}:${mins}` };
                      }
                      if (tourDateField === 'date') return { ...prev, date: iso };
                      if (tourDateField === 'bookedOn') return { ...prev, bookedOn: iso };
                      return { ...prev, freeCancelBy: iso };
                    });
                    setTourDateField(null);
                  }}
                />
              ) : null}
              <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
                <View style={styles.table}>
                  <View style={[styles.tableRow, styles.tableHeader]}>
                    {[
                      { label: 'Date', width: 140 },
                      { label: 'Tour', width: 180 },
                      { label: 'Start Location', width: 180 },
                      { label: 'Start Time', width: 120 },
                      { label: 'Duration', width: 120 },
                      { label: 'Cost', width: 120 },
                      { label: 'Free Cancel By', width: 160 },
                      { label: 'Platform Booked On', width: 140 },
                      { label: 'Reference', width: 140 },
                      { label: 'Paid By', width: 180 },
                      { label: 'Actions', width: 160 },
                    ].map((col, idx, arr) => (
                      <View key={col.label} style={[styles.cell, { minWidth: col.width, flex: 1 }, idx === arr.length - 1 && styles.lastCell]}>
                        <Text style={styles.headerText}>{col.label}</Text>
                      </View>
                    ))}
                  </View>
                  {tours.map((t) => (
                    <View key={t.id} style={styles.tableRow}>
                      <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                        <Text style={styles.cellText}>{formatDateLong(t.date)}</Text>
                      </View>
                      <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                        <Text style={styles.cellText}>{t.name || '-'}</Text>
                      </View>
                      <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                        <Text style={styles.cellText}>{t.startLocation || '-'}</Text>
                      </View>
                      <View style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                        <Text style={styles.cellText}>{t.startTime || '-'}</Text>
                      </View>
                      <View style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                        <Text style={styles.cellText}>{t.duration || '-'}</Text>
                      </View>
                      <View style={[styles.cell, { minWidth: 120, flex: 1 }]}>
                        <Text style={styles.cellText}>{t.cost ? `$${t.cost}` : '-'}</Text>
                      </View>
                      <View style={[styles.cell, { minWidth: 160, flex: 1 }]}>
                        <Text style={styles.cellText}>{t.freeCancelBy ? formatDateLong(t.freeCancelBy) : '-'}</Text>
                      </View>
                      <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                        <Text style={styles.cellText}>{t.bookedOn || '-'}</Text>
                      </View>
                      <View style={[styles.cell, { minWidth: 140, flex: 1 }]}>
                        <Text style={styles.cellText}>{t.reference || '-'}</Text>
                      </View>
                      <View style={[styles.cell, { minWidth: 180, flex: 1 }]}>
                        <Text style={styles.cellText}>{t.paidBy.length ? t.paidBy.map(payerName).join(', ') : '-'}</Text>
                      </View>
                      <View style={[styles.cell, styles.actionCell, styles.lastCell, { minWidth: 160, flex: 1 }]}>
                        <TouchableOpacity style={[styles.smallButton]} onPress={() => openTourEditor(t)}>
                          <Text style={styles.buttonText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.smallButton, styles.dangerButton]} onPress={() => removeTour(t.id)}>
                          <Text style={styles.buttonText}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              </ScrollView>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.flightTitle}>Total tour cost: ${toursTotal.toFixed(2)}</Text>
                {Object.keys(payerTotals).length ? (
                  <View style={{ marginTop: 4 }}>
                    {Object.entries(payerTotals).map(([id, total]) => (
                      <Text key={id} style={styles.helperText}>
                        {payerName(id)}: ${total.toFixed(2)}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
              {editingTour ? (
                <View style={styles.passengerOverlay}>
                  <TouchableOpacity style={styles.passengerOverlayBackdrop} onPress={closeTourEditor} />
                  <View style={styles.modalCard}>
                    <Text style={styles.sectionTitle}>{editingTourId ? 'Edit Tour' : 'Add Tour'}</Text>
                    <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingRight: 12 }}>
                      <Text style={styles.modalLabel}>Date</Text>
                      {Platform.OS === 'web' ? (
                        <input
                          style={{ ...StyleSheet.flatten(styles.input), width: '100%' }}
                          type="date"
                          value={editingTour.date}
                          onChange={(e) => setEditingTour((p) => (p ? { ...p, date: e.target.value } : p))}
                        />
                      ) : (
                        <TouchableOpacity style={styles.input} onPress={() => openTourDatePicker('date')}>
                          <Text style={styles.cellText}>{formatDateLong(editingTour.date)}</Text>
                        </TouchableOpacity>
                      )}
                      <Text style={styles.modalLabel}>Tour</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Tour name"
                        value={editingTour.name}
                        onChangeText={(text) => setEditingTour((p) => (p ? { ...p, name: text } : p))}
                      />
                      <Text style={styles.modalLabel}>Start location</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Start location"
                        value={editingTour.startLocation}
                        onChangeText={(text) => setEditingTour((p) => (p ? { ...p, startLocation: text } : p))}
                      />
                      <Text style={styles.modalLabel}>Start time</Text>
                      {Platform.OS === 'web' ? (
                        <input
                          style={{ ...StyleSheet.flatten(styles.input), width: '100%' }}
                          type="time"
                          value={editingTour.startTime}
                          onChange={(e) => setEditingTour((p) => (p ? { ...p, startTime: e.target.value } : p))}
                        />
                      ) : (
                        <TouchableOpacity style={styles.input} onPress={() => openTourDatePicker('startTime')}>
                          <Text style={styles.cellText}>{editingTour.startTime || 'Select time'}</Text>
                        </TouchableOpacity>
                      )}
                      <Text style={styles.modalLabel}>Duration</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Duration"
                        value={editingTour.duration}
                        onChangeText={(text) => setEditingTour((p) => (p ? { ...p, duration: text } : p))}
                      />
                      <Text style={styles.modalLabel}>Cost</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Cost"
                        keyboardType="numeric"
                        value={editingTour.cost}
                        onChangeText={(text) => setEditingTour((p) => (p ? { ...p, cost: text.replace(/[^0-9.]/g, '') } : p))}
                      />
                      <View style={styles.modalRow}>
                        <Text style={styles.modalLabel}>Free cancellation by</Text>
                        <TouchableOpacity onPress={() => setEditingTour((p) => (p ? { ...p, freeCancelBy: '' } : p))}>
                          <Text style={styles.linkText}>Clear</Text>
                        </TouchableOpacity>
                      </View>
                      {Platform.OS === 'web' ? (
                        <input
                          style={{ ...StyleSheet.flatten(styles.input), width: '100%' }}
                          type="date"
                          value={editingTour.freeCancelBy}
                          onChange={(e) => setEditingTour((p) => (p ? { ...p, freeCancelBy: e.target.value } : p))}
                        />
                      ) : (
                        <TouchableOpacity style={styles.input} onPress={() => openTourDatePicker('freeCancel')}>
                          <Text style={styles.cellText}>{editingTour.freeCancelBy ? formatDateLong(editingTour.freeCancelBy) : 'Select date'}</Text>
                        </TouchableOpacity>
                      )}
                      <Text style={styles.modalLabel}>Platform Booked On</Text>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TextInput
                          style={[styles.input, { flex: 1 }]}
                          placeholder="Viator, Get Your Guide, Klook, etc."
                          value={editingTour.bookedOn}
                          onChangeText={(text) => setEditingTour((p) => (p ? { ...p, bookedOn: text } : p))}
                        />
                        <TextInput
                          style={[styles.input, { flex: 1 }]}
                          placeholder="Reference"
                          value={editingTour.reference}
                          onChangeText={(text) => setEditingTour((p) => (p ? { ...p, reference: text } : p))}
                        />
                      </View>
                      <Text style={styles.modalLabel}>Paid by</Text>
                      <View style={[styles.input, styles.payerBox]}>
                        <View style={styles.payerChips}>
                          {editingTour.paidBy.map((id) => (
                            <View key={id} style={styles.payerChip}>
                              <Text style={styles.cellText}>{payerName(id)}</Text>
                              <TouchableOpacity onPress={() => setEditingTour((p) => (p ? { ...p, paidBy: p.paidBy.filter((x) => x !== id) } : p))}>
                                <Text style={styles.removeText}>x</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>
                        <View style={styles.payerOptions}>
                          {userMembers
                            .filter((m) => !editingTour.paidBy.includes(m.id))
                            .map((m) => (
                              <TouchableOpacity
                                key={m.id}
                                style={styles.smallButton}
                                onPress={() => setEditingTour((p) => (p ? { ...p, paidBy: [...p.paidBy, m.id] } : p))}
                              >
                                <Text style={styles.buttonText}>Add {formatMemberName(m)}</Text>
                              </TouchableOpacity>
                            ))}
                        </View>
                      </View>
                    </ScrollView>
                    <View style={[styles.tableFooter, { justifyContent: 'space-between' }]}>
                      <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={closeTourEditor}>
                        <Text style={styles.buttonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.button} onPress={saveTour}>
                        <Text style={styles.buttonText}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ) : null}
            </View>
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
            <View style={[styles.card, styles.accountSection]}>
              <Text style={styles.sectionTitle}>Account</Text>
              <Text style={styles.helperText}>Update your profile, change your password, or remove your account.</Text>
              {accountMessage ? (
                <View style={styles.successCard}>
                  <Text style={styles.bodyText}>{accountMessage}</Text>
                </View>
              ) : null}
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="First name"
                  value={accountProfile.firstName}
                  onChangeText={(text) => setAccountProfile((p) => ({ ...p, firstName: text }))}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Last name"
                  value={accountProfile.lastName}
                  onChangeText={(text) => setAccountProfile((p) => ({ ...p, lastName: text }))}
                />
              </View>
              <TextInput
                style={styles.input}
                placeholder="Email"
                autoCapitalize="none"
                keyboardType="email-address"
                value={accountProfile.email}
                onChangeText={(text) => setAccountProfile((p) => ({ ...p, email: text }))}
              />
              <TouchableOpacity style={styles.button} onPress={updateAccountProfile}>
                <Text style={styles.buttonText}>Save Profile</Text>
              </TouchableOpacity>

              <View style={styles.divider} />
              {!showPasswordEditor ? (
                <TouchableOpacity style={styles.button} onPress={() => setShowPasswordEditor(true)}>
                  <Text style={styles.buttonText}>Change Password</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <Text style={styles.modalLabel}>Change password</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Current password"
                    secureTextEntry
                    value={passwordForm.currentPassword}
                    onChangeText={(text) => setPasswordForm((p) => ({ ...p, currentPassword: text }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="New password"
                    secureTextEntry
                    value={passwordForm.newPassword}
                    onChangeText={(text) => setPasswordForm((p) => ({ ...p, newPassword: text }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Confirm new password"
                    secureTextEntry
                    value={passwordForm.newPasswordConfirm}
                    onChangeText={(text) => setPasswordForm((p) => ({ ...p, newPasswordConfirm: text }))}
                  />
                  <View style={styles.row}>
                    <TouchableOpacity style={[styles.button, styles.dangerButton, { flex: 1 }]} onPress={() => {
                      setPasswordForm({ currentPassword: '', newPassword: '', newPasswordConfirm: '' });
                      setShowPasswordEditor(false);
                    }}>
                      <Text style={styles.buttonText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={updateAccountPassword}>
                      <Text style={styles.buttonText}>Update Password</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              <View style={styles.divider} />
              <Text style={styles.sectionTitle}>Family & Relationships</Text>
              <Text style={styles.helperText}>Add relatives, accept invites, and manage non-user profiles.</Text>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Given name"
                  value={familyForm.givenName}
                  onChangeText={(text) => setFamilyForm((p) => ({ ...p, givenName: text }))}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Middle name"
                  value={familyForm.middleName}
                  onChangeText={(text) => setFamilyForm((p) => ({ ...p, middleName: text }))}
                />
              </View>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Family name"
                  value={familyForm.familyName}
                  onChangeText={(text) => setFamilyForm((p) => ({ ...p, familyName: text }))}
                />
                <View style={[styles.input, styles.dropdown, { flex: 1 }]}>
                  <TouchableOpacity onPress={() => setShowRelationshipDropdown((s) => !s)}>
                    <View style={styles.selectButtonRow}>
                      <Text style={familyForm.relationship ? styles.cellText : styles.placeholderText}>
                        {familyForm.relationship || 'Not Applicable'}
                      </Text>
                      <Text style={styles.selectCaret}>v</Text>
                    </View>
                  </TouchableOpacity>
                  {showRelationshipDropdown ? (
                    <View style={styles.dropdownList}>
                      {relationshipOptions.map((opt) => (
                        <TouchableOpacity
                          key={opt}
                          style={styles.dropdownOption}
                          onPress={() => {
                            setFamilyForm((p) => ({ ...p, relationship: opt }));
                            setShowRelationshipDropdown(false);
                          }}
                        >
                          <Text style={styles.cellText}>{opt}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>
              <TextInput
                style={styles.input}
                placeholder="Email"
                autoCapitalize="none"
                keyboardType="email-address"
                value={familyForm.email}
                onChangeText={(text) => setFamilyForm((p) => ({ ...p, email: text }))}
              />
              <TouchableOpacity style={styles.button} onPress={addFamilyMember}>
                <Text style={styles.buttonText}>Add Family Member</Text>
              </TouchableOpacity>

              {familyRelationships.length ? (
                <View style={{ marginTop: 12 }}>
                  {familyRelationships.map((rel) => {
                    const name = `${rel.relative.firstName ?? ''} ${rel.relative.middleName ?? ''} ${rel.relative.lastName ?? ''}`.replace(/\s+/g, ' ').trim();
                    const isPendingInbound = rel.status === 'pending' && rel.direction === 'inbound';
                    const isEditable = rel.editableProfile;
                    const isEditing = editingFamilyId === rel.id;
                    return (
                      <View key={rel.id} style={styles.familyRow}>
                        <Text style={styles.bodyText}>{name || 'Unknown'} ({rel.relative.email || 'No email'})</Text>
                        <Text style={styles.helperText}>Relationship: {rel.relationship} • Status: {rel.status}</Text>
                        {isPendingInbound ? (
                          <View style={styles.row}>
                            <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => acceptFamilyLink(rel.id)}>
                              <Text style={styles.buttonText}>Accept</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.button, styles.dangerButton, { flex: 1 }]} onPress={() => rejectFamilyLink(rel.id)}>
                              <Text style={styles.buttonText}>Reject</Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <View style={styles.row}>
                            <TouchableOpacity style={[styles.button, styles.smallButton]} onPress={() => removeFamilyLink(rel.id)}>
                              <Text style={styles.buttonText}>Remove</Text>
                            </TouchableOpacity>
                            {isEditable && !isEditing ? (
                              <TouchableOpacity
                                style={[styles.button, styles.smallButton]}
                                onPress={() => {
                                  setEditingFamilyId(rel.id);
                                  setEditingFamilyDraft({
                                    givenName: rel.relative.firstName ?? '',
                                    middleName: rel.relative.middleName ?? '',
                                    familyName: rel.relative.lastName ?? '',
                                    email: rel.relative.email ?? '',
                                    relationship: rel.relationship ?? '',
                                  });
                                }}
                              >
                                <Text style={styles.buttonText}>Edit profile</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        )}

                        {isEditable && isEditing && editingFamilyDraft ? (
                          <View style={{ marginTop: 8 }}>
                            <Text style={styles.modalLabel}>Edit profile</Text>
                            <View style={styles.row}>
                              <TextInput
                                style={[styles.input, { flex: 1 }]}
                                placeholder="Given"
                                value={editingFamilyDraft.givenName}
                                onChangeText={(text) => setEditingFamilyDraft((p) => (p ? { ...p, givenName: text } : p))}
                              />
                              <TextInput
                                style={[styles.input, { flex: 1 }]}
                                placeholder="Middle"
                                value={editingFamilyDraft.middleName}
                                onChangeText={(text) => setEditingFamilyDraft((p) => (p ? { ...p, middleName: text } : p))}
                              />
                            </View>
                            <TextInput
                              style={styles.input}
                              placeholder="Family"
                              value={editingFamilyDraft.familyName}
                              onChangeText={(text) => setEditingFamilyDraft((p) => (p ? { ...p, familyName: text } : p))}
                            />
                            <TextInput
                              style={styles.input}
                              placeholder="Email"
                              autoCapitalize="none"
                              keyboardType="email-address"
                              value={editingFamilyDraft.email}
                              onChangeText={(text) => setEditingFamilyDraft((p) => (p ? { ...p, email: text } : p))}
                            />
                            <TextInput
                              style={styles.input}
                              placeholder="Relationship"
                              value={editingFamilyDraft.relationship}
                              onChangeText={(text) => setEditingFamilyDraft((p) => (p ? { ...p, relationship: text } : p))}
                            />
                            <View style={styles.row}>
                              <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={saveFamilyProfile}>
                                <Text style={styles.buttonText}>Save</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.button, styles.dangerButton, { flex: 1 }]}
                                onPress={() => {
                                  setEditingFamilyId(null);
                                  setEditingFamilyDraft(null);
                                }}
                              >
                                <Text style={styles.buttonText}>Cancel</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.helperText}>No family members added yet.</Text>
              )}

              <View style={styles.divider} />
              <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={() => setShowDeleteConfirm(true)}>
                <Text style={styles.buttonText}>Delete Account</Text>
              </TouchableOpacity>
              {showDeleteConfirm ? (
                <View style={styles.modalOverlay}>
                  <View style={styles.confirmModal}>
                    <Text style={styles.sectionTitle}>Delete account?</Text>
                    <Text style={styles.helperText}>This cannot be undone. All solo trips and data will be removed.</Text>
                    <View style={styles.row}>
                      <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => setShowDeleteConfirm(false)}>
                        <Text style={styles.buttonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.button, styles.dangerButton, { flex: 1 }]} onPress={deleteAccount}>
                        <Text style={styles.buttonText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ) : null}
            </View>
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

          {activePage === 'follow' ? (
            <>
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Follow a Trip</Text>
                <Text style={styles.helperText}>Enter an invite code to view a shared trip and today's itinerary.</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Invite code"
                  value={followInviteCode}
                  onChangeText={setFollowInviteCode}
                  autoCapitalize="none"
                />
                {followError ? <Text style={styles.errorText}>{followError}</Text> : null}
                <TouchableOpacity style={styles.button} onPress={followTripByInvite} disabled={followLoading}>
                  <Text style={styles.buttonText}>{followLoading ? 'Following...' : 'Follow Trip'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Followed Trips</Text>
                {!followedTrips.length ? (
                  <Text style={styles.helperText}>No followed trips yet.</Text>
                ) : (
                  followedTrips.map((f) => (
                    <View key={f.tripId} style={styles.followTripItem}>
                      <Text style={styles.flightTitle}>{f.tripName}</Text>
                      <Text style={styles.helperText}>
                        {(f.destination ? `${f.destination} • ` : '') + (f.inviterName ? `Invited by ${f.inviterName}` : 'Shared')}
                      </Text>
                      <Text style={[styles.bodyText, { fontWeight: '700', marginTop: 6 }]}>Today's itinerary</Text>
                      {f.todayDetails && f.todayDetails.length ? (
                        f.todayDetails.map((d) => (
                          <View key={d.id ?? `${f.tripId}-${d.activity}`} style={{ marginTop: 4 }}>
                            <Text style={styles.bodyText}>
                              {d.time ? `${d.time} • ` : ''}
                              {d.activity}
                            </Text>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.helperText}>No shared activities for today.</Text>
                      )}
                    </View>
                  ))
                )}
              </View>

              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Share your trips</Text>
                <Text style={styles.helperText}>Grab an invite code to share so others can follow along.</Text>
                {followCodeError ? <Text style={styles.errorText}>{followCodeError}</Text> : null}
                {!trips.length ? (
                  <Text style={styles.helperText}>No trips available. Create one first.</Text>
                ) : (
                  trips.map((trip) => {
                    const code = followCodes[trip.id];
                    const loading = followCodeLoading[trip.id];
                    return (
                      <View key={trip.id} style={styles.followTripItem}>
                        <Text style={styles.flightTitle}>{trip.name}</Text>
                        <Text style={styles.helperText}>Group: {trip.groupName || 'N/A'}</Text>
                        <View style={{ marginTop: 6, gap: 6 }}>
                          {code ? (
                            <View style={[styles.codeRow]}>
                              <Text style={[styles.bodyText, { fontWeight: '700' }]}>Code: {code}</Text>
                              <TouchableOpacity
                                style={[styles.button, styles.smallButton]}
                                onPress={() => {
                                  const text = code;
                                  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                                    navigator.clipboard.writeText(text).catch(() => undefined);
                                  }
                                }}
                              >
                                <Text style={styles.buttonText}>Copy</Text>
                              </TouchableOpacity>
                            </View>
                          ) : null}
                          <TouchableOpacity
                            style={[styles.button, styles.smallButton]}
                            onPress={() => generateLocalFollowCode(trip.id, trip.name)}
                            disabled={loading}
                          >
                            <Text style={styles.buttonText}>Get invite code</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            </>
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
      {showItineraryCountryDropdown ? (
        <View style={styles.dropdownOverlay}>
          <TouchableOpacity
            style={styles.dropdownBackdrop}
            onPress={() => setShowItineraryCountryDropdown(false)}
          />
          <View style={styles.dropdownPortal}>
            <TextInput
              style={[styles.input, styles.inlineInput]}
              placeholder="Search countries"
              value={countrySearch}
              onChangeText={setCountrySearch}
              autoFocus
            />
            <ScrollView style={styles.dropdownScroll}>
              {filteredCountries.map((name) => (
                <TouchableOpacity
                  key={name}
                  style={styles.dropdownOption}
                  onPress={() => {
                    setItineraryCountry(name);
                    setItineraryRegion('');
                    setCountrySearch('');
                    setRegionSearch('');
                    setShowItineraryCountryDropdown(false);
                    setShowItineraryRegionDropdown(false);
                  }}
                >
                  <Text style={styles.cellText}>{name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      ) : null}
      {showItineraryRegionDropdown && regionOptions.length ? (
        <View style={styles.dropdownOverlay}>
          <TouchableOpacity
            style={styles.dropdownBackdrop}
            onPress={() => setShowItineraryRegionDropdown(false)}
          />
          <View style={styles.dropdownPortal}>
            <TextInput
              style={[styles.input, styles.inlineInput]}
              placeholder="Search regions / states"
              value={regionSearch}
              onChangeText={setRegionSearch}
              autoFocus
            />
            <ScrollView style={styles.dropdownScroll}>
              {filteredRegions.map((name) => (
                <TouchableOpacity
                  key={name}
                  style={styles.dropdownOption}
                  onPress={() => {
                    setItineraryRegion(name);
                    setRegionSearch('');
                    setShowItineraryRegionDropdown(false);
                  }}
                >
                  <Text style={styles.cellText}>{name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      ) : null}
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
