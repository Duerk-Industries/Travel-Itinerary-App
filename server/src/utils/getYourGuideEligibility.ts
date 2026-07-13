// Mirror of packages/domain/src/getYourGuideEligibility.ts.
// Server tsconfig intentionally does not import source outside server/src;
// server/__tests__/domainSync.test.ts verifies the public behavior stays aligned.

export const GETYOURGUIDE_RULES_VERSION = 'getyourguide-eligibility-v1';
export type GetYourGuideActivityType = 'Class' | 'Concert/Show' | 'Day Trip' | 'Event' | 'Food & Drink' | 'Fun & Games' | 'Hike' | 'Nightlife' | 'Open Access' | 'Outdoor Activity' | 'Reservation' | 'Shopping' | 'Sights & Landmarks' | 'Spa/Wellness' | 'Ticketed Attraction' | 'Tour';
export type GetYourGuideBudgetTier = 'free' | 'paid' | 'premium';
export type GetYourGuideComfort = 'Budget' | 'Midrange' | 'Luxury';
export type GetYourGuideMobility = 'Low' | 'Medium' | 'High';
export type GetYourGuideCoordinates = { lat: number; lon: number };
export type GetYourGuideDestinationInput = { destination?: string | null; city?: string | null; country?: string | null; coordinates?: Partial<GetYourGuideCoordinates> | null };
export type NormalizedGetYourGuideDestination = { query: string; city?: string; country?: string; coordinates?: GetYourGuideCoordinates; disambiguated: boolean };
export type GetYourGuideTimeWindow = { start?: string | null; end?: string | null };
export type GetYourGuideCandidate = {
  id: string; name: string; activityType: GetYourGuideActivityType | string; date?: string | null; destination: GetYourGuideDestinationInput;
  durationMinutes?: number | null; startTime?: string | null; timeWindow?: GetYourGuideTimeWindow | null;
  availableMinutes?: number | null; previousTravelMinutes?: number | null; nextTravelMinutes?: number | null;
  bufferMinutes?: number | null; walkingMinutes?: number | null; maxWalkingMinutes?: number | null;
  budgetTier?: GetYourGuideBudgetTier | null; mobilityAccessible?: boolean | null; languages?: string[] | null;
  interestTags?: string[] | null; mustSee?: boolean; alreadyBooked?: boolean;
};
export type GetYourGuideTravelerContext = { comfort?: GetYourGuideComfort | null; mobility?: GetYourGuideMobility | null; language?: string | null; avoid?: string[] | null; interestWeights?: Record<string, number> | null; requireDisambiguatedDestination?: boolean; maxCandidates?: number };
export type GetYourGuideCandidateDecision = { eligible: boolean; reasons: string[]; relevanceScore: number; canonicalKey: string };
export type GetYourGuideSelection = { selected: GetYourGuideCandidate[]; rejected: Array<{ candidate: GetYourGuideCandidate; reasons: string[] }> };

export const BOOKABLE_GETYOURGUIDE_ACTIVITY_TYPES: readonly GetYourGuideActivityType[] = ['Tour', 'Ticketed Attraction', 'Reservation', 'Day Trip', 'Class', 'Event', 'Concert/Show', 'Outdoor Activity', 'Spa/Wellness'];
const STOPWORDS = new Set(['a', 'an', 'and', 'at', 'for', 'from', 'in', 'of', 'on', 'the', 'this', 'to', 'with']);
const GENERIC_WORDS = new Set(['activity', 'event', 'experience', 'museum', 'restaurant', 'sight', 'tour', 'walk']);

export const normalizeGetYourGuideText = (value: unknown): string => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const cleanPart = (value: unknown): string => normalizeGetYourGuideText(value);
const validCoordinates = (coordinates: Partial<GetYourGuideCoordinates> | null | undefined): coordinates is GetYourGuideCoordinates => Number.isFinite(Number(coordinates?.lat)) && Number(coordinates!.lat) >= -90 && Number(coordinates!.lat) <= 90 && Number.isFinite(Number(coordinates?.lon)) && Number(coordinates!.lon) >= -180 && Number(coordinates!.lon) <= 180;

