import fs from 'fs';
import path from 'path';
import {
  OPENAI_CALLER_ITINERARY_PLAN_P0_NORM,
  OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE,
  OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS,
  OPENAI_CALLER_ITINERARY_PLAN_P3_VALIDATE,
  OPENAI_CALLER_ITINERARY_PLAN_P3B_REPAIR,
  OPENAI_CALLER_ITINERARY_PLAN_P4_RENDER,
  runItineraryPromptStageViaOpenAi,
} from '../apis/openaiCallers';
import { getEnvFlag, getEnvValue } from '../env';
import { logError, logInfo } from '../logger';
import type { ActivityType, AttractionCatalogEntry, AttractionDurationMetadata, ItineraryDetailKind } from '../types';
import { getApiCacheSetting } from '../config/apiLimits';
import {
  captureItineraryInteraction,
  type ItineraryStageCapture,
} from '../ai/capture/itineraryCapture';
import {
  getAttractionPromptBlockForDestinations,
  normalizeDestinationKey,
} from './attractionsCatalogService';
import { scoreActivityTypeByPreferences, type InterestWeights } from './activityTypeInterestWeights';
import { getAttractionDurationMetadataBatch, formatMinutesAsDuration } from './attractionDurationEstimationService';
import { getTransferEstimator, type TransferEstimator, type TransferMode as LocalTransferMode } from './transferEstimationService';
import { getItineraryPromptTemplates, type ItineraryPromptTemplate } from './itineraryInstructionService';
import {
  buildItineraryPreferenceContract,
  type NormalizedPreferenceContract,
} from './itineraryPreferenceContract';
import { evaluateItineraryBaseline, type ItineraryBaselineMetrics } from './itineraryEvaluationService';
import { decideItineraryEscalation } from './itineraryEscalationService';
import { chooseSafeItineraryMarkdown } from './itineraryDegradedFallbackService';
import { persistItineraryGenerationMetrics } from './itineraryMetricsService';
import type { AttractionPod } from './geoPodClusteringService';
import { scheduleDayItems, scheduleAdjacentDaySwaps } from './daySchedulingService';
import { injectMustSeesIntoCachedFragments } from './fragmentInjectorService';
import { renderAttractionPods } from './podBasedShortlisterService';
import { buildArrivalDepartureFacts, renderLogisticsFactBlock, type LogisticsFact } from './arrivalDepartureRulesService';
import {
  ITINERARY_STRUCTURE_VALIDATOR_VERSION,
  validateAndRepairItineraryStructure,
  DEFAULT_CLOSED_WEEKDAYS_BY_CATEGORY,
} from './itineraryStructureValidator';
import {
  buildCatalogFingerprint,
  buildDayFragments,
  buildPromptFingerprint,
  buildTripSignature,
  readItineraryPlanCache,
  stableHash,
  writeItineraryPlanCache,
} from './itineraryPlanCacheService';
import { accumulateDayFriction, calculateRouteFrictionScore } from './frictionAccumulatorService';
import {
  fillThinDaysDeterministically,
  buildThinDayRepairPayload,
  mergeThinDayRepairResult,
  THIN_DAY_MIN_ITEMS,
} from './dayFillService';
import { buildDestinationLogistics, calculateTransferBuffer, compareOpenJawLogistics, resolveCoarseHomeRegion, type CoarseHomeRegion, type LogisticsMobility } from './destinationLogisticsService';
import {
  buildGetYourGuideItineraryCandidates,
  selectGetYourGuideItineraryCandidates,
} from './getYourGuideItineraryEnrichmentService';
import type { GetYourGuideCandidate } from '../utils/getYourGuideEligibility';

type PromptPaceCode = 'R' | 'B' | 'F';
type PromptComfortCode = 'B' | 'M' | 'L';
type PromptMobilityCode = 'L' | 'M' | 'H';
type PromptCarCode = 'P' | 'D' | 'R';
type PromptInteractionStyleCode = 'self_guided' | 'mixed' | 'guided';
type PromptDayTimeCode = 'M' | 'D' | 'E';
type PromptActivityCode = 'A' | 'R' | 'T' | 'O' | 'E';
type PromptTransferMode = 'Flight' | 'Train' | 'Bus' | 'Private' | 'Ferry' | 'Other';

type LegacyPromptWeights = { o: number; c: number; f: number; n: number; r: number };
type PromptWeights = InterestWeights;

type PromptReq = {
  $: 'req1';
  d: string[];
  sd?: string;
  ed?: string;
  m?: string;
  dur?: number;
  s?: string;
  e?: string;
  p?: Array<{ a?: number; t?: string[] }>;
  tt?: {
    p?: PromptPaceCode;
    c?: PromptComfortCode;
    mob?: PromptMobilityCode;
    car?: PromptCarCode;
    w?: PromptWeights;
    is?: PromptInteractionStyleCode;
  };
  ut?: {
    po?: PromptPaceCode;
    mob?: PromptMobilityCode;
    i?: string[];
    eb?: boolean;
    no?: boolean;
  };
  rs?: number;
  budgetMin?: number;
  budgetMax?: number;
  tripStyle?: string;
  ms?: string[];
};

type PromptNorm = {
  $: 'norm1';
  sd: string;
  ed: string;
  p: PromptPaceCode;
  c: PromptComfortCode;
  mob: PromptMobilityCode;
  car: PromptCarCode;
  w: PromptWeights;
  a: string[];
  is: PromptInteractionStyleCode;
};

type PromptBase = {
  l: string;
  ci: string;
  co: string;
  dn: string[];
};

type PromptTransfer = {
  dt: string;
  m: PromptTransferMode;
  fr: string;
  to: string;
  td?: number;
  n?: string;
};

type PromptRoute = {
  $?: 'r1';
  eh: string;
  xh: string;
  b: PromptBase[];
  x: PromptTransfer[];
  rc: { pu: string; do: string; r: string } | null;
  w: PromptWeights;
  a: string[];
};

type PromptDay = {
  d: number;
  dt: string;
  b: string;
  it: Array<[PromptDayTimeCode, PromptActivityCode, string]>;
  me: ['BQ', 'LC', 'DL'];
  sl: string;
  ln: string[];
  cf?: 'H' | 'M' | 'L';
};

type PromptItinerary = {
  $?: 'it1';
  eh: string;
  xh: string;
  b: PromptBase[];
  x: PromptTransfer[];
  rc: { pu: string; do: string; r: string } | null;
  dy: PromptDay[];
  a: string[];
  cf: 'H' | 'M' | 'L';
};

export type ItineraryGeneratedTransfer = {
  status: 'Needed';
  transferType: PromptTransferMode;
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
};

export type ItineraryGeneratedLodging = {
  status: 'Needed';
  name: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: string;
  totalCost: string;
  costPerNight: string;
  address: string;
};

export type ItineraryGeneratedActivity = {
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
};

export type ItineraryGeneratedCarRental = {
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
};

export type ItineraryGeneratedItems = {
  transfers: ItineraryGeneratedTransfer[];
  lodgings: ItineraryGeneratedLodging[];
  activities: ItineraryGeneratedActivity[];
  carRentals: ItineraryGeneratedCarRental[];
};

export type ItineraryGeneratedDetail = {
  day: number;
  time: string | null;
  activity: string;
  cost: number | null;
  kind?: ItineraryDetailKind;
  noteBody?: string | null;
};

export type ItineraryPromptProfile = {
  pace: 'Relaxed' | 'Balanced' | 'Fast';
  comfort: 'Budget' | 'Midrange' | 'Luxury';
  mobility: 'Low' | 'Medium' | 'High';
  carPreference: 'PublicTransitOnly' | 'DayTripsOnly' | 'FullTripRental';
  interactionStyle: 'Self-Guided' | 'Mixed' | 'Guided';
  weights: PromptWeights;
};

export type ItineraryPromptPlanResult = {
  promptRequest: PromptReq;
  normalized: PromptNorm;
  route: PromptRoute;
  itinerary: PromptItinerary;
  planMarkdown: string;
  details: ItineraryGeneratedDetail[];
  generatedItems: ItineraryGeneratedItems;
  profile: ItineraryPromptProfile;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  preferenceContract: NormalizedPreferenceContract;
  evaluation: ItineraryBaselineMetrics;
  cacheUsage: { routeHit: boolean; dayHit: boolean };
  /** Bounded, deterministic candidates for post-response affiliate enrichment. */
  getYourGuideCandidates?: GetYourGuideCandidate[];
};

export type MustSeeAttractionInput = string | { name: string; destinationName?: string | null };

export type ItineraryPromptPlanServiceInput = {
  apiKey?: string;
  userId?: string;
  usageWindowKey?: string;
  aiProvider?: {
    provider?: string;
    model?: string;
  };
  destinations: string[];
  days: number;
  budgetMin: number;
  budgetMax: number;
  mustSeeAttractions?: MustSeeAttractionInput[];
  departureAirport?: string;
  /** Consented coarse return/home airport or region; never an address. */
  homeAirport?: string;
  homeRegion?: string;
  returnAirport?: string;
  tripStyle?: string;
  promptTraits?: {
    tt?: Partial<{
      p: PromptPaceCode;
      c: PromptComfortCode;
      mob: PromptMobilityCode;
      car: PromptCarCode;
      w: Partial<PromptWeights>;
      is: PromptInteractionStyleCode;
    }>;
    ut?: Partial<{
      po: PromptPaceCode;
      mob: PromptMobilityCode;
      i: string[];
      eb: boolean;
      no: boolean;
    }>;
  };
  groupTraits: Array<{ userId: string; name: string; traits: string[] }>;
  tripStartDate?: string | null;
  tripEndDate?: string | null;
  tripStartMonth?: number | null;
  tripStartYear?: number | null;
  tripIdSeed?: string;
  captureId?: string;
};

type PromptTemplate = ItineraryPromptTemplate;

type PromptBundle = {
  p0: PromptTemplate;
  p1: PromptTemplate;
  p2: PromptTemplate;
  p3: PromptTemplate;
  p4: PromptTemplate;
  normSchema: string;
  step1Schema: string;
  step2Schema: string;
};

const ACTIVITY_CODE_TO_LONG: Record<PromptActivityCode, ActivityType> = {
  A: 'Ticketed Attraction',
  R: 'Reservation',
  T: 'Tour',
  O: 'Open Access',
  E: 'Event',
};

const closestGeneratedActivityType = (text: string, fallback: ActivityType): ActivityType => {
  const input = String(text ?? '').toLowerCase();
  if (/\b(class|lesson|workshop|masterclass|cooking class|yoga class)\b/.test(input)) return 'Class';
  if (/\b(concert|show|theater|theatre|performance|opera|ballet|live music)\b/.test(input)) return 'Concert/Show';
  if (/\b(day trip|excursion|full-day|half-day)\b/.test(input)) return 'Day Trip';
  if (/\b(food|eat|restaurant|tasting|street food|dinner|lunch|brunch|market)\b/.test(input)) return 'Food & Drink';
  if (/\b(arcade|escape room|amusement|theme park|bowling|game)\b/.test(input)) return 'Fun & Games';
  if (/\b(hike|trail|trek|summit|mountain)\b/.test(input)) return 'Hike';
  if (/\b(nightlife|bar|club|pub|cocktail|speakeasy)\b/.test(input)) return 'Nightlife';
  if (/\b(outdoor|kayak|bike|cycling|snorkel|surf|beach|park)\b/.test(input)) return 'Outdoor Activity';
  if (/\b(shop|shopping|mall|boutique|bazaar|souvenir)\b/.test(input)) return 'Shopping';
  if (/\b(landmark|monument|cathedral|palace|historic|zocalo|old town|tower|temple)\b/.test(input))
    return 'Sights & Landmarks';
  if (/\b(spa|wellness|massage|onsen|thermal|sauna)\b/.test(input)) return 'Spa/Wellness';
  if (fallback === 'Ticketed Attraction' && /\b(museum|gallery|ticket|entry)\b/.test(input)) return 'Ticketed Attraction';
  if (fallback === 'Reservation' && /\b(reserve|reservation|timed)\b/.test(input)) return 'Reservation';
  if (fallback === 'Event' && /\b(event|festival|parade)\b/.test(input)) return 'Event';
  if (fallback === 'Tour' && /\b(tour|guided)\b/.test(input)) return 'Tour';
  return fallback;
};

const PROMPT_WEIGHT_KEYS: Array<keyof PromptWeights> = [
  'outdoors',
  'adventure',
  'culture',
  'food',
  'nightlife',
  'relax',
  'photography',
  'authentic_local',
  'iconic_landmarks',
];

const DEFAULT_WEIGHTS: PromptWeights = {
  outdoors: 15,
  adventure: 10,
  culture: 15,
  food: 15,
  nightlife: 10,
  relax: 10,
  photography: 10,
  authentic_local: 8,
  iconic_landmarks: 7,
};

export const ITINERARY_PIPELINE_VERSION = 'itinerary-pipeline-v8';
const MAX_ITEMS_PER_DAY = 5;

const scaleItineraryTokenBudget = (base: number): number => {
  if (!getEnvFlag('ITINERARY_GOLD_MODE')) return base;
  const configured = Number(getEnvValue('ITINERARY_GOLD_TOKEN_MULTIPLIER', { defaultValue: '2' }));
  const multiplier = Number.isFinite(configured) ? Math.max(1, Math.min(4, configured)) : 2;
  return Math.round(base * multiplier);
};

const PROMPTS_ROOT = path.resolve(__dirname, '../../prompts');

const readText = (relativePath: string): string => {
  const filePath = path.join(PROMPTS_ROOT, relativePath);
  return fs.readFileSync(filePath, 'utf8');
};

const getPromptBundle = async (): Promise<PromptBundle> => {
  const templates = await getItineraryPromptTemplates();
  return {
    p0: templates.p0,
    p1: templates.p1,
    p2: templates.p2,
    p3: templates.p3,
    p4: templates.p4,
    normSchema: readText(path.join('schemas', 'norm_schema_min.json')),
    step1Schema: readText(path.join('schemas', 'step1_schema_min.json')),
    step2Schema: readText(path.join('schemas', 'step2_schema_min.json')),
  };
};

// Phase 4B repair prompt is intentionally not wired into the admin-editable p0-p4 instruction
// document system (itineraryInstructionService.ts): it is a single, capped, code-triggered
// fallback rather than a per-generation stage, so it is loaded directly from disk with the same
// "## System" / "## User" markdown convention as the other prompt files.
let dayFillRepairTemplateCache: PromptTemplate | null = null;
const parseSimplePromptTemplate = (id: string, markdown: string): PromptTemplate => {
  const text = markdown.replace(/\r\n/g, '\n').trim();
  const systemMatch = text.match(/^##\s+System\s*$/im);
  const userMatch = text.match(/^##\s+User\s*$/im);
  if (!systemMatch || !userMatch || (userMatch.index ?? 0) <= (systemMatch.index ?? 0)) {
    throw new Error(`Prompt template ${id} must include "## System" followed by "## User"`);
  }
  const sysStart = (systemMatch.index ?? 0) + systemMatch[0].length;
  const usrStart = (userMatch.index ?? 0) + userMatch[0].length;
  return {
    id,
    sys: text.slice(sysStart, userMatch.index).trim(),
    usr: text.slice(usrStart).trim(),
  };
};
const getDayFillRepairTemplate = (): PromptTemplate => {
  if (!dayFillRepairTemplateCache) {
    dayFillRepairTemplateCache = parseSimplePromptTemplate(
      'p3b_day_repair',
      readText(path.join('prompts', 'p3b_day_repair.md'))
    );
  }
  return dayFillRepairTemplateCache;
};

const replaceAll = (template: string, key: string, value: string): string =>
  template
    .replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    .replace(new RegExp(`\\{${key}\\}`, 'g'), value);

export const applyTemplate = (template: string, replacements: Record<string, string>): string => {
  let output = template;
  for (const [key, value] of Object.entries(replacements)) {
    output = replaceAll(output, key, value);
  }
  return output.replace(/\{\{(?:ATTRACTION_PODS|LOGISTICS_FACTS|DAY_RANGE|USED_ATTRACTION_IDS|NARRATIVE_CONTINUITY_CONTEXT)\}\}/g, 'none');
};

const parseModelJson = <T>(raw: string): T => {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) throw new Error('Empty model response');

  const normalizeJsonLike = (value: string): string =>
    value
      .replace(/\uFEFF/g, '')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, '$1')
      .trim();

  const extractBalancedJsonBodies = (input: string): string[] => {
    const results: string[] = [];
    const maxCandidates = 8;
    for (let start = 0; start < input.length && results.length < maxCandidates; start += 1) {
      const startChar = input[start];
      if (startChar !== '{' && startChar !== '[') continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < input.length; i += 1) {
        const ch = input[i];
        if (inString) {
          if (escaped) {
            escaped = false;
            continue;
          }
          if (ch === '\\') {
            escaped = true;
            continue;
          }
          if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === '{' || ch === '[') depth += 1;
        if (ch === '}' || ch === ']') depth -= 1;
        if (depth === 0) {
          results.push(input.slice(start, i + 1));
          break;
        }
      }
    }
    return results;
  };

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const baseCandidates = [trimmed, fenced?.[1] ?? ''].map((v) => normalizeJsonLike(v)).filter(Boolean);
  const candidates = [
    ...baseCandidates,
    ...baseCandidates.flatMap((v) => extractBalancedJsonBodies(v).map((item) => normalizeJsonLike(item))),
  ];

  for (const candidate of candidates) {
    const body = candidate.trim();
    if (!body) continue;
    try {
      return JSON.parse(body) as T;
    } catch {
      // Try next parse strategy.
    }
  }

  throw new Error('Failed to parse model JSON output');
};

