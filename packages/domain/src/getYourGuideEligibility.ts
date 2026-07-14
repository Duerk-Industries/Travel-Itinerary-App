/**
 * Shared, dependency-free Phase 1 rules for selecting optional GetYourGuide
 * affiliate candidates. This module deliberately has no network, database,
 * feature-flag, or affiliate-link logic.
 */

export const GETYOURGUIDE_RULES_VERSION = 'getyourguide-eligibility-v1';

export type GetYourGuideActivityType =
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

export type GetYourGuideBudgetTier = 'free' | 'paid' | 'premium';
export type GetYourGuideComfort = 'Budget' | 'Midrange' | 'Luxury';
export type GetYourGuideMobility = 'Low' | 'Medium' | 'High';
export type GetYourGuideCoordinates = { lat: number; lon: number };

export type GetYourGuideDestinationInput = {
  destination?: string | null;
  city?: string | null;
  country?: string | null;
  coordinates?: Partial<GetYourGuideCoordinates> | null;
};

export type NormalizedGetYourGuideDestination = {
  query: string;
  city?: string;
  country?: string;
  coordinates?: GetYourGuideCoordinates;
  disambiguated: boolean;
};

export type GetYourGuideTimeWindow = { start?: string | null; end?: string | null };

export type GetYourGuideCandidate = {
  id: string;
  name: string;
  activityType: GetYourGuideActivityType | string;
  date?: string | null;
  destination: GetYourGuideDestinationInput;
  durationMinutes?: number | null;
  startTime?: string | null;
  timeWindow?: GetYourGuideTimeWindow | null;
  availableMinutes?: number | null;
  previousTravelMinutes?: number | null;
  nextTravelMinutes?: number | null;
  bufferMinutes?: number | null;
  walkingMinutes?: number | null;
  maxWalkingMinutes?: number | null;
  budgetTier?: GetYourGuideBudgetTier | null;
  mobilityAccessible?: boolean | null;
  languages?: string[] | null;
  interestTags?: string[] | null;
  mustSee?: boolean;
  alreadyBooked?: boolean;
};

export type GetYourGuideTravelerContext = {
  comfort?: GetYourGuideComfort | null;
  mobility?: GetYourGuideMobility | null;
  language?: string | null;
  avoid?: string[] | null;
  interestWeights?: Record<string, number> | null;
  requireDisambiguatedDestination?: boolean;
  maxCandidates?: number;
};

export type GetYourGuideCandidateDecision = {
  eligible: boolean;
  reasons: string[];
  relevanceScore: number;
  canonicalKey: string;
};

export type GetYourGuideSelection = {
  selected: GetYourGuideCandidate[];
  rejected: Array<{ candidate: GetYourGuideCandidate; reasons: string[] }>;
};

export const BOOKABLE_GETYOURGUIDE_ACTIVITY_TYPES: readonly GetYourGuideActivityType[] = [
  'Tour', 'Ticketed Attraction', 'Reservation', 'Day Trip', 'Class',
  'Event', 'Concert/Show', 'Outdoor Activity', 'Spa/Wellness',
];

/**
 * itinerary-improvement-plan.md §4 (Sunday/Monday Trap): hand-curated category-level
 * closure rules. Suggestions are suppressed for a category on a day it is
 * likely to be closed (e.g. many European museums on Mondays).
 */
export const GYG_CLOSED_WEEKDAYS_BY_CATEGORY: Record<string, number[]> = {
  'museum': [1],
  'art gallery': [1],
  'shopping': [0],
  'boutique': [0],
  'market': [1],
};

const STOPWORDS = new Set(['a', 'an', 'and', 'at', 'for', 'from', 'in', 'of', 'on', 'the', 'this', 'to', 'with']);
const GENERIC_WORDS = new Set(['activity', 'event', 'experience', 'museum', 'restaurant', 'sight', 'tour', 'walk']);

export const normalizeGetYourGuideText = (value: unknown): string => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const cleanPart = (value: unknown): string => normalizeGetYourGuideText(value);

const validCoordinates = (coordinates: Partial<GetYourGuideCoordinates> | null | undefined): coordinates is GetYourGuideCoordinates =>
  Number.isFinite(Number(coordinates?.lat)) && Number(coordinates!.lat) >= -90 && Number(coordinates!.lat) <= 90 &&
  Number.isFinite(Number(coordinates?.lon)) && Number(coordinates!.lon) >= -180 && Number(coordinates!.lon) <= 180;

