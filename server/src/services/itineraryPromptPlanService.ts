import fs from 'fs';
import path from 'path';
import {
  OPENAI_CALLER_ITINERARY_PLAN_P0_NORM,
  OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE,
  OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS,
  OPENAI_CALLER_ITINERARY_PLAN_P3_VALIDATE,
  OPENAI_CALLER_ITINERARY_PLAN_P4_RENDER,
  runItineraryPromptStageViaOpenAi,
} from '../apis/openaiCallers';
import { getEnvFlag } from '../env';
import { logError, logInfo } from '../logger';
import type { ActivityType, AttractionCatalogEntry } from '../types';
import { getApiCacheSetting } from '../config/apiLimits';
import {
  getAttractionPromptBlockForDestinations,
} from './attractionsCatalogService';
import { scoreActivityTypeByPreferences, type InterestWeights } from './activityTypeInterestWeights';

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
};

type ServiceInput = {
  apiKey: string;
  userId?: string;
  destinations: string[];
  days: number;
  budgetMin: number;
  budgetMax: number;
  mustSeeAttractions?: string[];
  departureAirport?: string;
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
};

type PromptTemplate = {
  id: string;
  sys: string;
  usr: string;
};

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

const PROMPTS_ROOT = path.resolve(__dirname, '../../prompts');
let cachedBundle: PromptBundle | null = null;

const readText = (relativePath: string): string => {
  const filePath = path.join(PROMPTS_ROOT, relativePath);
  return fs.readFileSync(filePath, 'utf8');
};

const readPromptTemplate = (relativePath: string): PromptTemplate => {
  const raw = readText(relativePath);
  return JSON.parse(raw) as PromptTemplate;
};

const getPromptBundle = (): PromptBundle => {
  if (cachedBundle) return cachedBundle;
  cachedBundle = {
    p0: readPromptTemplate(path.join('prompts', 'p0_norm.json')),
    p1: readPromptTemplate(path.join('prompts', 'p1_route.json')),
    p2: readPromptTemplate(path.join('prompts', 'p2_days.json')),
    p3: readPromptTemplate(path.join('prompts', 'p3_validate.json')),
    p4: readPromptTemplate(path.join('prompts', 'p4_render_md.json')),
    normSchema: readText(path.join('schemas', 'norm_schema_min.json')),
    step1Schema: readText(path.join('schemas', 'step1_schema_min.json')),
    step2Schema: readText(path.join('schemas', 'step2_schema_min.json')),
  };
  return cachedBundle;
};

const replaceAll = (template: string, key: string, value: string): string =>
  template
    .replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    .replace(new RegExp(`\\{${key}\\}`, 'g'), value);

const applyTemplate = (template: string, replacements: Record<string, string>): string => {
  let output = template;
  for (const [key, value] of Object.entries(replacements)) {
    output = replaceAll(output, key, value);
  }
  return output;
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

const normalizePromptTraitInput = (input?: ServiceInput['promptTraits']) => {
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

const normalizeMustSeeAttractions = (items: string[] | undefined): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items ?? []) {
    const value = normalizeText(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= 20) break;
  }
  return out;
};

const buildMustSeePromptBlock = (mustSeeAttractions: string[]): string => {
  if (!mustSeeAttractions.length) return '';
  const lines = ['Must-see attractions selected by travelers (prioritize these):'];
  mustSeeAttractions.forEach((name, idx) => {
    lines.push(`${idx + 1}. ${name}`);
  });
  return lines.join('\n');
};

