type PromptPaceCode = 'R' | 'B' | 'F';
type PromptComfortCode = 'B' | 'M' | 'L';
type PromptMobilityCode = 'L' | 'M' | 'H';
type PromptCarCode = 'P' | 'D' | 'R';
type PromptTripModeCode = 'E' | 'B' | 'S';

type PromptWeights = { o: number; c: number; f: number; n: number; r: number };

export type PromptTripTraitsPayload = {
  p: PromptPaceCode;
  c: PromptComfortCode;
  mob: PromptMobilityCode;
  car: PromptCarCode;
  w: PromptWeights;
  tm: PromptTripModeCode;
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

export const PROMPT_TRIP_MODE_OPTIONS: Array<{ value: PromptTripModeCode; label: string }> = [
  { value: 'E', label: 'Explorer' },
  { value: 'B', label: 'Balanced' },
  { value: 'S', label: 'Slow' },
];

export const PROMPT_INTEREST_OPTIONS: string[] = [
  'Outdoors',
  'Culture',
  'Food',
  'Nightlife',
  'Relax',
  'Photography',
  'Family Friendly',
  'Museums',
  'Road Trips',
];

export const DEFAULT_PROMPT_TRAITS: PromptTraitsPayload = {
  tt: {
    p: 'B',
    c: 'M',
    mob: 'M',
    car: 'P',
    w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
    tm: 'B',
  },
  ut: {
    i: [],
    eb: false,
    no: false,
  },
};

const normalizeWeights = (weights: PromptWeights): PromptWeights => {
  const safe: PromptWeights = {
    o: Math.max(0, Math.round(Number(weights.o) || 0)),
    c: Math.max(0, Math.round(Number(weights.c) || 0)),
    f: Math.max(0, Math.round(Number(weights.f) || 0)),
    n: Math.max(0, Math.round(Number(weights.n) || 0)),
    r: Math.max(0, Math.round(Number(weights.r) || 0)),
  };
  const sum = safe.o + safe.c + safe.f + safe.n + safe.r;
  if (sum === 100) return safe;
  if (sum <= 0) return { ...DEFAULT_PROMPT_TRAITS.tt.w };

  const scaled: PromptWeights = {
    o: Math.round((safe.o / sum) * 100),
    c: Math.round((safe.c / sum) * 100),
    f: Math.round((safe.f / sum) * 100),
    n: Math.round((safe.n / sum) * 100),
    r: Math.round((safe.r / sum) * 100),
  };
  const total = scaled.o + scaled.c + scaled.f + scaled.n + scaled.r;
  if (total === 100) return scaled;

  const keys: Array<keyof PromptWeights> = ['o', 'c', 'f', 'n', 'r'];
  const largest = keys.sort((a, b) => scaled[b] - scaled[a])[0];
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
      w: normalizeWeights({
        o: Number(weightsRaw?.o) || DEFAULT_PROMPT_TRAITS.tt.w.o,
        c: Number(weightsRaw?.c) || DEFAULT_PROMPT_TRAITS.tt.w.c,
        f: Number(weightsRaw?.f) || DEFAULT_PROMPT_TRAITS.tt.w.f,
        n: Number(weightsRaw?.n) || DEFAULT_PROMPT_TRAITS.tt.w.n,
        r: Number(weightsRaw?.r) || DEFAULT_PROMPT_TRAITS.tt.w.r,
      }),
      tm: (['E', 'B', 'S'] as const).includes((ttRaw as any).tm) ? (ttRaw as any).tm : DEFAULT_PROMPT_TRAITS.tt.tm,
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