const toIso = (value: Date): string => value.toISOString().slice(0, 10);

const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const addDays = (isoDate: string, days: number): string => {
  const base = new Date(isoDate);
  if (Number.isNaN(base.getTime())) return isoDate;
  base.setUTCDate(base.getUTCDate() + days);
  return toIso(base);
};

const normalizeText = (value: unknown): string => String(value ?? '').trim();

const normalizeLocalityKey = (value: string): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const localityAliases = (value: string): string[] => {
  const key = normalizeLocalityKey(value);
  if (!key) return [];
  const aliases = new Set<string>([key]);
  if (key === 'mexico city' || key === 'ciudad de mexico' || key === 'cdmx') {
    aliases.add('mexico city');
    aliases.add('ciudad de mexico');
    aliases.add('cdmx');
  }
  return Array.from(aliases);
};

const canonicalizeToRequestedLocality = (value: string, requestedDestinations: string[]): string => {
  const raw = normalizeText(value);
  if (!raw) return raw;
  const requested = requestedDestinations.map((item) => normalizeText(item)).filter(Boolean);
  if (!requested.length) return raw;
  const rawAliases = localityAliases(raw);

  for (const candidate of requested) {
    const candidateAliases = localityAliases(candidate);
    if (rawAliases.some((alias) => candidateAliases.includes(alias))) return candidate;
  }

  const scored = requested
    .map((candidate) => {
      const candidateKey = normalizeLocalityKey(candidate);
      const rawKey = normalizeLocalityKey(raw);
      const includesMatch =
        rawKey.includes(candidateKey) ||
        candidateKey.includes(rawKey) ||
        rawKey.split(' ').some((token) => token && candidateKey.includes(token));
      return { candidate, score: includesMatch ? candidate.length : -1 };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score > 0 ? scored[0].candidate : raw;
};

const isAllowedLocality = (value: string, requestedDestinations: string[]): boolean => {
  const rawAliases = localityAliases(value);
  return requestedDestinations.some((candidate) => {
    const candidateAliases = localityAliases(candidate);
    return rawAliases.some((alias) => candidateAliases.includes(alias));
  });
};

const strictCanonicalizeToRequestedLocality = (value: string, requestedDestinations: string[]): string => {
  const mapped = canonicalizeToRequestedLocality(value, requestedDestinations);
  if (!requestedDestinations.length) return mapped;
  if (isAllowedLocality(mapped, requestedDestinations)) return mapped;
  return requestedDestinations[0];
};

const TRANSIT_HUB_PATTERN = /\b(airport|station|port|terminal)\b|\b[A-Z]{3}\b|\([A-Z]{3}\)/;

const canonicalizeTransferEndpoint = (
  value: string,
  fallback: string,
  requestedDestinations: string[]
): string => {
  const raw = normalizeText(value) || fallback;
  if (!raw) return fallback;
  if (TRANSIT_HUB_PATTERN.test(raw)) return raw;
  const mapped = strictCanonicalizeToRequestedLocality(raw, requestedDestinations);
  return normalizeText(mapped) || fallback;
};

const dropBroaderLevelIfSpecificSelected = (value: string, requestedDestinations: string[]): string => {
  const normalized = normalizeLocalityKey(value);
  if (!normalized) return value;
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length > 1) return value;
  const hasSpecific = requestedDestinations.some((candidate) => {
    const key = normalizeLocalityKey(candidate);
    const candidateTokens = key.split(' ').filter(Boolean);
    return candidateTokens.length > 1 && candidateTokens.includes(tokens[0]);
  });
  if (!hasSpecific) return value;
  const mapped = requestedDestinations.find((candidate) => normalizeLocalityKey(candidate).includes(tokens[0]));
  return mapped ? mapped : value;
};

const pruneDestinationHierarchy = (destinations: string[]): string[] => {
  const cleaned = destinations.map((v) => normalizeText(v)).filter(Boolean);
  if (!cleaned.length) return ['Destination'];

  const canonicalMap = new Map<string, string>();
  for (const item of cleaned) {
    const aliases = localityAliases(item);
    const key = aliases.sort((a, b) => a.localeCompare(b))[0] || normalizeLocalityKey(item);
    if (!canonicalMap.has(key)) canonicalMap.set(key, item);
  }
  const deduped = Array.from(canonicalMap.values());
  if (deduped.length <= 1) return deduped;

  const keys = deduped.map((value) => ({ value, key: normalizeLocalityKey(value), tokens: normalizeLocalityKey(value).split(' ').filter(Boolean) }));
  const keep = keys.filter((candidate) => {
    const candidateTokenCount = candidate.tokens.length;
    const overshadowed = keys.some((other) => {
      if (other.value === candidate.value) return false;
      if (!other.key || !candidate.key) return false;
      if (other.tokens.length <= candidateTokenCount) return false;
      return (
        other.key.includes(candidate.key) ||
        candidate.tokens.every((token) => token && other.tokens.includes(token))
      );
    });
    return !overshadowed;
  });
  return keep.length ? keep.map((item) => item.value) : deduped;
};
const GENERIC_ACTIVITY_PATTERNS: RegExp[] = [
  /\bnearby\b/i,
  /\blocal (park|event|festival|market|eatery|restaurant)\b/i,
  /\bcity center\b/i,
  /\bold town\b/i,
  /\bflexible activity block\b/i,
  /\bvisit another museum\b/i,
  /\btour a historical site\b/i,
  /\benjoy a cultural performance\b/i,
  /\battend (a )?local (event|festival)\b/i,
];
const SPECIFICITY_ANCHORS: Array<{
  match: RegExp;
  values: Record<PromptActivityCode, string>;
}> = [
  {
    match: /\bmexico city\b|\bciudad de mexico\b/i,
    values: {
      A: 'Visit Museo Nacional de Antropologia',
      R: 'Timed entry at Castillo de Chapultepec',
      T: 'Guided walk through Centro Historico and Zocalo',
      O: 'Walk through Bosque de Chapultepec',
      E: 'Evening in Plaza Garibaldi',
    },
  },
  {
    match: /\bpuebla\b/i,
    values: {
      A: 'Visit Catedral de Puebla and nearby historic blocks',
      R: 'Timed visit to Biblioteca Palafoxiana',
      T: 'Guided walk of Callejon de los Sapos and Zocalo de Puebla',
      O: 'Explore Zocalo de Puebla and Barrio del Artista',
      E: 'Evening food market walk in Centro Historico de Puebla',
    },
  },
];
const sanitizeActivityText = (
  inputText: string,
  params: { base: string; activityCode: PromptActivityCode }
): { text: string; activityCode: PromptActivityCode } => {
  const text = normalizeText(inputText);
  if (!text) {
    return {
      text: `Explore the historic center in ${params.base || 'the destination'}`,
      activityCode: params.activityCode === 'E' ? 'O' : params.activityCode,
    };
  }
  if (!GENERIC_ACTIVITY_PATTERNS.some((pattern) => pattern.test(text))) {
    return { text, activityCode: params.activityCode };
  }
  for (const anchor of SPECIFICITY_ANCHORS) {
    if (anchor.match.test(params.base)) {
      const fallbackCode = params.activityCode === 'E' ? 'O' : params.activityCode;
      return { text: anchor.values[fallbackCode], activityCode: fallbackCode };
    }
  }
  const fallbackCode = params.activityCode === 'E' ? 'O' : params.activityCode;
  const area = params.base || 'the destination';
  const genericFallbackByCode: Record<PromptActivityCode, string> = {
    A: `Visit a major museum in ${area}`,
    R: `Reserve a timed entry for a top attraction in ${area}`,
    T: `Take a guided walking tour of the historic center in ${area}`,
    O: `Explore the main historic district in ${area}`,
    E: `Evening walk and food district exploration in ${area}`,
  };
  return { text: genericFallbackByCode[fallbackCode], activityCode: fallbackCode };
};

const diffDaysInclusive = (startIso: string, endIso: string): number => {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1);
};

const coerceToInterestWeights = (value: unknown): PromptWeights => {
  const raw = (value && typeof value === 'object' ? (value as Record<string, unknown>) : {}) as Record<string, unknown>;
  const hasModern = PROMPT_WEIGHT_KEYS.some((key) => key in raw);
  if (hasModern) {
    return {
      outdoors: Number(raw.outdoors) || 0,
      adventure: Number(raw.adventure) || 0,
      culture: Number(raw.culture) || 0,
      food: Number(raw.food) || 0,
      nightlife: Number(raw.nightlife) || 0,
      relax: Number(raw.relax) || 0,
      photography: Number(raw.photography) || 0,
      authentic_local: Number(raw.authentic_local) || 0,
      iconic_landmarks: Number(raw.iconic_landmarks) || 0,
    };
  }
  const legacy: LegacyPromptWeights = {
    o: Math.max(0, Math.round(Number(raw.o) || 0)),
    c: Math.max(0, Math.round(Number(raw.c) || 0)),
    f: Math.max(0, Math.round(Number(raw.f) || 0)),
    n: Math.max(0, Math.round(Number(raw.n) || 0)),
    r: Math.max(0, Math.round(Number(raw.r) || 0)),
  };
  return {
    outdoors: legacy.o,
    adventure: Math.round(legacy.o * 0.7),
    culture: legacy.c,
    food: legacy.f,
    nightlife: legacy.n,
    relax: legacy.r,
    photography: Math.round((legacy.o + legacy.c + legacy.r) / 3),
    authentic_local: Math.round((legacy.c + legacy.f) / 2),
    iconic_landmarks: Math.round(legacy.c * 0.8 + legacy.o * 0.2),
  };
};

const normalizeWeights = (weights: PromptWeights): PromptWeights => {
  const safe = PROMPT_WEIGHT_KEYS.reduce((acc, key) => {
    (acc as any)[key] = Math.max(0, Math.round(Number(weights[key]) || 0));
    return acc;
  }, {} as PromptWeights);
  const sum = PROMPT_WEIGHT_KEYS.reduce((acc, key) => acc + safe[key], 0);
  if (sum === 100) return safe;
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  const scaled = PROMPT_WEIGHT_KEYS.reduce((acc, key) => {
    (acc as any)[key] = Math.round((safe[key] / sum) * 100);
    return acc;
  }, {} as PromptWeights);
  const total = PROMPT_WEIGHT_KEYS.reduce((acc, key) => acc + scaled[key], 0);
  if (total === 100) return scaled;
  const largest = [...PROMPT_WEIGHT_KEYS].sort((a, b) => scaled[b] - scaled[a])[0];
  scaled[largest] += 100 - total;
  return scaled;
};

const normalizePromptTraitInput = (input?: ItineraryPromptPlanServiceInput['promptTraits']) => {
  const tt = input?.tt ?? {};
  const ut = input?.ut ?? {};
  return {
    tt: {
      p: (['R', 'B', 'F'] as const).includes(tt.p as PromptPaceCode) ? (tt.p as PromptPaceCode) : 'B',
      c: (['B', 'M', 'L'] as const).includes(tt.c as PromptComfortCode) ? (tt.c as PromptComfortCode) : 'M',
      mob: (['L', 'M', 'H'] as const).includes(tt.mob as PromptMobilityCode) ? (tt.mob as PromptMobilityCode) : 'M',
      car: (['P', 'D', 'R'] as const).includes(tt.car as PromptCarCode) ? (tt.car as PromptCarCode) : 'P',
      is: (['self_guided', 'mixed', 'guided'] as const).includes(tt.is as PromptInteractionStyleCode)
        ? (tt.is as PromptInteractionStyleCode)
        : 'mixed',
      w: normalizeWeights(coerceToInterestWeights(tt.w)),
    },
    ut: {
      po: (['R', 'B', 'F'] as const).includes(ut.po as PromptPaceCode) ? (ut.po as PromptPaceCode) : undefined,
      mob: (['L', 'M', 'H'] as const).includes(ut.mob as PromptMobilityCode)
        ? (ut.mob as PromptMobilityCode)
        : undefined,
      i: Array.isArray(ut.i)
        ? Array.from(new Set(ut.i.map((entry) => String(entry ?? '').trim()).filter(Boolean)))
        : [],
      eb: Boolean(ut.eb),
      no: Boolean(ut.no),
    },
  };
};

const normalizeDestinations = (destinations: string[]): string[] => {
  const cleaned = destinations.map((v) => String(v ?? '').trim()).filter(Boolean);
  return pruneDestinationHierarchy(cleaned);
};

type NormalizedMustSeeAttraction = { name: string; destinationName?: string };

