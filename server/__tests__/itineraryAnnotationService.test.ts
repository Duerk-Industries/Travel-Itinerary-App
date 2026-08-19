/// <reference types="jest" />

import type { ActivityBlock, LocationProfile } from '../src/schemas/itineraryCacheSchemas';
import type { AttractionCatalogEntry, AttractionDurationMetadata } from '../src/types';
import {
  buildAnnotatedItinerary,
  repairActivitiesForVerifiedAvailability,
  renderAnnotatedItineraryMarkdown,
} from '../src/services/itineraryAnnotationService';

const hikeBlock: ActivityBlock = {
  block_id: 'blk-mountain-trail',
  location_id: 'kyoto',
  zone_id: 'east',
  role: 'anchor',
  category: 'hike',
  title: 'Mountain Trail',
  name_local: '山道',
  name_script: 'Yamamichi',
  copy: {
    teaser: 'A scenic climb.',
    body: 'A hillside trail with broad views over the city.',
    insider_tip: 'Start early and carry water.',
    etiquette: 'Yield on narrow steps.',
    priority_signal: 'dont_skip',
  },
  timing: {
    optimal_arrival: 'early morning',
    hard_deadline: null,
    time_box: 'half day',
    after_dark_value: false,
  },
  cost_band: { currency: 'JPY', low: 0, high: 0, note: null },
  duration_minutes: { typical: 180, min: 120, max: 240 },
  energy_cost: 5,
  availability: {
    closed_days: [],
    booking_lead_days: 30,
    ticket_required: true,
    sells_out_risk: 'high',
  },
  relations: {
    pairs_well_with: [],
    conflicts_with: [],
    substitutes_for: ['blk-city-museum'],
    foreshadows: [],
    complements: [],
    duplicates: [],
    skip_if_completed: [],
  },
  interest_weights: {
    outdoors: 10,
    adventure: 9,
    culture: 2,
    food: 1,
    nightlife: 1,
    relaxing: 2,
    photography: 8,
    authentic_local: 3,
    iconic_landmarks: 4,
  },
  source: 'curated',
  last_verified: '2026-08-01',
};

const contingencyBlock: ActivityBlock = {
  ...hikeBlock,
  block_id: 'blk-city-museum',
  role: 'contingency',
  category: 'museum',
  title: 'City Museum',
  name_local: null,
  name_script: null,
  energy_cost: 1,
  availability: { closed_days: [], ticket_required: false },
};

