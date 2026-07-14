import {
  polishItineraryFinalPass,
  mapItems,
  buildTimingPreferenceNote,
  deriveDestinationTransferTiming,
  enforceMuseumHalfDayClear,
} from '../src/services/itineraryPromptPlanService';

const entry = (name: string, tags: string[], overrides: Partial<Record<string, unknown>> = {}) => ({
  id: name,
  destinationKey: 'paris',
  destinationDisplayName: 'Paris',
  name,
  rank: 1,
  activityType: 'Open Access' as const,
  interestTags: tags as any,
  budgetTier: 'paid' as const,
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const WEIGHTS = {
  outdoors: 10, adventure: 10, culture: 20, food: 20, nightlife: 10, relax: 10,
  photography: 10, authentic_local: 5, iconic_landmarks: 5,
};

describe('polishItineraryFinalPass', () => {
  test('Farewell Night: swaps the final night item for a top-ranked food match on the last day', () => {
    const itinerary = {
      dy: [
        { d: 1, dt: '2026-07-01', b: 'Paris', it: [['E', 'O', 'Generic evening walk']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [] },
      ],
    } as any;
    const shortlist = { Paris: [entry('Le Bistro Classique', ['food'], { rank: 1 })] };

    const result = polishItineraryFinalPass(itinerary, shortlist, {});

    expect(result.dy[0].it[0]).toEqual(['E', 'A', 'Le Bistro Classique']);
    expect(result.dy[0].ln.some((note: string) => /Farewell Dinner/i.test(note))).toBe(true);
  });

  test('Farewell Night: does not duplicate the food item if it is already scheduled that day', () => {
    const itinerary = {
      dy: [
        { d: 1, dt: '2026-07-01', b: 'Paris', it: [['D', 'A', 'Le Bistro Classique']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [] },
      ],
    } as any;
    const shortlist = { Paris: [entry('Le Bistro Classique', ['food'], { rank: 1 })] };

    const result = polishItineraryFinalPass(itinerary, shortlist, {});

    expect(result.dy[0].it).toEqual([['D', 'A', 'Le Bistro Classique']]);
  });

  test('Golden Hour: moves a mid-day photography item to the last slot with a lighting note', () => {
    const itinerary = {
      dy: [
        {
          d: 1,
          dt: '2026-07-01',
          b: 'Paris',
          it: [
            ['M', 'O', 'Morning market'],
            ['D', 'A', 'Sunset Viewpoint'],
            ['E', 'O', 'Evening stroll'],
          ],
          me: ['BQ', 'LC', 'DL'],
          sl: "Lodging at 'Paris'",
          ln: [],
        },
      ],
    } as any;
    const shortlist = {
      Paris: [entry('Sunset Viewpoint', ['photography'], { rank: 1 }), entry('Evening stroll', ['culture'], { rank: 2 })],
    };

    const result = polishItineraryFinalPass(itinerary, shortlist, {});

    expect(result.dy[0].it[result.dy[0].it.length - 1][2]).toBe('Sunset Viewpoint');
    expect(result.dy[0].ln.some((note: string) => /optimal lighting/i.test(note))).toBe(true);
  });

  test('Golden Hour: leaves a photography item already in the last slot untouched', () => {
    const itinerary = {
      dy: [
        {
          d: 1,
          dt: '2026-07-01',
          b: 'Paris',
          it: [
            ['M', 'O', 'Morning market'],
            ['E', 'A', 'Sunset Viewpoint'],
          ],
          me: ['BQ', 'LC', 'DL'],
          sl: "Lodging at 'Paris'",
          ln: [],
        },
      ],
    } as any;
    const shortlist = { Paris: [entry('Sunset Viewpoint', ['photography'], { rank: 1 })] };

    const result = polishItineraryFinalPass(itinerary, shortlist, {});

    expect(result.dy[0].it).toEqual([
      ['M', 'O', 'Morning market'],
      ['E', 'A', 'Sunset Viewpoint'],
    ]);
  });

  test('Farewell Night: boosts food items in the central geographic pod', () => {
    const itinerary = {
      dy: [
        { d: 1, dt: '2026-07-01', b: 'Paris', it: [['E', 'O', 'Walk']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [] },
      ],
    } as any;
    const entryA = entry('Regular Bistro', ['food'], { rank: 1, id: 'a' });
    const entryB = entry('Central Bistro', ['food'], { rank: 2, id: 'b' });
    const shortlist = { Paris: [entryA, entryB] };
    const pods = {
      Paris: [
        { kind: 'geographic', items: [entryB] },
      ],
    } as any;

    const result = polishItineraryFinalPass(itinerary, shortlist, pods);

    // Central Bistro (entryB) should win even though it has a lower rank (2 vs 1)
    expect(result.dy[0].it[0][2]).toBe('Central Bistro');
  });
});

describe('mapItems — mobility accessibility note', () => {
  const baseItinerary = {
    eh: 'CDG', xh: 'CDG', b: [{ l: 'Paris', ci: '2026-07-01', co: '2026-07-02', dn: [] }], x: [], rc: null,
    dy: [
      { d: 1, dt: '2026-07-01', b: 'Paris', it: [['D', 'A', 'City Museum']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [] },
    ],
    a: [], cf: 'M',
  } as any;

  test('appends a step-free-access note for mobility L (low)', () => {
    const items = mapItems(baseItinerary, WEIGHTS, undefined, undefined, undefined, 'L');
    expect(items.activities[0].notes).toContain('Check step-free access, seating, and route length');
  });

  test('does not append the accessibility note for mobility M (medium, the default)', () => {
    const items = mapItems(baseItinerary, WEIGHTS, undefined, undefined, undefined, 'M');
    expect(items.activities[0].notes).not.toContain('step-free access');
  });

  test('defaults to no accessibility note when mobility is omitted', () => {
    const items = mapItems(baseItinerary, WEIGHTS);
    expect(items.activities[0].notes).not.toContain('step-free access');
  });

  test('uses a factual missing-source fallback instead of invented itinerary boilerplate', () => {
    const items = mapItems(baseItinerary, WEIGHTS);
    expect(items.activities[0].notes).toContain('no verified attraction description was available');
    expect(items.activities[0].notes).not.toContain('complements the planned pace');
  });

  test('delays the first activity on an inter-destination transfer day', () => {
    const itinerary = {
      ...baseItinerary,
      x: [{ dt: '2026-07-01', m: 'Train', fr: 'Paris', to: 'Lyon', td: 5 }],
    } as any;
    const timing = deriveDestinationTransferTiming(itinerary);
    const items = mapItems(itinerary, WEIGHTS, undefined, undefined, undefined, 'M', timing);
    // 09:00 + 5h modeled leg + 1h change/check-in reserve.
    expect(items.activities[0].startTime).toBe('15:00');
  });
});

describe('museum half-day pacing', () => {
  test('keeps one major museum and moves excess activities to a compatible day', () => {
    const itinerary = {
      dy: [
        {
          d: 1,
          dt: '2026-07-01',
          b: 'Paris',
          it: [
            ['M', 'A', 'Louvre Museum'],
            ['D', 'A', 'Orsay Museum'],
            ['E', 'A', 'Dinner at Le Marais'],
            ['D', 'O', 'Latin Quarter walk'],
          ],
          ln: [],
        },
        { d: 2, dt: '2026-07-02', b: 'Paris', it: [['D', 'O', 'Montmartre walk']], ln: [] },
        { d: 3, dt: '2026-07-03', b: 'Paris', it: [['D', 'O', 'Canal Saint-Martin walk']], ln: [] },
      ],
    } as any;

    const result = enforceMuseumHalfDayClear(itinerary);
    expect(result.dy[0].it.filter((item: any[]) => /museum/i.test(item[2]))).toHaveLength(1);
    expect(result.dy[0].ln.join(' ')).toMatch(/half day/i);
    expect(result.dy[1].it.filter((item: any[]) => /museum/i.test(item[2]))).toHaveLength(1);
    expect(result.dy[2].it.map((item: any[]) => item[2])).toEqual(expect.arrayContaining(['Latin Quarter walk']));
  });
});

describe('buildTimingPreferenceNote', () => {
  test('early-bird only', () => {
    expect(buildTimingPreferenceNote({ eb: true })).toContain('Early-bird preference');
  });

  test('night-owl only', () => {
    expect(buildTimingPreferenceNote({ no: true })).toContain('Night-owl preference');
  });

  test('both flags set is treated as a conflict, not one preference silently winning', () => {
    const note = buildTimingPreferenceNote({ eb: true, no: true });
    expect(note).toContain('Timing preference conflict');
    expect(note).not.toContain('Early-bird preference');
    expect(note).not.toContain('Night-owl preference');
  });

  test('neither flag set produces no note', () => {
    expect(buildTimingPreferenceNote({})).toBe('');
    expect(buildTimingPreferenceNote(undefined)).toBe('');
  });
});