const normalizeMustSeeAttractions = (
  items: MustSeeAttractionInput[] | undefined
): NormalizedMustSeeAttraction[] => {
  const seen = new Set<string>();
  const out: NormalizedMustSeeAttraction[] = [];
  for (const raw of items ?? []) {
    const isObject = typeof raw === 'object' && raw !== null;
    const value = normalizeText(isObject ? raw.name : raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const destinationName = isObject ? normalizeText(raw.destinationName ?? '') : '';
    out.push(destinationName ? { name: value, destinationName } : { name: value });
    if (out.length >= 20) break;
  }
  return out;
};

const buildPromptRequest = (input: ItineraryPromptPlanServiceInput): PromptReq => {
  const destinations = normalizeDestinations(input.destinations);
  const mustSeeAttractions = normalizeMustSeeAttractions(input.mustSeeAttractions);
  const seed = String(input.tripIdSeed ?? destinations.join('|'));
  const seedNum = seed.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const normalizedPromptTraits = normalizePromptTraitInput(input.promptTraits);
  const req: PromptReq = {
    $: 'req1',
    d: destinations,
    dur: Math.max(1, Math.round(input.days)),
    s: input.departureAirport ? input.departureAirport.trim() : undefined,
    e: (input.returnAirport ?? input.homeAirport ?? input.departureAirport) ? String(input.returnAirport ?? input.homeAirport ?? input.departureAirport).trim() : undefined,
    p: input.groupTraits.map((member) => ({
      t: Array.isArray(member.traits) ? member.traits.map((t) => String(t)).filter(Boolean) : [],
    })),
    tt: normalizedPromptTraits.tt,
    ut: normalizedPromptTraits.ut,
    rs: seedNum,
    budgetMin: Math.max(0, Math.round(input.budgetMin)),
    budgetMax: Math.max(Math.round(input.budgetMin), Math.round(input.budgetMax)),
    tripStyle: String(input.tripStyle ?? '').trim() || undefined,
    ms: mustSeeAttractions.map((item) => item.name),
  };

  if (isIsoDate(input.tripStartDate) && isIsoDate(input.tripEndDate)) {
    req.sd = input.tripStartDate;
    req.ed = input.tripEndDate;
  } else if (Number.isFinite(Number(input.tripStartMonth)) && Number.isFinite(Number(input.tripStartYear))) {
    const month = String(Number(input.tripStartMonth)).padStart(2, '0');
    req.m = `${Number(input.tripStartYear)}-${month}`;
  }

  return req;
};

const buildPreferenceContract = (input: ItineraryPromptPlanServiceInput): NormalizedPreferenceContract => {
  const normalized = normalizePromptTraitInput(input.promptTraits);
  return buildItineraryPreferenceContract({
    trip: normalized.tt,
    account: {
      po: normalized.ut.po,
      mob: normalized.ut.mob,
      interests: normalized.ut.i,
      earlyBird: normalized.ut.eb,
      nightOwl: normalized.ut.no,
    },
    travelers: input.groupTraits.map((member) => ({ traits: Array.isArray(member.traits) ? member.traits : [] })),
  });
};

const sanitizeNorm = (raw: unknown, req: PromptReq): PromptNorm => {
  const start = isIsoDate((raw as any)?.sd)
    ? String((raw as any).sd)
    : isIsoDate(req.sd)
      ? req.sd
      : toIso(new Date());
  const dur = Math.max(1, Math.round(Number(req.dur) || 1));
  const end = isIsoDate((raw as any)?.ed)
    ? String((raw as any).ed)
    : isIsoDate(req.ed)
      ? req.ed
      : addDays(start, dur - 1);

  const pace = (['R', 'B', 'F'] as const).includes((raw as any)?.p) ? (raw as any).p : req.tt?.p ?? 'B';
  const comfort = (['B', 'M', 'L'] as const).includes((raw as any)?.c) ? (raw as any).c : req.tt?.c ?? 'M';
  const mobility = (['L', 'M', 'H'] as const).includes((raw as any)?.mob) ? (raw as any).mob : req.tt?.mob ?? 'M';
  const car = (['P', 'D', 'R'] as const).includes((raw as any)?.car) ? (raw as any).car : req.tt?.car ?? 'P';
  const interactionStyle = (['self_guided', 'mixed', 'guided'] as const).includes((raw as any)?.is)
    ? (raw as any).is
    : req.tt?.is ?? 'mixed';
  const weightsRaw = (raw as any)?.w ?? req.tt?.w ?? DEFAULT_WEIGHTS;
  const weights = normalizeWeights(coerceToInterestWeights(weightsRaw));
  const assumptions = Array.isArray((raw as any)?.a)
    ? (raw as any).a.map((line: any) => String(line)).filter(Boolean)
    : [];

  return {
    $: 'norm1',
    sd: start,
    ed: end,
    p: pace,
    c: comfort,
    mob: mobility,
    car,
    w: weights,
    a: assumptions,
    is: interactionStyle,
  };
};

const sanitizeRoute = (raw: unknown, norm: PromptNorm, req: PromptReq): PromptRoute => {
  const start = norm.sd;
  const end = norm.ed;
  const requestedDestinations = Array.isArray(req.d) ? req.d.map((item) => normalizeText(item)).filter(Boolean) : [];
  const defaultBase: PromptBase = {
    l: req.d[0] ?? 'Base',
    ci: start,
    co: addDays(end, 1),
    dn: req.d.slice(1),
  };
  const basesRaw = Array.isArray((raw as any)?.b) ? (raw as any).b : [defaultBase];
  const bases: PromptBase[] = basesRaw
    .map((base: any) => ({
      l:
        dropBroaderLevelIfSpecificSelected(
          strictCanonicalizeToRequestedLocality(String(base?.l ?? '').trim() || defaultBase.l, requestedDestinations),
          requestedDestinations
        ) || defaultBase.l,
      ci: isIsoDate(base?.ci) ? String(base.ci) : start,
      co: isIsoDate(base?.co) ? String(base.co) : addDays(end, 1),
      dn: Array.isArray(base?.dn)
        ? base.dn
            .map((v: any) =>
              canonicalizeToRequestedLocality(
                strictCanonicalizeToRequestedLocality(
                dropBroaderLevelIfSpecificSelected(String(v ?? '').trim(), requestedDestinations),
                requestedDestinations
                ),
                requestedDestinations
              )
            )
            .filter(Boolean)
        : [],
    }))
    .filter((base: PromptBase) => Boolean(base.l));
  if (!bases.length) bases.push(defaultBase);
  const compactBases: PromptBase[] = [];
  for (const base of bases) {
    const prev = compactBases[compactBases.length - 1];
    if (prev && normalizeLocalityKey(prev.l) === normalizeLocalityKey(base.l)) {
      prev.co = base.co;
      prev.dn = Array.from(new Set([...(prev.dn ?? []), ...(base.dn ?? [])]));
    } else {
      compactBases.push({ ...base });
    }
  }

  const transfersRaw = Array.isArray((raw as any)?.x) ? (raw as any).x : [];
  const transfers: PromptTransfer[] = transfersRaw
    .map((transfer: any) => {
      const mode = String(transfer?.m ?? '').trim() as PromptTransferMode;
      const validMode: PromptTransferMode = (
        ['Flight', 'Train', 'Bus', 'Private', 'Ferry', 'Other'] as const
      ).includes(mode)
        ? mode
        : 'Flight';
      return {
        dt: isIsoDate(transfer?.dt) ? String(transfer.dt) : start,
        m: validMode,
        fr:
          dropBroaderLevelIfSpecificSelected(
            canonicalizeTransferEndpoint(
              String(transfer?.fr ?? '').trim(),
              compactBases[0].l,
              requestedDestinations
            ),
            requestedDestinations
          ) || compactBases[0].l,
        to:
          dropBroaderLevelIfSpecificSelected(
            canonicalizeTransferEndpoint(
              String(transfer?.to ?? '').trim(),
              compactBases[Math.max(0, compactBases.length - 1)].l,
              requestedDestinations
            ),
            requestedDestinations
          ) || compactBases[Math.max(0, compactBases.length - 1)].l,
        td: Number.isFinite(Number(transfer?.td)) ? Number(transfer.td) : undefined,
        n: typeof transfer?.n === 'string' ? transfer.n : undefined,
      };
    })
    .filter((transfer: PromptTransfer) => transfer.fr && transfer.to)
    .filter((transfer: PromptTransfer) => normalizeLocalityKey(transfer.fr) !== normalizeLocalityKey(transfer.to));

  const weightsRaw = (raw as any)?.w ?? norm.w;
  const weights = normalizeWeights(coerceToInterestWeights(weightsRaw));

  return {
    $: 'r1',
    eh: String((raw as any)?.eh ?? req.s ?? req.d[0] ?? 'Entry Hub').trim(),
    xh: String((raw as any)?.xh ?? req.e ?? req.d[0] ?? 'Exit Hub').trim(),
    b: compactBases,
    x: transfers,
    rc:
      raw && typeof (raw as any)?.rc === 'object' && (raw as any).rc
        ? {
            pu: String((raw as any).rc.pu ?? '').trim(),
            do: String((raw as any).rc.do ?? '').trim(),
            r: String((raw as any).rc.r ?? '').trim(),
          }
        : null,
    w: weights,
    a: Array.isArray((raw as any)?.a) ? (raw as any).a.map((line: any) => String(line)).filter(Boolean) : [],
  };
};

const sanitizeItinerary = (raw: unknown, route: PromptRoute, norm: PromptNorm, req: PromptReq): PromptItinerary => {
  const dayCount = diffDaysInclusive(norm.sd, norm.ed);
  const fallbackDays: PromptDay[] = Array.from({ length: dayCount }, (_, idx) => {
    const date = addDays(norm.sd, idx);
    const base = route.b.find((b) => date >= b.ci && date < b.co)?.l ?? route.b[0]?.l ?? 'Base';
    return {
      d: idx + 1,
      dt: date,
      b: base,
      it: [
        ['M', 'O', 'Morning neighborhood walk'],
        ['D', 'A', 'Main attraction and city highlights'],
        ['E', 'O', 'Local dinner and evening stroll'],
      ],
      me: ['BQ', 'LC', 'DL'],
      sl: `Lodging at '${base}'`,
      ln: [],
      cf: 'M',
    };
  });

  const daysRaw = Array.isArray((raw as any)?.dy) ? (raw as any).dy : fallbackDays;
  const seenActivityKeys = new Set<string>();
  const days: PromptDay[] = daysRaw.map((day: any, idx: number) => {
    const date = isIsoDate(day?.dt) ? String(day.dt) : addDays(norm.sd, idx);
    const defaultBaseRaw = route.b.find((b) => date >= b.ci && date < b.co)?.l ?? route.b[0]?.l ?? 'Base';
    const defaultBase = strictCanonicalizeToRequestedLocality(defaultBaseRaw, req.d);
    const itemsRaw = Array.isArray(day?.it) ? day.it : [];
    const items = itemsRaw
      .map((item: any): [PromptDayTimeCode, PromptActivityCode, string] => {
        const time = (['M', 'D', 'E'] as const).includes(item?.[0]) ? item[0] : 'D';
        const code = (['A', 'R', 'T', 'O', 'E'] as const).includes(item?.[1]) ? item[1] : 'O';
        const baseForDay = strictCanonicalizeToRequestedLocality(String(day?.b ?? '').trim() || defaultBase, req.d);
        const normalized = sanitizeActivityText(String(item?.[2] ?? ''), { base: baseForDay, activityCode: code });
        return [time, normalized.activityCode, normalized.text];
      })
      .filter((item: [PromptDayTimeCode, PromptActivityCode, string]) => {
        const key = normalizeText(item[2]).toLowerCase();
        if (!key) return false;
        if (seenActivityKeys.has(key)) return false;
        seenActivityKeys.add(key);
        return true;
      })
      .slice(0, 5);

    return {
      d: Number.isFinite(Number(day?.d)) ? Math.max(1, Math.round(Number(day.d))) : idx + 1,
      dt: date,
      b: strictCanonicalizeToRequestedLocality(String(day?.b ?? '').trim() || defaultBase, req.d),
      it: items.length ? items : [['D', 'O', `Flexible exploration in ${defaultBase}`]],
      me: ['BQ', 'LC', 'DL'],
      sl: String(day?.sl ?? '').trim() || `Lodging at '${defaultBase}'`,
      ln: Array.isArray(day?.ln) ? day.ln.map((line: any) => String(line)).filter(Boolean).slice(0, 2) : [],
      cf: (['H', 'M', 'L'] as const).includes(day?.cf) ? day.cf : 'M',
    };
  });

  return {
    $: 'it1',
    eh: String((raw as any)?.eh ?? route.eh).trim() || route.eh,
    xh: String((raw as any)?.xh ?? route.xh).trim() || route.xh,
    b: Array.isArray((raw as any)?.b) ? sanitizeRoute(raw, norm, { ...req, dur: days.length }).b : route.b,
    x: Array.isArray((raw as any)?.x) ? sanitizeRoute(raw, norm, { ...req, dur: days.length }).x : route.x,
    rc:
      raw && typeof (raw as any)?.rc === 'object' && (raw as any).rc
        ? {
            pu: String((raw as any).rc.pu ?? '').trim(),
            do: String((raw as any).rc.do ?? '').trim(),
            r: String((raw as any).rc.r ?? '').trim(),
          }
        : route.rc,
    dy: days,
    a: Array.isArray((raw as any)?.a) ? (raw as any).a.map((line: any) => String(line)).filter(Boolean) : route.a,
    cf: (['H', 'M', 'L'] as const).includes((raw as any)?.cf) ? (raw as any).cf : 'M',
  };
};

const EXTRA_GENERIC_ACTIVITY_PATTERNS: RegExp[] = [
  /\b(local (art gallery|food stalls|restaurant|market|spot|district))\b/i,
  /\b(traditional (mexican|local) restaurant)\b/i,
  /\b(main historic district)\b/i,
  /\b(cultural district)\b/i,
  /^\s*visit to\s+/i,
];

const ATTRACTION_NAME_HINT_PATTERN =
  /\b(museum|museo|temple|templo|pyramid|pyramids|cathedral|basilica|palace|castillo|castle|park|bosque|zocalo|market|mercado|plaza|centro|historic|tour|walk|neighborhood|barrio|avenida|ruins|site|gallery|teatro|theater|food|restaurant|cafe|caf[eé])\b/i;

const isLikelyStandaloneLocalityLabel = (value: string): boolean => {
  const text = normalizeText(value);
  if (!text) return true;
  if (ATTRACTION_NAME_HINT_PATTERN.test(text)) return false;
  const unwrapped = text.replace(/\([^)]*\)/g, ' ').trim();
  const words = normalizeLocalityKey(unwrapped).split(' ').filter(Boolean);
  return words.length > 0 && words.length <= 4;
};

const buildShortlistPools = (
  shortlistByDestination: Record<string, AttractionCatalogEntry[]>,
  requestedDestinations: string[]
): { byDestination: Record<string, string[]>; global: string[] } => {
  const byDestination: Record<string, string[]> = {};
  const global: string[] = [];
  const seenGlobal = new Set<string>();

  const addName = (bucket: string[], name: string) => {
    const cleaned = normalizeText(name);
    if (!cleaned) return;
    if (!bucket.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) bucket.push(cleaned);
    if (!seenGlobal.has(cleaned.toLowerCase())) {
      seenGlobal.add(cleaned.toLowerCase());
      global.push(cleaned);
    }
  };

  for (const [destination, entries] of Object.entries(shortlistByDestination ?? {})) {
    const canonicalDestination = canonicalizeToRequestedLocality(destination, requestedDestinations);
    const bucket = byDestination[canonicalDestination] ?? [];
    for (const entry of entries ?? []) addName(bucket, entry?.name ?? '');
    byDestination[canonicalDestination] = bucket;
  }
  return { byDestination, global };
};

// itinerary-improvement-plan.md §2: Fairness Floor. Ensures every traveler's primary interests are
// represented in the daily activity slots. Deterministically injects a
// high-relevance item for an under-served traveler interest if the LLM
// output drifted.
const enforceFairnessFloor = (
  itinerary: PromptItinerary,
  shortlistByDestination: Record<string, AttractionCatalogEntry[]>,
  travelerInterests: Array<keyof InterestWeights>
): { itinerary: PromptItinerary; changed: boolean; missingCount: number; servedCount: number } => {
  if (!travelerInterests.length) return { itinerary, changed: false, missingCount: 0, servedCount: 0 };
  const output = JSON.parse(JSON.stringify(itinerary)) as PromptItinerary;
  let changed = false;

  const allEntries = Object.values(shortlistByDestination).flat();
  const entryByName = new Map<string, AttractionCatalogEntry>();
  for (const entry of allEntries) {
    const key = normalizeText(entry.name).toLowerCase();
    if (key && !entryByName.has(key)) entryByName.set(key, entry);
  }

  const servedInterests = new Set<string>();
  for (const day of output.dy) {
    for (const item of day.it) {
      const entry = entryByName.get(normalizeText(item[2]).toLowerCase());
      if (entry) {
        for (const tag of entry.interestTags) {
          const interest = String(tag).toLowerCase().replace(/\s+/g, '_');
          servedInterests.add(interest);
        }
      }
    }
  }

  const initialServedCount = travelerInterests.filter((interest) => servedInterests.has(interest)).length;
  const missingInterests = travelerInterests.filter((interest) => !servedInterests.has(interest));
  if (!missingInterests.length) return { itinerary, changed: false, missingCount: 0, servedCount: initialServedCount };

  // For each underserved interest, find a suitable candidate and inject it.
  for (const interest of missingInterests) {
    const candidate = allEntries.find((entry) =>
      entry.interestTags.some((tag) => String(tag).toLowerCase().replace(/\s+/g, '_') === interest)
    );
    if (!candidate) continue;

    const day = output.dy.find((d) => normalizeDestinationKey(d.b) === candidate.destinationKey) ?? output.dy[0];
    const genericIndex = day.it.findIndex((item) =>
      GENERIC_ACTIVITY_PATTERNS.some((pattern) => pattern.test(normalizeText(item[2]))) ||
      EXTRA_GENERIC_ACTIVITY_PATTERNS.some((pattern) => pattern.test(normalizeText(item[2])))
    );

    if (genericIndex >= 0) {
      day.it[genericIndex] = ['D', 'A', candidate.name];
      changed = true;
      servedInterests.add(interest);
    } else if (day.it.length < MAX_ITEMS_PER_DAY) {
      day.it.push(['D', 'A', candidate.name]);
      changed = true;
      servedInterests.add(interest);
    }
  }

  return { itinerary: output, changed, missingCount: missingInterests.length, servedCount: initialServedCount };
};

