import { createHash } from 'node:crypto';
import { getApiCacheSetting } from '../config/apiLimits';
import { getGetYourGuideApiLocale, isGetYourGuideFeatureEnabled } from '../config/getYourGuide';
import { incrementMetric, recordTiming } from '../metrics';
import type { ActivityType, AttractionCatalogEntry, AttractionDurationMetadata, ItineraryGeneratedActivity } from '../types';
import {
  createGetYourGuideDescriptor,
  type GetYourGuideDescriptor,
} from './getYourGuideAffiliateService';
import {
  getGetYourGuideCanonicalKey,
  selectGetYourGuideCandidates,
  type GetYourGuideCandidate,
  type GetYourGuideTravelerContext,
} from '../utils/getYourGuideEligibility';
import {
  GETYOURGUIDE_CALLER_ITINERARY_ACTIVITY_SUGGESTION,
  getGetYourGuideActivitySuggestions,
  type GetYourGuideActivityLookupResult,
} from '../apis/getYourGuideCallers';

type TransferNoteLike = { fromName: string; toName: string; minutes: number };

export type GetYourGuideCandidateBuildInput = {
  activities: ItineraryGeneratedActivity[];
  destinations: string[];
  catalogEntries?: AttractionCatalogEntry[];
  durationMetadataByName?: Map<string, AttractionDurationMetadata>;
  transferNotesByDay?: Map<number, TransferNoteLike[]>;
  dayNumberByDate?: Map<string, number>;
  mustSeeNames?: string[];
  context?: GetYourGuideTravelerContext;
};

export type GetYourGuideItineraryCandidateSelection = {
  selected: GetYourGuideCandidate[];
  rejected: Array<{ candidate: GetYourGuideCandidate; reasons: string[] }>;
};

export type GetYourGuideDescriptorEnrichmentResult = {
  candidates: GetYourGuideCandidate[];
  descriptors: Record<string, GetYourGuideDescriptor>;
};

export type GetYourGuidePartnerEnrichmentResult = {
  productsByCandidateId: Record<string, GetYourGuideActivityLookupResult>;
};

const normalize = (value: unknown): string => String(value ?? '').trim().toLowerCase();
const normalizeName = (value: unknown): string => normalize(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const stableActivityId = (activity: ItineraryGeneratedActivity, destination: string): string =>
  `generated-${createHash('sha256').update(`${activity.date}|${destination}|${activity.name}`).digest('hex').slice(0, 24)}`;

const parseDurationMinutes = (value: unknown): number | null => {
  const text = normalize(value);
  const hours = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/)?.[1] ?? 0);
  const minutesMatch = text.match(/(\d+)\s*(?:minutes?|mins?|m)\b/);
  const minutes = minutesMatch ? Number(minutesMatch[1]) : hours ? 0 : Number(text.match(/^\d+$/)?.[0] ?? NaN);
  const total = hours * 60 + minutes;
  return Number.isFinite(total) && total >= 0 && total <= 24 * 60 ? Math.round(total) : null;
};

const destinationMatches = (location: string, destination: string): boolean => {
  const locationKey = normalizeName(location);
  const destinationKey = normalizeName(destination);
  return Boolean(locationKey && destinationKey && (locationKey === destinationKey || locationKey.includes(destinationKey) || destinationKey.includes(locationKey)));
};

const resolveDestination = (activity: ItineraryGeneratedActivity, destinations: string[], catalog?: AttractionCatalogEntry): string => {
  if (catalog?.destinationDisplayName) {
    return [catalog.destinationDisplayName, catalog.country].filter(Boolean).join(', ');
  }
  const location = String(activity.startLocation ?? '').trim();
  const matched = destinations.find((destination) => destinationMatches(location, destination));
  if (matched) return matched;
  if (destinations.length === 1) return destinations[0];
  return location;
};

const findTransferMinutes = (notes: TransferNoteLike[] | undefined, name: string, direction: 'in' | 'out'): number | null => {
  const key = normalizeName(name);
  const note = (notes ?? []).find((item) => normalizeName(direction === 'in' ? item.toName : item.fromName) === key);
  const minutes = Number(note?.minutes);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
};

const isMustSee = (name: string, mustSeeNames: string[]): boolean => {
  const key = normalizeName(name);
  return mustSeeNames.some((mustSee) => {
    const candidate = normalizeName(mustSee);
    return candidate && (key === candidate || key.includes(candidate) || candidate.includes(key));
  });
};

