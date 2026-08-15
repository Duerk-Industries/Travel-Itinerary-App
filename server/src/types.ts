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
  apple_id?: string;
  picture?: string;
  firstName?: string;
  lastName?: string;
  emailVerified?: boolean;
  emailVerifiedAt?: string | null;
  role: UserRole;
  is_internal_canary?: boolean;
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

export interface AiProviderConfig {
  featureKey: string;
  provider: string;
  model: string;
  enabled: boolean;
  updatedBy?: string | null;
  updatedAt: string;
}

export interface AdminSetting {
  key: string;
  value: string;
  updatedBy?: string | null;
  updatedAt: string;
}

export type AiAnalyticsMetricTable =
  | 'ai_daily_metrics'
  | 'ai_provider_metrics'
  | 'ai_prompt_metrics'
  | 'ai_parser_metrics'
  | 'ai_field_metrics'
  | 'ai_cost_metrics';

export type AiAnalyticsPeriodType = 'day' | 'week' | 'month' | 'quarter';

export interface AiAnalyticsMetric {
  table: AiAnalyticsMetricTable;
  periodStart: string;
  periodType: AiAnalyticsPeriodType;
  dimensions: Record<string, string>;
  metricKey: string;
  metricValue: number;
  updatedAt: string;
}

export type AiExperimentKind = 'shadow_compare' | 'traffic_split';
export type AiExperimentStatus = 'draft' | 'running' | 'paused' | 'completed';

export interface AiExperimentVariant {
  variantId: string;
  provider?: string;
  model?: string;
  promptVersion?: string;
  parserVersion?: string;
  trafficPercent: number;
}