const catalogEntry: AttractionCatalogEntry = {
  id: 'catalog-mountain-trail',
  destinationKey: 'kyoto',
  destinationDisplayName: 'Kyoto',
  name: 'Mountain Trail',
  rank: 1,
  activityType: 'Hike',
  interestTags: ['outdoors', 'adventure'],
  sourceUrl: 'https://example.test/mountain-trail',
  sourceLabel: 'Official destination guide',
  wikipediaTitle: 'Mountain Trail',
  wikipediaSummary: 'A hillside trail with broad views over the city.',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const durationMetadata: AttractionDurationMetadata = {
  id: 'duration-mountain-trail',
  destinationKey: 'kyoto',
  destinationDisplayName: 'Kyoto',
  name: 'Mountain Trail',
  activityType: 'Hike',
  estimatedDurationMinutes: 180,
  durationSource: 'override',
  requiresPreOrderTickets: true,
  preOrderNotes: 'Reserve the timed trail permit.',
  description: 'A hillside trail with broad views over the city.',
  descriptionSource: 'wikipedia',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('itinerary annotation service', () => {
  it('adds route rationale, evidence, actions, contingencies, and physical summaries', () => {
    const annotation = buildAnnotatedItinerary({
      route: {
        eh: 'KIX',
        xh: 'NRT',
        rationale: {
          thesis: 'Move east as the seasonal conditions change.',
          organizingFactors: ['Keep consecutive stops geographically coherent.'],
          tradeoffs: ['Verify the long transfer before booking.'],
        },
        bases: [{
          location: 'Kyoto',
          checkIn: '2026-11-27',
          checkOut: '2026-12-03',
          dayTrips: ['Uji'],
          rationale: 'A six-night base reduces hotel changes and supports a Uji day trip.',
        }],
        transfers: [{ date: '2026-11-27', mode: 'Flight', from: 'KIX', to: 'Kyoto' }],
      },
      days: [{
        day: 1,
        date: '2026-11-27',
        base: 'Kyoto',
        logisticsNotes: ['Confirm permit availability one week before.'],
        activities: [{ name: 'Mountain Trail', activityType: 'Hike', startTime: '08:00', duration: '3h' }],
      }],
      catalogEntries: [catalogEntry],
      durationMetadataByName: new Map([['mountain trail', durationMetadata]]),
      whyFitsByName: new Map([['mountain trail', 'It supports your outdoors and adventure interests.']]),
      activityBlocks: [hikeBlock, contingencyBlock],
    });

    expect(annotation.route.thesis).toBe('Move east as the seasonal conditions change.');
    expect(annotation.route.bases[0]).toMatchObject({ location: 'Kyoto', nights: 6 });
    expect(annotation.days[0].activities[0]).toMatchObject({
      names: { display: 'Mountain Trail', native: '山道', romanized: 'Yamamichi', travelerLanguage: null },
      booking: { required: true, leadDays: 30, sellsOutRisk: 'high', verificationRequired: true },
      effort: { energyCost: 5, weatherDependent: true },
      confidence: 'verified',
    });
    expect(annotation.days[0].activities[0].evidence.map((item) => item.sourceType)).toEqual(
      expect.arrayContaining(['curated', 'catalog', 'wikipedia'])
    );
    expect(annotation.days[0].contingencies).toContainEqual(expect.objectContaining({
      condition: 'rain',
      recommendation: 'Use City Museum as the poor-weather replacement.',
    }));
    expect(annotation.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'book', timing: 'now', label: 'Reserve Mountain Trail' }),
      expect.objectContaining({ type: 'verify', label: 'Confirm hours and ticket availability for Mountain Trail' }),
      expect.objectContaining({ type: 'book', label: 'Book lodging in Kyoto for 2026-11-27 to 2026-12-03' }),
    ]));
    expect(annotation.summary.hikes).toEqual([
      expect.objectContaining({ date: '2026-11-27', name: 'Mountain Trail', verificationRequired: true }),
    ]);
    expect(annotation.validation).toMatchObject({ evidenceCoverage: 1, bookingActionsCovered: true });

    const markdown = renderAnnotatedItineraryMarkdown(annotation);
    expect(markdown).toContain('## Route Strategy');
    expect(markdown).toContain('## Booking & Verification Checklist');
    expect(markdown).toContain('## Pace & Contingencies');
    expect(markdown).toContain('## Physical Activity Summary');
  });

  it('marks ungrounded free-form activities as unsupported instead of inventing annotations', () => {
    const annotation = buildAnnotatedItinerary({
      route: {
        eh: 'AAA',
        xh: 'AAA',
        bases: [{ location: 'Example City', checkIn: '2026-01-01', checkOut: '2026-01-02' }],
        transfers: [],
      },
      days: [{
        day: 1,
        date: '2026-01-01',
        base: 'Example City',
        activities: [{ name: 'Unverified Secret Garden', activityType: 'Open Access' }],
      }],
      catalogEntries: [],
      durationMetadataByName: new Map(),
      whyFitsByName: new Map(),
    });

    expect(annotation.days[0].activities[0]).toMatchObject({
      whatItIs: null,
      insiderTip: null,
      evidence: [],
      confidence: 'needs_confirmation',
    });
    expect(annotation.validation.unsupportedActivities).toEqual(['Unverified Secret Garden']);
    expect(annotation.validation.evidenceCoverage).toBe(0);
  });

  it('repairs only activities constrained by verified operating schedules', () => {
    const closedBlock: ActivityBlock = {
      ...hikeBlock,
      availability: {
        ...hikeBlock.availability,
        closed_days: ['monday'],
        operating_schedule: {
          timezone: 'Asia/Tokyo',
          weekly: { monday: [] },
          seasonal_overrides: [],
          exceptions: [],
          confidence: 'verified',
        },
      },
    };
    const afternoonBlock: ActivityBlock = {
      ...contingencyBlock,
      availability: {
        closed_days: [],
        ticket_required: false,
        operating_schedule: {
          timezone: 'Asia/Tokyo',
          weekly: { tuesday: [{ opens: '12:00', closes: '17:00' }] },
          seasonal_overrides: [],
          exceptions: [],
          confidence: 'verified',
        },
      },
    };
    const draftBlock: ActivityBlock = {
      ...hikeBlock,
      block_id: 'blk-draft-attraction',
      title: 'Draft Attraction',
      source: 'llm_draft',
      last_verified: null,
      availability: closedBlock.availability,
    };
    const itinerary: { dy: Array<{ dt: string; it: Array<[string, string, string]> }> } = {
      dy: [
        { dt: '2026-11-30', it: [['M', 'A', 'Mountain Trail'], ['D', 'A', 'Draft Attraction']] },
        { dt: '2026-12-01', it: [['M', 'A', 'City Museum']] },
      ],
    };

    const result = repairActivitiesForVerifiedAvailability(itinerary, [closedBlock, afternoonBlock, draftBlock]);

    expect(result.itinerary.dy[0].it).toEqual([['D', 'A', 'Draft Attraction']]);
    expect(result.itinerary.dy[1].it).toEqual([['D', 'A', 'City Museum']]);
    expect(result.repairs).toEqual([
      '2026-11-30: removed Mountain Trail because verified availability marks it closed.',
      '2026-12-01: moved City Museum from M to D to fit its verified operating window.',
    ]);
  });

  describe('lodging-zone guidance', () => {
    const kyotoProfile: LocationProfile = {
      location_id: 'kyoto',
      name: 'Kyoto',
      location_type: 'city',
      country_code: 'JP',
      timezone: 'Asia/Tokyo',
      zones: [
        {
          zone_id: 'east',
          name: 'Higashiyama',
          name_local: '東山',
          centroid: null,
          traversal: 'walk',
          terrain_note: null,
          adjacency: [{ zone_id: 'central', minutes: 12, mode: 'walk' }],
          // Deliberately no `lodging` block — this zone is where the day's activities cluster,
          // but it isn't itself recommendable for lodging.
        },
        {
          zone_id: 'central',
          name: 'Kyoto Station Area',
          name_local: '京都駅周辺',
          centroid: null,
          traversal: 'transit',
          terrain_note: null,
          adjacency: [
            { zone_id: 'east', minutes: 12, mode: 'walk', from_stop: 'Kyoto Station', to_stop: 'Gion-Shijo' },
          ],
          lodging: {
            suitable: true,
            rationale_by_trip_shape: { default: 'Central hub with direct transit to every base in the itinerary.' },
            access_note: 'Every JR and subway line converges here.',
            cost_band: 'mid',
            alternative_zone_id: 'north',
            alternative_reason: 'Quieter and roughly 20% cheaper, at the cost of a longer commute.',
          },
        },
        {
          zone_id: 'north',
          name: 'Kitayama',
          name_local: '北山',
          centroid: null,
          traversal: 'transit',
          terrain_note: null,
          adjacency: [],
          lodging: { suitable: true, access_note: null, cost_band: 'budget', alternative_zone_id: null, alternative_reason: null },
        },
      ],
      season_windows: [],
      default_day_template_id: null,
    };

    const baseInput = {
      route: {
        eh: 'KIX',
        xh: 'NRT',
        bases: [{ location: 'Kyoto', checkIn: '2026-11-27', checkOut: '2026-12-03', dayTrips: [] }],
        transfers: [],
      },
      days: [{
        day: 1,
        date: '2026-11-27',
        base: 'Kyoto',
        activities: [{ name: 'Mountain Trail', activityType: 'Hike' }],
      }],
      catalogEntries: [],
      durationMetadataByName: new Map(),
      whyFitsByName: new Map(),
      activityBlocks: [hikeBlock], // hikeBlock.zone_id === 'east', hikeBlock.location_id === 'kyoto'
    };

    it('recommends the nearest lodging-suitable zone via the adjacency graph when activities cluster somewhere not lodging-suitable', () => {
      const annotation = buildAnnotatedItinerary({ ...baseInput, locationProfiles: [kyotoProfile] });
      expect(annotation.route.bases[0].lodgingZone).toMatchObject({
        zoneName: 'Kyoto Station Area',
        zoneNameLocal: '京都駅周辺',
        whyItFits: 'Central hub with direct transit to every base in the itinerary.',
        transitAdvantage: 'Every JR and subway line converges here.',
        costBand: 'mid',
        alternative: { zoneName: 'Kitayama', reason: 'Quieter and roughly 20% cheaper, at the cost of a longer commute.' },
        confidence: 'needs_confirmation',
      });
      expect(annotation.route.bases[0].lodgingZone?.stations).toEqual(
        expect.arrayContaining(['Kyoto Station', 'Gion-Shijo'])
      );
    });

    it('is null when no LocationProfile is supplied for the destination — never fabricates a recommendation', () => {
      const annotation = buildAnnotatedItinerary(baseInput);
      expect(annotation.route.bases[0].lodgingZone).toBeNull();
    });

    it('is null when the corpus has no lodging-suitable zone at all for this location', () => {
      const noSuitableProfile: LocationProfile = {
        ...kyotoProfile,
        zones: kyotoProfile.zones.map((zone) => ({ ...zone, lodging: undefined })),
      };
      const annotation = buildAnnotatedItinerary({ ...baseInput, locationProfiles: [noSuitableProfile] });
      expect(annotation.route.bases[0].lodgingZone).toBeNull();
    });

    it('renders the lodging zone and its alternative into the markdown', () => {
      const annotation = buildAnnotatedItinerary({ ...baseInput, locationProfiles: [kyotoProfile] });
      const markdown = renderAnnotatedItineraryMarkdown(annotation);
      expect(markdown).toContain('Stay in **Kyoto Station Area**');
      expect(markdown).toContain('More affordable/convenient alternative: **Kitayama**');
    });
  });
});
