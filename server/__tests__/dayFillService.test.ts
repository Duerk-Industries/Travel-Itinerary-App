/// <reference types="jest" />
import {
  fillThinDaysDeterministically,
  buildThinDayRepairPayload,
  mergeThinDayRepairResult,
  THIN_DAY_MIN_ITEMS,
  type FillItinerary,
} from '../src/services/dayFillService';
import type { AttractionPod } from '../src/services/geoPodClusteringService';
import type { AttractionCatalogEntry } from '../src/types';

const entry = (overrides: Partial<AttractionCatalogEntry> & { id: string; name: string; rank: number }): AttractionCatalogEntry => ({
  destinationKey: 'paris',
  destinationDisplayName: 'Paris',
  activityType: 'Sights & Landmarks',
  interestTags: ['iconic_landmarks'],
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const pod = (id: string, items: AttractionCatalogEntry[]): AttractionPod => ({
  id,
  destination: 'Paris',
  kind: 'geographic',
  items,
  centroid: { lat: 48.8, lon: 2.3 },
  radiusKm: 1,
  distanceGuaranteed: true,
});

const itinerary = (days: Array<{ dt: string; b?: string; it?: Array<[string, string, string]>; ln?: string[]; d?: number }>): FillItinerary => ({
  dy: days.map((day) => ({ d: day.d, dt: day.dt, b: day.b ?? 'Paris', it: day.it ?? [], ln: day.ln ?? [] })),
});

describe('dayFillService — deterministic fill (Phase 4B)', () => {
  it('leaves days with enough items untouched', () => {
    const input = itinerary([{ dt: '2026-08-01', it: [['D', 'A', 'Louvre'], ['E', 'A', 'Eiffel Tower']] }]);
    const result = fillThinDaysDeterministically({ itinerary: input, mustSees: [], podsByDestination: {} });
    expect(result.itinerary.dy[0].it).toHaveLength(2);
    expect(result.filledDayDates).toHaveLength(0);
    expect(result.thinDayDates).toHaveLength(0);
  });

  it('Priority 1: recovers an unused must-see for the day destination', () => {
    const input = itinerary([{ dt: '2026-08-01', it: [] }]);
    const result = fillThinDaysDeterministically({
      itinerary: input,
      mustSees: [{ name: 'Notre-Dame', destinationName: 'Paris' }, { name: 'Kyoto Temple', destinationName: 'Kyoto' }],
      podsByDestination: {},
    });
    const names = result.itinerary.dy[0].it.map((item) => item[2]);
    expect(names).toContain('Notre-Dame');
    expect(names).not.toContain('Kyoto Temple');
  });

  it('Priority 2: falls back to POD proximity when there is no matching must-see (missing must-see case)', () => {
    const input = itinerary([{ dt: '2026-08-01', it: [] }]);
    const pods = {
      Paris: [pod('pod-1', [
        entry({ id: 'a1', name: 'Musee d Orsay', rank: 1 }),
        entry({ id: 'a2', name: 'Sacre-Coeur', rank: 2 }),
      ])],
    };
    const result = fillThinDaysDeterministically({ itinerary: input, mustSees: [], podsByDestination: pods });
    const names = result.itinerary.dy[0].it.map((item) => item[2]);
    expect(names).toEqual(expect.arrayContaining(['Musee d Orsay', 'Sacre-Coeur']));
    expect(result.thinDayDates).toHaveLength(0);
  });

  it('never duplicates an attraction already used elsewhere in the trip', () => {
    const input = itinerary([
      { dt: '2026-08-01', it: [['D', 'A', 'Musee d Orsay']] },
      { dt: '2026-08-02', it: [] },
    ]);
    const pods = {
      Paris: [pod('pod-1', [entry({ id: 'a1', name: 'Musee d Orsay', rank: 1 })])],
    };
    const result = fillThinDaysDeterministically({ itinerary: input, mustSees: [], podsByDestination: pods });
    // Second day could not find any other candidate, so it stays thin rather than duplicating.
    expect(result.itinerary.dy[1].it.some((item) => item[2] === 'Musee d Orsay')).toBe(false);
    expect(result.thinDayDates).toContain('2026-08-02');
  });

  it('respects weekday-closure heuristics (opening-hour conflict)', () => {
    // 2026-08-03 is a Monday (museums default-closed); the museum candidate must be skipped.
    const input = itinerary([{ dt: '2026-08-03', it: [] }]);
    const pods = {
      Paris: [pod('pod-1', [
        entry({ id: 'a1', name: 'City Museum', rank: 1 }),
        entry({ id: 'a2', name: 'Riverside Park', rank: 2 }),
      ])],
    };
    const result = fillThinDaysDeterministically({ itinerary: input, mustSees: [], podsByDestination: pods });
    const names = result.itinerary.dy[0].it.map((item) => item[2]);
    expect(names).not.toContain('City Museum');
    expect(names).toContain('Riverside Park');
  });

  it('caps additions at maxItemsPerDay (5-item cap) and at a rest-hub day', () => {
    const input = itinerary([{ dt: '2026-08-01', it: [], ln: ['Rest day: light activities to recover from travel fatigue.'] }]);
    const pods = {
      Paris: [pod('pod-1', [
        entry({ id: 'a1', name: 'Spot A', rank: 1 }),
        entry({ id: 'a2', name: 'Spot B', rank: 2 }),
        entry({ id: 'a3', name: 'Spot C', rank: 3 }),
      ])],
    };
    const result = fillThinDaysDeterministically({ itinerary: input, mustSees: [], podsByDestination: pods, maxItemsPerDay: 5 });
    expect(result.itinerary.dy[0].it.length).toBeLessThanOrEqual(THIN_DAY_MIN_ITEMS);
  });

  it('handles a day with no destination match and no must-sees gracefully (still-thin, no throw)', () => {
    const input = itinerary([{ dt: '2026-08-01', b: 'Reykjavik', it: [] }]);
    expect(() =>
      fillThinDaysDeterministically({ itinerary: input, mustSees: [], podsByDestination: {} })
    ).not.toThrow();
    const result = fillThinDaysDeterministically({ itinerary: input, mustSees: [], podsByDestination: {} });
    expect(result.thinDayDates).toEqual(['2026-08-01']);
  });
});

describe('dayFillService — buildThinDayRepairPayload', () => {
  it('only includes the requested thin days', () => {
    const input = itinerary([
      { dt: '2026-08-01', it: [['D', 'A', 'Louvre']] },
      { dt: '2026-08-02', it: [] },
    ]);
    const payload = buildThinDayRepairPayload(input, ['2026-08-02']);
    expect(payload).toHaveLength(1);
    expect(payload[0]).toEqual({ dt: '2026-08-02', destination: 'Paris', existingItems: [] });
  });
});

describe('dayFillService — mergeThinDayRepairResult (targeted repair merge)', () => {
  const thin = itinerary([{ dt: '2026-08-01', it: [] }]);

  it('malformed JSON / non-object response falls back to unchanged (still-thin) itinerary without throwing', () => {
    expect(() =>
      mergeThinDayRepairResult({ itinerary: thin, repaired: 'not json' })
    ).not.toThrow();
    const result = mergeThinDayRepairResult({ itinerary: thin, repaired: 'not json' });
    expect(result.stillThinDayDates).toEqual(['2026-08-01']);
    expect(result.repairedDayDates).toHaveLength(0);
  });

  it('empty p2-shaped output (no dy array) falls back to unchanged itinerary', () => {
    const result = mergeThinDayRepairResult({ itinerary: thin, repaired: {} });
    expect(result.stillThinDayDates).toEqual(['2026-08-01']);
  });

  it('applies a well-formed repair response and clears the thin flag', () => {
    const result = mergeThinDayRepairResult({
      itinerary: thin,
      repaired: { dy: [{ dt: '2026-08-01', it: [['D', 'A', 'Repaired Landmark'], ['E', 'A', 'Repaired Dinner']] }] },
    });
    expect(result.repairedDayDates).toEqual(['2026-08-01']);
    expect(result.stillThinDayDates).toHaveLength(0);
    expect(result.itinerary.dy[0].it.map((item) => item[2])).toEqual(['Repaired Landmark', 'Repaired Dinner']);
  });

  it('drops a repaired name that duplicates an attraction used elsewhere in the trip', () => {
    const withOtherDay = itinerary([
      { dt: '2026-08-01', it: [['D', 'A', 'Existing Elsewhere']] },
      { dt: '2026-08-02', it: [] },
    ]);
    const result = mergeThinDayRepairResult({
      itinerary: withOtherDay,
      repaired: {
        dy: [{ dt: '2026-08-02', it: [['D', 'A', 'Existing Elsewhere'], ['D', 'A', 'New Candidate']] }],
      },
    });
    // Only one real candidate after dedupe — below the minimum, so day 2 stays unchanged/still thin.
    expect(result.stillThinDayDates).toContain('2026-08-02');
    expect(result.itinerary.dy[1].it).toHaveLength(0);
  });

  it('ignores malformed item tuples and normalizes invalid time/kind codes to safe defaults', () => {
    const result = mergeThinDayRepairResult({
      itinerary: thin,
      repaired: {
        dy: [
          {
            dt: '2026-08-01',
            it: [
              ['not-a-real-code', 'not-a-real-kind', 'Valid Name'],
              ['D'], // malformed: too short, dropped
              ['E', 'A', 'Second Valid Name'],
            ],
          },
        ],
      },
    });
    expect(result.repairedDayDates).toEqual(['2026-08-01']);
    const items = result.itinerary.dy[0].it;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(['D', 'A', 'Valid Name']);
    expect(items[1]).toEqual(['E', 'A', 'Second Valid Name']);
  });
});
