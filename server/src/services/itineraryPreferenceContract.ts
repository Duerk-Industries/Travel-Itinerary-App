import type { InterestWeights } from './activityTypeInterestWeights';

export type PreferenceSource = 'account' | 'trip' | 'traveler' | 'default' | 'inferred';
export type PaceCode = 'R' | 'B' | 'F';
export type ComfortCode = 'B' | 'M' | 'L';
export type MobilityCode = 'L' | 'M' | 'H';
export type CarCode = 'P' | 'D' | 'R';
export type InteractionStyleCode = 'self_guided' | 'mixed' | 'guided';

export const INTEREST_KEYS: Array<keyof InterestWeights> = [
  'outdoors', 'adventure', 'culture', 'food', 'nightlife', 'relax', 'photography',
  'authentic_local', 'iconic_landmarks',
];

export type PreferenceValue<T> = { value: T; source: PreferenceSource; reason: string };

/**
 * A hard-exclusion request derived from traveler traits (e.g. "no museums", "avoid nightlife").
 * `tag` is normalized to a known interest key when recognized, otherwise the free-form,
 * de-identified label itself (never a name/address/medical/free-text note — see
 * `normalizeExclusionLabel`). Consumed by `candidateHardFilterService` to reject candidates
 * before scoring, per plan §2A ("hard filters first ... do not hide a hard rejection as a low
 * score").
 */
export type PreferenceExclusion = { tag: string; source: 'traveler'; reason: string };

export type NormalizedPreferenceContract = {
  version: 'preference-contract-v1';
  pace: PreferenceValue<PaceCode>;
  comfort: PreferenceValue<ComfortCode>;
  mobility: PreferenceValue<MobilityCode>;
  car: PreferenceValue<CarCode>;
  interactionStyle: PreferenceValue<InteractionStyleCode>;
  weights: InterestWeights;
  travelerInterests: Array<keyof InterestWeights>;
  /** Hard-exclusion tags parsed from traveler traits; see `PreferenceExclusion`. */
  exclusions: PreferenceExclusion[];
  conflicts: string[];
  assumptions: string[];
  privacy: 'private-trip';
  sharedCacheDimensions: {
    pace: PaceCode;
    comfort: ComfortCode;
    mobility: MobilityCode;
    car: CarCode;
    interactionStyle: InteractionStyleCode;
    weightBucket: string;
  };
};

export type PreferenceContractInput = {
  trip: { p: PaceCode; c: ComfortCode; mob: MobilityCode; car: CarCode; w: InterestWeights; is: InteractionStyleCode };
  account: { po?: PaceCode; mob?: MobilityCode; interests?: string[]; earlyBird?: boolean; nightOwl?: boolean };
  travelers: Array<{ traits: string[] }>;
};

const TRAIT_INTERESTS: Record<string, keyof InterestWeights> = {
  adventurous: 'adventure', adventure: 'adventure', hiking: 'outdoors', outdoorsy: 'outdoors',
  outdoors: 'outdoors', beaches: 'relax', relaxing: 'relax', relax: 'relax', cultural: 'culture',
  culture: 'culture', museums: 'culture', foodie: 'food', food: 'food', cafes: 'food',
  nightlife: 'nightlife', photography: 'photography', 'authentic/local': 'authentic_local',
  'authentic local': 'authentic_local', 'iconic landmarks': 'iconic_landmarks',
};

const TRAIT_MOBILITY: Record<string, MobilityCode> = {
  'low mobility': 'L', 'limited mobility': 'L', 'medium mobility': 'M', 'high mobility': 'H',
};

const mobilityRank: Record<MobilityCode, number> = { L: 0, M: 1, H: 2 };
const normalizeLabel = (value: unknown): string => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// Recognized negation phrasing for traveler-stated exclusions, e.g. "no museums", "avoid
// nightlife", "skip shopping". Only a fixed vocabulary of recognized topics is ever surfaced as
// an exclusion tag; unrecognized remainders are dropped rather than passed through as free text,
// keeping this consistent with the "no private free-text" rule already applied to interests.
const EXCLUSION_PATTERN = /^(?:no|avoid|skip|dislike|hate)\s+(.+)$/;
const EXCLUSION_TOPICS: Record<string, keyof InterestWeights> = {
  ...TRAIT_INTERESTS,
  museum: 'culture', museums: 'culture', crowds: 'nightlife', nightlife: 'nightlife',
  shopping: 'authentic_local', hiking: 'outdoors', walking: 'outdoors',
};

/** Parses a normalized traveler trait label into a recognized exclusion topic, if any. */
const parseExclusionLabel = (label: string): keyof InterestWeights | null => {
  const match = EXCLUSION_PATTERN.exec(label);
  if (!match) return null;
  const remainder = match[1].trim();
  return EXCLUSION_TOPICS[remainder] ?? null;
};

