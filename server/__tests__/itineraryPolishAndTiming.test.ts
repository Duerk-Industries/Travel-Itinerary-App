import {
  polishItineraryFinalPass,
  mapItems,
  buildTimingPreferenceNote,
  deriveDestinationTransferTiming,
  enforceMuseumHalfDayClear,
  looksLikeSearchableAttractionName,
  extractAttractionSearchPhrase,
  sanitizeActivityText,
  enforceGeographicActivityPlausibility,
  rescopeDayTripCarRental,
  getNotableHolidaysInRange,
  buildHolidayAwarenessNote,
  ensureFullDateCoverage,
  rebalanceItineraryPacing,
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

  test('still reserves a conservative buffer when the transfer has no modeled duration', () => {
    // Regression case: a real Boston/New York trip scheduled "Explore Boston
    // Common" at 09:00 on the same day the CLE -> Boston arrival flight was
    // rendered as 09:00-11:00 — because the route stage left `td` unset (per
    // the anti-hallucination rule against inventing a flight duration), the
    // old code treated that as "no transfer time to reserve at all" instead
    // of falling back to a default buffer, so the two overlapped.
    const itinerary = {
      ...baseItinerary,
      dy: [
        { d: 1, dt: '2026-07-01', b: 'Boston', it: [['M', 'A', 'Explore Boston Common']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [] },
      ],
      x: [{ dt: '2026-07-01', m: 'Flight', fr: 'CLE', to: 'Boston' }],
    } as any;
    const timing = deriveDestinationTransferTiming(itinerary);
    const items = mapItems(itinerary, WEIGHTS, undefined, undefined, undefined, 'M', timing);
    // 09:00 + 2h default (matches the rendered 09:00-11:00 placeholder) + 1h buffer.
    expect(items.activities[0].startTime).toBe('12:00');
  });
});