export const normalizeGetYourGuideDestination = (input: GetYourGuideDestinationInput | null | undefined): NormalizedGetYourGuideDestination | null => {
  const rawDestination = String(input?.destination ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const destinationParts = rawDestination.split(',').map((part) => cleanPart(part)).filter(Boolean), destination = destinationParts.join(', ');
  const explicitCity = cleanPart(input?.city), explicitCountry = cleanPart(input?.country);
  const city = explicitCity || destinationParts[0] || undefined, country = explicitCountry || (destinationParts.length > 1 ? destinationParts[destinationParts.length - 1] : undefined);
  const coordinates = validCoordinates(input?.coordinates) ? { lat: Number(input!.coordinates!.lat), lon: Number(input!.coordinates!.lon) } : undefined;
  const query = [city, country && country !== city ? country : undefined].filter(Boolean).join(', ') || destination || (coordinates ? `${coordinates.lat},${coordinates.lon}` : '');
  if (!query) return null;
  return { query, ...(city ? { city } : {}), ...(country ? { country } : {}), ...(coordinates ? { coordinates } : {}), disambiguated: Boolean(coordinates || (city && country)) };
};

export const isBookableGetYourGuideActivityType = (activityType: unknown): activityType is GetYourGuideActivityType => BOOKABLE_GETYOURGUIDE_ACTIVITY_TYPES.includes(activityType as GetYourGuideActivityType);
const isVagueActivityName = (normalized: string): boolean => /^(?:a\s+)?nearby(?:\s+.+)?$/.test(normalized) || /^(?:a\s+)?flexible(?:\s+plan|\s+activity)?$/.test(normalized) || /^(?:a\s+)?(?:city\s+center|old\s+town)(?:\s+(?:walk|tour|area|activity))?$/.test(normalized) || /^(?:a\s+)?local\s+(?:park|market|restaurant|event)(?:\s+(?:in|at)\s+.+)?$/.test(normalized);
export const isLikelySpecificGetYourGuideActivityName = (name: unknown): boolean => {
  const normalized = normalizeGetYourGuideText(name); if (!normalized || isVagueActivityName(normalized)) return false;
  const meaningfulWords = normalized.split(' ').filter((word) => !STOPWORDS.has(word));
  return meaningfulWords.length >= 2 && !(meaningfulWords.length === 2 && meaningfulWords.every((word) => GENERIC_WORDS.has(word)));
};

export const parseGetYourGuideClockMinutes = (value: unknown): number | null => {
  const match = String(value ?? '').trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/); if (!match) return null;
  let hour = Number(match[1]); const minute = Number(match[2] ?? 0); if (minute > 59) return null;
  if (match[3]) { if (hour < 1 || hour > 12) return null; if (match[3] === 'pm' && hour !== 12) hour += 12; if (match[3] === 'am' && hour === 12) hour = 0; } else if (hour > 23) return null;
  return hour * 60 + minute;
};
export const isGetYourGuideTimeWindowFeasible = (params: { startTime?: string | null; durationMinutes?: number | null; timeWindow?: GetYourGuideTimeWindow | null }): boolean => {
  if (!params.startTime || !params.timeWindow) return true;
  const start = parseGetYourGuideClockMinutes(params.startTime), duration = Number(params.durationMinutes); if (start == null || !Number.isFinite(duration) || duration < 0) return false;
  const windowStart = params.timeWindow.start ? parseGetYourGuideClockMinutes(params.timeWindow.start) : 0, windowEnd = params.timeWindow.end ? parseGetYourGuideClockMinutes(params.timeWindow.end) : 1440;
  if (windowStart == null || windowEnd == null) return false; const overnight = windowEnd < windowStart, adjustedStart = overnight && start < windowStart ? start + 1440 : start;
  return adjustedStart >= windowStart && adjustedStart + duration <= (overnight ? windowEnd + 1440 : windowEnd);
};
const finiteNonNegative = (value: unknown): number | null => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; };
export const isGetYourGuideTravelWindowFeasible = (candidate: GetYourGuideCandidate, mobility?: GetYourGuideMobility | null): boolean => {
  const duration = finiteNonNegative(candidate.durationMinutes), available = finiteNonNegative(candidate.availableMinutes), previous = finiteNonNegative(candidate.previousTravelMinutes) ?? 0, next = finiteNonNegative(candidate.nextTravelMinutes) ?? 0, buffer = finiteNonNegative(candidate.bufferMinutes) ?? 0;
  if (candidate.durationMinutes != null && duration == null) return false; if (candidate.availableMinutes != null && available == null) return false;
  if ([candidate.previousTravelMinutes, candidate.nextTravelMinutes, candidate.bufferMinutes].some((value) => value != null && finiteNonNegative(value) == null)) return false;
  if (candidate.availableMinutes != null && candidate.durationMinutes != null && available != null && duration != null && duration + previous + next + buffer > available) return false;
  const walking = finiteNonNegative(candidate.walkingMinutes); if (candidate.walkingMinutes != null && walking == null) return false;
  if (mobility === 'Low' && candidate.mobilityAccessible === false) return false; if (mobility === 'Low' && walking != null && walking > (finiteNonNegative(candidate.maxWalkingMinutes) ?? 30)) return false;
  return isGetYourGuideTimeWindowFeasible(candidate);
};
const isBudgetCompatible = (tier: GetYourGuideBudgetTier | null | undefined, comfort: GetYourGuideComfort | null | undefined): boolean => !tier || !comfort || (comfort === 'Budget' ? tier !== 'premium' : comfort === 'Luxury' ? tier !== 'free' : true);
const isLanguageCompatible = (languages: string[] | null | undefined, language: string | null | undefined): boolean => !language || !languages?.length || languages.some((value) => { const normalized = normalizeGetYourGuideText(value), requested = normalizeGetYourGuideText(language); return normalized === requested || normalized.startsWith(`${requested} `); });
const matchesAvoidTerm = (candidate: GetYourGuideCandidate, avoid: string[] | null | undefined): boolean => { const terms = (avoid ?? []).map(normalizeGetYourGuideText).filter(Boolean); const haystack = [candidate.name, ...(candidate.interestTags ?? [])].map(normalizeGetYourGuideText).join(' '); return terms.some((term) => haystack.includes(term)); };
export const getGetYourGuideCanonicalKey = (candidate: GetYourGuideCandidate): string => [candidate.date ?? '', normalizeGetYourGuideDestination(candidate.destination)?.query ?? '', normalizeGetYourGuideText(candidate.name)].join('|');
export const evaluateGetYourGuideCandidate = (candidate: GetYourGuideCandidate, context: GetYourGuideTravelerContext = {}): GetYourGuideCandidateDecision => {
  const reasons: string[] = [], destination = normalizeGetYourGuideDestination(candidate.destination), requireDestination = context.requireDisambiguatedDestination ?? true;
  if (!isBookableGetYourGuideActivityType(candidate.activityType)) reasons.push('activity_type_not_eligible'); if (!isLikelySpecificGetYourGuideActivityName(candidate.name)) reasons.push('activity_name_not_specific');
  if (!destination) reasons.push('destination_missing'); else if (requireDestination && !destination.disambiguated) reasons.push('destination_not_disambiguated'); if (candidate.alreadyBooked) reasons.push('already_booked');
  if (matchesAvoidTerm(candidate, context.avoid)) reasons.push('matches_avoid_preference'); if (!isBudgetCompatible(candidate.budgetTier, context.comfort)) reasons.push('budget_incompatible'); if (!isLanguageCompatible(candidate.languages, context.language)) reasons.push('language_unavailable'); if (!isGetYourGuideTravelWindowFeasible(candidate, context.mobility)) reasons.push('travel_window_infeasible');
  const interestScore = (candidate.interestTags ?? []).reduce((sum, tag) => sum + Number(context.interestWeights?.[tag] ?? context.interestWeights?.[normalizeGetYourGuideText(tag)] ?? 0), 0);
  return { eligible: reasons.length === 0, reasons, relevanceScore: (candidate.mustSee ? 100000 : 0) + (Number.isFinite(interestScore) ? interestScore : 0), canonicalKey: getGetYourGuideCanonicalKey(candidate) };
};
export const selectGetYourGuideCandidates = (candidates: GetYourGuideCandidate[], context: GetYourGuideTravelerContext = {}): GetYourGuideSelection => {
  const evaluated = candidates.map((candidate, index) => ({ candidate, index, decision: evaluateGetYourGuideCandidate(candidate, context) }));
  const rejected = evaluated.filter(({ decision }) => !decision.eligible).map(({ candidate, decision }) => ({ candidate, reasons: decision.reasons })), seen = new Set<string>();
  const eligible = evaluated.filter(({ decision }) => decision.eligible).sort((a, b) => b.decision.relevanceScore - a.decision.relevanceScore || a.index - b.index).filter(({ decision }) => { if (seen.has(decision.canonicalKey)) return false; seen.add(decision.canonicalKey); return true; });
  const requestedMax = Number(context.maxCandidates ?? 4), maxCandidates = Number.isFinite(requestedMax) ? Math.max(0, Math.floor(requestedMax)) : 4;
  return { selected: eligible.slice(0, maxCandidates).map(({ candidate }) => candidate), rejected };
};
