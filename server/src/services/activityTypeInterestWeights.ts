import fs from 'fs';
import path from 'path';

type InterestWeightKey =
  | 'outdoors'
  | 'adventure'
  | 'culture'
  | 'food'
  | 'nightlife'
  | 'relax'
  | 'photography'
  | 'authentic_local'
  | 'iconic_landmarks';

export type InterestWeights = Record<InterestWeightKey, number>;

const CSV_PATH = path.resolve(__dirname, '../../data/activity_type_interest_weights.csv');
const KEYS: InterestWeightKey[] = [
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

let cachedByActivityType: Record<string, InterestWeights> | null = null;

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
};

const parseCsvLine = (line: string): string[] => {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let idx = 0; idx < line.length; idx += 1) {
    const char = line[idx];
    if (char === '"') {
      const next = line[idx + 1];
      if (inQuotes && next === '"') {
        current += '"';
        idx += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts;
};

const parseCsv = (raw: string): Record<string, InterestWeights> => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return {};

  const header = parseCsvLine(lines[0]).map((item) => item.toLowerCase());
  const indexByKey = new Map<string, number>();
  header.forEach((key, index) => indexByKey.set(key, index));

  const result: Record<string, InterestWeights> = {};
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const activityType = cols[indexByKey.get('activity_type') ?? -1];
    if (!activityType) continue;
    result[activityType] = {
      outdoors: toNumber(cols[indexByKey.get('outdoors') ?? -1]),
      adventure: toNumber(cols[indexByKey.get('adventure') ?? -1]),
      culture: toNumber(cols[indexByKey.get('culture') ?? -1]),
      food: toNumber(cols[indexByKey.get('food') ?? -1]),
      nightlife: toNumber(cols[indexByKey.get('nightlife') ?? -1]),
      relax: toNumber(cols[indexByKey.get('relax') ?? -1]),
      photography: toNumber(cols[indexByKey.get('photography') ?? -1]),
      authentic_local: toNumber(cols[indexByKey.get('authentic_local') ?? -1]),
      iconic_landmarks: toNumber(cols[indexByKey.get('iconic_landmarks') ?? -1]),
    };
  }

  return result;
};

const getWeightsByActivityType = (): Record<string, InterestWeights> => {
  if (cachedByActivityType) return cachedByActivityType;
  try {
    const raw = fs.readFileSync(CSV_PATH, 'utf8');
    cachedByActivityType = parseCsv(raw);
  } catch {
    cachedByActivityType = {};
  }
  return cachedByActivityType;
};

export const scoreActivityTypeByPreferences = (
  activityType: string,
  preferences: InterestWeights
): number => {
  const byType = getWeightsByActivityType();
  const typeWeights = byType[activityType];
  if (!typeWeights) return 0;
  return KEYS.reduce((score, key) => score + (typeWeights[key] || 0) * (preferences[key] || 0), 0);
};

export const __resetActivityTypeWeightsCacheForTests = (): void => {
  cachedByActivityType = null;
};