describe('mapItems — meal-time scheduling', () => {
  test('schedules a lunch item at noon instead of inheriting a late start from a preceding same-slot item', () => {
    // Regression case: a real Boston trip scheduled "Lunch at a historic pub"
    // for 15:45 because it was the SECOND 'D' (daytime) item that day, stacked
    // after a 2.5h museum visit at 13:00 — technically correct sequencing,
    // but a nonsensical lunch time.
    const itinerary = {
      eh: 'BOS', xh: 'BOS', b: [{ l: 'Boston', ci: '2026-08-20', co: '2026-08-21', dn: [] }], x: [], rc: null,
      dy: [
        {
          d: 1,
          dt: '2026-08-20',
          b: 'Boston',
          it: [
            ['D', 'A', 'Isabella Stewart Gardner Museum'],
            ['D', 'O', 'Lunch at a historic pub'],
          ],
          me: ['BQ', 'LC', 'DL'],
          sl: "Lodging at 'Boston'",
          ln: [],
        },
      ],
      a: [], cf: 'M',
    } as any;

    const items = mapItems(itinerary, WEIGHTS);
    const lunch = items.activities.find((a) => a.name === 'Lunch at a historic pub');
    const museum = items.activities.find((a) => a.name === 'Isabella Stewart Gardner Museum');
    expect(lunch?.startTime).toBe('12:00');
    // The museum visit is pushed after lunch instead, not dropped or duplicated
    // (lunch here resolves to a 90m Food & Drink duration + the 15m item gap).
    expect(museum?.startTime).toBe('13:45');
  });

  test('does not move lunch earlier than a transfer-day readiness buffer', () => {
    const itinerary = {
      eh: 'BOS', xh: 'BOS', b: [{ l: 'Boston', ci: '2026-08-20', co: '2026-08-21', dn: [] }], x: [], rc: null,
      dy: [
        { d: 1, dt: '2026-08-20', b: 'Boston', it: [['D', 'O', 'Lunch at a historic pub']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [] },
      ],
      a: [], cf: 'M',
    } as any;
    // 3h reserved (e.g. an unmodeled arrival transfer) pushes the D slot to 12:00 already —
    // still within the 11am-1pm window, so this alone doesn't distinguish the fix, but a
    // longer reserve pushing past 13:00 must not be pulled back to noon.
    const timing = new Map([[itinerary.dy[0].dt, { date: itinerary.dy[0].dt, from: 'CLE', to: 'Boston', mode: 'Flight' as const, minutes: 300 }]]);
    const items = mapItems(itinerary, WEIGHTS, undefined, undefined, undefined, 'M', timing);
    // 09:00 + 300min reserve = 14:00, which is later than the natural 13:00 D
    // base — a genuine constraint, so it must win over the noon preference.
    expect(items.activities[0].startTime).toBe('14:00');
  });

  test('leaves a lunch item alone when it is already the only, first item in its slot at the default time', () => {
    const itinerary = {
      eh: 'BOS', xh: 'BOS', b: [{ l: 'Boston', ci: '2026-08-20', co: '2026-08-21', dn: [] }], x: [], rc: null,
      dy: [
        { d: 1, dt: '2026-08-20', b: 'Boston', it: [['D', 'O', 'Casual lunch stop']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [] },
      ],
      a: [], cf: 'M',
    } as any;
    const items = mapItems(itinerary, WEIGHTS);
    expect(items.activities[0].startTime).toBe('12:00');
  });

  test('does not reorder non-meal items relative to each other', () => {
    const itinerary = {
      eh: 'BOS', xh: 'BOS', b: [{ l: 'Boston', ci: '2026-08-20', co: '2026-08-21', dn: [] }], x: [], rc: null,
      dy: [
        {
          d: 1,
          dt: '2026-08-20',
          b: 'Boston',
          it: [
            ['D', 'A', 'First museum'],
            ['D', 'A', 'Second museum'],
          ],
          me: ['BQ', 'LC', 'DL'],
          sl: "Lodging at 'Boston'",
          ln: [],
        },
      ],
      a: [], cf: 'M',
    } as any;
    const items = mapItems(itinerary, WEIGHTS);
    const first = items.activities.find((a) => a.name === 'First museum');
    const second = items.activities.find((a) => a.name === 'Second museum');
    // "HH:MM" 24h strings compare correctly lexicographically for same-day times.
    expect(first!.startTime < second!.startTime).toBe(true);
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

  // Regression case: a real Boston/New York replay searched "National
  // September" instead of the full memorial name and got back the generic
  // New York City Wikipedia article — "11" starts with a digit, not a
  // capital letter, so it broke the proper-noun run right before the most
  // specific part of the name ("Memorial").
  test('bridges a numeric token between two proper-noun words instead of breaking the run', () => {
    expect(
      extractAttractionSearchPhrase('National September 11 Memorial & Museum', 'New York City')
    ).toBe('National September 11 Memorial');
  });
});

describe('sanitizeActivityText — rejects listicle/roundup article titles as activities', () => {
  // Regression case: a real La Fortuna itinerary showed "5 Things to do in La Fortuna" as a
  // 1.5h "activity" with no link to whatever article it came from — an article title is not a
  // visitable place, and the itinerary doesn't even offer the page it's summarizing.
  test('replaces a numbered listicle title with a specific fallback', () => {
    const result = sanitizeActivityText('5 Things to Do in La Fortuna', { base: 'La Fortuna', activityCode: 'O' });
    expect(result.text.toLowerCase()).not.toContain('things to do');
    expect(result.text).toContain('La Fortuna');
  });

  test.each([
    ['10 Best Restaurants in Oslo', 'Oslo'],
    ['Top 10 Attractions in Mexico City', 'Mexico City'],
    ['Best places to visit in Puebla', 'Puebla'],
    ['What to do in Monteverde', 'Monteverde'],
    ['How to spend a day in Manuel Antonio', 'Manuel Antonio'],
    ['Ultimate guide to Arenal Volcano', 'Arenal Volcano'],
  ])('treats "%s" as generic filler, not a specific activity', (text, base) => {
    const result = sanitizeActivityText(text, { base, activityCode: 'O' });
    expect(result.text).not.toBe(text);
  });

  test('leaves a genuinely specific activity name untouched', () => {
    const result = sanitizeActivityText('La Fortuna Waterfall', { base: 'La Fortuna', activityCode: 'O' });
    expect(result.text).toBe('La Fortuna Waterfall');
  });
});

describe('enforceGeographicActivityPlausibility', () => {
  // Regression cases: real generated itineraries scheduled "Surf Lesson" in Monteverde (a Costa
  // Rican cloud-forest mountain town nowhere near the coast) and "Hot Springs" in Manuel Antonio
  // (a Pacific beach town with no geothermal activity) — a plausible destination paired with an
  // activity type that place doesn't actually have.
  const metadata = (name: string, description: string | null, opts: { catalogSourced?: boolean } = {}) => [
    name.toLowerCase(),
    {
      id: opts.catalogSourced ? `catalog:${name}` : `db:${name}`,
      destinationKey: 'monteverde', destinationDisplayName: 'Monteverde', name,
      activityType: 'Outdoor Activity' as const, estimatedDurationMinutes: 120, durationSource: 'heuristic' as const,
      requiresPreOrderTickets: false, preOrderNotes: null, description, descriptionSource: description ? 'wikipedia' as const : null,
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ] as const;

  test('replaces an uncatalogued, uncorroborated coastal activity in a landlocked/mountain destination', () => {
    const itinerary = {
      dy: [{ d: 1, dt: '2026-07-01', b: 'Monteverde', it: [['D', 'O', 'Surf Lesson']], me: [], sl: "Lodging at 'Monteverde'", ln: [] }],
    } as any;
    const durationMetadataByName = new Map([metadata('Surf Lesson', null)]);

    enforceGeographicActivityPlausibility(itinerary, {}, durationMetadataByName);

    expect(itinerary.dy[0].it[0][2]).not.toMatch(/surf/i);
  });

  test('replaces the same activity even when a description was fetched but never actually corroborates it', () => {
    const itinerary = {
      dy: [{ d: 1, dt: '2026-07-01', b: 'Manuel Antonio', it: [['D', 'O', 'Hot Springs']], me: [], sl: "Lodging at 'Manuel Antonio'", ln: [] }],
    } as any;
    const durationMetadataByName = new Map([
      metadata('Hot Springs', 'Manuel Antonio is a Pacific beach town known for its national park and rainforest-meets-ocean coastline.'),
    ]);

    enforceGeographicActivityPlausibility(itinerary, {}, durationMetadataByName);

    expect(itinerary.dy[0].it[0][2]).not.toBe('Hot Springs');
  });

  test('keeps the activity when its description genuinely corroborates the feature', () => {
    const itinerary = {
      dy: [{ d: 1, dt: '2026-07-01', b: 'Tamarindo', it: [['D', 'O', 'Surf Lesson']], me: [], sl: "Lodging at 'Tamarindo'", ln: [] }],
    } as any;
    const durationMetadataByName = new Map([
      metadata('Surf Lesson', 'Tamarindo is a popular surf town on the Pacific coast of Costa Rica, known for its beach breaks.'),
    ]);

    enforceGeographicActivityPlausibility(itinerary, {}, durationMetadataByName);

    expect(itinerary.dy[0].it[0][2]).toBe('Surf Lesson');
  });

  test('keeps the activity when it is a real, verified entry in the destination catalog', () => {
    const itinerary = {
      dy: [{ d: 1, dt: '2026-07-01', b: 'Monteverde', it: [['D', 'O', 'Surf Lesson']], me: [], sl: "Lodging at 'Monteverde'", ln: [] }],
    } as any;
    const shortlist = { Monteverde: [entry('Surf Lesson', ['adventure'])] };
    const durationMetadataByName = new Map([metadata('Surf Lesson', null, { catalogSourced: true })]);

    enforceGeographicActivityPlausibility(itinerary, shortlist, durationMetadataByName);

    expect(itinerary.dy[0].it[0][2]).toBe('Surf Lesson');
  });

  test('leaves ordinary activities with no geographic risk pattern untouched', () => {
    const itinerary = {
      dy: [{ d: 1, dt: '2026-07-01', b: 'Monteverde', it: [['D', 'O', 'Cloud Forest Canopy Tour']], me: [], sl: "Lodging at 'Monteverde'", ln: [] }],
    } as any;

    enforceGeographicActivityPlausibility(itinerary, {}, new Map());

    expect(itinerary.dy[0].it[0][2]).toBe('Cloud Forest Canopy Tour');
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

describe('ensureFullDateCoverage', () => {
  const route = {
    eh: 'CLE', xh: 'CLE',
    b: [
      { l: 'Boston', ci: '2026-08-16', co: '2026-08-21', dn: [] },
      { l: 'New York City', ci: '2026-08-21', co: '2026-08-26', dn: [] },
    ],
    x: [], rc: null, w: {} as any, a: [],
  } as any;

  test('inserts a bare empty day for a date the model silently skipped', () => {
    // Regression case: a real 11-day Boston/New York trip had dates 08-18,
    // 08-21, and 08-24 missing entirely from dy[] — not thin, just absent, so
    // no "## Day X" header rendered for them at all.
    const itinerary = {
      dy: [
        { d: 1, dt: '2026-08-16', b: 'Boston', it: [['M', 'O', 'Boston Common']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [] },
        { d: 2, dt: '2026-08-17', b: 'Boston', it: [['M', 'O', 'Freedom Trail']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [] },
        // 08-18 missing
        { d: 3, dt: '2026-08-19', b: 'Boston', it: [['M', 'O', 'Aquarium']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [] },
      ],
    } as any;

    const result = ensureFullDateCoverage(itinerary, '2026-08-16', '2026-08-19', route);
    expect(result.dy.map((day: any) => day.dt)).toEqual(['2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19']);
    const inserted = result.dy.find((day: any) => day.dt === '2026-08-18');
    expect(inserted.it).toEqual([]);
    expect(inserted.b).toBe('Boston');
    expect(inserted.sl).toBe("Lodging at 'Boston'");
  });

  test('assigns the correct base for a missing date that falls in a later destination window', () => {
    const itinerary = {
      dy: [
        { d: 1, dt: '2026-08-20', b: 'Boston', it: [], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [] },
        // 08-21 missing (New York City check-in date)
        { d: 2, dt: '2026-08-22', b: 'New York City', it: [], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'New York City'", ln: [] },
      ],
    } as any;
    const result = ensureFullDateCoverage(itinerary, '2026-08-20', '2026-08-22', route);
    const inserted = result.dy.find((day: any) => day.dt === '2026-08-21');
    expect(inserted.b).toBe('New York City');
  });

  test('assigns the LAST base (not the first) for the trip\'s trailing final day', () => {
    // Regression case: a real 11-day Boston/New York trip labeled its actual
    // last day (2026-08-26, equal to New York's own checkout date) as
    // "Boston" and populated it with a Boston-only attraction. The date-range
    // match used `date < b.co` (checkout exclusive, correct for handing an
    // intermediate checkout date to the NEXT base's check-in) but that means
    // the very last day of the whole trip — equal to the LAST base's own
    // checkout date — never satisfies any window and fell back to
    // route.b[0], the FIRST city, instead of the last one.
    const itinerary = {
      dy: [
        { d: 1, dt: '2026-08-25', b: 'New York City', it: [], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'New York City'", ln: [] },
        // 08-26 missing — the trip's actual last day, equal to New York's checkout date.
      ],
    } as any;
    const result = ensureFullDateCoverage(itinerary, '2026-08-25', '2026-08-26', route);
    const lastDay = result.dy.find((day: any) => day.dt === '2026-08-26');
    expect(lastDay.b).toBe('New York City');
  });

  test('renumbers day indexes sequentially after inserting missing dates', () => {
    const itinerary = {
      dy: [
        { d: 1, dt: '2026-08-16', b: 'Boston', it: [], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [] },
        { d: 2, dt: '2026-08-18', b: 'Boston', it: [], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [] },
      ],
    } as any;
    const result = ensureFullDateCoverage(itinerary, '2026-08-16', '2026-08-18', route);
    expect(result.dy.map((day: any) => day.d)).toEqual([1, 2, 3]);
  });

  test('is a no-op when every date is already present', () => {
    const itinerary = {
      dy: [
        { d: 1, dt: '2026-08-16', b: 'Boston', it: [['M', 'O', 'X']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [] },
        { d: 2, dt: '2026-08-17', b: 'Boston', it: [], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [] },
      ],
    } as any;
    const result = ensureFullDateCoverage(itinerary, '2026-08-16', '2026-08-17', route);
    expect(result.dy).toHaveLength(2);
    expect(result.dy[0].it).toEqual([['M', 'O', 'X']]);
  });
});

describe('rebalanceItineraryPacing', () => {
  const dayWithItems = (dt: string, b: string, count: number) => ({
    d: 0,
    dt,
    b,
    it: Array.from({ length: count }, (_, i) => ['D', 'O', `${b} activity ${i + 1} on ${dt}`]),
    me: ['BQ', 'LC', 'DL'],
    sl: `Lodging at '${b}'`,
    ln: [],
  });

  test('moves spare items from an overloaded day to an empty day in the same base', () => {
    // Regression case: a real Boston/New York trip had a day with 5 packed
    // items (running past 9pm) while other days in the same city sat at 2-3,
    // and some dates had zero items at all.
    const itinerary = {
      dy: [
        dayWithItems('2026-08-16', 'Boston', 5),
        dayWithItems('2026-08-17', 'Boston', 0),
        dayWithItems('2026-08-18', 'Boston', 2),
      ],
    } as any;

    const result = rebalanceItineraryPacing(itinerary, { minItemsPerDay: 2, maxItemsPerDay: 5 });
    const counts = result.dy.map((day: any) => day.it.length);
    // Total item count is conserved — nothing invented, nothing dropped.
    expect(counts.reduce((a: number, b: number) => a + b, 0)).toBe(7);
    // No day should still be sitting at 0 while another has more than the target.
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  test('never moves an item to a day in a different base/destination', () => {
    const itinerary = {
      dy: [
        dayWithItems('2026-08-16', 'Boston', 5),
        dayWithItems('2026-08-17', 'New York City', 0),
      ],
    } as any;
    const result = rebalanceItineraryPacing(itinerary, { minItemsPerDay: 2, maxItemsPerDay: 5 });
    const nyDay = result.dy.find((day: any) => day.b === 'New York City');
    expect(nyDay.it).toEqual([]);
    const bostonDay = result.dy.find((day: any) => day.b === 'Boston');
    expect(bostonDay.it).toHaveLength(5);
  });

  test('never adds items to a zero-activity (terminal-only) day', () => {
    const itinerary = {
      dy: [
        dayWithItems('2026-08-16', 'Boston', 5),
        dayWithItems('2026-08-17', 'Boston', 0),
      ],
    } as any;
    const result = rebalanceItineraryPacing(itinerary, {
      minItemsPerDay: 2,
      maxItemsPerDay: 5,
      zeroActivityDayDates: new Set(['2026-08-17']),
    });
    const blockedDay = result.dy.find((day: any) => day.dt === '2026-08-17');
    expect(blockedDay.it).toEqual([]);
    const otherDay = result.dy.find((day: any) => day.dt === '2026-08-16');
    expect(otherDay.it).toHaveLength(5);
  });

  test('never exceeds maxItemsPerDay on the receiving day', () => {
    const itinerary = {
      dy: [
        dayWithItems('2026-08-16', 'Boston', 5),
        dayWithItems('2026-08-17', 'Boston', 4),
      ],
    } as any;
    const result = rebalanceItineraryPacing(itinerary, { minItemsPerDay: 2, maxItemsPerDay: 5 });
    for (const day of result.dy) {
      expect(day.it.length).toBeLessThanOrEqual(5);
    }
  });

  test('is a no-op when days are already balanced', () => {
    const itinerary = {
      dy: [
        dayWithItems('2026-08-16', 'Boston', 3),
        dayWithItems('2026-08-17', 'Boston', 3),
      ],
    } as any;
    const result = rebalanceItineraryPacing(itinerary, { minItemsPerDay: 2, maxItemsPerDay: 5 });
    expect(result.dy.map((day: any) => day.it.length)).toEqual([3, 3]);
  });
});
