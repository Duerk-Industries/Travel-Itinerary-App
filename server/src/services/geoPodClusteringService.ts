import type { AttractionCatalogEntry } from '../types';
import { haversineKm, type LatLon } from '../utils/geo';

export type AttractionPod = {
  id: string;
  destination: string;
  kind: 'geographic' | 'locality-only';
  items: AttractionCatalogEntry[];
  centroid: LatLon | null;
  radiusKm: number | null;
  distanceGuaranteed: boolean;
};

const stableEntries = (entries: AttractionCatalogEntry[]): AttractionCatalogEntry[] => [...entries].sort((a, b) =>
  a.rank - b.rank || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
const hasCoordinates = (entry: AttractionCatalogEntry): boolean =>
  entry.lat != null && entry.lon != null && Number.isFinite(Number(entry.lat)) && Number.isFinite(Number(entry.lon));
const point = (entry: AttractionCatalogEntry): LatLon => ({ lat: Number(entry.lat), lon: Number(entry.lon) });
const centroidOf = (entries: AttractionCatalogEntry[]): LatLon => ({
  lat: entries.reduce((sum, entry) => sum + Number(entry.lat), 0) / entries.length,
  lon: entries.reduce((sum, entry) => sum + Number(entry.lon), 0) / entries.length,
});

export const clusterAttractionsIntoPods = (params: {
  destination: string;
  entries: AttractionCatalogEntry[];
  radiusKm?: number;
  maxItemsPerPod?: number;
}): AttractionPod[] => {
  const radiusKm = Math.max(0.1, Number(params.radiusKm) || 2);
  const maxItems = Math.max(1, Math.min(10, Math.round(Number(params.maxItemsPerPod) || 3)));
  const located = stableEntries(params.entries.filter(hasCoordinates));
  const unlocated = stableEntries(params.entries.filter((entry) => !hasCoordinates(entry)));
  const remaining = new Map(located.map((entry) => [entry.id, entry]));
  const pods: AttractionPod[] = [];

  while (remaining.size) {
    const seed = stableEntries(Array.from(remaining.values()))[0];
    remaining.delete(seed.id);
    const candidates = Array.from(remaining.values())
      .map((entry) => ({ entry, distance: haversineKm(point(seed), point(entry)) }))
      .filter(({ distance }) => distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance || a.entry.rank - b.entry.rank || a.entry.name.localeCompare(b.entry.name));
    const items = [seed];
    for (const { entry } of candidates) {
      if (items.length >= maxItems) break;
      const proposed = [...items, entry];
      const proposedCentroid = centroidOf(proposed);
      if (proposed.every((item) => haversineKm(proposedCentroid, point(item)) <= radiusKm)) items.push(entry);
    }
    items.slice(1).forEach((entry) => remaining.delete(entry.id));
    const centroid = centroidOf(items);
    const actualRadius = Math.max(...items.map((entry) => haversineKm(centroid, point(entry))), 0);
    pods.push({
      id: `pod-${pods.length + 1}`, destination: params.destination, kind: 'geographic', items,
      centroid, radiusKm: Math.round(actualRadius * 100) / 100, distanceGuaranteed: true,
    });
  }

  for (let index = 0; index < unlocated.length; index += maxItems) {
    pods.push({
      id: `pod-${pods.length + 1}-locality`, destination: params.destination, kind: 'locality-only',
      items: unlocated.slice(index, index + maxItems), centroid: null, radiusKm: null, distanceGuaranteed: false,
    });
  }
  return pods;
};

export const flattenPods = (pods: AttractionPod[]): AttractionCatalogEntry[] => pods.flatMap((pod) => pod.items);