const enforceShortlistGrounding = (
  itinerary: PromptItinerary,
  req: PromptReq,
  shortlistByDestination: Record<string, AttractionCatalogEntry[]>,
  travelerInterests?: Array<keyof InterestWeights>
): { itinerary: PromptItinerary; groupCohesionScore: number | null } => {
  const requested = Array.isArray(req.d) ? req.d.map((item) => normalizeText(item)).filter(Boolean) : [];
  const pools = buildShortlistPools(shortlistByDestination, requested);
  if (!pools.global.length) return { itinerary, groupCohesionScore: null };

  const usedText = new Set<string>();
  const usedShortlist = new Set<string>();
  const destinationSpecific = requested.filter((value) => normalizeLocalityKey(value).split(' ').length > 1);

  const nextReplacement = (base: string): string | null => {
    const bucket = pools.byDestination[base] ?? [];
    const local = bucket.find(
      (name) => !usedShortlist.has(name.toLowerCase()) && !isLikelyStandaloneLocalityLabel(name)
    );
    if (local) {
      usedShortlist.add(local.toLowerCase());
      return local;
    }
    if (requested.length <= 1) return null;
    const global = pools.global.find((name) => !usedShortlist.has(name.toLowerCase()));
    if (!global) return null;
    if (isLikelyStandaloneLocalityLabel(global)) return null;
    usedShortlist.add(global.toLowerCase());
    return global;
  };

  const hasBroaderLevelDrift = (text: string): boolean =>
    destinationSpecific.some((dest) => {
      const key = normalizeLocalityKey(dest);
      const tokens = key.split(' ').filter(Boolean);
      if (tokens.length < 2) return false;
      const head = tokens[0];
      const textKey = normalizeLocalityKey(text);
      return new RegExp(`\\b${head}\\b`, 'i').test(textKey) && !textKey.includes(key);
    });

  for (const day of itinerary.dy) {
    day.b = strictCanonicalizeToRequestedLocality(day.b, requested);
    day.sl = `Lodging at '${day.b}'`;
    day.it = day.it.map((item) => {
      const text = normalizeText(item[2]);
      const textKey = text.toLowerCase();
      const isDuplicate = usedText.has(textKey);
      const isGeneric =
        GENERIC_ACTIVITY_PATTERNS.some((pattern) => pattern.test(text)) ||
        EXTRA_GENERIC_ACTIVITY_PATTERNS.some((pattern) => pattern.test(text));
      const invalidLocality = hasBroaderLevelDrift(text) || isLikelyStandaloneLocalityLabel(text);
      if (isDuplicate || isGeneric || invalidLocality) {
        const replacement = nextReplacement(day.b);
        if (replacement) {
          usedText.add(replacement.toLowerCase());
          return [item[0], item[1], replacement];
        }
      }
      usedText.add(textKey);
      return item;
    });
  }

  let grounded = itinerary;
  let groupCohesionScore: number | null = null;
  if (travelerInterests?.length) {
    const floor = enforceFairnessFloor(itinerary, shortlistByDestination, travelerInterests);
    grounded = floor.itinerary;
    groupCohesionScore = floor.servedCount / travelerInterests.length;
  }

  const primaryDestination = requested[0];
  const primaryTop = (pools.byDestination[primaryDestination] ?? []).slice(0, 3);
  const pickInjectionDay = (): PromptDay | undefined => {
    const middleDay = grounded.dy.find((day, idx) => idx > 0 && idx < grounded.dy.length - 1 && day.it.length > 0);
    if (middleDay) return middleDay;
    return grounded.dy.find((day) => day.it.length > 0);
  };
  const forceInjectTopAttraction = (topName: string): void => {
    if (!topName) return;
    const alreadyPresent = grounded.dy.some((day) =>
      day.it.some((item) => normalizeText(item[2]).toLowerCase() === normalizeText(topName).toLowerCase())
    );
    if (alreadyPresent) return;
    const injectionDay = pickInjectionDay();
    if (!injectionDay) return;
    const current = injectionDay.it[0];
    injectionDay.it[0] = [current[0], current[1], topName];
  };

  forceInjectTopAttraction(primaryTop[0] ?? '');

  for (const topName of primaryTop.slice(1)) {
    const alreadyPresent = grounded.dy.some((day) =>
      day.it.some((item) => normalizeText(item[2]).toLowerCase() === normalizeText(topName).toLowerCase())
    );
    if (alreadyPresent) continue;
    let injected = false;
    for (const day of grounded.dy) {
      const replaceIndex = day.it.findIndex((item) => {
        const text = normalizeText(item[2]);
        return (
          GENERIC_ACTIVITY_PATTERNS.some((pattern) => pattern.test(text)) ||
          EXTRA_GENERIC_ACTIVITY_PATTERNS.some((pattern) => pattern.test(text))
        );
      });
      if (replaceIndex >= 0) {
        const current = day.it[replaceIndex];
        day.it[replaceIndex] = [current[0], current[1], topName];
        injected = true;
        break;
      }
    }
    if (!injected) {
      const injectionDay = pickInjectionDay();
      if (!injectionDay) continue;
      if (injectionDay.it.length < MAX_ITEMS_PER_DAY) {
        const seed = injectionDay.it[injectionDay.it.length - 1] ?? ['D', 'A', topName];
        injectionDay.it.push([seed[0], seed[1], topName]);
      } else {
        const current = injectionDay.it[0];
        injectionDay.it[0] = [current[0], current[1], topName];
      }
    }
  }

  return { itinerary: grounded, groupCohesionScore };
};

// itinerary-improvements-coding-plan.md Phase 2A: bounded, deterministic WITHIN-DAY
// scheduling (pod-density seed, nearest insertion, bounded 2-opt — see
// daySchedulingService.ts for the algorithm). Runs before polishItineraryFinalPass so
// the explicit golden-hour/farewell-dinner pins below always get the final say over
// any single item's slot. The bounded adjacent-day pass runs immediately after each
// within-day ordering pass and only moves catalog-grounded items to their neighboring base.
export const scheduleItineraryDaysDeterministically = (
  itinerary: PromptItinerary,
  shortlistByDestination: Record<string, AttractionCatalogEntry[]>,
  logisticsFacts?: LogisticsFact[]
): PromptItinerary => {
  const output = JSON.parse(JSON.stringify(itinerary)) as PromptItinerary;
  if (!output.dy.length) return output;

  const entryByName = new Map<string, AttractionCatalogEntry>();
  for (const entry of Object.values(shortlistByDestination).flat()) {
    const key = normalizeText(entry.name).toLowerCase();
    if (key && !entryByName.has(key)) entryByName.set(key, entry);
  }
  const lookupEntry = (name: string): AttractionCatalogEntry | null =>
    entryByName.get(normalizeText(name).toLowerCase()) ?? null;

  for (const day of output.dy) {
    const result = scheduleDayItems(day.b, day.it, lookupEntry);
    if (!result.changed) continue;
    day.it = result.items;
    for (const note of result.notes) {
      logInfo(`[itinerary] day-scheduling day=${day.d} ${note}`);
    }
  }

  // Phase 2A "adjacent-day swap" pass: after each day is internally ordered above, run a single
  // bounded forward sweep over adjacent day pairs to relocate at most one catalog-mismatched
  // activity per pair. Reuses the same zero-activity-day derivation as dayFillService's callers
  // (arrivalDepartureRulesService facts with maxActivities === 0) so a terminal-only day is never
  // touched by two different mechanisms in two different ways.
  const zeroActivityDayDates = new Set(
    (logisticsFacts ?? []).filter((fact) => fact.maxActivities === 0).map((fact) => fact.date)
  );
  const swapResult = scheduleAdjacentDaySwaps(output.dy, lookupEntry, {
    maxItemsPerDay: MAX_ITEMS_PER_DAY,
    zeroActivityDayDates,
  });
  for (const note of swapResult.notes) {
    logInfo(`[itinerary] adjacent-day-swap ${note}`);
  }

  return output;
};