export interface AiExperiment {
  experimentId: string;
  featureKey: string;
  experimentKind: AiExperimentKind;
  name: string;
  status: AiExperimentStatus;
  variants: AiExperimentVariant[];
  controlVariantId?: string | null;
  minSampleSize: number;
  maxDurationDays: number;
  startedAt?: string | null;
  endsAt?: string | null;
  winningVariantId?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiExperimentAssignment {
  assignmentKey: string;
  experimentId: string;
  variantId: string;
  originalVariantId?: string | null;
  assignedAt: string;
  reassignedAt?: string | null;
}

export interface AiAbTestMetric {
  experimentId: string;
  variantId: string;
  day: string;
  requestCount: number;
  successRate: number;
  avgQualityScore: number;
  avgCostUsd: number;
  avgLatencyMs: number;
  groundTruthAgreement?: number | null;
  groundTruthSignal?: string | null;
  updatedAt: string;
}

export interface AiProviderCertification {
  providerId: string;
  certifiedAt: string;
  certifiedBy?: string | null;
  contractSuiteVersion: string;
  notes?: string | null;
}

export type AiRecommendationStatus = 'proposed' | 'applied' | 'dismissed' | 'expired';

export interface AiRecommendation {
  recommendationId: string;
  recommendationType: string;
  featureKey: string;
  subjectCurrent: Record<string, unknown>;
  subjectProposed: Record<string, unknown>;
  rationale: string;
  qualityDeltaEstimate: number;
  costDeltaEstimateUsdMonthly: number;
  confidence: 'low' | 'medium' | 'high' | string;
  supportingEvidenceRef?: string | null;
  supportingEvidenceQuery?: Record<string, unknown> | null;
  engineVersion: string;
  status: AiRecommendationStatus;
  createdAt: string;
  respondedBy?: string | null;
  respondedAt?: string | null;
  outcomeMeasuredAt?: string | null;
  outcomeQualityDelta?: number | null;
  outcomeCostDeltaUsdMonthly?: number | null;
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
  | 'AI_PROVIDER_CONFIG_UPDATED'
  | 'AI_PROVIDER_CERTIFIED'
  | 'AI_PROVIDER_CERTIFICATION_REVOKED'
  | 'AI_EXPERIMENT_CREATED'
  | 'AI_EXPERIMENT_STATUS_CHANGED'
  | 'AI_EXPERIMENT_PROMOTED'
  | 'AI_RECOMMENDATION_APPLIED'
  | 'AI_RECOMMENDATION_DISMISSED'
  | 'ADMIN_SETTING_UPDATED'
  | 'PACKING_DEFAULTS_UPDATED'
  | 'PACKING_PRESET_UPLOADED'
  | 'PACKING_PRESET_REMOVED'
  | 'API_LIMITS_UPDATED'
  | 'API_CACHING_CONFIG_UPDATED'
  | 'COST_ESTIMATOR_CONFIG_UPDATED'
  | 'BILLING_CONFIG_UPDATED'
  | 'BILLING_PRICE_PUBLISHED'
  | 'BILLING_RECONCILIATION_RUN'
  | 'RETENTION_TICK_RUN'
  | 'ITINERARY_CACHE_PREPOPULATE_RUN'
  | 'DEPLOY_CUTOVER'
  | 'DEPLOY_DIRECT_PROD'
  | 'DEPLOY_ROLLBACK'
  | 'DEPLOY_TEARDOWN';

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
  temperatureUnit?: 'fahrenheit' | 'celsius' | null;
  emailVerified?: boolean;
  firstLoginAt?: string | null;
  lastLoginAt?: string | null;
  dateOfBirth?: string | null;
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
  mustSeeAttractions?: string[];
  startDate?: string | null;
  endDate?: string | null;
  startMonth?: number | null;
  startYear?: number | null;
  durationDays?: number | null;
  currency?: string | null;
  coveredBy?: Record<string, string>;
  createdAt: string;
}

export interface PackingListItem {
  id: string;
  category: string;
  label: string;
  position: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PackingListTraveler {
  id: string;
  userId?: string | null;
  name: string;
  email?: string | null;
}

export interface TripPackingList extends PackingListItem {
  packedBy: string[];
}

export type PackingPreset = {
  id: string;
  key: string;
  label: string;
  description: string;
  gendered: boolean;
  contentHash: string;
  sourceFilename: string;
  isActive: boolean;
  items: PackingListItem[];
};

export type PackingPresetPreference = {
  userId: string;
  presetKeys: string[];
  updatedAt?: string | null;
};

export type PackingListV2SourceKind =
  | 'profile_preset'
  | 'profile_personal'
  | 'trip_preset'
  | 'trip_manual'
  | 'legacy_manual';

export type PackingListV2Contribution = {
  id: string;
  tripId: string;
  sourceKind: PackingListV2SourceKind;
  sourceUserId?: string | null;
  sourcePresetKey?: string | null;
  contributionKey: string;
  removedAt?: string | null;
};

export type PackingListV2DisplayGroup = {
  id: string;
  label: string;
  kind: 'preset' | 'trip_manual' | 'multiple_travelers' | 'personal';
  ownerId?: string | null;
  items: Array<PackingListItem & { normalizedLabel?: string; packedBy?: string[]; personalOwnerIds?: string[] }>;
};

export type PackingListV2Source = {
  key: string;
  label: string;
  kind: 'preset' | 'personal';
  active: boolean;
  ownerMemberId?: string | null;
  presetKey?: string | null;
};

export type PackingListV2Trip = {
  groups: PackingListV2DisplayGroup[];
  travelers: PackingListTraveler[];
  presets: PackingPreset[];
  currentTravelerId?: string | null;
  items?: Array<PackingListItem & { packedBy?: string[] }>;
  tripPresetKeys?: string[];
  sources?: PackingListV2Source[];
  manualItems?: PackingListItem[];
};

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
  | 'photography'
  | 'adventure'
  | 'culture'
  | 'food'
  | 'nightlife'
  | 'relax'
  | 'shopping'
  | 'day trips'
  | 'events'
  | 'classes'
  | 'authentic_local'
  | 'iconic_landmarks';

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
  popularityScore?: number | null;
  primaryTag?: InterestTag | null;
  wikipediaTitle?: string | null;
  wikipediaPageId?: number | null;
  wikipediaSummary?: string | null;
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

export interface ItineraryPlanCacheEntry {
  id: string;
  cacheKey: string;
  stage: 'route' | 'day' | 'binding_plan';
  signature: string;
  dependencyFingerprint: string;
  payload: unknown;
  compression?: 'br' | 'none';
  fragments?: unknown[];
  expiresAt: string;
  updatedAt: string;
}

export interface AttractionDurationMetadata {
  id: string;
  destinationKey: string;
  destinationDisplayName: string;
  name: string;
  activityType: ActivityType;
  estimatedDurationMinutes: number;
  durationSource: 'heuristic' | 'override';
  requiresPreOrderTickets: boolean;
  preOrderNotes?: string | null;
  description?: string | null;
  descriptionSource?: 'wikipedia' | 'catalog_snippet' | null;
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
  notes?: string | null;
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

export type ItineraryDetailKind = 'activity' | 'place' | 'note' | 'checklist';

export interface ItineraryChecklistItem {
  id: string;
  detailId: string;
  position: number;
  label: string;
  checkedBy?: string | null;
  checkedAt?: string | null;
  createdAt: string;
}

export interface ItineraryDetail {
  id: string;
  itineraryId: string;
  day: number;
  time?: string | null;
  activity: string;
  cost?: number | null;
  kind?: ItineraryDetailKind;
  placeId?: string | null;
  noteBody?: string | null;
  position?: number;
  updatedAt?: string | null;
  checklistItems?: ItineraryChecklistItem[];
}

export type ItineraryDetailReactionValue = 1 | -1;

export interface ItineraryDetailReactionSummary {
  score: number;
  upCount: number;
  downCount: number;
  userValue: ItineraryDetailReactionValue | null;
}

export interface ItineraryDetailWithReactions extends ItineraryDetail {
  reactions: ItineraryDetailReactionSummary;
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

/** De-identified, per-generation telemetry used for rollout and cost analysis. */
export interface ItineraryGenerationMetrics {
  generationId: string;
  tripId?: string | null;
  userId?: string | null;
  provider: string;
  model: string;
  outcome: 'success' | 'failure';
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  stageMetrics: Array<{
    stage: string;
    callerId: string;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    outcome: 'success' | 'failure';
    parseFailure: boolean;
  }>;
  evaluation?: Record<string, unknown> | null;
  cacheUsage?: Record<string, unknown> | null;
  fallbackUsed?: boolean;
  /** Tokens and estimated cost saved by cache hits or Tier 1 lightweight binding. */
  avoidedInference?: {
    promptTokens: number;
    completionTokens: number;
    estimatedCostMicros: number | null;
  } | null;
  /** Estimated cost in micros (1e-6 USD), derived via providerBudgeting's shared pricing tables. Null when the provider/model has no configured pricing. */
  estimatedCostMicros?: number | null;
  createdAt?: string;
}

/** Offline-safe comparison between a production generation and a "Gold" reference. */
export interface ItineraryComparison {
  id?: string;
  requestPath: string;
  goldCaptureId: string | null;
  productionCaptureId: string | null;
  goldItemCount: number;
  productionItemCount: number;
  itemCountDelta: number;
  goldDays: number;
  productionDays: number;
  attractionCoveragePercent: number | null;
  goldStructuralIssues: string[];
  productionStructuralIssues: string[];
  createdAt?: string;
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
  notes: string;
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
  kind?: ItineraryDetailKind;
  noteBody?: string | null;
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

export interface TripPayment {
  id: string;
  tripId: string;
  groupId: string;
  recordedBy: string;
  payerId: string;
  receiverId: string;
  paymentDate: string;
  amountCents: number;
  currency: string;
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

// ---------------------------------------------------------------------------
// Stripe Billing
// ---------------------------------------------------------------------------

export type BillingSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused'
  | 'canceled';

export type BillingPlanKey = 'premium_monthly' | 'premium_annual' | 'storage_20gb' | 'storage_100gb' | 'storage_200gb' | 'storage_2tb';

export type BillingSubscriptionScope = 'individual' | 'family';

export type WebhookProcessingStatus = 'pending' | 'processed' | 'ignored' | 'failed';

export interface BillingCustomer {
  id: string;
  userId: string;
  stripeCustomerId: string;
  emailSnapshot: string | null;
  livemode: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BillingTrialUsage {
  id: string;
  emailNormalized: string;
  userId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  trialUsedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type BillingNotificationType = 'premium_trial_will_end';

export interface BillingNotification {
  id: string;
  userId: string;
  type: BillingNotificationType;
  notificationKey: string;
  title: string;
  message: string;
  stripeSubscriptionId: string | null;
  stripeEventId: string | null;
  emailSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillingSubscription {
  id: string;
  stripeSubscriptionId: string;
  userId: string;
  subscriptionScope: BillingSubscriptionScope;
  scopeOwnerId: string;
  stripeCustomerId: string;
  stripePriceId: string;
  planKey: BillingPlanKey;
  status: BillingSubscriptionStatus;
  livemode: boolean;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  endedAt: string | null;
  latestInvoiceId: string | null;
  pastDueSince: string | null;
  accessRevokedAt: string | null;
  accessRevocationReason: string | null;
  disputeId: string | null;
  refundedAt: string | null;
  lastStripeEventCreated: number | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StripeWebhookEvent {
  id: string;
  stripeEventId: string;
  eventType: string;
  stripeObjectId: string | null;
  livemode: boolean;
  eventCreated: number | null;
  processingStatus: WebhookProcessingStatus;
  attemptCount: number;
  lastError: string | null;
  receivedAt: string;
  processedAt: string | null;
}

export interface BillingPlanConfig {
  id: string;
  planKey: BillingPlanKey;
  stripeProductId: string | null;
  activeStripePriceId: string | null;
  unitAmountCents: number;
  currency: string;
  interval: 'month' | 'year';
  trialDays: number;
  pastDueGraceDays: number;
  automaticTaxEnabled: boolean;
  promotionCodesEnabled: boolean;
  isCheckoutEnabled: boolean;
  livemode: boolean | null;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface BillingPriceHistory {
  id: string;
  stripePriceId: string;
  planKey: BillingPlanKey;
  stripeProductId: string | null;
  unitAmountCents: number;
  currency: string;
  interval: 'month' | 'year';
  livemode: boolean;
  activeForNewCheckout: boolean;
  createdBy: string | null;
  createdAt: string;
  retiredAt: string | null;
}