const buildPromptRequest = (input: ServiceInput): PromptReq => {
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
    p: input.groupTraits.map((member) => ({
      t: Array.isArray(member.traits) ? member.traits.map((t) => String(t)).filter(Boolean) : [],
    })),
    tt: normalizedPromptTraits.tt,
    ut: normalizedPromptTraits.ut,
    rs: seedNum,
    budgetMin: Math.max(0, Math.round(input.budgetMin)),
    budgetMax: Math.max(Math.round(input.budgetMin), Math.round(input.budgetMax)),
    tripStyle: String(input.tripStyle ?? '').trim() || undefined,
    ms: mustSeeAttractions,
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

const enforceShortlistGrounding = (
  itinerary: PromptItinerary,
  req: PromptReq,
  shortlistByDestination: Record<string, AttractionCatalogEntry[]>
): PromptItinerary => {
  const requested = Array.isArray(req.d) ? req.d.map((item) => normalizeText(item)).filter(Boolean) : [];
  const pools = buildShortlistPools(shortlistByDestination, requested);
  if (!pools.global.length) return itinerary;

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

  const primaryDestination = requested[0];
  const primaryTop = (pools.byDestination[primaryDestination] ?? []).slice(0, 3);
  const pickInjectionDay = (): PromptDay | undefined => {
    const middleDay = itinerary.dy.find((day, idx) => idx > 0 && idx < itinerary.dy.length - 1 && day.it.length > 0);
    if (middleDay) return middleDay;
    return itinerary.dy.find((day) => day.it.length > 0);
  };
  const forceInjectTopAttraction = (topName: string): void => {
    if (!topName) return;
    const alreadyPresent = itinerary.dy.some((day) =>
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
    const alreadyPresent = itinerary.dy.some((day) =>
      day.it.some((item) => normalizeText(item[2]).toLowerCase() === normalizeText(topName).toLowerCase())
    );
    if (alreadyPresent) continue;
    let injected = false;
    for (const day of itinerary.dy) {
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
      if (injectionDay.it.length < 5) {
        const seed = injectionDay.it[injectionDay.it.length - 1] ?? ['D', 'A', topName];
        injectionDay.it.push([seed[0], seed[1], topName]);
      } else {
        const current = injectionDay.it[0];
        injectionDay.it[0] = [current[0], current[1], topName];
      }
    }
  }

  return itinerary;
};

const enforceMustSeeAttractions = (
  itinerary: PromptItinerary,
  mustSeeAttractions: string[]
): PromptItinerary => {
  const required = normalizeMustSeeAttractions(mustSeeAttractions);
  if (!required.length) return itinerary;
  const normalizedRequired = required.map((item) => normalizeText(item));
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
  const targetDays = candidateDays.length ? candidateDays : itinerary.dy;
  if (!targetDays.length) return itinerary;

  let targetCursor = 0;
  for (const mustSee of normalizedRequired) {
    const key = mustSee.toLowerCase();
    if (!key || present.has(key)) continue;
    const day = targetDays[targetCursor % targetDays.length];
    targetCursor += 1;
    const genericIndex = day.it.findIndex((item) => {
      const text = normalizeText(item[2]);
      return (
        GENERIC_ACTIVITY_PATTERNS.some((pattern) => pattern.test(text)) ||
        EXTRA_GENERIC_ACTIVITY_PATTERNS.some((pattern) => pattern.test(text))
      );
    });
    if (genericIndex >= 0) {
      const current = day.it[genericIndex];
      day.it[genericIndex] = [current[0], current[1], mustSee];
      present.add(key);
      continue;
    }
    if (day.it.length < 5) {
      day.it.push(['D', 'A', mustSee]);
      present.add(key);
      continue;
    }
    const current = day.it[0];
    day.it[0] = [current[0], current[1], mustSee];
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

const mapTimeCodeToTime = (code: PromptDayTimeCode): string => {
  if (code === 'M') return '09:00';
  if (code === 'E') return '19:00';
  return '13:00';
};

const transferDurationHours = (td: unknown): number | null => {
  const raw = Number(td);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (raw > 24) return raw / 60;
  return raw;
};

const getActivityBlockedDates = (itinerary: PromptItinerary, norm: PromptNorm): Set<string> => {
  const blocked = new Set<string>();
  if (isIsoDate(norm.sd)) blocked.add(norm.sd);
  if (isIsoDate(norm.ed)) blocked.add(norm.ed);
  for (const transfer of itinerary.x) {
    if (!isIsoDate(transfer.dt)) continue;
    const durationHours = transferDurationHours(transfer.td);
    if (durationHours !== null && durationHours > 4) {
      blocked.add(transfer.dt);
    }
  }
  return blocked;
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

const mapItems = (itinerary: PromptItinerary, preferenceWeights: PromptWeights): ItineraryGeneratedItems => {
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

  const activities: ItineraryGeneratedActivity[] = itinerary.dy.flatMap((day) =>
    day.it.map(([timeCode, activityCode, text]) => {
      const mapped = ACTIVITY_CODE_TO_LONG[activityCode];
      const closest = pickActivityTypeForPreferences(text, mapped, preferenceWeights);
      return {
        status: 'Proposed',
        activityType: closest,
        date: day.dt,
        name: text,
        startLocation: day.b || itinerary.eh,
        startTime: mapTimeCodeToTime(timeCode),
        duration: '2h',
        cost: '',
        freeCancelBy: '',
        bookedOn: '',
        reference: '',
      };
    })
  );

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

const buildDetails = (itinerary: PromptItinerary): ItineraryGeneratedDetail[] =>
  itinerary.dy.flatMap((day) =>
    day.it.map(([timeCode, _activityCode, text]) => ({
      day: day.d,
      time: mapTimeCodeToTime(timeCode),
      activity: text,
      cost: null,
    }))
  );

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

const hasVisibleText = (value: unknown): boolean => {
  const text = String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  return /[A-Za-z0-9]/.test(text);
};

const runJsonStage = async <T>(params: {
  apiKey: string;
  caller:
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P0_NORM
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P3_VALIDATE;
  template: PromptTemplate;
  replacements: Record<string, string>;
  maxTokens: number;
  fallbackValue: T;
  acc?: { promptTokens: number; completionTokens: number };
}): Promise<T> => {
  const sys = applyTemplate(params.template.sys, params.replacements);
  const usr = applyTemplate(params.template.usr, params.replacements);
  logInfo(`[itinerary] stage start caller=${params.caller} maxTokens=${params.maxTokens}`);
  const result = await runItineraryPromptStageViaOpenAi({
    apiKey: params.apiKey,
    caller: params.caller,
    systemPrompt: sys,
    userPrompt: usr,
    maxTokens: params.maxTokens,
  });
  if (params.acc) {
    params.acc.promptTokens += result.promptTokens;
    params.acc.completionTokens += result.completionTokens;
  }
  if (!result.text) {
    logError(`[itinerary] ${params.caller} returned empty response; using fallback`);
    return params.fallbackValue;
  }
  logInfo(`[itinerary] stage response caller=${params.caller} chars=${result.text.length}`);
  try {
    return parseModelJson<T>(result.text);
  } catch (err) {
    const snippet = String(result.text).slice(0, 600).replace(/\s+/g, ' ');
    logError(`[itinerary] ${params.caller} JSON parse failed; using fallback`, {
      error: err instanceof Error ? err.message : String(err),
      snippet,
    });
    return params.fallbackValue;
  }
};

const runRenderStage = async (params: {
  apiKey: string;
  template: PromptTemplate;
  replacements: Record<string, string>;
  acc?: { promptTokens: number; completionTokens: number };
}): Promise<string | null> => {
  const sys = applyTemplate(params.template.sys, params.replacements);
  const usr = applyTemplate(params.template.usr, params.replacements);
  logInfo('[itinerary] stage start caller=ITINERARY_PLAN_P4_RENDER maxTokens=900');
  const result = await runItineraryPromptStageViaOpenAi({
    apiKey: params.apiKey,
    caller: OPENAI_CALLER_ITINERARY_PLAN_P4_RENDER,
    systemPrompt: sys,
    userPrompt: usr,
    maxTokens: 900,
  });
  if (params.acc) {
    params.acc.promptTokens += result.promptTokens;
    params.acc.completionTokens += result.completionTokens;
  }
  return result.text;
};

export const generateItineraryViaPromptPlan = async (input: ServiceInput): Promise<ItineraryPromptPlanResult> => {
  const bundle = getPromptBundle();
  const promptRequest = buildPromptRequest(input);
  const mustSeePromptBlock = buildMustSeePromptBlock(promptRequest.ms ?? []);
  const allowAttractionDiscovery = getEnvFlag('ITINERARY_ATTRACTIONS_DISCOVERY_ENABLED', { defaultValue: false });
  logInfo(
    `[itinerary] prompt-plan start destinations=${promptRequest.d.length} mustSee=${promptRequest.ms?.length ?? 0} days=${promptRequest.dur ?? input.days} budget=${input.budgetMin}-${input.budgetMax}`
  );

  const tokenAcc = { promptTokens: 0, completionTokens: 0 };

  const normRaw = await runJsonStage<unknown>({
    apiKey: input.apiKey,
    caller: OPENAI_CALLER_ITINERARY_PLAN_P0_NORM,
    template: bundle.p0,
    replacements: {
      REQ_JSON: JSON.stringify(promptRequest),
      NORM_SCHEMA_MIN: bundle.normSchema,
    },
    maxTokens: 700,
    fallbackValue: {},
    acc: tokenAcc,
  });
  const normalized = sanitizeNorm(normRaw, promptRequest);
  logInfo(
    `[itinerary] stage done caller=${OPENAI_CALLER_ITINERARY_PLAN_P0_NORM} sd=${normalized.sd} ed=${normalized.ed} pace=${normalized.p} comfort=${normalized.c}`
  );

  let attractionShortlistBlock = 'none';
  let shortlistByDestination: Record<string, AttractionCatalogEntry[]> = {};
  if (input.userId) {
    try {
      const limitPerDestination = Number(getApiCacheSetting('attractions', 'limitPerDestination')) || 20;
      const shortlistPromptItemsPerDestination =
        Number(getApiCacheSetting('attractions', 'shortlistPromptItemsPerDestination')) || 8;
      const shortlist = await getAttractionPromptBlockForDestinations({
        userId: input.userId,
        destinations: promptRequest.d,
        dateKey: normalized.sd,
        budgetMin: input.budgetMin,
        budgetMax: input.budgetMax,
        limitPerDestination,
        promptItemsPerDestination: shortlistPromptItemsPerDestination,
        allowDiscovery: allowAttractionDiscovery,
      });
      attractionShortlistBlock = shortlist.promptBlock;
      shortlistByDestination = shortlist.shortlistByDestination ?? {};
      const totalItems = Object.values(shortlist.shortlistByDestination).reduce((sum, list) => sum + list.length, 0);
      logInfo(
        `[itinerary] attractions shortlist loaded destinations=${Object.keys(shortlist.shortlistByDestination).length} items=${totalItems}`
      );
    } catch (err) {
      logError('[itinerary] attractions shortlist load failed; continuing without shortlist', err);
      attractionShortlistBlock = 'none';
      shortlistByDestination = {};
    }
  }
  const mergedAttractionBlocks = [mustSeePromptBlock, attractionShortlistBlock]
    .map((block) => normalizeText(block))
    .filter((block) => block && block !== 'none');
  const attractionContextBlock = mergedAttractionBlocks.length ? mergedAttractionBlocks.join('\n') : 'none';

  const routeRaw = await runJsonStage<unknown>({
    apiKey: input.apiKey,
    caller: OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE,
    template: bundle.p1,
    replacements: {
      REQ_JSON: JSON.stringify(promptRequest),
      NORM_JSON: JSON.stringify(normalized),
      STEP1_SCHEMA_MIN: bundle.step1Schema,
      ATTRACTION_SHORTLIST: attractionContextBlock,
    },
    maxTokens: 1200,
    fallbackValue: {},
    acc: tokenAcc,
  });
  const route = sanitizeRoute(routeRaw, normalized, promptRequest);
  logInfo(
    `[itinerary] stage done caller=${OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE} bases=${route.b.length} transfers=${route.x.length} hasRentalCar=${route.rc ? 'yes' : 'no'}`
  );

  const dayRaw = await runJsonStage<unknown>({
    apiKey: input.apiKey,
    caller: OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS,
    template: bundle.p2,
    replacements: {
      NORM_JSON: JSON.stringify(normalized),
      STEP1_JSON: JSON.stringify(route),
      STEP2_SCHEMA_MIN: bundle.step2Schema,
      ATTRACTION_SHORTLIST: attractionContextBlock,
    },
    maxTokens: Math.max(1100, Math.min(3500, Math.round(promptRequest.dur ?? 1) * 280)),
    fallbackValue: {},
    acc: tokenAcc,
  });
  const dayItinerary = sanitizeItinerary(dayRaw, route, normalized, promptRequest);
  logInfo(
    `[itinerary] stage done caller=${OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS} days=${dayItinerary.dy.length} transfers=${dayItinerary.x.length}`
  );

  const validatedRaw = await runJsonStage<unknown>({
    apiKey: input.apiKey,
    caller: OPENAI_CALLER_ITINERARY_PLAN_P3_VALIDATE,
    template: bundle.p3,
    replacements: {
      STEP2_JSON: JSON.stringify(dayItinerary),
      STEP2_SCHEMA_MIN: bundle.step2Schema,
    },
    maxTokens: 1400,
    fallbackValue: dayItinerary,
    acc: tokenAcc,
  });
  const itinerary = enforceShortlistGrounding(
    sanitizeItinerary(validatedRaw, route, normalized, promptRequest),
    promptRequest,
    shortlistByDestination
  );
  const blockedActivityDates = getActivityBlockedDates(itinerary, normalized);
  const filteredItinerary: PromptItinerary = {
    ...itinerary,
    dy: itinerary.dy.map((day) =>
      blockedActivityDates.has(day.dt)
        ? {
            ...day,
            it: [],
            ln: Array.from(new Set([...(Array.isArray(day.ln) ? day.ln : []), 'Travel day: no activities scheduled'])).slice(0, 2),
          }
        : day
    ),
  };
  logInfo(
    `[itinerary] stage done caller=${OPENAI_CALLER_ITINERARY_PLAN_P3_VALIDATE} days=${filteredItinerary.dy.length} transfers=${filteredItinerary.x.length} activityBlockedDays=${blockedActivityDates.size}`
  );
  const profile = mapProfile(normalized);
  const itineraryWithMustSee = enforceMustSeeAttractions(filteredItinerary, promptRequest.ms ?? []);

  const render = await runRenderStage({
    apiKey: input.apiKey,
    template: bundle.p4,
    replacements: {
      FINAL_JSON: JSON.stringify(itineraryWithMustSee),
    },
    acc: tokenAcc,
  });
  const renderedMarkdown = String(render ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  logInfo(`[itinerary] stage response caller=${OPENAI_CALLER_ITINERARY_PLAN_P4_RENDER} chars=${renderedMarkdown.length}`);
  const fallbackMarkdown = renderMarkdownFallback(itineraryWithMustSee, profile);
  const planMarkdown = hasVisibleText(renderedMarkdown) ? renderedMarkdown : fallbackMarkdown;
  const details = buildDetails(itineraryWithMustSee);
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
  const items = mapItems(itineraryWithMustSee, profile.weights);
  logInfo(
    `[itinerary] prompt-plan done details=${safeDetails.length} transfers=${items.transfers.length} lodgings=${items.lodgings.length} activities=${items.activities.length} carRentals=${items.carRentals.length} usedRenderFallback=${planMarkdown === fallbackMarkdown ? 'yes' : 'no'}`
  );

  return {
    promptRequest,
    normalized,
    route,
    itinerary: itineraryWithMustSee,
    planMarkdown,
    details: safeDetails,
    generatedItems: items,
    profile,
    tokenUsage: {
      promptTokens: tokenAcc.promptTokens,
      completionTokens: tokenAcc.completionTokens,
      totalTokens: tokenAcc.promptTokens + tokenAcc.completionTokens,
    },
  };
};
