import {
  polishItineraryFinalPass,
  mapItems,
  buildTimingPreferenceNote,
  deriveDestinationTransferTiming,
  enforceMuseumHalfDayClear,
  looksLikeSearchableAttractionName,
  extractAttractionSearchPhrase,
  rescopeDayTripCarRental,
  getNotableHolidaysInRange,
  buildHolidayAwarenessNote,
  type ItineraryGeneratedCarRental,
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

  test('leaves the description blank instead of inventing itinerary boilerplate', () => {
    // No catalog/Wikipedia description, no accessibility note, no pre-order flag,
    // and no preference-fit match here — notes must stay empty rather than restate
    // the (already-separate) duration field or invent filler prose.
    const items = mapItems(baseItinerary, WEIGHTS);
    expect(items.activities[0].notes).toBe('');
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

describe('looksLikeSearchableAttractionName — gates live Wikipedia description lookups', () => {
  // Regression cases: a real trip where description enrichment attached a
  // Canadian settlement, a WWII naval raid, and the 2011 Oslo terrorist
  // attacks to unrelated filler activities purely on keyword overlap with
  // "Norway"/"Oslo". None of these should ever reach the Wikipedia search.
  test('rejects generic/transitional filler text with no specific place named', () => {
    expect(looksLikeSearchableAttractionName('Explore the main historic district in Norway', 'Norway')).toBe(false);
    expect(looksLikeSearchableAttractionName('Return to Oslo for a calm evening meal', 'Oslo')).toBe(false);
    expect(looksLikeSearchableAttractionName('Departure from Oslo', 'Oslo')).toBe(false);
    expect(
      looksLikeSearchableAttractionName(
        'Arrive in Oslo and settle into the city rhythm around the waterfront and central districts',
        'Oslo'
      )
    ).toBe(false);
  });

  test('allows names with a strong attraction keyword when a real proper noun is also present', () => {
    expect(looksLikeSearchableAttractionName('MUNCH museum in Bjørvika', 'Oslo')).toBe(true);
    expect(looksLikeSearchableAttractionName('Astrup Fearnley Museum of Modern Art', 'Oslo')).toBe(true);
  });

  test('allows names with a specific proper noun beyond the destination and the first word', () => {
    expect(looksLikeSearchableAttractionName('Self-guided morning in Vigeland Sculpture Park', 'Oslo')).toBe(true);
    expect(looksLikeSearchableAttractionName('Short farewell stop at the Oslo Opera House exterior and harbor edge', 'Oslo')).toBe(true);
    expect(looksLikeSearchableAttractionName('Explore Akershus Fortress grounds and the waterfront edges', 'Oslo')).toBe(true);
  });

  test('rejects a bare locality label with nothing specific beyond the destination name', () => {
    expect(looksLikeSearchableAttractionName('Oslo', 'Oslo')).toBe(false);
  });

  test('rejects generic template text that mentions a strong attraction keyword but names no real place', () => {
    // Regression case: a live replay generated "A major history or art museum
    // in the base city", "Main city museum district or cultural quarter", and
    // "Visit a major museum in Norway" — all contain "museum" (previously an
    // unconditional keyword-shortcut to `true`) but name no actual place, and
    // all three got a confidently-wrong live-search hit (a different city's
    // page, a football league, a queen consort's biography).
    expect(looksLikeSearchableAttractionName('A major history or art museum in the base city', 'Norway')).toBe(false);
    expect(looksLikeSearchableAttractionName('Main city museum district or cultural quarter', 'Norway')).toBe(false);
    expect(looksLikeSearchableAttractionName('Visit a major museum in Norway', 'Norway')).toBe(false);
  });
});

describe('extractAttractionSearchPhrase — builds a tight Wikipedia search query instead of the full sentence', () => {
  // Regression cases: even after looksLikeSearchableAttractionName correctly
  // allowed these (they do name a real place), searching the FULL sentence
  // let an unrelated but keyword-adjacent article win: a Norway history blurb,
  // a King Harald V biography, the 2011 terrorist attacks, and a Bernadotte
  // king biography, respectively.
  test('extracts the day-trip destination instead of the whole sentence', () => {
    expect(extractAttractionSearchPhrase('Train-based day trip to Drammen', 'Norway')).toBe('Drammen');
  });

  test('extracts a multi-word proper-noun run over a shorter later run', () => {
    expect(extractAttractionSearchPhrase('Karl Johans gate and the University area', 'Norway')).toBe('Karl Johans');
  });

  test('extracts the base city over a sentence-initial verb via tie-break', () => {
    expect(extractAttractionSearchPhrase('Arrive in Oslo and settle in near the central waterfront', 'Norway')).toBe('Oslo');
    expect(extractAttractionSearchPhrase('Return to Oslo for a quiet final-night dinner', 'Norway')).toBe('Oslo');
  });

  test('extracts the longest run outright when one clearly dominates', () => {
    expect(
      extractAttractionSearchPhrase('Last-look free time around Oslo Central Station and the waterfront', 'Norway')
    ).toBe('Oslo Central Station');
  });

  test('keeps a formal name intact across a bridging "of"', () => {
    expect(
      extractAttractionSearchPhrase('Norwegian Museum of Cultural History in Bygdøy', 'Norway')
    ).toBe('Norwegian Museum of Cultural History');
  });

  test('preserves a run that genuinely starts at the first word when nothing else competes', () => {
    expect(extractAttractionSearchPhrase('Oslo Opera House lobby and roof', 'Norway')).toBe('Oslo Opera House');
  });

  test('falls back to the original text when no capitalized content word is found', () => {
    expect(extractAttractionSearchPhrase('a quiet evening walk', 'Norway')).toBe('a quiet evening walk');
  });
});

describe('rescopeDayTripCarRental', () => {
  // Regression case: a real 7-day Oslo trip recommended a full-week rental car
  // (pickup day 1, dropoff last day) even though the traveler only ever left
  // Oslo for one Lillehammer day trip — expensive/unnecessary advice for a
  // city stay where driving/parking is a hassle.
  const baseRental: ItineraryGeneratedCarRental = {
    status: 'Needed',
    pickupLocation: 'Oslo',
    pickupDate: '2026-01-01',
    dropoffLocation: 'Oslo',
    dropoffDate: '2026-01-07',
    reference: '',
    vendor: '',
    prepaid: '',
    cost: '',
    model: '',
    notes: '',
  };

  const oslo = (dt: string, it: Array<[string, string, string]>) => ({ d: 1, dt, b: 'Oslo', it, me: [], sl: '', ln: [], cf: 'M' as const });

  const itinerary = {
    $: 'it1' as const, eh: 'OSL', xh: 'OSL', rc: null, a: [], cf: 'M' as const,
    b: [{ l: 'Oslo', ci: '2026-01-01', co: '2026-01-07', dn: [] }],
    x: [],
    dy: [
      oslo('2026-01-01', [['D', 'A', 'Munch Museum']]),
      oslo('2026-01-02', [['D', 'A', 'Norsk Folkemuseum']]),
      oslo('2026-01-05', [
        ['D', 'O', 'Drive toward Lillehammer'],
        ['D', 'A', 'Maihaugen'],
      ]),
      oslo('2026-01-06', [['D', 'A', 'National Museum']]),
    ],
  } as any;

  const entryByName = new Map([
    ['munch museum', entry('Munch Museum', ['culture'], { destinationKey: 'oslo' })],
    ['maihaugen', entry('Maihaugen', ['culture'], { destinationKey: 'lillehammer' })],
    ['national museum', entry('National Museum', ['culture'], { destinationKey: 'oslo' })],
  ].map(([key, value]) => [key as string, value as any]));

  test('leaves a full-trip rental (car=R) untouched', () => {
    const result = rescopeDayTripCarRental(baseRental, itinerary, 'R', entryByName);
    expect(result).toEqual(baseRental);
  });

  test('rescopes a day-trips-only rental (car=D) to the detected day-trip day', () => {
    const result = rescopeDayTripCarRental(baseRental, itinerary, 'D', entryByName);
    expect(result.pickupDate).toBe('2026-01-05');
    expect(result.dropoffDate).toBe('2026-01-05');
    // Only the dates change — location/notes/etc. are preserved.
    expect(result.pickupLocation).toBe('Oslo');
  });

  test('falls back to the untouched day1/last-day dates when no day-trip day is detected', () => {
    const noDayTripItinerary = {
      ...itinerary,
      dy: [
        oslo('2026-01-01', [['D', 'A', 'Munch Museum']]),
        oslo('2026-01-02', [['D', 'A', 'National Museum']]),
      ],
    };
    const result = rescopeDayTripCarRental(baseRental, noDayTripItinerary, 'D', entryByName);
    expect(result).toEqual(baseRental);
  });

  test('spans pickup/dropoff across multiple day-trip days', () => {
    const twoDayTripItinerary = {
      ...itinerary,
      dy: [
        oslo('2026-01-01', [['D', 'A', 'Munch Museum']]),
        oslo('2026-01-04', [['D', 'O', 'Drive toward Lillehammer'], ['D', 'A', 'Maihaugen']]),
        oslo('2026-01-05', [['D', 'A', 'Maihaugen']]),
        oslo('2026-01-06', [['D', 'A', 'National Museum']]),
      ],
    };
    const result = rescopeDayTripCarRental(baseRental, twoDayTripItinerary, 'D', entryByName);
    expect(result.pickupDate).toBe('2026-01-04');
    expect(result.dropoffDate).toBe('2026-01-05');
  });
});

describe('getNotableHolidaysInRange / buildHolidayAwarenessNote', () => {
  // Regression case: a real trip ran 2026-01-01..2026-01-07 (starting on New
  // Year's Day) with no note anywhere that hours might be reduced.
  test('detects New Year\'s Day within a trip range', () => {
    expect(getNotableHolidaysInRange('2026-01-01', '2026-01-07')).toEqual(["New Year's Day (01/01)"]);
  });

  test('detects Christmas Day within a trip range', () => {
    expect(getNotableHolidaysInRange('2026-12-20', '2026-12-27')).toEqual(['Christmas Day (12/25)']);
  });

  test('detects both holidays when a trip spans a year boundary', () => {
    expect(getNotableHolidaysInRange('2026-12-24', '2027-01-02')).toEqual([
      'Christmas Day (12/25)',
      "New Year's Day (01/01)",
    ]);
  });

  test('returns nothing for a trip that does not include a notable holiday', () => {
    expect(getNotableHolidaysInRange('2026-06-01', '2026-06-10')).toEqual([]);
  });

  test('returns nothing for an invalid date range', () => {
    expect(getNotableHolidaysInRange('not-a-date', '2026-01-07')).toEqual([]);
    expect(getNotableHolidaysInRange('2026-01-07', '2026-01-01')).toEqual([]);
  });

  test('buildHolidayAwarenessNote produces a caution, not an asserted closure', () => {
    const note = buildHolidayAwarenessNote('2026-01-01', '2026-01-07');
    expect(note).toContain("New Year's Day");
    expect(note).toContain('may have reduced hours or be closed');
    expect(note).toContain('verify opening hours');
  });

  test('buildHolidayAwarenessNote is empty when no holiday falls in range', () => {
    expect(buildHolidayAwarenessNote('2026-06-01', '2026-06-10')).toBe('');
  });
});