const catalogByName = (entries: AttractionCatalogEntry[]): Map<string, AttractionCatalogEntry> => {
  const result = new Map<string, AttractionCatalogEntry>();
  for (const entry of entries) {
    const key = normalizeName(entry.name);
    if (key && !result.has(key)) result.set(key, entry);
  }
  return result;
};

export const buildGetYourGuideItineraryCandidates = (params: GetYourGuideCandidateBuildInput): GetYourGuideCandidate[] => {
  const byName = catalogByName(params.catalogEntries ?? []);
  const mustSeeNames = (params.mustSeeNames ?? []).map(String).filter(Boolean);
  return (Array.isArray(params.activities) ? params.activities : []).map((activity) => {
    const catalog = byName.get(normalizeName(activity.name));
    const destination = resolveDestination(activity, params.destinations, catalog);
    const metadata = params.durationMetadataByName?.get(normalizeName(activity.name));
    const dayNumber = params.dayNumberByDate?.get(String(activity.date ?? '')) ?? Number((activity as any).day ?? 0);
    const notes = params.transferNotesByDay?.get(dayNumber);
    const previousTravelMinutes = findTransferMinutes(notes, activity.name, 'in');
    const nextTravelMinutes = findTransferMinutes(notes, activity.name, 'out');
    const candidate: GetYourGuideCandidate = {
      id: stableActivityId(activity, destination),
      name: String(activity.name ?? '').trim(),
      activityType: activity.activityType as ActivityType,
      date: String(activity.date ?? '').trim() || null,
      destination: {
        destination,
        city: catalog?.destinationDisplayName ?? undefined,
        country: catalog?.country ?? undefined,
        ...(catalog?.lat != null && catalog?.lon != null ? { coordinates: { lat: catalog.lat, lon: catalog.lon } } : {}),
      },
      durationMinutes: metadata?.estimatedDurationMinutes ?? parseDurationMinutes(activity.duration),
      startTime: String(activity.startTime ?? '').trim() || null,
      previousTravelMinutes,
      nextTravelMinutes,
      bufferMinutes: 20,
      budgetTier: catalog?.budgetTier ?? null,
      interestTags: catalog?.interestTags ?? [],
      mustSee: isMustSee(activity.name, mustSeeNames),
      alreadyBooked: Boolean(activity.bookedOn || activity.reference || String((activity as any).status) === 'Needed'),
    };
    return candidate;
  });
};

export const selectGetYourGuideItineraryCandidates = (
  candidates: GetYourGuideCandidate[],
  context: GetYourGuideTravelerContext = {},
  limits: { maxPerDay?: number; maxPerItinerary?: number } = {},
): GetYourGuideItineraryCandidateSelection => {
  const maxPerDay = Math.max(1, Math.floor(limits.maxPerDay ?? getApiCacheSetting('getYourGuide', 'maxAffiliateCandidatesPerDay') ?? 2));
  const maxPerItinerary = Math.max(1, Math.floor(limits.maxPerItinerary ?? getApiCacheSetting('getYourGuide', 'maxAffiliateLinksPerItinerary') ?? 4));
  const stableCandidates = [...(candidates ?? [])].sort((a, b) => getGetYourGuideCanonicalKey(a).localeCompare(getGetYourGuideCanonicalKey(b)) || a.id.localeCompare(b.id));
  const byDay = new Map<string, GetYourGuideCandidate[]>();
  for (const candidate of stableCandidates) {
    const key = String(candidate.date ?? 'unknown');
    byDay.set(key, [...(byDay.get(key) ?? []), candidate]);
  }
  const selectedByDay: GetYourGuideCandidate[] = [];
  const rejected: Array<{ candidate: GetYourGuideCandidate; reasons: string[] }> = [];
  for (const day of Array.from(byDay.keys()).sort()) {
    const result = selectGetYourGuideCandidates(byDay.get(day) ?? [], { ...context, maxCandidates: maxPerDay });
    selectedByDay.push(...result.selected);
    rejected.push(...result.rejected);
  }
  const global = selectGetYourGuideCandidates(
    [...selectedByDay].sort((a, b) => getGetYourGuideCanonicalKey(a).localeCompare(getGetYourGuideCanonicalKey(b)) || a.id.localeCompare(b.id)),
    { ...context, maxCandidates: maxPerItinerary },
  );
  return { selected: global.selected, rejected: [...rejected, ...global.rejected] };
};

