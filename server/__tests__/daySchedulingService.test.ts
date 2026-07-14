import { scheduleDayItems, type DaySchedulingItem } from '../src/services/daySchedulingService';
import type { AttractionCatalogEntry, InterestTag } from '../src/types';

const entry = (name: string, rank: number, lat?: number, lon?: number, tags: InterestTag[] = ['culture']): AttractionCatalogEntry => ({
  id: name.toLowerCase().replace(/\s+/g, '-'), destinationKey: 'new york city', destinationDisplayName: 'New York City',
  name, rank, activityType: 'Open Access', interestTags: tags, lat: lat ?? null, lon: lon ?? null,
  updatedAt: '2026-07-12T00:00:00.000Z',
});

const makeLookup = (entries: AttractionCatalogEntry[]) => {
  const byName = new Map(entries.map((e) => [e.name.toLowerCase(), e]));
  return (name: string) => byName.get(name.toLowerCase()) ?? null;
};

// DUMBO cluster (Brooklyn) vs Upper West Side cluster (Manhattan) — same fixture
// geography used by geoPodClusteringService.test.ts's "20-attraction NYC pod
// separation" fixture, scaled down to a single day's worth of items and deliberately
// interleaved (D,U,D,U,D,U) to exercise the scheduler's pod-density seeding.
const dumbo = Array.from({ length: 3 }, (_, i) => entry(`DUMBO ${i + 1}`, i + 1, 40.7033 + i * 0.0004, -73.988 + i * 0.0004));
const uws = Array.from({ length: 3 }, (_, i) => entry(`UWS ${i + 1}`, i + 4, 40.787 + i * 0.0004, -73.975 + i * 0.0004));

const interleavedEntries = [dumbo[0], uws[0], dumbo[1], uws[1], dumbo[2], uws[2]];
const interleavedItems: DaySchedulingItem[] = interleavedEntries.map((e, i) => [
  i === 0 ? 'M' : i === interleavedEntries.length - 1 ? 'E' : 'D',
  'A',
  e.name,
]);

const podOf = (name: string): 'DUMBO' | 'UWS' => (name.startsWith('DUMBO') ? 'DUMBO' : 'UWS');

describe('Phase 2 day scheduling (within-day nearest-insertion + bounded 2-opt)', () => {
  test('does not interleave DUMBO and Upper West Side pods within the day', () => {
    const lookup = makeLookup([...dumbo, ...uws]);
    const result = scheduleDayItems('New York City', interleavedItems, lookup);
    expect(result.changed).toBe(true);

    const podSequence = result.items.map((item) => podOf(item[2]));
    // Count transitions between pods; a properly clustered day should have at most
    // one transition (all of one pod, then all of the other), never re-entering a
    // pod after leaving it.
    let transitions = 0;
    for (let i = 1; i < podSequence.length; i += 1) {
      if (podSequence[i] !== podSequence[i - 1]) transitions += 1;
    }
    expect(transitions).toBeLessThanOrEqual(1);

    // No item was dropped or fabricated -- same six names, just reordered.
    expect(new Set(result.items.map((item) => item[2]))).toEqual(new Set(interleavedItems.map((item) => item[2])));
  });

  test('is deterministic given the same input (no unstable sort / no randomness)', () => {
    const lookup = makeLookup([...dumbo, ...uws]);
    const first = scheduleDayItems('New York City', interleavedItems, lookup);
    const second = scheduleDayItems('New York City', interleavedItems, lookup);
    expect(second.items).toEqual(first.items);
  });

  test('does not needlessly rewrite a day that is already well-ordered (idempotence)', () => {
    // Already contiguous by pod and already nearest-neighbor ordered within each pod.
    const wellOrderedEntries = [...dumbo, ...uws];
    const wellOrderedItems: DaySchedulingItem[] = wellOrderedEntries.map((e, i) => [
      i === 0 ? 'M' : i === wellOrderedEntries.length - 1 ? 'E' : 'D',
      'A',
      e.name,
    ]);
    const lookup = makeLookup(wellOrderedEntries);
    const result = scheduleDayItems('New York City', wellOrderedItems, lookup);
    expect(result.changed).toBe(false);
    expect(result.items).toEqual(wellOrderedItems);
  });

  test('retains distance-unknown (ungeocoded) items after the geo-grounded ones, never dropping them', () => {
    const unknown = entry('Mystery Spot', 99, undefined, undefined);
    const items: DaySchedulingItem[] = [
      ['M', 'A', unknown.name],
      ['D', 'A', uws[0].name],
      ['D', 'A', dumbo[0].name],
      ['E', 'A', uws[1].name],
    ];
    const lookup = makeLookup([...dumbo, ...uws, unknown]);
    const result = scheduleDayItems('New York City', items, lookup);
    const names = result.items.map((item) => item[2]);
    expect(names).toContain('Mystery Spot');
    expect(names[names.length - 1]).toBe('Mystery Spot');
    expect(new Set(names)).toEqual(new Set(items.map((item) => item[2])));
  });

  test('leaves 2-item and shorter days untouched', () => {
    const items: DaySchedulingItem[] = [
      ['M', 'A', uws[0].name],
      ['E', 'A', dumbo[0].name],
    ];
    const lookup = makeLookup([...dumbo, ...uws]);
    const result = scheduleDayItems('New York City', items, lookup);
    expect(result.changed).toBe(false);
    expect(result.items).toEqual(items);
  });

  test('preserves original time-slot codes by position (morning/day/evening rhythm)', () => {
    const lookup = makeLookup([...dumbo, ...uws]);
    const result = scheduleDayItems('New York City', interleavedItems, lookup);
    const originalCodes = interleavedItems.map((item) => item[0]);
    const resultCodes = result.items.map((item) => item[0]);
    expect(resultCodes).toEqual(originalCodes);
  });
});
