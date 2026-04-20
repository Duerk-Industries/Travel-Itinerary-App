export type ItineraryStatus = 'Needed' | 'Proposed' | 'Booked' | 'Cancelled' | 'Completed';
export type ActivityType =
  | 'Class'
  | 'Concert/Show'
  | 'Day Trip'
  | 'Event'
  | 'Food & Drink'
  | 'Fun & Games'
  | 'Hike'
  | 'Nightlife'
  | 'Open Access'
  | 'Outdoor Activity'
  | 'Reservation'
  | 'Shopping'
  | 'Sights & Landmarks'
  | 'Spa/Wellness'
  | 'Ticketed Attraction'
  | 'Tour';

export type UserRole = 'user' | 'admin';
export type TierKey = 'free' | 'premium' | 'pro' | string;

export interface User {
  id: string;
  email: string;
  username?: string;
  provider: 'google' | 'apple' | 'email' | 'family';
  google_id?: string;
  picture?: string;
  firstName?: string;
  lastName?: string;
  emailVerified?: boolean;
  emailVerifiedAt?: string | null;
  role: UserRole;
}

export interface Tier {
  id: string;
  key: TierKey;
  displayName: string;
  rank: number;
  isActive: boolean;
  createdAt: string;
}

export interface Feature {
  id: string;
  key: string;
  description: string;
  defaultEnabled: boolean;
  createdAt: string;
}

export interface TierEntitlement {
  id: string;
  tierId: string;
  featureId: string;
  isAllowed: boolean;
  createdAt: string;
}

export interface TierLimit {
  id: string;
  tierId: string;
  limitKey: string;
  limitValue: number;
  createdAt: string;
}

export interface UserTier {
  id: string;
  userId: string;
  tierId: string;
  source: 'system' | 'billing' | 'admin_override' | 'admin' | string;
  reason?: string | null;
  assignedBy?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  createdAt: string;
}

