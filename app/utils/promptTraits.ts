export type PromptPaceCode = 'R' | 'B' | 'F';
export type PromptComfortCode = 'B' | 'M' | 'L';
export type PromptMobilityCode = 'L' | 'M' | 'H';
export type PromptCarCode = 'P' | 'D' | 'R';
export type PromptInteractionStyleCode = 'self_guided' | 'mixed' | 'guided';

export type PromptInterestWeights = {
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

export type PromptTripTraitsPayload = {
  p: PromptPaceCode;
  c: PromptComfortCode;
  mob: PromptMobilityCode;
  car: PromptCarCode;
  w: PromptInterestWeights;
  is: PromptInteractionStyleCode;
};

export type PromptUserTraitsPayload = {
  po?: PromptPaceCode;
  mob?: PromptMobilityCode;
  i: string[];
  eb?: boolean;
  no?: boolean;
};

export type PromptTraitsPayload = {
  tt: PromptTripTraitsPayload;
  ut: PromptUserTraitsPayload;
};

type TraitLike = { id?: string; name: string; notes?: string | null };

export const PROMPT_PROFILE_TRAIT_NAME = '__PROMPT_PROFILE__';

export const PROMPT_PACE_OPTIONS: Array<{ value: PromptPaceCode; label: string }> = [
  { value: 'R', label: 'Relaxed' },
  { value: 'B', label: 'Balanced' },
  { value: 'F', label: 'Fast' },
];

export const PROMPT_COMFORT_OPTIONS: Array<{ value: PromptComfortCode; label: string }> = [
  { value: 'B', label: 'Budget' },
  { value: 'M', label: 'Midrange' },
  { value: 'L', label: 'Luxury' },
];

export const PROMPT_MOBILITY_OPTIONS: Array<{ value: PromptMobilityCode; label: string }> = [
  { value: 'L', label: 'Low' },
  { value: 'M', label: 'Medium' },
  { value: 'H', label: 'High' },
];

export const PROMPT_CAR_OPTIONS: Array<{ value: PromptCarCode; label: string }> = [
  { value: 'P', label: 'Public Transit Only' },
  { value: 'D', label: 'Day Trips by Car' },
  { value: 'R', label: 'Full Trip Rental' },
];

export const PROMPT_INTERACTION_STYLE_OPTIONS: Array<{ value: PromptInteractionStyleCode; label: string }> = [
  { value: 'self_guided', label: 'Self-Guided' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'guided', label: 'Guided' },
];

export const PROMPT_INTEREST_OPTIONS: string[] = [
  'Outdoors',
  'Adventure',
  'Culture',
  'Food',
  'Nightlife',
  'Relax',
  'Photography',
  'Authentic/Local',
  'Iconic Landmarks',
];

export const DEFAULT_PROMPT_TRAITS: PromptTraitsPayload = {
  tt: {
    p: 'B',
    c: 'M',
    mob: 'M',
    car: 'P',
    w: {
      outdoors: 15,
      adventure: 10,
      culture: 15,
      food: 15,
      nightlife: 10,
      relax: 10,
      photography: 10,
      authentic_local: 8,
      iconic_landmarks: 7,
    },
    is: 'mixed',
  },
  ut: {
    i: [],
    eb: false,
    no: false,
  },
};

const INTEREST_WEIGHT_KEYS: Array<keyof PromptInterestWeights> = [
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

const toLegacyWeight = (weights: Record<string, unknown>, key: 'o' | 'c' | 'f' | 'n' | 'r'): number =>
  Math.max(0, Math.round(Number(weights[key]) || 0));

const coerceWeights = (raw: unknown): PromptInterestWeights => {
  const source = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const hasModernKeys = INTEREST_WEIGHT_KEYS.some((key) => key in source);
  if (hasModernKeys) {
    return {
      outdoors: Number(source.outdoors) || 0,
      adventure: Number(source.adventure) || 0,
      culture: Number(source.culture) || 0,
      food: Number(source.food) || 0,
      nightlife: Number(source.nightlife) || 0,
      relax: Number(source.relax) || 0,
      photography: Number(source.photography) || 0,
      authentic_local: Number(source.authentic_local) || 0,
      iconic_landmarks: Number(source.iconic_landmarks) || 0,
    };
  }
  const legacy = {
    o: toLegacyWeight(source, 'o'),
    c: toLegacyWeight(source, 'c'),
    f: toLegacyWeight(source, 'f'),
    n: toLegacyWeight(source, 'n'),
    r: toLegacyWeight(source, 'r'),
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

const normalizeWeights = (weights: PromptInterestWeights): PromptInterestWeights => {
  const safe: PromptInterestWeights = {
    outdoors: Math.max(0, Math.round(Number(weights.outdoors) || 0)),
    adventure: Math.max(0, Math.round(Number(weights.adventure) || 0)),
    culture: Math.max(0, Math.round(Number(weights.culture) || 0)),
    food: Math.max(0, Math.round(Number(weights.food) || 0)),
    nightlife: Math.max(0, Math.round(Number(weights.nightlife) || 0)),
    relax: Math.max(0, Math.round(Number(weights.relax) || 0)),
    photography: Math.max(0, Math.round(Number(weights.photography) || 0)),
    authentic_local: Math.max(0, Math.round(Number(weights.authentic_local) || 0)),
    iconic_landmarks: Math.max(0, Math.round(Number(weights.iconic_landmarks) || 0)),
  };
  const sum = INTEREST_WEIGHT_KEYS.reduce((acc, key) => acc + safe[key], 0);
  if (sum === 100) return safe;
  if (sum <= 0) return { ...DEFAULT_PROMPT_TRAITS.tt.w };

  const scaled = INTEREST_WEIGHT_KEYS.reduce((acc, key) => {
    (acc as any)[key] = Math.round((safe[key] / sum) * 100);
    return acc;
  }, {} as PromptInterestWeights);
  const total = INTEREST_WEIGHT_KEYS.reduce((acc, key) => acc + scaled[key], 0);
  if (total === 100) return scaled;

  const largest = [...INTEREST_WEIGHT_KEYS].sort((a, b) => scaled[b] - scaled[a])[0];
  scaled[largest] += 100 - total;
  return scaled;
};

export const normalizePromptTraits = (input: Partial<PromptTraitsPayload> | null | undefined): PromptTraitsPayload => {
  const ttRaw = input?.tt ?? {};
  const utRaw = input?.ut ?? {};
  const weightsRaw = (ttRaw as any).w ?? DEFAULT_PROMPT_TRAITS.tt.w;
  return {
    tt: {
      p: (['R', 'B', 'F'] as const).includes((ttRaw as any).p) ? (ttRaw as any).p : DEFAULT_PROMPT_TRAITS.tt.p,
      c: (['B', 'M', 'L'] as const).includes((ttRaw as any).c) ? (ttRaw as any).c : DEFAULT_PROMPT_TRAITS.tt.c,
      mob: (['L', 'M', 'H'] as const).includes((ttRaw as any).mob)
        ? (ttRaw as any).mob
        : DEFAULT_PROMPT_TRAITS.tt.mob,
      car: (['P', 'D', 'R'] as const).includes((ttRaw as any).car)
        ? (ttRaw as any).car
        : DEFAULT_PROMPT_TRAITS.tt.car,
      w: normalizeWeights(coerceWeights(weightsRaw)),
      is: (['self_guided', 'mixed', 'guided'] as const).includes((ttRaw as any).is)
        ? (ttRaw as any).is
        : DEFAULT_PROMPT_TRAITS.tt.is,
    },
    ut: {
      po: (['R', 'B', 'F'] as const).includes((utRaw as any).po) ? (utRaw as any).po : undefined,
      mob: (['L', 'M', 'H'] as const).includes((utRaw as any).mob) ? (utRaw as any).mob : undefined,
      i: Array.isArray((utRaw as any).i)
        ? Array.from(
            new Set(
              (utRaw as any).i
                .map((value: unknown) => String(value ?? '').trim())
                .filter((value: string) => value.length > 0)
            )
          )
        : [],
      eb: Boolean((utRaw as any).eb),
      no: Boolean((utRaw as any).no),
    },
  };
};

export const serializePromptTraits = (profile: Partial<PromptTraitsPayload> | null | undefined): string =>
  JSON.stringify(normalizePromptTraits(profile));

export const parsePromptTraits = (value: string | null | undefined): PromptTraitsPayload | null => {
  if (!value || !value.trim()) return null;
  try {
    return normalizePromptTraits(JSON.parse(value));
  } catch {
    return null;
  }
};

export const extractPromptTraitsFromTraits = (traits: TraitLike[]): { profile: PromptTraitsPayload; traitId: string | null } => {
  const profileTrait = traits.find((trait) => trait.name === PROMPT_PROFILE_TRAIT_NAME);
  const parsed = parsePromptTraits(profileTrait?.notes ?? null);
  return { profile: parsed ?? { ...DEFAULT_PROMPT_TRAITS }, traitId: profileTrait?.id ?? null };
};