// Final "master travel agent" polishing pass, per itinerary-improvement-plan.md §9:
// 1. Farewell Night: bias the ranker toward a high-quality food attraction for the final night,
//    geographically central to the group's lodging (proximity to the day's base centroid).
// 2. Golden Hour: pin photography-tagged items to the first/last activity slot of their day.
// Respects category-level closure rules (Sunday/Monday trap).
export const polishItineraryFinalPass = (
  itinerary: PromptItinerary,
  shortlistByDestination: Record<string, AttractionCatalogEntry[]>,
  podsByDestination: Record<string, AttractionPod[]>
): PromptItinerary => {
  const output = JSON.parse(JSON.stringify(itinerary)) as PromptItinerary;
  if (!output.dy.length) return output;

  const allEntries = Object.values(shortlistByDestination).flat();
  const entryByName = new Map<string, AttractionCatalogEntry>();
  for (const entry of allEntries) {
    const key = normalizeText(entry.name).toLowerCase();
    if (key && !entryByName.has(key)) entryByName.set(key, entry);
  }

  const isClosed = (name: string, dateStr: string): boolean => {
    const date = new Date(`${dateStr}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return false;
    const weekday = date.getUTCDay();
    const normalized = normalizeText(name).toLowerCase();
    for (const [category, closedDays] of Object.entries(DEFAULT_CLOSED_WEEKDAYS_BY_CATEGORY)) {
      if (normalized.includes(category) && closedDays.includes(weekday)) return true;
    }
    return false;
  };

  // 1. Farewell Night Crescendo
  const lastDay = output.dy[output.dy.length - 1];
  const lastDinnerIndex = lastDay.it.length - 1;
  if (lastDinnerIndex >= 0) {
    const destinationPods = podsByDestination[lastDay.b] ?? [];
    const centralPod = destinationPods.find((p) => p.kind === 'geographic');

    const foodCandidates = allEntries
      .filter((e) => e.interestTags.includes('food') && normalizeDestinationKey(lastDay.b) === e.destinationKey)
      .filter((e) => !isClosed(e.name, lastDay.dt))
      .sort((a, b) => {
        // Boost items in the central pod
        const aInCentral = centralPod?.items.some((item) => item.id === a.id) ? 1 : 0;
        const bInCentral = centralPod?.items.some((item) => item.id === b.id) ? 1 : 0;
        if (aInCentral !== bInCentral) return bInCentral - aInCentral;
        return a.rank - b.rank;
      });

    const topFood = foodCandidates[0];

    if (topFood && !lastDay.it.some((item) => normalizeText(item[2]).toLowerCase() === topFood.name.toLowerCase())) {
      lastDay.it[lastDinnerIndex] = ['E', 'A', topFood.name];
      lastDay.ln = Array.from(new Set([...(lastDay.ln ?? []), `Farewell Dinner: celebrating the trip at ${topFood.name}.`])).slice(0, 2);
    }
  }

  // 2. Golden Hour Pins
  for (const day of output.dy) {
    if (day.it.length < 2) continue;
    const photoIndex = day.it.findIndex((item) => {
      const entry = entryByName.get(normalizeText(item[2]).toLowerCase());
      return entry?.interestTags.includes('photography') && !isClosed(item[2], day.dt);
    });

    if (photoIndex > 0 && photoIndex < day.it.length - 1) {
      // If it's in the middle, try to move it to the end (best light usually)
      const item = day.it.splice(photoIndex, 1)[0];
      day.it.push(['E', item[1], item[2]]);
      day.ln = Array.from(new Set([...(day.ln ?? []), `${item[2]} moved to evening for optimal lighting.`])).slice(0, 2);
    }
  }

  return output;
};

// itinerary-improvement-plan.md §4 (Fatigue Accumulator). Tracks cumulative travel friction and
// forces a "Rest/Hub" day (no vehicle transfers, capped activities) when
// travelers are likely to be burned out.
// itinerary-improvements-coding-plan.md Phase 2B: for each destination base in the route, look up
// (already-fetched, publicly-locatable) attraction coordinates to derive a coarse destination
// centroid, then call destinationLogisticsService.buildDestinationLogistics for climatology/
// daylight facts. No home/traveler location is passed in — only public destination coordinates
// already used elsewhere in the pipeline — so this never puts a home address in a shared cache key
// or LLM prompt (plan §2B privacy rule). Silently skips destinations with no coordinate data so it
// never blocks generation when the shortlist is empty (e.g. mocked in tests or a cold cache).
export const buildDestinationClimatologyBlock = async (
  route: PromptRoute,
  shortlistByDestination: Record<string, AttractionCatalogEntry[]>,
  tripStartDate: string,
  fetchImpl?: typeof fetch
): Promise<string> => {
  if (Number(getApiCacheSetting('itineraryPlan', 'logisticsClimatologyEnabled')) <= 0) return '';
  const entriesByKey = new Map<string, AttractionCatalogEntry[]>();
  for (const [name, entries] of Object.entries(shortlistByDestination)) {
    entriesByKey.set(normalizeDestinationKey(name), entries);
  }
  const fallbackYearMonth = (() => {
    const parsed = new Date(`${tripStartDate}T00:00:00Z`);
    return Number.isNaN(parsed.getTime())
      ? { year: new Date().getUTCFullYear(), month: 1 }
      : { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1 };
  })();
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const base of route.b) {
    const key = normalizeDestinationKey(base.l);
    if (seen.has(key)) continue;
    seen.add(key);
    const entries = (entriesByKey.get(key) ?? []).filter((entry) => entry.lat != null && entry.lon != null);
    if (!entries.length) continue;
    const lat = entries.reduce((sum, entry) => sum + (entry.lat as number), 0) / entries.length;
    const lon = entries.reduce((sum, entry) => sum + (entry.lon as number), 0) / entries.length;
    const [yearStr, monthStr] = String(base.ci || '').split('-');
    const year = Number(yearStr) || fallbackYearMonth.year;
    const month = Number(monthStr) || fallbackYearMonth.month;
    try {
      const logistics = await buildDestinationLogistics({ destination: { lat, lon }, home: null, year, month, fetchImpl });
      const climate = logistics.climatology
        ? `climate: ${logistics.climatology.label}${logistics.climatology.averageHighC != null ? ` (avg high ${logistics.climatology.averageHighC}C)` : ''}`
        : null;
      const daylight = `daylight ~${logistics.daylight.daylightHours.toFixed(1)}h (sunrise ${logistics.daylight.sunriseLocalHours.toFixed(1)}h local)`;
      lines.push(`${base.l}: ${[climate, daylight].filter(Boolean).join('; ')}.`);
    } catch (err) {
      logError(`[itinerary] destination logistics lookup failed for destination="${base.l}"`, err);
    }
  }
  return lines.join('\n');
};

/** Build a non-PII terminal-routing hint even when climatology is disabled. */
export const buildHomeTerminalLogisticsNote = (
  route: PromptRoute,
  shortlistByDestination: Record<string, AttractionCatalogEntry[]>,
  home?: CoarseHomeRegion | null,
  terminals?: { entryAirport?: string | null; exitAirport?: string | null }
): string => {
  const coarseHome = resolveCoarseHomeRegion(home);
  if (!coarseHome.label) return '';
  const byKey = new Map(Object.entries(shortlistByDestination).map(([key, entries]) => [normalizeDestinationKey(key), entries]));
  const coordinates = route.b.map((base) => {
    const entries = (byKey.get(normalizeDestinationKey(base.l)) ?? []).filter((entry) => entry.lat != null && entry.lon != null);
    if (!entries.length) return null;
    return {
      label: base.l,
      lat: entries.reduce((sum, entry) => sum + Number(entry.lat), 0) / entries.length,
      lon: entries.reduce((sum, entry) => sum + Number(entry.lon), 0) / entries.length,
    };
  }).filter((value): value is { label: string; lat: number; lon: number } => Boolean(value));
  if (coordinates.length < 2) return `Home-terminal routing anchor: ${coarseHome.label}; compare round-trip and open-jaw terminal access, elapsed time, and fare.`;
  const comparison = compareOpenJawLogistics({
    home: { region: coarseHome.label, coordinates: coarseHome.coordinates },
    entry: coordinates[0],
    exit: coordinates[coordinates.length - 1],
    entryAirport: terminals?.entryAirport ?? home?.airportCode,
    exitAirport: terminals?.exitAirport ?? home?.airportCode,
  });
  return `Home-terminal routing (${coarseHome.label}): ${comparison.rationale}`;
};

const enforceFatigueManagement = (
  itinerary: PromptItinerary,
  transferNotesByDay: Map<number, TransferNote[]>,
  durationMetadataByName: Map<string, AttractionDurationMetadata>,
  groupSize: number,
  mobility: LogisticsMobility = 'M'
): { itinerary: PromptItinerary; issues: string[] } => {
  const output = JSON.parse(JSON.stringify(itinerary)) as PromptItinerary;
  const issues: string[] = [];
  let rollingFriction = 0;

  for (const day of output.dy) {
    const notes = transferNotesByDay.get(day.d) ?? [];
    const transferMinutes = notes.reduce((sum, n) => sum + n.minutes, 0);
    const transferCount = notes.length;
    const activityMinutes = day.it.reduce((sum, [, , text]) => {
      return sum + (durationMetadataByName.get(normalizeText(text).toLowerCase())?.estimatedDurationMinutes ?? DEFAULT_ACTIVITY_DURATION_MINUTES);
    }, 0);
    // Rough estimate of walking based on transfer modes
    const walkingKm = notes.filter((n) => n.mode === 'walk').reduce((sum, n) => sum + n.distanceKm, 0);
    // destinationLogisticsService.calculateTransferBuffer (Phase 2B: "Scale transfer
    // buffers by group size/mobility") replaces the previous flat groupSize*5 estimate
    // with one that also accounts for each transfer's actual distance and the
    // traveler's mobility level, summed across the day's transfers.
    const groupBufferMinutes = notes.reduce((sum, note) => sum + calculateTransferBuffer(note.distanceKm, groupSize, mobility), 0);

    const result = accumulateDayFriction({
      transferMinutes,
      transferCount,
      baseChange: day.d > 1 && output.dy[day.d - 2].b !== day.b,
      activityMinutes,
      walkingKm,
      groupBufferMinutes,
    });

    rollingFriction += result.score;

    // If cumulative friction is high (e.g. > 15 over 2-3 days) or single day is high,
    // force a rest status.
    if (rollingFriction >= 15 || result.status === 'rest-hub') {
      if (day.it.length > 2) {
        day.it = day.it.slice(0, 2);
        issues.push(`${day.dt}: forced rest-hub day due to travel fatigue (score: ${rollingFriction.toFixed(1)}).`);
        rollingFriction = Math.max(0, rollingFriction - 5); // Recovery credit
      }
      day.ln = Array.from(new Set([...(day.ln ?? []), 'Rest day: light activities to recover from travel fatigue.'])).slice(0, 2);
    } else if (result.status === 'lighten') {
      if (day.it.length > 3) {
        day.it = day.it.slice(0, 3);
        issues.push(`${day.dt}: lightened day to manage travel friction (score: ${rollingFriction.toFixed(1)}).`);
      }
    }

    // Decay friction slightly each day
    rollingFriction = Math.max(0, rollingFriction - 2);
  }

  return { itinerary: output, issues };
};

// Verifies each generated attraction is scheduled under the day whose
// destination actually matches the attraction's catalog destinationKey
// (e.g. fixes AMNH — a New York attraction — being scheduled on a Boston day
// in a Boston+NYC trip). Reassigns to a matching day if one exists in the
// itinerary; drops the item (with logging) if no matching day exists.
const enforceAttractionDestinationConsistency = (
  itinerary: PromptItinerary,
  shortlistByDestination: Record<string, AttractionCatalogEntry[]>
): PromptItinerary => {
  const allEntries = Object.values(shortlistByDestination ?? {}).flat();
  if (!allEntries.length) return itinerary;

  const entryByName = new Map<string, AttractionCatalogEntry>();
  for (const entry of allEntries) {
    const key = normalizeText(entry.name).toLowerCase();
    if (key && !entryByName.has(key)) entryByName.set(key, entry);
  }
  if (!entryByName.size) return itinerary;

  const dayDestinationKey = (day: PromptDay) => normalizeDestinationKey(day.b);

  for (const day of itinerary.dy) {
    const dayKey = dayDestinationKey(day);
    const keptItems: PromptDay['it'] = [];
    for (const item of day.it) {
      const text = normalizeText(item[2]);
      const entry = entryByName.get(text.toLowerCase());
      const entryDestinationKey = entry?.destinationKey ? normalizeDestinationKey(entry.destinationKey) : '';
      if (!entry || !entryDestinationKey || entryDestinationKey === dayKey) {
        keptItems.push(item);
        continue;
      }
      const targetDay = itinerary.dy.find((candidate) => dayDestinationKey(candidate) === entryDestinationKey);
      if (targetDay && targetDay.it.length < MAX_ITEMS_PER_DAY) {
        targetDay.it.push(item);
        logInfo(
          `[itinerary] reassigned attraction "${text}" from "${day.b}" to "${targetDay.b}" (destinationKey mismatch: ${dayKey} vs ${entryDestinationKey})`
        );
      } else {
        logError(
          `[itinerary] dropped attraction "${text}" from "${day.b}" — no available day found for destinationKey="${entryDestinationKey}"`
        );
      }
    }
    day.it = keptItems;
  }

  return itinerary;
};

// Returns the requested destination an attraction's real-world description
// clearly belongs to, when it's a DIFFERENT one than the day it's currently
// scheduled under (e.g. a Wikipedia summary for "Central Park" naming "New
// York City" while scheduled on a Boston day). Only fires on an unambiguous
// single match that doesn't also mention the current day's destination, to
// avoid false positives on attractions that legitimately reference multiple
// cities.
const detectMismatchedDestinationFromDescription = (
  description: string,
  requestedDestinations: string[],
  currentDestKey: string,
  currentDestDisplayName: string
): string | null => {
  const lower = description.toLowerCase();
  const mentionsCurrent = currentDestDisplayName ? lower.includes(currentDestDisplayName.trim().toLowerCase()) : false;
  if (mentionsCurrent) return null;
  const matches = requestedDestinations
    .map((dest) => ({ dest, key: normalizeDestinationKey(dest) }))
    .filter(({ key }) => key && key !== currentDestKey)
    .filter(({ dest }) => dest.trim() && lower.includes(dest.trim().toLowerCase()));
  if (matches.length !== 1) return null;
  return matches[0].key;
};

// Catches the attractions the catalog-based pass above can't: text with no
// matching AttractionCatalogEntry at all (common for iconic landmarks not
// yet in the discovery catalog, or manually-typed must-see entries). Runs
// after attachAttractionMetadata so every item's cached Wikipedia
// description (if any) is already available to check against.
const enforceDescriptionBasedDestinationConsistency = (
  itinerary: PromptItinerary,
  requestedDestinations: string[],
  durationMetadataByName: Map<string, AttractionDurationMetadata>
): void => {
  const dayDestinationKey = (day: PromptDay) => normalizeDestinationKey(day.b);

  for (const day of itinerary.dy) {
    const dayKey = dayDestinationKey(day);
    const keptItems: PromptDay['it'] = [];
    for (const item of day.it) {
      const text = normalizeText(item[2]);
      const description = durationMetadataByName.get(text.toLowerCase())?.description;
      const mismatchedKey = description
        ? detectMismatchedDestinationFromDescription(description, requestedDestinations, dayKey, day.b)
        : null;
      if (!mismatchedKey) {
        keptItems.push(item);
        continue;
      }
      const targetDay = itinerary.dy.find((candidate) => dayDestinationKey(candidate) === mismatchedKey);
      if (targetDay && targetDay.it.length < MAX_ITEMS_PER_DAY) {
        targetDay.it.push(item);
        logInfo(
          `[itinerary] reassigned attraction "${text}" from "${day.b}" to "${targetDay.b}" (description names a different destination, no catalog match)`
        );
      } else {
        logError(
          `[itinerary] dropped attraction "${text}" from "${day.b}" — description names destinationKey="${mismatchedKey}" but no available day found`
        );
      }
    }
    day.it = keptItems;
  }
};

/** Keep the generated lineup coherent with the selected comfort tier. */
export const enforceBudgetTierCoherence = (
  itinerary: PromptItinerary,
  shortlistByDestination: Record<string, AttractionCatalogEntry[]>,
  comfort: PromptComfortCode,
  mustSeeNames: string[]
): PromptItinerary => {
  if (comfort === 'M') return itinerary;
  const output = JSON.parse(JSON.stringify(itinerary)) as PromptItinerary;
  const entriesByName = new Map<string, AttractionCatalogEntry>();
  Object.values(shortlistByDestination).flat().forEach((entry) => entriesByName.set(normalizeText(entry.name).toLowerCase(), entry));
  const entriesByDestination = new Map<string, AttractionCatalogEntry[]>();
  Object.entries(shortlistByDestination).forEach(([destination, entries]) => entriesByDestination.set(normalizeDestinationKey(destination), entries));
  const mustSees = new Set(mustSeeNames.map((name) => normalizeText(name).toLowerCase()));
  for (const day of output.dy) {
    const candidates = (entriesByDestination.get(normalizeDestinationKey(day.b)) ?? Object.values(shortlistByDestination).flat())
      .filter((entry) => entry.budgetTier)
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    const used = new Set(day.it.map((item) => normalizeText(item[2]).toLowerCase()));
    day.it = day.it.map((item) => {
      const entry = entriesByName.get(normalizeText(item[2]).toLowerCase());
      const tier = entry?.budgetTier;
      const disallowed = (comfort === 'B' && tier === 'premium') || (comfort === 'L' && tier === 'free');
      if (!entry || !tier || !disallowed || mustSees.has(normalizeText(item[2]).toLowerCase())) return item;
      const replacement = candidates.find((candidate) => {
        if (used.has(normalizeText(candidate.name).toLowerCase())) return false;
        if (comfort === 'B') return candidate.budgetTier !== 'premium';
        return candidate.budgetTier !== 'free';
      });
      if (!replacement) return item;
      used.delete(normalizeText(item[2]).toLowerCase());
      used.add(normalizeText(replacement.name).toLowerCase());
      return [item[0], item[1], replacement.name];
    });
  }
  return output;
};

const enforceMustSeeAttractions = (
  itinerary: PromptItinerary,
  mustSeeAttractions: NormalizedMustSeeAttraction[],
  requestedDestinations: string[]
): PromptItinerary => {
  if (!mustSeeAttractions.length) return itinerary;
  const present = new Set<string>();
  itinerary.dy.forEach((day) => {
    day.it.forEach((item) => {
      const key = normalizeText(item[2]).toLowerCase();
      if (key) present.add(key);
    });
  });

  const candidateDays = itinerary.dy.filter((day) => {
    const noteText = Array.isArray(day.ln) ? day.ln.join(' ') : '';
    return !/travel day:\s*no activities scheduled/i.test(noteText);
  });
  const allTargetDays = candidateDays.length ? candidateDays : itinerary.dy;
  if (!allTargetDays.length) return itinerary;

  // Prefer days whose base destination matches the attraction's tagged
  // destination (from the must-see picker, e.g. a Boston attraction should
  // only be inserted on a Boston day); fall back to any target day when no
  // destination hint is provided or no day matches it.
  const findDaysForDestination = (destinationName?: string): PromptDay[] => {
    if (!destinationName) return [];
    const canonical = canonicalizeToRequestedLocality(destinationName, requestedDestinations);
    const key = normalizeLocalityKey(canonical);
    if (!key) return [];
    return allTargetDays.filter((day) => normalizeLocalityKey(day.b) === key);
  };

  for (const mustSee of mustSeeAttractions) {
    const key = mustSee.name.toLowerCase();
    if (!key || present.has(key)) continue;
    const destinationDays = findDaysForDestination(mustSee.destinationName);
    const pool = destinationDays.length ? destinationDays : allTargetDays;
    const day = pool.reduce((min, candidate) => (candidate.it.length < min.it.length ? candidate : min), pool[0]);

    const genericIndex = day.it.findIndex((item) => {
      const text = normalizeText(item[2]);
      return (
        GENERIC_ACTIVITY_PATTERNS.some((pattern) => pattern.test(text)) ||
        EXTRA_GENERIC_ACTIVITY_PATTERNS.some((pattern) => pattern.test(text))
      );
    });
    if (genericIndex >= 0) {
      const current = day.it[genericIndex];
      day.it[genericIndex] = [current[0], current[1], mustSee.name];
      present.add(key);
      continue;
    }
    if (day.it.length < MAX_ITEMS_PER_DAY) {
      day.it.push(['D', 'A', mustSee.name]);
      present.add(key);
      continue;
    }
    const current = day.it[0];
    day.it[0] = [current[0], current[1], mustSee.name];
    present.add(key);
  }

  return itinerary;
};

const mapProfile = (norm: PromptNorm): ItineraryPromptProfile => ({
  pace: norm.p === 'R' ? 'Relaxed' : norm.p === 'F' ? 'Fast' : 'Balanced',
  comfort: norm.c === 'B' ? 'Budget' : norm.c === 'L' ? 'Luxury' : 'Midrange',
  mobility: norm.mob === 'L' ? 'Low' : norm.mob === 'H' ? 'High' : 'Medium',
  carPreference: norm.car === 'P' ? 'PublicTransitOnly' : norm.car === 'R' ? 'FullTripRental' : 'DayTripsOnly',
  interactionStyle: norm.is === 'self_guided' ? 'Self-Guided' : norm.is === 'guided' ? 'Guided' : 'Mixed',
  weights: norm.w,
});

const DEFAULT_ACTIVITY_DURATION_MINUTES = 120;
const ITEM_GAP_MINUTES = 15;

const timeStringToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map((part) => Number(part) || 0);
  return hours * 60 + minutes;
};

const minutesToTimeString = (minutes: number): string => {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

// Sequences same-day items sharing a time-of-day code (morning/day/evening)
// so back-to-back attractions don't collide on the same clock time — each
// subsequent item starts after the previous one's estimated duration plus
// the real estimated travel time to get there (when known), rather than
// every "D" (daytime) item defaulting to 13:00 or a flat generic buffer.
const computeDayItemSchedule = (
  day: PromptDay,
  durationMetadataByName?: Map<string, AttractionDurationMetadata>,
  transferNotesForDay?: TransferNote[]
): Array<{ startTime: string; durationMinutes: number }> => {
  const transferMinutesByFromName = new Map<string, number>();
  for (const note of transferNotesForDay ?? []) {
    transferMinutesByFromName.set(note.fromName.toLowerCase(), note.minutes);
  }
  const clockByTimeCode: Record<PromptDayTimeCode, number> = {
    M: timeStringToMinutes('09:00'),
    D: timeStringToMinutes('13:00'),
    E: timeStringToMinutes('19:00'),
  };
  return day.it.map(([timeCode, , text]) => {
    const normalizedText = normalizeText(text).toLowerCase();
    const durationMetadata = durationMetadataByName?.get(normalizedText);
    const durationMinutes = durationMetadata?.estimatedDurationMinutes ?? DEFAULT_ACTIVITY_DURATION_MINUTES;
    const startMinutes = clockByTimeCode[timeCode] ?? clockByTimeCode.D;
    const gapMinutes = transferMinutesByFromName.get(normalizedText) ?? ITEM_GAP_MINUTES;
    clockByTimeCode[timeCode] = startMinutes + durationMinutes + gapMinutes;
    return { startTime: minutesToTimeString(startMinutes), durationMinutes };
  });
};

const ALL_ACTIVITY_TYPES: ActivityType[] = [
  'Class',
  'Concert/Show',
  'Day Trip',
  'Event',
  'Food & Drink',
  'Fun & Games',
  'Hike',
  'Nightlife',
  'Open Access',
  'Outdoor Activity',
  'Reservation',
  'Shopping',
  'Sights & Landmarks',
  'Spa/Wellness',
  'Ticketed Attraction',
  'Tour',
];

const pickActivityTypeForPreferences = (
  text: string,
  fallback: ActivityType,
  preferenceWeights: PromptWeights
): ActivityType => {
  const heuristic = closestGeneratedActivityType(text, fallback);
  let best = heuristic;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of ALL_ACTIVITY_TYPES) {
    const baseScore = scoreActivityTypeByPreferences(candidate, preferenceWeights);
    const heuristicBonus = candidate === heuristic ? 500 : 0;
    const fallbackBonus = candidate === fallback ? 250 : 0;
    const score = baseScore + heuristicBonus + fallbackBonus;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
};

const buildGeneratedActivityDescription = (
  day: PromptDay,
  activityName: string,
  activityType: ActivityType
): string => {
  const notes = Array.isArray(day.ln) ? day.ln.map(normalizeText).filter(Boolean) : [];
  const context = notes.length ? ` Things to know: ${notes.join(' ')}` : '';
  return `${activityName} is a ${activityType.toLowerCase()} based around ${day.b || 'this stop'}. It fits this day because it complements the planned pace and gives the group a concrete, destination-specific experience.${context}`.trim();
};

type TransferNote = {
  fromName: string;
  toName: string;
  mode: LocalTransferMode;
  minutes: number;
  distanceKm: number;
};

// Collapses the estimator's four-way mode into the three travel categories
// travelers actually plan around (taxi and rideshare are both "a car").
const describeTransferMode = (mode: LocalTransferMode): string => {
  if (mode === 'walk') return 'Walk';
  if (mode === 'transit') return 'Public transport';
  return 'Car';
};

// Populates the attraction duration/pre-order-ticket cache for every attraction
// in the itinerary, and computes mobility-aware transfer time/mode estimates
// between consecutive same-day attractions with known coordinates.
const attachAttractionMetadata = async (
  itinerary: PromptItinerary,
  norm: PromptNorm,
  shortlistByDestination: Record<string, AttractionCatalogEntry[]>,
  userId: string | undefined,
  groupSize?: number
): Promise<{
  durationMetadataByName: Map<string, AttractionDurationMetadata>;
  transferNotesByDay: Map<number, TransferNote[]>;
}> => {
  const durationMetadataByName = new Map<string, AttractionDurationMetadata>();
  const transferNotesByDay = new Map<number, TransferNote[]>();
  if (!userId) return { durationMetadataByName, transferNotesByDay };

  const allEntries = Object.values(shortlistByDestination ?? {}).flat();
  const entryByName = new Map<string, AttractionCatalogEntry>();
  for (const entry of allEntries) {
    const key = normalizeText(entry.name).toLowerCase();
    if (key && !entryByName.has(key)) entryByName.set(key, entry);
  }

  let estimator: TransferEstimator | null = null;
  try {
    estimator = await getTransferEstimator();
  } catch (err) {
    logError('[itinerary] transfer estimator init failed; skipping transfer time estimation', err);
  }

  for (const day of itinerary.dy) {
    if (!day.it.length) continue;
    const destinationKey = normalizeDestinationKey(day.b);
    const destinationDisplayName = day.b;
    const dayEntries = day.it.map(([, activityCode, text]) => {
      const cleanText = normalizeText(text);
      const entry = entryByName.get(cleanText.toLowerCase());
      return {
        name: cleanText,
        activityType: entry?.activityType ?? ACTIVITY_CODE_TO_LONG[activityCode],
        lat: entry?.lat ?? null,
        lon: entry?.lon ?? null,
        cachedWikipediaSummary: entry?.wikipediaSummary ?? null,
      };
    });

    try {
      const batch = await getAttractionDurationMetadataBatch({
        userId,
        destinationKey,
        destinationDisplayName,
        entries: dayEntries.map(({ name, activityType, cachedWikipediaSummary }) => ({ name, activityType, cachedWikipediaSummary })),
      });
      for (const [key, metadata] of batch) durationMetadataByName.set(key, metadata);
    } catch (err) {
      logError(`[itinerary] duration metadata lookup failed for destination="${destinationDisplayName}"`, err);
    }

    if (!estimator) continue;
    for (let i = 0; i < dayEntries.length - 1; i++) {
      const from = dayEntries[i];
      const to = dayEntries[i + 1];
      if (from.lat == null || from.lon == null || to.lat == null || to.lon == null) continue;
      try {
        const estimate = await estimator.estimate({
          from: { lat: from.lat, lon: from.lon },
          to: { lat: to.lat, lon: to.lon },
          mobility: norm.mob,
          groupSize,
        });
        if (!estimate) continue;
        const notes = transferNotesByDay.get(day.d) ?? [];
        notes.push({
          fromName: from.name,
          toName: to.name,
          mode: estimate.mode,
          minutes: estimate.minutes,
          distanceKm: estimate.distanceKm,
        });
        transferNotesByDay.set(day.d, notes);
      } catch (err) {
        logError(`[itinerary] transfer estimate failed for "${from.name}" -> "${to.name}"`, err);
      }
    }
  }

  return { durationMetadataByName, transferNotesByDay };
};

export const mapItems = (
  itinerary: PromptItinerary,
  preferenceWeights: PromptWeights,
  durationMetadataByName?: Map<string, AttractionDurationMetadata>,
  transferNotesByDay?: Map<number, TransferNote[]>,
  whyFitsByName?: Map<string, string>,
  mobility: PromptMobilityCode = 'M'
): ItineraryGeneratedItems => {
  const transfers: ItineraryGeneratedTransfer[] = itinerary.x.map((transfer) => ({
    status: 'Needed',
    transferType: transfer.m,
    departureDate: transfer.dt,
    arrivalDate: transfer.dt,
    departureLocation: transfer.fr,
    arrivalLocation: transfer.to,
    departureTime: '09:00',
    arrivalTime: '11:00',
    carrier: '',
    flightNumber: '',
    bookingReference: '',
    ...(typeof transfer.n === 'string' && transfer.n.trim() ? { note: transfer.n } : {}),
  }));

  const lodgings: ItineraryGeneratedLodging[] = itinerary.b.map((base) => ({
    status: 'Needed',
    name: `Lodging at '${base.l}'`,
    checkInDate: base.ci,
    checkOutDate: base.co,
    rooms: '1',
    totalCost: '',
    costPerNight: '',
    address: base.l,
  }));

  const activities: ItineraryGeneratedActivity[] = itinerary.dy.flatMap((day) => {
    const schedule = computeDayItemSchedule(day, durationMetadataByName, transferNotesByDay?.get(day.d));
    return day.it.map(([, activityCode, text], index) => {
      const mapped = ACTIVITY_CODE_TO_LONG[activityCode];
      const closest = pickActivityTypeForPreferences(text, mapped, preferenceWeights);
      const durationMetadata = durationMetadataByName?.get(normalizeText(text).toLowerCase());
      const { startTime, durationMinutes } = schedule[index];
      const duration = formatMinutesAsDuration(durationMinutes);
      const description = durationMetadata?.description || buildGeneratedActivityDescription(day, text, closest);
      const accessibilityNote = mobility === 'L'
        ? ' Check step-free access, seating, and route length with the venue before booking.'
        : '';
      const notesWithDuration = `${description} Plan for about ${duration} here.${accessibilityNote}`;
      const bookingNotes = durationMetadata?.requiresPreOrderTickets
        ? `${notesWithDuration} Tickets may need to be pre-ordered.`
        : notesWithDuration;
      const fit = whyFitsByName?.get(normalizeText(text).toLowerCase());
      const notes = fit ? `${bookingNotes} Why this fits your group: ${fit}` : bookingNotes;
      return {
        status: 'Proposed',
        activityType: closest,
        date: day.dt,
        name: text,
        startLocation: day.b || itinerary.eh,
        startTime,
        duration,
        cost: '',
        freeCancelBy: '',
        bookedOn: '',
        reference: '',
        notes,
      };
    });
  });

  const carRentals: ItineraryGeneratedCarRental[] = itinerary.rc
    ? [
        {
          status: 'Needed',
          pickupLocation: itinerary.rc.pu || itinerary.eh,
          pickupDate: itinerary.dy[0]?.dt ?? itinerary.b[0]?.ci ?? '',
          dropoffLocation: itinerary.rc.do || itinerary.xh,
          dropoffDate:
            itinerary.dy[Math.max(0, itinerary.dy.length - 1)]?.dt ??
            itinerary.b[Math.max(0, itinerary.b.length - 1)]?.co ??
            '',
          reference: '',
          vendor: '',
          prepaid: '',
          cost: '',
          model: '',
          notes: itinerary.rc.r || '',
        },
      ]
    : [];

  return { transfers, lodgings, activities, carRentals };
};

const buildDetails = (
  itinerary: PromptItinerary,
  transferNotesByDay?: Map<number, TransferNote[]>,
  durationMetadataByName?: Map<string, AttractionDurationMetadata>
): ItineraryGeneratedDetail[] =>
  itinerary.dy.flatMap((day) => {
    const schedule = computeDayItemSchedule(day, durationMetadataByName, transferNotesByDay?.get(day.d));
    const notesByFromName = new Map<string, TransferNote>();
    for (const note of transferNotesByDay?.get(day.d) ?? []) {
      notesByFromName.set(note.fromName.toLowerCase(), note);
    }

    const details: ItineraryGeneratedDetail[] = [];
    day.it.forEach(([, _activityCode, text], index) => {
      details.push({
        day: day.d,
        time: schedule[index].startTime,
        activity: text,
        cost: null,
      });
      // Insert the travel segment to the NEXT activity right after this one,
      // between the two activities it connects, rather than lumped at the
      // end of the day.
      const note = notesByFromName.get(normalizeText(text).toLowerCase());
      if (note) {
        details.push({
          day: day.d,
          time: null,
          activity: `${describeTransferMode(note.mode)} to ${note.toName} (~${note.minutes} min, ${note.distanceKm.toFixed(1)} km)`,
          cost: null,
          kind: 'note',
          noteBody: `${describeTransferMode(note.mode)}, ~${note.minutes} min (${note.distanceKm.toFixed(1)} km)`,
        });
      }
    });
    return details;
  });

const renderMarkdownFallback = (itinerary: PromptItinerary, profile: ItineraryPromptProfile): string => {
  const lines: string[] = [];
  lines.push('## Trip Overview');
  lines.push(`- Entry hub: ${itinerary.eh}`);
  lines.push(`- Exit hub: ${itinerary.xh}`);
  lines.push(
    `- Style: ${profile.pace}, ${profile.comfort}, mobility ${profile.mobility}, car ${profile.carPreference}, interaction ${profile.interactionStyle}`
  );
  lines.push('');
  lines.push('## Day-by-day');
  for (const day of itinerary.dy) {
    lines.push(`### Day ${day.d} (${day.dt}) - ${day.b}`);
    for (const [timeCode, activityCode, text] of day.it) {
      const timeLabel = timeCode === 'M' ? 'Morning' : timeCode === 'E' ? 'Evening' : 'Day';
      lines.push(`- ${timeLabel}: ${text} (${ACTIVITY_CODE_TO_LONG[activityCode]})`);
    }
    lines.push(`- Lodging: ${day.sl}`);
    if (day.ln.length) {
      lines.push(`- Notes: ${day.ln.join('; ')}`);
    }
  }
  return lines.join('\n');
};

// Raw prompt/response text is only attached to a stage capture when
// ENABLE_RAW_AI_CAPTURE is set. Kept out of the default path so we don't hold
// full prompt/response strings in memory for every generation. Even when
// populated, the capture allowlist strips these unless the record is stored
// locally with raw capture enabled (see allowlistSerializer / captureService).
export const buildRawStageCapture = (
  systemPrompt: string,
  userPrompt: string,
  responseText: string | null | undefined
): Pick<ItineraryStageCapture, 'systemPrompt' | 'userPrompt' | 'responseText'> | Record<string, never> => {
  if (!getEnvFlag('ENABLE_RAW_AI_CAPTURE', { defaultValue: false })) return {};
  return { systemPrompt, userPrompt, responseText: String(responseText ?? '') };
};

const runJsonStage = async <T>(params: {
  apiKey?: string;
  aiProvider?: ItineraryPromptPlanServiceInput['aiProvider'];
  caller:
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P0_NORM
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P3_VALIDATE
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P3B_REPAIR;
  template: PromptTemplate;
  replacements: Record<string, string>;
  maxTokens: number;
  fallbackValue: T;
  acc?: { promptTokens: number; completionTokens: number };
  captureStages?: ItineraryStageCapture[];
  usageContext?: {
    userId: string;
    windowKey?: string | null;
    metadata?: Record<string, unknown>;
  };
}): Promise<T> => {
  const sys = applyTemplate(params.template.sys, params.replacements);
  const usr = applyTemplate(params.template.usr, params.replacements);
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  logInfo(`[itinerary] stage start caller=${params.caller} maxTokens=${params.maxTokens}`);
  const result = await runItineraryPromptStageViaOpenAi({
    apiKey: params.apiKey,
    providerOverride: params.aiProvider?.provider,
    modelOverride: params.aiProvider?.model,
    caller: params.caller,
    systemPrompt: sys,
    userPrompt: usr,
    maxTokens: params.maxTokens,
    usageContext: params.usageContext,
  });
  if (params.acc) {
    params.acc.promptTokens += result.promptTokens;
    params.acc.completionTokens += result.completionTokens;
  }
  const completedAt = new Date().toISOString();
  const stageCapture: ItineraryStageCapture = {
    stage: params.template.id,
    callerId: params.caller,
    startedAt,
    completedAt,
    latencyMs: Date.now() - startedMs,
    outcome: 'success',
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    responseChars: String(result.text ?? '').length,
    ...buildRawStageCapture(sys, usr, result.text),
  };
  if (!result.text) {
    logError(`[itinerary] ${params.caller} returned empty response; using fallback`);
    params.captureStages?.push({ ...stageCapture, outcome: 'failure', parseError: 'empty_response' });
    return params.fallbackValue;
  }
  logInfo(`[itinerary] stage response caller=${params.caller} chars=${result.text.length}`);
  try {
    const parsed = parseModelJson<T>(result.text);
    params.captureStages?.push(stageCapture);
    return parsed;
  } catch (err) {
    const snippet = String(result.text).slice(0, 600).replace(/\s+/g, ' ');
    logError(`[itinerary] ${params.caller} JSON parse failed; using fallback`, {
      error: err instanceof Error ? err.message : String(err),
      snippet,
    });
    params.captureStages?.push({
      ...stageCapture,
      outcome: 'failure',
      parseError: err instanceof Error ? err.message : String(err),
    });
    return params.fallbackValue;
  }
};

const runRenderStage = async (params: {
  apiKey?: string;
  aiProvider?: ItineraryPromptPlanServiceInput['aiProvider'];
  template: PromptTemplate;
  replacements: Record<string, string>;
  acc?: { promptTokens: number; completionTokens: number };
  captureStages?: ItineraryStageCapture[];
  usageContext?: {
    userId: string;
    windowKey?: string | null;
    metadata?: Record<string, unknown>;
  };
}): Promise<string | null> => {
  const sys = applyTemplate(params.template.sys, params.replacements);
  const usr = applyTemplate(params.template.usr, params.replacements);
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const maxTokens = scaleItineraryTokenBudget(900);
  logInfo(`[itinerary] stage start caller=ITINERARY_PLAN_P4_RENDER maxTokens=${maxTokens}`);
  const result = await runItineraryPromptStageViaOpenAi({
    apiKey: params.apiKey,
    providerOverride: params.aiProvider?.provider,
    modelOverride: params.aiProvider?.model,
    caller: OPENAI_CALLER_ITINERARY_PLAN_P4_RENDER,
    systemPrompt: sys,
    userPrompt: usr,
    maxTokens,
    usageContext: params.usageContext,
  });
  if (params.acc) {
    params.acc.promptTokens += result.promptTokens;
    params.acc.completionTokens += result.completionTokens;
  }
  params.captureStages?.push({
    stage: params.template.id,
    callerId: OPENAI_CALLER_ITINERARY_PLAN_P4_RENDER,
    startedAt,
    completedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedMs,
    outcome: result.text ? 'success' : 'failure',
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    responseChars: String(result.text ?? '').length,
    ...(result.text ? {} : { parseError: 'empty_response' }),
    ...buildRawStageCapture(sys, usr, result.text),
  });
  return result.text;
};

export const generateItineraryViaPromptPlan = async (input: ItineraryPromptPlanServiceInput): Promise<ItineraryPromptPlanResult> => {
  const tokenAcc = { promptTokens: 0, completionTokens: 0 };
  const captureStages: ItineraryStageCapture[] = [];
  try {
    return await runGenerateItineraryViaPromptPlan(input, tokenAcc, captureStages);
  } catch (err) {
    // Stages accumulated before the throw (e.g. a network error mid-pipeline)
    // must still be captured — otherwise a failed generation leaves nothing
    // to debug from, even though several stages may have succeeded first.
    captureItineraryInteraction({
      captureId: input.captureId ?? input.tripIdSeed,
      jobId: input.captureId ?? input.tripIdSeed,
      userId: input.userId,
      provider: input.aiProvider?.provider,
      model: input.aiProvider?.model,
      outcome: 'failure',
      stages: captureStages,
      tokenUsage: {
        promptTokens: tokenAcc.promptTokens,
        completionTokens: tokenAcc.completionTokens,
        totalTokens: tokenAcc.promptTokens + tokenAcc.completionTokens,
      },
      payload: {
        error: err instanceof Error ? err.message : String(err),
      },
    });
    persistItineraryGenerationMetrics({
      generationId: input.captureId ?? input.tripIdSeed,
      tripId: input.tripIdSeed,
      userId: input.userId,
      provider: input.aiProvider?.provider,
      model: input.aiProvider?.model,
      outcome: 'failure',
      stages: captureStages,
      tokenUsage: {
        promptTokens: tokenAcc.promptTokens,
        completionTokens: tokenAcc.completionTokens,
        totalTokens: tokenAcc.promptTokens + tokenAcc.completionTokens,
      },
    });
    throw err;
  }
};

// Renders a p2_days logistics-block note for the ut.eb (early-bird) / ut.no (night-owl) user
// overrides (§8 of itinerary-improvement-plan.md). Both flags set is treated as a conflict
// (deliberately not "eb wins" or "no wins" — that would silently drop one traveler's stated
// preference) rather than either preference alone.
export const buildTimingPreferenceNote = (ut?: { eb?: boolean; no?: boolean }): string => {
  if (ut?.eb && ut?.no) return '\nTiming preference conflict: keep morning/evening starts flexible.';
  if (ut?.eb) return '\nEarly-bird preference: favor earlier starts when venue access is verified; do not invent opening times.';
  if (ut?.no) return '\nNight-owl preference: favor later activity slots when feasible; preserve terminal and meal buffers.';
  return '';
};

const runGenerateItineraryViaPromptPlan = async (
  input: ItineraryPromptPlanServiceInput,
  tokenAcc: { promptTokens: number; completionTokens: number },
  captureStages: ItineraryStageCapture[]
): Promise<ItineraryPromptPlanResult> => {
  const bundle = await getPromptBundle();
  const promptRequest = buildPromptRequest(input);
  const preferenceContract = buildPreferenceContract(input);
  const normalizedMustSee = normalizeMustSeeAttractions(input.mustSeeAttractions);
  const allowAttractionDiscovery = getEnvFlag('ITINERARY_ATTRACTIONS_DISCOVERY_ENABLED', { defaultValue: false });
  const allowPlanCache = !getEnvFlag('ITINERARY_GOLD_MODE') && getEnvFlag('ITINERARY_PLAN_CACHE_ENABLED', { defaultValue: true });
  const cacheUsage = { routeHit: false, dayHit: false };
  logInfo(
    `[itinerary] prompt-plan start destinations=${promptRequest.d.length} mustSee=${promptRequest.ms?.length ?? 0} days=${promptRequest.dur ?? input.days} budget=${input.budgetMin}-${input.budgetMax}`
  );

  const usageContext = input.userId
    ? {
        userId: input.userId,
        windowKey: input.usageWindowKey,
        metadata: {
          tripId: input.tripIdSeed ?? null,
          pipeline: 'itinerary_prompt_plan',
        },
      }
    : undefined;

  const normRaw = await runJsonStage<unknown>({
    apiKey: input.apiKey,
    aiProvider: input.aiProvider,
    caller: OPENAI_CALLER_ITINERARY_PLAN_P0_NORM,
    template: bundle.p0,
    replacements: {
      REQ_JSON: JSON.stringify(promptRequest),
      NORM_SCHEMA_MIN: bundle.normSchema,
    },
    maxTokens: scaleItineraryTokenBudget(700),
    fallbackValue: {},
    acc: tokenAcc,
    captureStages,
    usageContext,
  });
  const modelNormalized = sanitizeNorm(normRaw, promptRequest);
  const hasExplicitWeights = Boolean(input.promptTraits?.tt?.w);
  const hasExplicitInterests = Boolean(input.promptTraits?.ut?.i?.length || preferenceContract.travelerInterests.length);
  const normalized: PromptNorm = getEnvFlag('ITINERARY_PREFERENCE_CONTRACT_ENABLED', { defaultValue: true })
    ? {
        ...modelNormalized,
        p: input.promptTraits?.ut?.po || input.promptTraits?.tt?.p ? preferenceContract.pace.value : modelNormalized.p,
        c: input.promptTraits?.tt?.c ? preferenceContract.comfort.value : modelNormalized.c,
        mob:
          input.promptTraits?.ut?.mob || input.promptTraits?.tt?.mob || preferenceContract.mobility.source === 'traveler'
            ? preferenceContract.mobility.value
            : modelNormalized.mob,
        car: input.promptTraits?.tt?.car ? preferenceContract.car.value : modelNormalized.car,
        is: input.promptTraits?.tt?.is ? preferenceContract.interactionStyle.value : modelNormalized.is,
        w: hasExplicitWeights || hasExplicitInterests ? preferenceContract.weights : modelNormalized.w,
        a: Array.from(new Set([...modelNormalized.a, ...preferenceContract.conflicts, ...preferenceContract.assumptions])),
      }
    : modelNormalized;
  logInfo(
    `[itinerary] stage done caller=${OPENAI_CALLER_ITINERARY_PLAN_P0_NORM} sd=${normalized.sd} ed=${normalized.ed} pace=${normalized.p} comfort=${normalized.c}`
  );

  let attractionShortlistBlock = 'none';
  let shortlistByDestination: Record<string, AttractionCatalogEntry[]> = {};
  let attractionPodsByDestination: Record<string, AttractionPod[]> = {};
  if (input.userId) {
    try {
      const limitPerDestination = Number(getApiCacheSetting('attractions', 'limitPerDestination')) || 20;
      // ITINERARY_GOLD_MODE is an explicit forced override (wants the full catalog, not the
      // regular floor/adaptive shortlist), so it still passes promptItemsPerDestination
      // directly. Otherwise leave it undefined so getAttractionPromptBlockForDestinations
      // picks base-8 vs adaptive-N itself per itinerary-improvements-coding-plan.md Phase 3C
      // (trip length > 7 days, multiple destinations, >=5 high-weight interests, or a
      // coverage-check miss against the base shortlist).
      const shortlistPromptItemsPerDestination = getEnvFlag('ITINERARY_GOLD_MODE')
        ? Math.min(20, Math.max(1, limitPerDestination))
        : undefined;
      const tripLengthDaysForShortlist = Number(promptRequest.dur ?? input.days) || undefined;
      const shortlist = await getAttractionPromptBlockForDestinations({
        userId: input.userId,
        destinations: promptRequest.d,
        dateKey: normalized.sd,
        budgetMin: input.budgetMin,
        budgetMax: input.budgetMax,
        limitPerDestination,
        promptItemsPerDestination: shortlistPromptItemsPerDestination,
        tripLengthDays: tripLengthDaysForShortlist,
        allowDiscovery: allowAttractionDiscovery,
        weights: normalized.w,
        travelers: input.groupTraits.map((member) => ({
          travelerId: member.userId,
          interests: Array.isArray(member.traits) ? member.traits : [],
        })),
      });
      attractionShortlistBlock = shortlist.promptBlock;
      shortlistByDestination = shortlist.shortlistByDestination ?? {};
      attractionPodsByDestination = shortlist.attractionPodsByDestination ?? {};
      const totalItems = Object.values(shortlist.shortlistByDestination).reduce((sum, list) => sum + list.length, 0);
      logInfo(
        `[itinerary] attractions shortlist loaded destinations=${Object.keys(shortlist.shortlistByDestination).length} items=${totalItems}`
      );
    } catch (err) {
      logError('[itinerary] attractions shortlist load failed; continuing without shortlist', err);
      attractionShortlistBlock = 'none';
      shortlistByDestination = {};
      attractionPodsByDestination = {};
    }
  }
  // Shared LLM stages must remain free of private must-see selections. Those
  // are injected deterministically after cache reads/validation below.
  const mergedAttractionBlocks = [attractionShortlistBlock]
    .map((block) => normalizeText(block))
    .filter((block) => block && block !== 'none');
  const attractionContextBlock = mergedAttractionBlocks.length ? mergedAttractionBlocks.join('\n') : 'none';
  const attractionPodsBlock = Object.entries(attractionPodsByDestination)
    .map(([destination, pods]) => `Destination: ${destination}\n${renderAttractionPods(pods)}`)
    .join('\n') || 'none';

  const shortlistCoverage = (() => {
    const entries = Object.values(shortlistByDestination).flat();
    const requested = Object.entries(normalized.w).filter(([, weight]) => Number(weight) >= 10).map(([key]) => key);
    if (!requested.length) return null;
    const covered = requested.filter((interest) => entries.some((entry) => entry.interestTags.some((tag) =>
      String(tag).toLowerCase().replace(/\s+/g, '_') === interest
    )));
    return covered.length / requested.length;
  })();
  const escalation = decideItineraryEscalation({
    days: Number(promptRequest.dur ?? input.days),
    destinationCount: promptRequest.d.length,
    shortlistCoverage,
    provider: input.aiProvider?.provider,
  });
  if (escalation.shouldEscalate) {
    logInfo(`[itinerary] selective p2 escalation model=${escalation.model} reasons=${escalation.reasons.join(',')}`);
  }
  const p2AiProvider = escalation.shouldEscalate
    ? { ...(input.aiProvider ?? {}), provider: input.aiProvider?.provider ?? 'openai', model: escalation.model! }
    : input.aiProvider;

  const signatureInput = {
    destinations: promptRequest.d, duration: promptRequest.dur ?? input.days, pace: normalized.p,
    comfort: normalized.c, mobility: normalized.mob, car: normalized.car, interactionStyle: normalized.is,
    budgetMin: input.budgetMin, budgetMax: input.budgetMax, startDate: normalized.sd, endDate: normalized.ed,
    weights: normalized.w,
    startHub: promptRequest.s ?? null, endHub: promptRequest.e ?? null,
  };
  const cacheSafeRequest: PromptReq = {
    $: 'req1', d: promptRequest.d, sd: normalized.sd, ed: normalized.ed, dur: promptRequest.dur,
    s: promptRequest.s, e: promptRequest.e, tt: {
      p: normalized.p, c: normalized.c, mob: normalized.mob, car: normalized.car, w: normalized.w, is: normalized.is,
    }, budgetMin: promptRequest.budgetMin, budgetMax: promptRequest.budgetMax,
  };
  const cacheSafeNormalized: PromptNorm = { ...normalized, a: [] };
  const routeSignature = buildTripSignature(signatureInput, false);
  const daySignature = buildTripSignature(signatureInput, true);
  const catalogFingerprint = buildCatalogFingerprint(shortlistByDestination);
  const routeDependency = buildPromptFingerprint({ pipeline: ITINERARY_PIPELINE_VERSION, p1: bundle.p1, schema: bundle.step1Schema, catalogFingerprint });

  let cachedRoute: PromptRoute | null = null;
  if (allowPlanCache) {
    try { cachedRoute = await readItineraryPlanCache<PromptRoute>({ stage: 'route', signature: routeSignature, dependencyFingerprint: routeDependency }); }
    catch (err) { logError('[itinerary] route cache read failed; treating as miss', err); }
  }
  let route: PromptRoute;
  if (cachedRoute) {
    cacheUsage.routeHit = true;
    route = sanitizeRoute(cachedRoute, normalized, promptRequest);
  } else {
    const routeRaw = await runJsonStage<unknown>({
      apiKey: input.apiKey, aiProvider: input.aiProvider, caller: OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE,
      template: bundle.p1, replacements: { REQ_JSON: JSON.stringify(cacheSafeRequest), NORM_JSON: JSON.stringify(cacheSafeNormalized), STEP1_SCHEMA_MIN: bundle.step1Schema, ATTRACTION_SHORTLIST: attractionContextBlock },
      maxTokens: scaleItineraryTokenBudget(1200), fallbackValue: {}, acc: tokenAcc, captureStages, usageContext,
    });
    route = sanitizeRoute(routeRaw, normalized, promptRequest);
    if (allowPlanCache) try {
      await writeItineraryPlanCache({ stage: 'route', signature: routeSignature, dependencyFingerprint: routeDependency, payload: route, ttlDays: Number(getApiCacheSetting('itineraryPlan', 'routeCacheTtlDays')) || 60 });
    } catch (err) { logError('[itinerary] route cache write failed; continuing', err); }
  }
  logInfo(
    `[itinerary] stage done caller=${OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE} bases=${route.b.length} transfers=${route.x.length} hasRentalCar=${route.rc ? 'yes' : 'no'}`
  );
  const routeFrictionScore = calculateRouteFrictionScore({
    transferHours: route.x.reduce((sum, transfer) => sum + Math.max(0, Number(transfer.td) || 0), 0),
    transfersCount: route.x.length,
    baseChanges: Math.max(0, route.b.length - 1),
  });
  route.a = Array.from(new Set([...(route.a ?? []), `Route friction score (derived): ${routeFrictionScore}. Lower is easier; verify booked legs and terminal buffers.`]));

  const startTransfer = route.x.find((transfer) => transfer.dt === normalized.sd);
  const endTransfer = [...route.x].reverse().find((transfer) => transfer.dt === normalized.ed);
  const logisticsFacts = buildArrivalDepartureFacts({
    arrival: promptRequest.s || startTransfer
      ? { date: normalized.sd, localTime: null, durationHours: startTransfer?.td ?? null, isLongHaul: (startTransfer?.td ?? 0) >= 7, terminalOnly: !startTransfer }
      : null,
    departure: promptRequest.s || promptRequest.e || endTransfer
      ? { date: normalized.ed, localTime: null, durationHours: endTransfer?.td ?? null, isLongHaul: (endTransfer?.td ?? 0) >= 7, terminalOnly: !endTransfer }
      : null,
    departureBufferMinutes: 180,
  });
  const timingPreferenceNote = buildTimingPreferenceNote(promptRequest.ut);
  let destinationClimatologyBlock = '';
  try {
    destinationClimatologyBlock = await buildDestinationClimatologyBlock(route, shortlistByDestination, normalized.sd);
  } catch (err) {
    logError('[itinerary] destination climatology block build failed; continuing without it', err);
  }
  const homeTerminalNote = buildHomeTerminalLogisticsNote(route, shortlistByDestination, {
    airportCode: input.homeAirport ?? input.returnAirport ?? input.departureAirport,
    region: input.homeRegion,
  }, {
    entryAirport: input.departureAirport,
    exitAirport: input.returnAirport ?? input.homeAirport ?? input.departureAirport,
  });
  const logisticsFactsBlock = `${renderLogisticsFactBlock(logisticsFacts)}${timingPreferenceNote}${input.groupTraits.length > 4 ? '\nGroup size >4: verify a group-size-appropriate transfer mode and reservation capacity.' : ''}${homeTerminalNote ? `\n${homeTerminalNote}` : ''}${destinationClimatologyBlock ? `\n${destinationClimatologyBlock}` : ''}`;
  const dayDependency = buildPromptFingerprint({
    pipeline: ITINERARY_PIPELINE_VERSION, p2: bundle.p2, p3: bundle.p3, schema: bundle.step2Schema, catalogFingerprint, route: stableHash(route),
    attractionPodsBlock, logisticsFactsBlock, structureValidator: ITINERARY_STRUCTURE_VALIDATOR_VERSION,
  });
  let cachedDay: PromptItinerary | null = null;
  if (allowPlanCache) try { cachedDay = await readItineraryPlanCache<PromptItinerary>({ stage: 'day', signature: daySignature, dependencyFingerprint: dayDependency }); }
  catch (err) { logError('[itinerary] day cache read failed; treating as miss', err); }
  let filteredItinerary: PromptItinerary;
  if (cachedDay) {
    cacheUsage.dayHit = true;
    filteredItinerary = sanitizeItinerary(cachedDay, route, normalized, promptRequest);
  } else {
  const goldMode = getEnvFlag('ITINERARY_GOLD_MODE');
  const chunkingEnabled = goldMode || Number(getApiCacheSetting('itineraryPlan', 'chunkingEnabled')) > 0;
  const chunkingMinDays = Math.max(1, Number(getApiCacheSetting('itineraryPlan', 'chunkingMinDays')) || 8);
  const chunkSizeDays = Math.max(1, Number(getApiCacheSetting('itineraryPlan', 'chunkSizeDays')) || 3);
  // Gold mode forces chunking regardless of trip length (coding plan Phase 8, override (c)) —
  // production's chunkingMinDays threshold only applies outside gold mode.
  const shouldChunkP2 = chunkingEnabled && (goldMode || Number(promptRequest.dur ?? input.days) >= chunkingMinDays);
  const dayItineraries: PromptItinerary[] = [];
  const ranges = shouldChunkP2
    ? chunkDayRanges(normalized.sd, normalized.ed, chunkSizeDays)
    : [{ start: normalized.sd, end: normalized.ed, offset: 0 }];
  let usedAttractionNames: string[] = [];
  let narrativeContinuityContext = 'none';

  for (const range of ranges) {
    const chunkDays = diffDaysInclusive(range.start, range.end);
    const chunkNorm = { ...cacheSafeNormalized, sd: range.start, ed: range.end };
    const chunkReq = { ...promptRequest, sd: range.start, ed: range.end, dur: chunkDays };
    // A thrown error here (network failure, rate limit, missing key) is NOT the same as the
    // empty-response/parse-failure case runJsonStage already handles internally — those return
    // fallbackValue, but a *thrown* error would otherwise propagate out of this loop and fail the
    // entire multi-chunk generation just because one window's call failed. Per the "clean
    // offline/degraded fallback" requirement, a single chunk failure must degrade to the same
    // deterministic day skeleton used for other degraded cases, not crash the whole itinerary.
    let dayRaw: unknown = {};
    try {
      dayRaw = await runJsonStage<unknown>({
        apiKey: input.apiKey,
        aiProvider: p2AiProvider,
        caller: OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS,
        template: bundle.p2,
        replacements: {
          NORM_JSON: JSON.stringify(chunkNorm),
          STEP1_JSON: JSON.stringify(route),
          STEP2_SCHEMA_MIN: bundle.step2Schema,
          ATTRACTION_SHORTLIST: attractionContextBlock,
          ATTRACTION_PODS: attractionPodsBlock,
          LOGISTICS_FACTS: logisticsFactsBlock,
          DAY_RANGE: `${range.start}..${range.end}`,
          USED_ATTRACTION_IDS: usedAttractionNames.join(', ') || 'none',
          NARRATIVE_CONTINUITY_CONTEXT: narrativeContinuityContext,
        },
        maxTokens: scaleItineraryTokenBudget(Math.max(1100, Math.min(3500, chunkDays * 280))),
        fallbackValue: {},
        acc: tokenAcc,
        captureStages,
        usageContext,
      });
    } catch (err) {
      logError(`[itinerary] p2 chunk call threw for range=${range.start}..${range.end}; falling back to deterministic day skeleton for this window`, err);
      captureStages?.push({
        stage: bundle.p2.id,
        callerId: OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        latencyMs: 0,
        outcome: 'failure',
        promptTokens: 0,
        completionTokens: 0,
        responseChars: 0,
        parseError: err instanceof Error ? err.message : String(err),
      });
      dayRaw = {};
    }
    const chunkItinerary = sanitizeItinerary(dayRaw, route, chunkNorm, chunkReq);
    dayItineraries.push(chunkItinerary);
    usedAttractionNames = Array.from(new Set([
      ...usedAttractionNames,
      ...chunkItinerary.dy.flatMap((day) => day.it.map((item) => item[2])),
    ]));

    // Update narrative continuity context for the next chunk: a 1-sentence emotional/tonal
    // summary of how the previous chunk ended.
    if (chunkItinerary.dy.length > 0) {
      const lastDay = chunkItinerary.dy[chunkItinerary.dy.length - 1];
      const items = lastDay.it.map((item) => item[2]).join(', ');
      narrativeContinuityContext = `The previous chunk ended on Day ${lastDay.d} at ${lastDay.b} with: ${items}. The group is satisfied and ready for the next phase of the trip.`;
    }
  }
  const dayItinerary = shouldChunkP2
    ? mergeChunkedItineraries(dayItineraries, route)
    : (dayItineraries[0] ?? sanitizeItinerary({}, route, normalized, promptRequest));
  const mechanicallyValidated = validateAndRepairItineraryStructure({ itinerary: dayItinerary, logisticsFacts });
  logInfo(
    `[itinerary] stage done caller=${OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS} days=${dayItinerary.dy.length} transfers=${dayItinerary.x.length}`
  );

  const skipCleanValidator = Number(getApiCacheSetting('itineraryPlan', 'skipValidatorWhenClean')) > 0;
  if (skipCleanValidator && !mechanicallyValidated.changed) {
    filteredItinerary = mechanicallyValidated.itinerary;
    logInfo('[itinerary] skipped clean p3 validator; mechanical checks passed');
  } else {
    const validatedRaw = await runJsonStage<unknown>({
      apiKey: input.apiKey,
      aiProvider: input.aiProvider,
      caller: OPENAI_CALLER_ITINERARY_PLAN_P3_VALIDATE,
      template: bundle.p3,
      replacements: {
        STEP2_JSON: JSON.stringify(mechanicallyValidated.itinerary),
        STEP2_SCHEMA_MIN: bundle.step2Schema,
      },
      maxTokens: scaleItineraryTokenBudget(1400),
      fallbackValue: mechanicallyValidated.itinerary,
      acc: tokenAcc,
      captureStages,
      usageContext,
    });
    filteredItinerary = sanitizeItinerary(validatedRaw, route, normalized, promptRequest);
    logInfo(
      `[itinerary] stage done caller=${OPENAI_CALLER_ITINERARY_PLAN_P3_VALIDATE} days=${filteredItinerary.dy.length} transfers=${filteredItinerary.x.length}`
    );
  }
  if (allowPlanCache) try {
    await writeItineraryPlanCache({ stage: 'day', signature: daySignature, dependencyFingerprint: dayDependency, payload: filteredItinerary, fragments: buildDayFragments(filteredItinerary.dy, 3), ttlDays: Number(getApiCacheSetting('itineraryPlan', 'dayCacheTtlDays')) || 30 });
  } catch (err) { logError('[itinerary] day cache write failed; continuing', err); }
  }
  filteredItinerary = validateAndRepairItineraryStructure({ itinerary: filteredItinerary, logisticsFacts }).itinerary;
  // Shared day-cache hits contain only generic, validated content. Re-run the
  // cheap grounding, destination, and logistics checks after every read so a
  // cached skeleton cannot bypass this user's fairness/accessibility rules.
  const groundedResult = enforceShortlistGrounding(
    filteredItinerary,
    promptRequest,
    shortlistByDestination,
    preferenceContract.travelerInterests
  );
  filteredItinerary = groundedResult.itinerary;
  filteredItinerary = validateAndRepairItineraryStructure({
    itinerary: enforceAttractionDestinationConsistency(filteredItinerary, shortlistByDestination),
    logisticsFacts,
  }).itinerary;
  const profile = mapProfile(normalized);
  const fragmentInjected = injectMustSeesIntoCachedFragments({
    itinerary: filteredItinerary,
    mustSees: normalizedMustSee,
    podsByDestination: attractionPodsByDestination,
    maxItemsPerDay: MAX_ITEMS_PER_DAY,
  });
  const itineraryWithMustSee = enforceMustSeeAttractions(fragmentInjected, normalizedMustSee, promptRequest.d);
  const budgetCoherentItinerary = enforceBudgetTierCoherence(
    itineraryWithMustSee,
    shortlistByDestination,
    normalized.c,
    normalizedMustSee.map((item) => item.name)
  );
  const scheduledItinerary = scheduleItineraryDaysDeterministically(budgetCoherentItinerary, shortlistByDestination, logisticsFacts);
  const polishedItinerary = polishItineraryFinalPass(scheduledItinerary, shortlistByDestination, attractionPodsByDestination);
  const { durationMetadataByName, transferNotesByDay } = await attachAttractionMetadata(
    polishedItinerary,
    normalized,
    shortlistByDestination,
    input.userId,
    input.groupTraits.length
  );
  enforceDescriptionBasedDestinationConsistency(polishedItinerary, promptRequest.d, durationMetadataByName);

  const fatigueManaged = enforceFatigueManagement(
    polishedItinerary,
    transferNotesByDay,
    durationMetadataByName,
    input.groupTraits.length,
    normalized.mob
  );
  let finalItinerary = fatigueManaged.itinerary;

  // itinerary-improvements-coding-plan.md Phase 4B ("Deterministic fill + one targeted repair"):
  // thin days (fewer than ~2 items) get filled from already-fetched must-see/shortlist data
  // before any new LLM call; only if that can't resolve a day do we spend one small, batched
  // repair call, capped at exactly one attempt per generation.
  const dayFillEnabled = Number(getApiCacheSetting('itineraryPlan', 'dayFillEnabled')) !== 0;
  if (dayFillEnabled) {
    // arrivalDepartureRulesService/itineraryStructureValidator already truncated any date with
    // maxActivities === 0 (terminal-only arrival/departure day) down to zero items for a hard
    // logistics reason — that's an intentional empty day, not a "thin" one. Neither deterministic
    // fill nor the repair call below may re-populate it.
    const zeroActivityDayDates = new Set(
      logisticsFacts.filter((fact) => fact.maxActivities === 0).map((fact) => fact.date)
    );
    const deterministicFill = fillThinDaysDeterministically({
      itinerary: finalItinerary,
      mustSees: normalizedMustSee,
      podsByDestination: attractionPodsByDestination,
      transferNotesByDay,
      minItemsPerDay: THIN_DAY_MIN_ITEMS,
      maxItemsPerDay: MAX_ITEMS_PER_DAY,
      zeroActivityDayDates,
    });
    finalItinerary = deterministicFill.itinerary;
    if (deterministicFill.filledDayDates.length || deterministicFill.thinDayDates.length) {
      logInfo(
        `[itinerary] day-fill deterministic filled=${deterministicFill.filledDayDates.length} stillThin=${deterministicFill.thinDayDates.length}`
      );
    }

    const dayFillRepairEnabled = Number(getApiCacheSetting('itineraryPlan', 'dayFillRepairEnabled')) !== 0;
    if (deterministicFill.thinDayDates.length && dayFillRepairEnabled) {
      // Hard cap: exactly one repair attempt per generation, batching every thin day into this
      // single call rather than looping per day. Any failure (thrown network/provider error, or
      // an empty/malformed response — the latter already falls back inside runJsonStage/
      // mergeThinDayRepairResult) leaves finalItinerary as the deterministic, possibly-still-thin
      // itinerary; there is no retry.
      try {
        const repairPayload = buildThinDayRepairPayload(finalItinerary, deterministicFill.thinDayDates);
        const repairedRaw = await runJsonStage<unknown>({
          apiKey: input.apiKey,
          aiProvider: input.aiProvider,
          caller: OPENAI_CALLER_ITINERARY_PLAN_P3B_REPAIR,
          template: getDayFillRepairTemplate(),
          replacements: {
            MIN_ITEMS: String(THIN_DAY_MIN_ITEMS),
            THIN_DAYS_JSON: JSON.stringify(repairPayload),
            SHORTLIST_JSON: JSON.stringify(
              Object.fromEntries(
                Object.entries(shortlistByDestination).map(([destination, entries]) => [
                  destination,
                  entries.slice(0, 12).map((entry) => entry.name),
                ])
              )
            ),
            USED_NAMES_JSON: JSON.stringify(
              Array.from(new Set(finalItinerary.dy.flatMap((day) => day.it.map((item) => item[2]))))
            ),
          },
          maxTokens: scaleItineraryTokenBudget(500),
          fallbackValue: null,
          acc: tokenAcc,
          captureStages,
          usageContext,
        });
        const merged = mergeThinDayRepairResult({
          itinerary: finalItinerary,
          repaired: repairedRaw,
          minItemsPerDay: THIN_DAY_MIN_ITEMS,
          maxItemsPerDay: MAX_ITEMS_PER_DAY,
          zeroActivityDayDates,
        });
        finalItinerary = merged.itinerary;
        logInfo(
          `[itinerary] day-fill repair caller=${OPENAI_CALLER_ITINERARY_PLAN_P3B_REPAIR} repaired=${merged.repairedDayDates.length} stillThin=${merged.stillThinDayDates.length}`
        );
      } catch (err) {
        logError('[itinerary] day-fill repair call failed; keeping deterministic (possibly still-thin) itinerary', err);
      }
    }
  }

  // Surface the same derived transfer estimates used for scheduling so the
  // traveler can understand why activities are grouped and paced this way.
  for (const day of finalItinerary.dy) {
    const transferNotes = transferNotesByDay.get(day.d) ?? [];
    if (!transferNotes.length) continue;
    const logistics = transferNotes.slice(0, 2).map((note) =>
      `Estimated ${describeTransferMode(note.mode).toLowerCase()} transfer: ${note.fromName} → ${note.toName}, about ${note.minutes} min (${note.distanceKm.toFixed(1)} km).`
    );
    day.ln = Array.from(new Set([...(day.ln ?? []), ...logistics])).slice(0, 2);
  }

  const whyFitsByName = new Map<string, string>();
  for (const entries of Object.values(shortlistByDestination)) {
    for (const entry of entries) {
      const relevantTags = entry.interestTags.filter((tag) => Number((normalized.w as any)[String(tag).replace(/\s+/g, '_')]) >= 10);
      if (relevantTags.length) whyFitsByName.set(entry.name.toLowerCase(), `it supports your ${relevantTags.slice(0, 2).join(' and ')} interests.`);
    }
  }
  const activityContext = Array.from(durationMetadataByName.entries()).map(([name, metadata]) => ({
    name, description: metadata.description ?? undefined,
    whyThisFits: whyFitsByName.get(name),
    requiresPreOrderTickets: metadata.requiresPreOrderTickets,
  }));

  const render = await runRenderStage({
    apiKey: input.apiKey,
    aiProvider: input.aiProvider,
    template: bundle.p4,
    replacements: {
      FINAL_JSON: JSON.stringify({ itinerary: finalItinerary, activityContext }),
    },
    acc: tokenAcc,
    captureStages,
    usageContext,
  });
  const renderedMarkdown = String(render ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  logInfo(`[itinerary] stage response caller=${OPENAI_CALLER_ITINERARY_PLAN_P4_RENDER} chars=${renderedMarkdown.length}`);
  const fallbackMarkdown = renderMarkdownFallback(finalItinerary, profile);
  const safeRender = chooseSafeItineraryMarkdown(renderedMarkdown, fallbackMarkdown);
  const planMarkdown = safeRender.markdown;
  const details = buildDetails(finalItinerary, transferNotesByDay, durationMetadataByName);
  const safeDetails = details.length
    ? details
    : [
        {
          day: 1,
          time: '13:00',
          activity: 'Travel day: no activities scheduled',
          cost: null,
        },
      ];
  const allEntries = Object.values(shortlistByDestination).flat();
  const entryByName = new Map<string, AttractionCatalogEntry>();
  for (const entry of allEntries) {
    const key = normalizeText(entry.name).toLowerCase();
    if (key && !entryByName.has(key)) entryByName.set(key, entry);
  }

  const items = mapItems(finalItinerary, profile.weights, durationMetadataByName, transferNotesByDay, whyFitsByName, normalized.mob);
  const getYourGuideCandidates = buildGetYourGuideItineraryCandidates({
    activities: items.activities,
    destinations: promptRequest.d,
    catalogEntries: allEntries,
    durationMetadataByName,
    transferNotesByDay,
    dayNumberByDate: new Map(finalItinerary.dy.map((day) => [day.dt, day.d] as const)),
    mustSeeNames: normalizedMustSee.map((item) => item.name),
    context: {
      comfort: preferenceContract.comfort.value === 'B' ? 'Budget' : preferenceContract.comfort.value === 'L' ? 'Luxury' : 'Midrange',
      mobility: preferenceContract.mobility.value === 'L' ? 'Low' : preferenceContract.mobility.value === 'H' ? 'High' : 'Medium',
      interestWeights: preferenceContract.weights,
      requireDisambiguatedDestination: true,
    },
  });
  const selectedGetYourGuide = selectGetYourGuideItineraryCandidates(getYourGuideCandidates, {
    comfort: preferenceContract.comfort.value === 'B' ? 'Budget' : preferenceContract.comfort.value === 'L' ? 'Luxury' : 'Midrange',
    mobility: preferenceContract.mobility.value === 'L' ? 'Low' : preferenceContract.mobility.value === 'H' ? 'High' : 'Medium',
    interestWeights: preferenceContract.weights,
    requireDisambiguatedDestination: true,
  });
  const transferMinutesByDay = new Map<number, number>();
  for (const [dayNum, notes] of transferNotesByDay) {
    transferMinutesByDay.set(dayNum, notes.reduce((sum, n) => sum + n.minutes, 0));
  }
  const evaluation = evaluateItineraryBaseline({
    activities: items.activities.map((a) => {
      const entry = entryByName.get(normalizeText(a.name).toLowerCase());
      return { ...a, interestTags: entry?.interestTags };
    }),
    transfers: items.transfers,
    mustSees: normalizedMustSee.map((item) => item.name),
    weights: normalized.w,
    comfort: normalized.c,
    tokenUsage: {
      promptTokens: tokenAcc.promptTokens,
      completionTokens: tokenAcc.completionTokens,
      totalTokens: tokenAcc.promptTokens + tokenAcc.completionTokens,
    },
    stageLatenciesMs: captureStages.map((stage) => stage.latencyMs),
    transferMinutesByDay,
    groupCohesionScore: groundedResult.groupCohesionScore,
  });
  logInfo(
    `[itinerary] prompt-plan done details=${safeDetails.length} transfers=${items.transfers.length} lodgings=${items.lodgings.length} activities=${items.activities.length} carRentals=${items.carRentals.length} usedRenderFallback=${safeRender.fallbackUsed ? 'yes' : 'no'}`
  );
  captureItineraryInteraction({
    captureId: input.captureId ?? input.tripIdSeed,
    jobId: input.captureId ?? input.tripIdSeed,
    userId: input.userId,
    provider: input.aiProvider?.provider,
    model: input.aiProvider?.model,
    outcome: 'success',
    stages: captureStages,
    tokenUsage: {
      promptTokens: tokenAcc.promptTokens,
      completionTokens: tokenAcc.completionTokens,
      totalTokens: tokenAcc.promptTokens + tokenAcc.completionTokens,
    },
    payload: {
      destinationCount: promptRequest.d.length,
      days: promptRequest.dur ?? input.days,
      detailCount: safeDetails.length,
      transfersCount: items.transfers.length,
      lodgingsCount: items.lodgings.length,
      activitiesCount: items.activities.length,
      carRentalsCount: items.carRentals.length,
      usedRenderFallback: safeRender.fallbackUsed,
      evaluation,
      fatigueIssues: fatigueManaged.issues,
    },
  });
  persistItineraryGenerationMetrics({
    generationId: input.captureId ?? input.tripIdSeed,
    tripId: input.tripIdSeed,
    userId: input.userId,
    provider: input.aiProvider?.provider,
    model: input.aiProvider?.model,
    outcome: 'success',
    stages: captureStages,
    tokenUsage: {
      promptTokens: tokenAcc.promptTokens,
      completionTokens: tokenAcc.completionTokens,
      totalTokens: tokenAcc.promptTokens + tokenAcc.completionTokens,
    },
    evaluation,
    cacheUsage: cacheUsage as unknown as Record<string, unknown>,
    fallbackUsed: safeRender.fallbackUsed,
  });

  return {
    promptRequest,
    normalized,
    route,
    itinerary: finalItinerary,
    planMarkdown,
    details: safeDetails,
    generatedItems: items,
    profile,
    tokenUsage: {
      promptTokens: tokenAcc.promptTokens,
      completionTokens: tokenAcc.completionTokens,
      totalTokens: tokenAcc.promptTokens + tokenAcc.completionTokens,
    },
    preferenceContract,
    evaluation,
    cacheUsage,
    ...(selectedGetYourGuide.selected.length ? { getYourGuideCandidates: selectedGetYourGuide.selected } : {}),
  };
};

const chunkDayRanges = (start: string, end: string, size: number): Array<{ start: string; end: string; offset: number }> => {
  const total = diffDaysInclusive(start, end);
  const ranges: Array<{ start: string; end: string; offset: number }> = [];
  for (let offset = 0; offset < total; offset += size) {
    const chunkStart = addDays(start, offset);
    const chunkEnd = addDays(start, Math.min(total - 1, offset + size - 1));
    ranges.push({ start: chunkStart, end: chunkEnd, offset });
  }
  return ranges;
};

const mergeChunkedItineraries = (chunks: PromptItinerary[], route: PromptRoute): PromptItinerary => {
  const seen = new Set<string>();
  const days = chunks.flatMap((chunk) => chunk.dy).sort((a, b) => a.dt.localeCompare(b.dt)).map((day, index) => ({
    ...day,
    d: index + 1,
    it: day.it.filter((item) => {
      const key = normalizeText(item[2]).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  }));
  return {
    ...(chunks[0] ?? { $: 'it1', eh: route.eh, xh: route.xh, b: route.b, x: route.x, a: route.a, cf: 'M' }),
    dy: days,
    b: route.b,
    x: route.x,
  } as PromptItinerary;
};