export const normalizeInterestWeights = (raw: Partial<InterestWeights>): InterestWeights => {
  const safe = Object.fromEntries(INTEREST_KEYS.map((key) => [key, Math.max(0, Number(raw[key]) || 0)])) as InterestWeights;
  const sum = INTEREST_KEYS.reduce((total, key) => total + safe[key], 0);
  if (sum <= 0) return { outdoors: 15, adventure: 10, culture: 15, food: 15, nightlife: 10, relax: 10, photography: 10, authentic_local: 8, iconic_landmarks: 7 };
  const scaled = Object.fromEntries(INTEREST_KEYS.map((key) => [key, Math.round((safe[key] / sum) * 100)])) as InterestWeights;
  const delta = 100 - INTEREST_KEYS.reduce((total, key) => total + scaled[key], 0);
  const largest = [...INTEREST_KEYS].sort((a, b) => scaled[b] - scaled[a] || a.localeCompare(b))[0];
  scaled[largest] += delta;
  return scaled;
};

const weightBucket = (weights: InterestWeights): string => INTEREST_KEYS
  .map((key) => `${key}:${Math.round(weights[key] / 10) * 10}`)
  .join('|');

export const buildItineraryPreferenceContract = (input: PreferenceContractInput): NormalizedPreferenceContract => {
  const conflicts: string[] = [];
  const assumptions: string[] = [];
  const accountLabels = (input.account.interests ?? []).map(normalizeLabel).filter(Boolean);
  const travelerLabels = input.travelers
    .flatMap((traveler) => traveler.traits ?? [])
    .map(normalizeLabel)
    .filter(Boolean)
    .sort();
  const interests = Array.from(new Set([...accountLabels, ...travelerLabels].map((label) => TRAIT_INTERESTS[label]).filter(Boolean))) as Array<keyof InterestWeights>;

  // Deterministic and order-independent: dedupe by tag over the sorted label set, exactly like
  // `travelerInterests` above, so reordering travelers cannot change which exclusions apply.
  const exclusionTags = new Map<keyof InterestWeights, string>();
  for (const label of travelerLabels) {
    const tag = parseExclusionLabel(label);
    if (tag && !exclusionTags.has(tag)) exclusionTags.set(tag, label);
  }
  const exclusions: PreferenceExclusion[] = Array.from(exclusionTags.entries())
    .map(([tag, label]) => ({ tag, source: 'traveler' as const, reason: `Recognized traveler exclusion: ${label}` }))
    .sort((a, b) => a.tag.localeCompare(b.tag));

  const mobilityCandidates: Array<{ value: MobilityCode; source: PreferenceSource; reason: string }> = [
    { value: input.trip.mob, source: 'trip', reason: 'Trip mobility preference' },
  ];
  if (input.account.mob) mobilityCandidates.push({ value: input.account.mob, source: 'account', reason: 'Account mobility override' });
  for (const label of travelerLabels) {
    const value = TRAIT_MOBILITY[label];
    if (value) mobilityCandidates.push({ value, source: 'traveler', reason: `Recognized traveler constraint: ${label}` });
  }
  mobilityCandidates.sort((a, b) => mobilityRank[a.value] - mobilityRank[b.value] || a.source.localeCompare(b.source));
  const mobility = mobilityCandidates[0];
  if (new Set(mobilityCandidates.map((candidate) => candidate.value)).size > 1) {
    conflicts.push(`Mobility preferences conflict; using the most restrictive value (${mobility.value}).`);
  }

  if (input.account.earlyBird && input.account.nightOwl) conflicts.push('Account is marked both early bird and night owl; keep daily timing flexible.');

  const weighted = { ...input.trip.w };
  for (const interest of interests) weighted[interest] = (Number(weighted[interest]) || 0) + 5;
  let weights = normalizeInterestWeights(weighted);
  for (const interest of interests) {
    if (weights[interest] > 0) continue;
    const donor = [...INTEREST_KEYS].filter((key) => key !== interest).sort((a, b) => weights[b] - weights[a])[0];
    if (donor && weights[donor] > 1) { weights[donor] -= 1; weights[interest] = 1; }
  }

  const pace: PreferenceValue<PaceCode> = input.account.po
    ? { value: input.account.po, source: 'account', reason: 'Explicit account pace override' }
    : { value: input.trip.p, source: 'trip', reason: 'Trip pace preference' };
  if (input.account.po && input.account.po !== input.trip.p) conflicts.push('Account pace override differs from the trip pace.');

  const contract: NormalizedPreferenceContract = {
    version: 'preference-contract-v1', pace,
    comfort: { value: input.trip.c, source: 'trip', reason: 'Trip comfort preference' },
    mobility, car: { value: input.trip.car, source: 'trip', reason: 'Trip transport preference' },
    interactionStyle: { value: input.trip.is, source: 'trip', reason: 'Trip interaction preference' },
    weights, travelerInterests: interests.sort(), exclusions, conflicts: conflicts.sort(), assumptions: assumptions.sort(),
    privacy: 'private-trip',
    sharedCacheDimensions: { pace: pace.value, comfort: input.trip.c, mobility: mobility.value, car: input.trip.car, interactionStyle: input.trip.is, weightBucket: weightBucket(weights) },
  };
  return contract;
};

