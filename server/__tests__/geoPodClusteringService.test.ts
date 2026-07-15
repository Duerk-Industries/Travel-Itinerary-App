import { clusterAttractionsIntoPods, flattenPods } from '../src/services/geoPodClusteringService';
import type { AttractionCatalogEntry, InterestTag } from '../src/types';

const entry = (name: string, rank: number, lat?: number, lon?: number, tags: InterestTag[] = ['culture']): AttractionCatalogEntry => ({
  id: name.toLowerCase().replace(/\s+/g, '-'), destinationKey: 'new york city', destinationDisplayName: 'New York City',
  name, rank, activityType: 'Open Access', interestTags: tags, lat: lat ?? null, lon: lon ?? null,
  updatedAt: '2026-07-12T00:00:00.000Z',
});

describe('Phase 2 geographic pods', () => {
  test('keeps DUMBO and Upper West Side attractions in separate three-item pods', () => {
    const entries = Array.from({ length: 10 }, (_, index) => entry(`DUMBO ${index + 1}`, index + 1, 40.7033 + index * 0.0002, -73.988 + index * 0.0002))
      .concat(Array.from({ length: 10 }, (_, index) => entry(`Upper West Side ${index + 1}`, index + 11, 40.787 + index * 0.0002, -73.975 + index * 0.0002)));
    const pods = clusterAttractionsIntoPods({ destination: 'New York City', entries, radiusKm: 2, maxItemsPerPod: 3 });
    expect(pods.every((pod) => pod.items.length <= 3)).toBe(true);
    expect(pods.every((pod) => !(
      pod.items.some((item) => item.name.startsWith('DUMBO')) && pod.items.some((item) => item.name.startsWith('Upper West Side'))
    ))).toBe(true);
    expect(new Set(flattenPods(pods).map((item) => item.id)).size).toBe(20);
  });

  test('retains ungeocoded attractions in locality-only pods', () => {
    const entries = [entry('Located Museum', 1, 40.71, -74), entry('Unknown Coordinates A', 2), entry('Unknown Coordinates B', 3)];
    const pods = clusterAttractionsIntoPods({ destination: 'New York City', entries });
    const fallback = pods.find((pod) => pod.kind === 'locality-only');
    expect(fallback?.distanceGuaranteed).toBe(false);
    expect(fallback?.items.map((item) => item.name)).toEqual(['Unknown Coordinates A', 'Unknown Coordinates B']);
    expect(flattenPods(pods)).toHaveLength(3);
  });

  test('is stable when input order changes', () => {
    const entries = [entry('A', 1, 40.7, -74), entry('B', 2, 40.701, -74), entry('C', 3), entry('D', 4, 40.8, -73.9)];
    const summarize = (values: AttractionCatalogEntry[]) => clusterAttractionsIntoPods({ destination: 'NYC', entries: values }).map((pod) => pod.items.map((item) => item.name));
    expect(summarize([...entries].reverse())).toEqual(summarize(entries));
  });
});