export const normalizeGetYourGuideDestination = (
  input: GetYourGuideDestinationInput | null | undefined
): NormalizedGetYourGuideDestination | null => {
  const rawDestination = String(input?.destination ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const destinationParts = rawDestination.split(',').map((part) => cleanPart(part)).filter(Boolean);
  const destination = destinationParts.join(', ');
  const explicitCity = cleanPart(input?.city);
  const explicitCountry = cleanPart(input?.country);
  const city = explicitCity || destinationParts[0] || undefined;
  const country = explicitCountry || (destinationParts.length > 1 ? destinationParts[destinationParts.length - 1] : undefined);
  const coordinates = validCoordinates(input?.coordinates)
    ? { lat: Number(input!.coordinates!.lat), lon: Number(input!.coordinates!.lon) }
    : undefined;
  const query = [city, country && country !== city ? country : undefined].filter(Boolean).join(', ') || destination ||
    (coordinates ? `${coordinates.lat},${coordinates.lon}` : '');
  if (!query) return null;
  return {
    query,
    ...(city ? { city } : {}),
    ...(country ? { country } : {}),
    ...(coordinates ? { coordinates } : {}),
    disambiguated: Boolean(coordinates || (city && country)),
  };
};

export const isBookableGetYourGuideActivityType = (activityType: unknown): activityType is GetYourGuideActivityType =>
  BOOKABLE_GETYOURGUIDE_ACTIVITY_TYPES.includes(activityType as GetYourGuideActivityType);

const isVagueActivityName = (normalized: string): boolean => {
  if (/^(?:a\s+)?nearby(?:\s+.+)?$/.test(normalized)) return true;
  if (/^(?:a\s+)?flexible(?:\s+plan|\s+activity)?$/.test(normalized)) return true;
  if (/^(?:a\s+)?(?:city\s+center|old\s+town)(?:\s+(?:walk|tour|area|activity))?$/.test(normalized)) return true;
  if (/^(?:a\s+)?local\s+(?:park|market|restaurant|event)(?:\s+(?:in|at)\s+.+)?$/.test(normalized)) return true;
  return false;
};

export const isLikelySpecificGetYourGuideActivityName = (name: unknown): boolean => {
  const normalized = normalizeGetYourGuideText(name);
  if (!normalized || isVagueActivityName(normalized)) return false;
  const meaningfulWords = normalized.split(' ').filter((word) => !STOPWORDS.has(word));
  if (meaningfulWords.length < 2) return false;
  if (meaningfulWords.length === 2 && meaningfulWords.every((word) => GENERIC_WORDS.has(word))) return false;
  return true;
};

export const parseGetYourGuideClockMinutes = (value: unknown): number | null => {
  const text = String(value ?? '').trim().toLowerCase();
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (minute > 59) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    if (match[3] === 'pm' && hour !== 12) hour += 12;
    if (match[3] === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) return null;
  return hour * 60 + minute;
};

export const isGetYourGuideTimeWindowFeasible = (params: {
  startTime?: string | null;
  durationMinutes?: number | null;
  timeWindow?: GetYourGuideTimeWindow | null;
}): boolean => {
  if (!params.startTime || !params.timeWindow) return true;
  const start = parseGetYourGuideClockMinutes(params.startTime);
  const duration = Number(params.durationMinutes);
  if (start == null || !Number.isFinite(duration) || duration < 0) return false;
  const windowStart = params.timeWindow.start ? parseGetYourGuideClockMinutes(params.timeWindow.start) : 0;
  const windowEnd = params.timeWindow.end ? parseGetYourGuideClockMinutes(params.timeWindow.end) : 1440;
  if (windowStart == null || windowEnd == null) return false;
  const overnight = windowEnd < windowStart;
  const adjustedStart = overnight && start < windowStart ? start + 1440 : start;
  const adjustedEnd = adjustedStart + duration;
  const adjustedWindowEnd = overnight ? windowEnd + 1440 : windowEnd;
  return adjustedStart >= windowStart && adjustedEnd <= adjustedWindowEnd;
};

const finiteNonNegative = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

export const isGetYourGuideTravelWindowFeasible = (candidate: GetYourGuideCandidate, mobility?: GetYourGuideMobility | null): boolean => {
  const duration = finiteNonNegative(candidate.durationMinutes);
  const available = finiteNonNegative(candidate.availableMinutes);
  const previous = finiteNonNegative(candidate.previousTravelMinutes) ?? 0;
  const next = finiteNonNegative(candidate.nextTravelMinutes) ?? 0;
  const buffer = finiteNonNegative(candidate.bufferMinutes) ?? 0;
  if ([candidate.previousTravelMinutes, candidate.nextTravelMinutes, candidate.bufferMinutes].some((value) => value != null && finiteNonNegative(value) == null)) return false;
  if (candidate.durationMinutes != null && duration == null) return false;
  if (candidate.availableMinutes != null && available == null) return false;
  if (candidate.availableMinutes != null && candidate.durationMinutes != null && available != null && duration != null && duration + previous + next + buffer > available) return false;
  const walking = finiteNonNegative(candidate.walkingMinutes);
  if (candidate.walkingMinutes != null && walking == null) return false;
  if (mobility === 'Low' && candidate.mobilityAccessible === false) return false;
  if (mobility === 'Low' && walking != null && walking > (finiteNonNegative(candidate.maxWalkingMinutes) ?? 30)) return false;
  return isGetYourGuideTimeWindowFeasible(candidate);
};

const isBudgetCompatible = (candidateTier: GetYourGuideBudgetTier | null | undefined, comfort: GetYourGuideComfort | null | undefined): boolean => {
  if (!candidateTier || !comfort) return true;
  if (comfort === 'Budget') return candidateTier !== 'premium';
  if (comfort === 'Luxury') return candidateTier !== 'free';
  return true;
};

const isLanguageCompatible = (languages: string[] | null | undefined, language: string | null | undefined): boolean => {
  if (!language || !languages?.length) return true;
  const requested = normalizeGetYourGuideText(language);
  return languages.some((value) => {
    const normalized = normalizeGetYourGuideText(value);
    return normalized === requested || normalized.startsWith(`${requested} `);
  });
};

const matchesAvoidTerm = (candidate: GetYourGuideCandidate, avoid: string[] | null | undefined): boolean => {
  const terms = (avoid ?? []).map(normalizeGetYourGuideText).filter(Boolean);
  if (!terms.length) return false;
  const haystack = [candidate.name, ...(candidate.interestTags ?? [])].map(normalizeGetYourGuideText).join(' ');
  return terms.some((term) => haystack.includes(term));
};

const isLikelyClosedOnDay = (candidate: GetYourGuideCandidate): boolean => {
  if (!candidate.date) return false;
  const date = new Date(`${candidate.date}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const weekday = date.getUTCDay();
  const name = normalizeGetYourGuideText(candidate.name);
  for (const [category, closedDays] of Object.entries(GYG_CLOSED_WEEKDAYS_BY_CATEGORY)) {
    if (name.includes(category) && closedDays.includes(weekday)) return true;
  }
  return false;
};

export const getGetYourGuideCanonicalKey = (candidate: GetYourGuideCandidate): string => {
  const destination = normalizeGetYourGuideDestination(candidate.destination)?.query ?? '';
  return [candidate.date ?? '', destination, normalizeGetYourGuideText(candidate.name)].join('|');
};

export const evaluateGetYourGuideCandidate = (
  candidate: GetYourGuideCandidate,
  context: GetYourGuideTravelerContext = {}
): GetYourGuideCandidateDecision => {
  const reasons: string[] = [];
  const destination = normalizeGetYourGuideDestination(candidate.destination);
  const requireDestination = context.requireDisambiguatedDestination ?? true;
  if (!isBookableGetYourGuideActivityType(candidate.activityType)) reasons.push('activity_type_not_eligible');
  if (!isLikelySpecificGetYourGuideActivityName(candidate.name)) reasons.push('activity_name_not_specific');
  if (!destination) reasons.push('destination_missing');
  else if (requireDestination && !destination.disambiguated) reasons.push('destination_not_disambiguated');
  if (candidate.alreadyBooked) reasons.push('already_booked');
  if (matchesAvoidTerm(candidate, context.avoid)) reasons.push('matches_avoid_preference');
  if (!isBudgetCompatible(candidate.budgetTier, context.comfort)) reasons.push('budget_incompatible');
  if (!isLanguageCompatible(candidate.languages, context.language)) reasons.push('language_unavailable');
  if (!isGetYourGuideTravelWindowFeasible(candidate, context.mobility)) reasons.push('travel_window_infeasible');
  if (isLikelyClosedOnDay(candidate)) reasons.push('likely_closed_on_day');
  const interestScore = (candidate.interestTags ?? []).reduce((sum, tag) => sum + Number(context.interestWeights?.[tag] ?? context.interestWeights?.[normalizeGetYourGuideText(tag)] ?? 0), 0);
  const relevanceScore = (candidate.mustSee ? 100000 : 0) + (Number.isFinite(interestScore) ? interestScore : 0);
  return { eligible: reasons.length === 0, reasons, relevanceScore, canonicalKey: getGetYourGuideCanonicalKey(candidate) };
};

export const selectGetYourGuideCandidates = (
  candidates: GetYourGuideCandidate[],
  context: GetYourGuideTravelerContext = {}
): GetYourGuideSelection => {
  const evaluated = candidates.map((candidate, index) => ({ candidate, index, decision: evaluateGetYourGuideCandidate(candidate, context) }));
  const rejected = evaluated.filter(({ decision }) => !decision.eligible).map(({ candidate, decision }) => ({ candidate, reasons: decision.reasons }));
  const seen = new Set<string>();
  const eligible = evaluated
    .filter(({ decision }) => decision.eligible)
    .sort((a, b) => b.decision.relevanceScore - a.decision.relevanceScore || a.index - b.index)
    .filter(({ decision }) => {
      if (seen.has(decision.canonicalKey)) return false;
      seen.add(decision.canonicalKey);
      return true;
    });
  const requestedMax = Number(context.maxCandidates ?? 4);
  const maxCandidates = Number.isFinite(requestedMax) ? Math.max(0, Math.floor(requestedMax)) : 4;
  return { selected: eligible.slice(0, maxCandidates).map(({ candidate }) => candidate), rejected };
};
