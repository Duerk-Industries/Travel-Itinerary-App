import { getApiCacheSetting } from '../config/apiLimits';
import { getAttractionDurationMetadata, upsertAttractionDurationMetadata } from '../db';
import type { ActivityType, AttractionDurationMetadata } from '../types';

export const ACTIVITY_TYPE_DURATION_MINUTES: Record<ActivityType, number> = {
  'Sights & Landmarks': 45,
  'Ticketed Attraction': 150,
  Tour: 180,
  'Outdoor Activity': 90,
  Hike: 150,
  'Day Trip': 480,
  'Food & Drink': 90,
  Shopping: 90,
  Nightlife: 120,
  'Concert/Show': 150,
  Event: 120,
  'Fun & Games': 90,
  Class: 120,
  Reservation: 90,
  'Spa/Wellness': 120,
  'Open Access': 60,
};

const NAME_DURATION_OVERRIDES: Array<{ pattern: RegExp; minutes: number }> = [
  { pattern: /museum/i, minutes: 150 },
  { pattern: /(gallery|aquarium|zoo)/i, minutes: 120 },
  { pattern: /\b(tower|observation deck|lookout)\b/i, minutes: 45 },
  { pattern: /\b(park|square|garden|plaza)\b/i, minutes: 90 },
  { pattern: /\b(tour|excursion)\b/i, minutes: 180 },
];

const PRE_ORDER_NAME_PATTERNS: RegExp[] = [
  /museum/i,
  /\b(tower|observation deck|skydeck|lookout)\b/i,
  /\b(theater|theatre|show|concert)\b/i,
  /\baquarium|zoo\b/i,
  /\bpalace|castle|colosseum\b/i,
];

const PRE_ORDER_ACTIVITY_TYPES: ActivityType[] = ['Ticketed Attraction', 'Tour', 'Concert/Show', 'Event'];

export const estimateAttractionDurationMinutes = (name: string, activityType: ActivityType): number => {
  const override = NAME_DURATION_OVERRIDES.find((entry) => entry.pattern.test(name));
  if (override) return override.minutes;
  return ACTIVITY_TYPE_DURATION_MINUTES[activityType] ?? 90;
};

export const inferRequiresPreOrderTickets = (name: string, activityType: ActivityType): boolean => {
  if (PRE_ORDER_NAME_PATTERNS.some((pattern) => pattern.test(name))) return true;
  return PRE_ORDER_ACTIVITY_TYPES.includes(activityType);
};

const isStale = (metadata: AttractionDurationMetadata | null, refreshDays: number): boolean => {
  if (!metadata) return true;
  const ts = new Date(metadata.updatedAt).getTime();
  if (!Number.isFinite(ts)) return true;
  const thresholdMs = Math.max(1, refreshDays) * 24 * 60 * 60 * 1000;
  return Date.now() - ts > thresholdMs;
};

export const getOrCreateAttractionDurationMetadata = async (params: {
  userId: string;
  destinationKey: string;
  destinationDisplayName: string;
  name: string;
  activityType: ActivityType;
}): Promise<AttractionDurationMetadata> => {
  const refreshDays = Number(getApiCacheSetting('attractions', 'durationMetadataRefreshDays')) || 60;
  const existing = await getAttractionDurationMetadata(params.userId, params.destinationKey, params.name);
  if (!isStale(existing, refreshDays)) return existing as AttractionDurationMetadata;

  const estimatedDurationMinutes = estimateAttractionDurationMinutes(params.name, params.activityType);
  const requiresPreOrderTickets = inferRequiresPreOrderTickets(params.name, params.activityType);
  const entry: AttractionDurationMetadata = {
    id: '',
    destinationKey: params.destinationKey,
    destinationDisplayName: params.destinationDisplayName,
    name: params.name,
    activityType: params.activityType,
    estimatedDurationMinutes,
    durationSource: 'heuristic',
    requiresPreOrderTickets,
    preOrderNotes: null,
    updatedAt: new Date().toISOString(),
  };
  return upsertAttractionDurationMetadata(entry);
};

export const getAttractionDurationMetadataBatch = async (params: {
  userId: string;
  destinationKey: string;
  destinationDisplayName: string;
  entries: Array<{ name: string; activityType: ActivityType }>;
}): Promise<Map<string, AttractionDurationMetadata>> => {
  const result = new Map<string, AttractionDurationMetadata>();
  const seen = new Set<string>();
  for (const entry of params.entries) {
    const key = entry.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const metadata = await getOrCreateAttractionDurationMetadata({
      userId: params.userId,
      destinationKey: params.destinationKey,
      destinationDisplayName: params.destinationDisplayName,
      name: entry.name,
      activityType: entry.activityType,
    });
    result.set(key, metadata);
  }
  return result;
};

export const formatMinutesAsDuration = (minutes: number): string => {
  const safeMinutes = Math.max(1, Math.round(Number(minutes) || 0));
  if (safeMinutes % 60 === 0) return `${safeMinutes / 60}h`;
  if (safeMinutes < 60) return `${safeMinutes}m`;
  const hours = safeMinutes / 60;
  return `${Math.round(hours * 10) / 10}h`;
};