export interface FeatureFlag {
  id: string;
  key: string;
  enabled: boolean;
  scope: 'global';
  updatedBy?: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface UsageCounter {
  id: string;
  userId: string;
  metricKey: string;
  windowKey: string;
  count: number;
  updatedAt: string;
}

export interface GenerationIdempotencyRecord {
  key: string;
  userId: string;
  tripId: string;
  usageKey?: string | null;
  windowKey?: string | null;
  status: 'pending' | 'completed' | 'failed';
  resultRef?: string | null;
  responseBody?: Record<string, unknown> | null;
  errorMessage?: string | null;
  createdAt: string;
  expiresAt: string;
}

export type AuditAction =
  | 'ADMIN_BOOTSTRAP_GRANTED'
  | 'USER_ROLE_GRANTED'
  | 'USER_ROLE_REVOKED'
  | 'USER_TIER_CHANGED'
  | 'TIER_LIMIT_UPDATED'
  | 'TIER_ENTITLEMENT_UPDATED'
  | 'FEATURE_FLAG_UPDATED'
  | 'API_LIMITS_UPDATED';

export interface AuditLogEntry {
  id: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  action: AuditAction;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export interface WebUser {
  id: string;
  email: string;
  username?: string;
  firstName: string;
  lastName: string;
  homeAddress?: string | null;
  preferredAirport?: string | null;
  mapPreference?: 'google' | 'apple' | 'waze' | null;
  appearancePreference?: 'light' | 'dark' | 'auto' | null;
  emailVerified?: boolean;
  firstLoginAt?: string | null;
  lastLoginAt?: string | null;
}

export interface Flight {
  id: string;
  userId: string;
  status: ItineraryStatus;
  transferType?: 'Flight' | 'Train' | 'Bus' | 'Private' | 'Ferry' | 'Other';
  netVotes?: number;
  userVote?: -1 | 1 | null;
  netRating?: number;
  userRating?: -1 | 1 | null;
  passengerName: string;
  passengerIds?: string[];
  departureDate: string;
  arrivalDate?: string | null;
  tripId: string;
  departureLocation?: string;
  departureAirportCode?: string;
  departureTime: string;
  arrivalLocation?: string;
  arrivalAirportCode?: string;
  layoverLocation?: string;
  layoverLocationCode?: string;
  layoverDuration?: string;
  arrivalTime: string;
  cost: number;
  carrier: string;
  flightNumber: string;
  bookingReference: string;
  paidBy: string[];
  sharedWith?: string[];
  groupId?: string;
  passengerInGroup?: boolean;
  departureAirportLabel?: string;
  arrivalAirportLabel?: string;
  layoverAirportLabel?: string;
}

export interface Airport {
  iata_code: string;
  name: string;
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
}

export interface Group {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId?: string;
  guestName?: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  addedBy: string;
  createdAt: string;
  userEmail?: string;
}

export interface Trip {
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
  coveredBy?: Record<string, string>;
  createdAt: string;
}

export interface LocationRecord {
  id: string;
  sourceType: 'country_region' | 'city';
  category?: string | null;
  name: string;
  address?: string | null;
  visitorCount?: string | null;
  climate?: string | null;
  priceLevel?: string | null;
  bestMonth?: string | null;
  editorialSummary?: string | null;
  popularityTier?: string | null;
  unesco?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
  websiteUri?: string | null;
  googleMapsUri?: string | null;
  keywords?: string[];
  sourceFile?: string | null;
  sourceRowHash?: string | null;
  updatedAt?: string;
}

export type InterestTag =
  | 'outdoors'
  | 'culture'
  | 'food'
  | 'nightlife'
  | 'relax'
  | 'shopping'
  | 'day trips'
  | 'events'
  | 'classes';

export type AttractionBudgetTier = 'free' | 'paid' | 'premium';

export interface AttractionCatalogEntry {
  id: string;
  destinationKey: string;
  destinationDisplayName: string;
  country?: string | null;
  stateProvince?: string | null;
  name: string;
  rank: number;
  activityType: ActivityType;
  interestTags: InterestTag[];
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  snippet?: string | null;
  sourceCount?: number;
  budgetTier?: AttractionBudgetTier;
  sitelinks?: number | null;
  qid?: string | null;
  lat?: number | null;
  lon?: number | null;
  updatedAt: string;
}

export interface AttractionShortlistBlob {
  id: string;
  destinationKey: string;
  destinationDisplayName: string;
  dateKey: string;
  promptBlock: string;
  compact: string;
  itemCount: number;
  updatedAt: string;
}

export interface Trait {
  id: string;
  userId: string;
  name: string;
  level: number;
  notes?: string | null;
  createdAt: string;
}

export interface Lodging {
  id: string;
  user_id: string;
  trip_id: string;
  status: ItineraryStatus;
  netVotes?: number;
  userVote?: -1 | 1 | null;
  netRating?: number;
  userRating?: -1 | 1 | null;
  name: string;
  check_in_date: string;
  check_out_date: string;
  rooms: number;
  refund_by: string;
  total_cost: number;
  cost_per_night: number;
  address: string;
  paid_by: string[];
  traveler_ids?: string[];
  imageUrl?: string;
  place_id?: string;
  placeId?: string;
}

export interface Activity {
  id: string;
  userId: string;
  tripId: string;
  status: ItineraryStatus;
  activityType: ActivityType;
  netVotes?: number;
  userVote?: -1 | 1 | null;
  netRating?: number;
  userRating?: -1 | 1 | null;
  date: string;
  name: string;
  startLocation: string;
  startTime: string;
  duration: string;
  cost: number;
  freeCancelBy?: string | null;
  bookedOn: string;
  reference: string;
  paidBy: string[];
  travelerIds?: string[];
  createdAt: string;
}

// Temporary compatibility alias while call sites transition to Activity naming.
export type Tour = Activity;

export interface CarRental {
  id: string;
  userId: string;
  tripId: string;
  status: ItineraryStatus;
  netVotes?: number;
  userVote?: -1 | 1 | null;
  netRating?: number;
  userRating?: -1 | 1 | null;
  pickupLocation: string;
  pickupDate: string;
  dropoffLocation: string;
  dropoffDate: string;
  reference: string;
  vendor: string;
  prepaid: string;
  cost: number;
  model: string;
  notes: string;
  paidBy: string[];
  travelerIds: string[];
  createdAt: string;
}

export interface Itinerary {
  id: string;
  userId: string;
  tripId: string;
  destination: string;
  days: number;
  budget?: number | null;
  createdAt: string;
}

export interface ItineraryDetail {
  id: string;
  itineraryId: string;
  day: number;
  time?: string | null;
  activity: string;
  cost?: number | null;
}

export type ItineraryPromptPace = 'Relaxed' | 'Balanced' | 'Fast';
export type ItineraryPromptComfort = 'Budget' | 'Midrange' | 'Luxury';
export type ItineraryPromptMobility = 'Low' | 'Medium' | 'High';
export type ItineraryPromptCarPreference = 'PublicTransitOnly' | 'DayTripsOnly' | 'FullTripRental';
export type ItineraryPromptInteractionStyle = 'Self-Guided' | 'Mixed' | 'Guided';
export type TransferMode = 'Flight' | 'Train' | 'Bus' | 'Private' | 'Ferry' | 'Other';

export interface ItineraryPromptProfile {
  pace: ItineraryPromptPace;
  comfort: ItineraryPromptComfort;
  mobility: ItineraryPromptMobility;
  carPreference: ItineraryPromptCarPreference;
  interactionStyle: ItineraryPromptInteractionStyle;
  weights: {
    outdoors: number;
    adventure: number;
    culture: number;
    food: number;
    nightlife: number;
    relax: number;
    photography: number;
    authentic_local: number;
    iconic_landmarks: number;
  };
}

export interface ItineraryGeneratedTransfer {
  status: 'Needed';
  transferType: TransferMode;
  departureDate: string;
  arrivalDate: string;
  departureLocation: string;
  arrivalLocation: string;
  departureTime: string;
  arrivalTime: string;
  carrier: string;
  flightNumber: string;
  bookingReference: string;
  note?: string;
}

export interface ItineraryGeneratedLodging {
  status: 'Needed';
  name: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: string;
  totalCost: string;
  costPerNight: string;
  address: string;
}

export interface ItineraryGeneratedActivity {
  status: 'Proposed';
  activityType: ActivityType;
  date: string;
  name: string;
  startLocation: string;
  startTime: string;
  duration: string;
  cost: string;
  freeCancelBy: string;
  bookedOn: string;
  reference: string;
}

export interface ItineraryGeneratedCarRental {
  status: 'Needed';
  pickupLocation: string;
  pickupDate: string;
  dropoffLocation: string;
  dropoffDate: string;
  reference: string;
  vendor: string;
  prepaid: string;
  cost: string;
  model: string;
  notes: string;
}

export interface ItineraryGeneratedItems {
  transfers: ItineraryGeneratedTransfer[];
  lodgings: ItineraryGeneratedLodging[];
  activities: ItineraryGeneratedActivity[];
  carRentals: ItineraryGeneratedCarRental[];
}

export interface ItineraryGeneratedDetail {
  day: number;
  time: string | null;
  activity: string;
  cost: number | null;
}

export interface PlaceDetailsCache {
  placeId: string;
  name: string;
  details: Record<string, any>;
  fetchedAt: string;
}

export interface PlaceLookupCache {
  queryKey: string;
  placeId: string;
  name: string;
  likelihood: number;
  fetchedAt: string;
}

export interface Expense {
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

export interface GroupInvite {
  id: string;
  groupId: string;
  inviterId: string;
  inviteeUserId: string;
  inviteeEmail: string;
  status: 'pending' | 'accepted';
  createdAt: string;
  groupName: string;
  inviterEmail: string;
}

export interface FamilyRelationship {
  id: string;
  requesterId: string;
  relativeId: string;
  relationship: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export type TripActivityType =
  | 'TRIP_CREATED'
  | 'FOLLOW_ADDED'
  | 'FOLLOW_REMOVED'
  | 'ITINERARY_ITEM_ADDED'
  | 'ITINERARY_ITEM_UPDATED'
  | 'ITINERARY_ITEM_DELETED'
  | 'FLIGHT_ADDED'
  | 'LODGING_ADDED'
  | 'TOUR_ADDED'
  | 'NOTE_ADDED';

export interface TripActivity {
  id: string;
  tripId: string;
  actorUserId?: string | null;
  type: TripActivityType;
  title: string;
  summary: string;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface TripComment {
  id: string;
  tripId: string;
  actorUserId?: string | null;
  body: string;
  createdAt: string;
  authorName?: string | null;
  authorEmail?: string | null;
}

export interface TripShareInvite {
  id: string;
  tripId: string;
  groupId: string;
  inviterId: string;
  inviteeUserId?: string | null;
  inviteeEmail: string;
  role: 'member' | 'follower';
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt?: string | null;
  acceptedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Chat / Messaging
// ---------------------------------------------------------------------------

export interface TripChatMessage {
  id: string;
  appId: string;
  tripId: string;
  senderId: string;
  senderName: string;
  senderInitials: string;
  body: string;
  createdAt: string;
  /** IDs of users who have read this message */
  readBy?: string[];
}

export interface TripMessageRead {
  messageId: string;
  userId: string;
  readAt: string;
}
