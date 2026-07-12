import type { AttractionCatalogEntry, InterestTag } from '../types';
import type { InterestWeights } from './activityTypeInterestWeights';
import type { LatLon } from '../utils/geo';
import { haversineKm } from '../utils/geo';

export type RankedAttraction = { entry: AttractionCatalogEntry; score: number; interestMatch: number; mustSee: number; geoProximity: number };
export type TravelerInterest = { travelerId: string; interests: string[] };

const tagToWeight: Record<InterestTag, keyof InterestWeights> = {
  outdoors: 'outdoors', culture: 'culture', food: 'food', nightlife: 'nightlife', relax: 'relax',
  shopping: 'authentic_local', 'day trips': 'adventure', events: 'nightlife', classes: 'authentic_local',
};
const normalize = (value: string): string => {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return ({ museums: 'culture', cultural: 'culture', foodie: 'food', hiking: 'outdoors', outdoorsy: 'outdoors', relaxing: 'relax' } as Record<string, string>)[normalized] ?? normalized;
};
const entryInterests = (entry: AttractionCatalogEntry): Set<string> => new Set(entry.interestTags.flatMap((tag) => [normalize(tag), normalize(tagToWeight[tag])]));

export const rankAttractionsForGroup = (params: {
  entries: AttractionCatalogEntry[];
  weights: InterestWeights;
  mustSeeNames?: string[];
  anchor?: LatLon | null;
}): RankedAttraction[] => {
  const mustSees = new Set((params.mustSeeNames ?? []).map(normalize));
  return params.entries.map((entry) => {
    const keys = entry.interestTags.map((tag) => tagToWeight[tag]);
    const interestMatch = keys.length ? Math.min(1, Math.max(...keys.map((key) => params.weights[key] / 100))) : 0;
    const mustSee = mustSees.has(normalize(entry.name)) ? 1 : 0;
    const geoProximity = params.anchor && entry.lat != null && entry.lon != null
      ? 1 / (1 + haversineKm(params.anchor, { lat: entry.lat, lon: entry.lon }) / 2)
      : 0.5;
    return { entry, interestMatch, mustSee, geoProximity, score: interestMatch * 0.5 + mustSee * 0.3 + geoProximity * 0.2 };
  }).sort((a, b) => b.score - a.score || a.entry.rank - b.entry.rank || a.entry.name.localeCompare(b.entry.name));
};

export const selectWithFairnessFloor = (params: {
  ranked: RankedAttraction[];
  travelers: TravelerInterest[];
  limit: number;
}): RankedAttraction[] => {
  const limit = Math.max(0, Math.round(params.limit));
  const selected: RankedAttraction[] = [];
  const used = new Set<string>();
  const travelers = [...params.travelers].sort((a, b) => a.travelerId.localeCompare(b.travelerId));
  for (const traveler of travelers) {
    if (selected.length >= limit) break;
    const interests = new Set(traveler.interests.map(normalize));
    const match = params.ranked.find(({ entry }) => !used.has(entry.id) && Array.from(entryInterests(entry)).some((interest) => interests.has(interest)));
    if (match) { selected.push(match); used.add(match.entry.id); }
  }
  for (const candidate of params.ranked) {
    if (selected.length >= limit) break;
    if (!used.has(candidate.entry.id)) { selected.push(candidate); used.add(candidate.entry.id); }
  }
  return selected;
};