export const enrichGetYourGuideDescriptors = async (params: {
  candidates: GetYourGuideCandidate[];
  concurrency?: number;
  signal?: AbortSignal;
  issueDescriptor?: (candidate: GetYourGuideCandidate) => Promise<GetYourGuideDescriptor | null>;
}): Promise<GetYourGuideDescriptorEnrichmentResult> => {
  const issue = params.issueDescriptor ?? ((candidate: GetYourGuideCandidate) => createGetYourGuideDescriptor({ candidate }));
  const concurrency = Math.max(1, Math.min(4, Math.floor(params.concurrency ?? getApiCacheSetting('getYourGuide', 'descriptorConcurrency') ?? 2)));
  const descriptors: Record<string, GetYourGuideDescriptor> = {};
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      if (params.signal?.aborted) return;
      const index = nextIndex++;
      if (index >= params.candidates.length) return;
      const candidate = params.candidates[index];
      try {
        const descriptor = await issue(candidate);
        if (descriptor) descriptors[candidate.id] = descriptor;
      } catch {
        // Affiliate enrichment is best-effort and never affects the itinerary.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, params.candidates.length) }, () => worker()));
  return { candidates: params.candidates, descriptors };
};

/**
 * Optional Partner API enrichment. It deliberately returns normalized data to
 * the caller and never mutates an itinerary activity. The caller's generation
 * budget prevents this bounded candidate list from turning into one lookup per
 * generated activity.
 */
export const enrichGetYourGuidePartnerActivities = async (params: {
  candidates: GetYourGuideCandidate[];
  currency: string;
  language: string;
  scopeKey: string;
  signal?: AbortSignal;
  concurrency?: number;
}): Promise<GetYourGuidePartnerEnrichmentResult> => {
  const productsByCandidateId: Record<string, GetYourGuideActivityLookupResult> = {};
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      if (params.signal?.aborted) return;
      const index = nextIndex++;
      if (index >= params.candidates.length) return;
      const candidate = params.candidates[index];
      try {
        const lookup = await getGetYourGuideActivitySuggestions({
          caller: GETYOURGUIDE_CALLER_ITINERARY_ACTIVITY_SUGGESTION,
          query: candidate.name,
          destination: candidate.destination.city ?? candidate.destination.destination ?? undefined,
          country: candidate.destination.country ?? undefined,
          locationHint: candidate.destination.coordinates && Number.isFinite(Number(candidate.destination.coordinates.lat)) && Number.isFinite(Number(candidate.destination.coordinates.lon))
            ? { lat: Number(candidate.destination.coordinates.lat), lon: Number(candidate.destination.coordinates.lon) }
            : undefined,
          date: candidate.date ?? undefined,
          currency: params.currency,
          language: params.language,
          scopeKey: params.scopeKey,
          signal: params.signal,
        });
        if (lookup) productsByCandidateId[candidate.id] = lookup;
      } catch {
        // Partner data is optional; Phase-A descriptor fallback remains valid.
      }
    }
  };
  const concurrency = Math.max(1, Math.min(4, Math.floor(params.concurrency ?? getApiCacheSetting('getYourGuide', 'descriptorConcurrency') ?? 2)));
  await Promise.all(Array.from({ length: Math.min(concurrency, params.candidates.length) }, () => worker()));
  return { productsByCandidateId };
};

export const scheduleGetYourGuideDescriptorEnrichment = (candidates: GetYourGuideCandidate[]): void => {
  if (!candidates.length) return;
  const startedAt = Date.now();
  void isGetYourGuideFeatureEnabled().then((enabled) => {
    if (!enabled) return null;
    const locale = getGetYourGuideApiLocale();
    const scopeKey = createHash('sha256').update(candidates.map((candidate) => candidate.id).sort().join('|')).digest('hex').slice(0, 32);
    return Promise.all([
      enrichGetYourGuideDescriptors({ candidates }),
      locale
        ? enrichGetYourGuidePartnerActivities({ candidates, currency: locale.currency, language: locale.language, scopeKey })
        : Promise.resolve({ productsByCandidateId: {} }),
    ]);
  }).then((result) => {
    if (!result) return;
    const [descriptors, partner] = result;
    incrementMetric('getyourguide_affiliate_enrichment', {
      selected: descriptors.candidates.length,
      issued: Object.keys(descriptors.descriptors).length,
      products: Object.keys(partner.productsByCandidateId).length,
    });
    recordTiming('getyourguide_affiliate_enrichment_ms', Date.now() - startedAt, {
      selected: descriptors.candidates.length,
      issued: Object.keys(descriptors.descriptors).length,
      products: Object.keys(partner.productsByCandidateId).length,
    });
  }).catch(() => undefined);
};
