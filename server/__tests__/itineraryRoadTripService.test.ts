import { buildRoadTripLogisticsOverlay } from '../src/services/itineraryRoadTripService';

describe('itinerary road-trip-lite planner', () => {
  it('builds dated bases, buffered legs, deadline cuts, and exclusive variants deterministically', () => {
    const result = buildRoadTripLogisticsOverlay({
      destinations: ['Bucharest', 'Brașov', 'Sibiu'],
      startDate: '2026-09-10',
      endDate: '2026-09-18',
      lodgings: [
        { id: 'lodging-b', name: 'Bucharest base', address: 'Bucharest', checkInDate: '2026-09-10', checkOutDate: '2026-09-11' },
        { id: 'lodging-r', name: 'Brașov base', address: 'Brașov', checkInDate: '2026-09-11', checkOutDate: '2026-09-13' },
        { id: 'lodging-s', name: 'Sibiu base', address: 'Sibiu', checkInDate: '2026-09-13', checkOutDate: '2026-09-18' },
      ],
      corridors: [
        { fromLocationId: 'Bucharest', toLocationId: 'Brașov', minutes: 165, confidence: 'estimated' },
        { fromLocationId: 'Brașov', toLocationId: 'Sibiu', minutes: 150, confidence: 'estimated' },
      ],
      carRentals: [{ pickupDate: '2026-09-11', dropoffDate: '2026-09-18' }],
      activities: [
        { date: '2026-09-17', name: 'Poenari optional stop', duration: '8h' },
        { date: '2026-09-17', name: 'Scenic detour', duration: '8h' },
      ],
      deadlines: [{ date: '2026-09-17', at: '12:00', reasonCode: 'CAR_RETURN_PREP', requiredSlackMinutes: 60 }],
      variants: [
        { variantId: 'transfagarasan-dry', date: '2026-09-16', labelReasonCode: 'DRY_ROUTE', activityNames: ['Transfăgărășan', 'Bâlea Lake'], estimatedMinutes: 420, exclusiveGroup: 'transfagarasan', conditions: ['dry'] },
        { variantId: 'transfagarasan-wet', date: '2026-09-16', labelReasonCode: 'POOR_WEATHER_ROUTE', activityNames: ['Sibiu museums'], estimatedMinutes: 240, exclusiveGroup: 'transfagarasan', conditions: ['poor_weather'] },
      ],
      enableTimedRoutes: true,
      enableDayVariants: true,
    });

    expect(result.baseStays).toHaveLength(3);
    expect(result.travelLegs).toHaveLength(2);
    expect(result.travelLegs[0]).toMatchObject({ source: 'static_corridor', confidence: 'estimated', mode: 'drive' });
    expect(result.activeVariantIds).toEqual(['transfagarasan-dry']);
    expect(result.timedRouteDays).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-09-17', hardDeadline: expect.objectContaining({ reasonCode: 'CAR_RETURN_PREP' }) }),
    ]));
    expect(result.conflicts).toEqual([]);
    const deadlineDay = result.timedRouteDays.find((day) => day.date === '2026-09-17');
    expect(deadlineDay?.checkpoints.some((checkpoint) => checkpoint.checkpointId.includes('scenic_detour'))).toBe(false);
  });

  it('tags checkpoints with the origin they resolve against (travel leg vs. bound activity)', () => {
    const result = buildRoadTripLogisticsOverlay({
      destinations: ['Bucharest', 'Brașov'],
      startDate: '2026-09-10',
      endDate: '2026-09-12',
      lodgings: [
        { address: 'Bucharest', checkInDate: '2026-09-10', checkOutDate: '2026-09-11' },
        { address: 'Brașov', checkInDate: '2026-09-11', checkOutDate: '2026-09-12' },
      ],
      corridors: [{ fromLocationId: 'Bucharest', toLocationId: 'Brașov', minutes: 165 }],
      activities: [{ date: '2026-09-11', name: 'Black Church', duration: '1h' }],
      deadlines: [{ date: '2026-09-11', at: '20:00', reasonCode: 'DINNER_RESERVATION' }],
    });

    const day = result.timedRouteDays.find((candidate) => candidate.date === '2026-09-11');
    expect(day?.checkpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkpointType: 'travel_leg', required: true }),
      expect.objectContaining({ checkpointType: 'activity_block', required: false }),
    ]));
  });

  it('prefers the dry-condition variant deterministically regardless of input order', () => {
    const buildResult = (variants: Array<{ variantId: string; conditions: Array<'dry' | 'poor_weather'> }>) =>
      buildRoadTripLogisticsOverlay({
        destinations: ['Sibiu'],
        startDate: '2026-09-16',
        endDate: '2026-09-17',
        variants: variants.map((variant) => ({
          variantId: variant.variantId,
          date: '2026-09-16',
          labelReasonCode: 'ROUTE_OPTION',
          activityNames: [variant.variantId],
          exclusiveGroup: 'transfagarasan',
          conditions: variant.conditions,
        })),
      });

    const dryFirst = buildResult([
      { variantId: 'dry-option', conditions: ['dry'] },
      { variantId: 'wet-option', conditions: ['poor_weather'] },
    ]);
    const wetFirst = buildResult([
      { variantId: 'wet-option', conditions: ['poor_weather'] },
      { variantId: 'dry-option', conditions: ['dry'] },
    ]);

    expect(dryFirst.activeVariantIds).toEqual(['dry-option']);
    expect(wetFirst.activeVariantIds).toEqual(['dry-option']);
  });

  it('estimates leg time from real coordinates (geodesic) when no corridor or transfer is supplied', () => {
    const result = buildRoadTripLogisticsOverlay({
      destinations: ['Bucharest', 'Brașov'],
      startDate: '2026-09-10',
      endDate: '2026-09-12',
      lodgings: [
        { address: 'Bucharest', checkInDate: '2026-09-10', checkOutDate: '2026-09-11' },
        { address: 'Brașov', checkInDate: '2026-09-11', checkOutDate: '2026-09-12' },
      ],
      locationCoordinates: {
        bucharest: { lat: 44.4268, lng: 26.1025 },
        brasov: { lat: 45.6427, lng: 25.5887 },
      },
    });

    expect(result.travelLegs).toHaveLength(1);
    const leg = result.travelLegs[0];
    expect(leg.source).toBe('heuristic');
    expect(leg.confidence).toBe('estimated');
    // ~166 km real driving distance; sanity-bound rather than pin an exact number to the speed
    // constant so this doesn't become a change-detector test.
    expect(leg.estimatedMinutes).toBeGreaterThan(60);
    expect(leg.estimatedMinutes).toBeLessThan(400);
  });

  it('falls back to the flat low-confidence estimate when neither a corridor nor coordinates exist', () => {
    const result = buildRoadTripLogisticsOverlay({
      destinations: ['Bucharest', 'Brașov'],
      startDate: '2026-09-10',
      endDate: '2026-09-12',
      lodgings: [
        { address: 'Bucharest', checkInDate: '2026-09-10', checkOutDate: '2026-09-11' },
        { address: 'Brașov', checkInDate: '2026-09-11', checkOutDate: '2026-09-12' },
      ],
    });

    expect(result.travelLegs).toHaveLength(1);
    expect(result.travelLegs[0]).toMatchObject({ source: 'heuristic', confidence: 'low', estimatedMinutes: 120 });
  });

  it('truncates a day past the checkpoint cap deterministically instead of throwing', () => {
    const activities = Array.from({ length: 15 }, (_, index) => ({
      date: '2026-09-11',
      name: `Stop ${index}`,
      duration: '30m',
    }));
    const result = buildRoadTripLogisticsOverlay({
      destinations: ['Sibiu'],
      startDate: '2026-09-11',
      endDate: '2026-09-12',
      activities,
    });

    const day = result.timedRouteDays.find((candidate) => candidate.date === '2026-09-11');
    expect(day?.checkpoints.length).toBeLessThanOrEqual(12);
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'LIMIT_REACHED', date: '2026-09-11', required: false }),
    ]));
    // Lowest cutPriority (earliest-listed, i.e. highest-priority) activities survive the cut.
    expect(day?.checkpoints.some((checkpoint) => checkpoint.checkpointId.includes('stop_0'))).toBe(true);
    expect(day?.checkpoints.some((checkpoint) => checkpoint.checkpointId.includes('stop_14'))).toBe(false);
  });

  it('reports driving outside the supplied rental window without dropping the leg', () => {
    const result = buildRoadTripLogisticsOverlay({
      destinations: ['Bucharest', 'Brașov'],
      startDate: '2026-09-10',
      endDate: '2026-09-12',
      lodgings: [
        { address: 'Bucharest', checkInDate: '2026-09-10', checkOutDate: '2026-09-11' },
        { address: 'Brașov', checkInDate: '2026-09-11', checkOutDate: '2026-09-12' },
      ],
      carRentals: [{ pickupDate: '2026-09-12', dropoffDate: '2026-09-18' }],
    });

    expect(result.travelLegs).toHaveLength(1);
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TRANSPORT_WINDOW', required: true }),
    ]));
  });

  it('truncates an oversized day-variant list instead of throwing, and drops orphaned active ids', () => {
    const variants = Array.from({ length: 130 }, (_, index) => ({
      variantId: `variant-${index}`,
      date: '2026-09-11',
      labelReasonCode: 'ROUTE_OPTION',
      activityNames: [`Stop ${index}`],
      exclusiveGroup: `group-${index}`,
      conditions: ['dry' as const],
    }));
    const result = buildRoadTripLogisticsOverlay({
      destinations: ['Sibiu'],
      startDate: '2026-09-11',
      endDate: '2026-09-12',
      variants,
    });

    expect(result.dayVariants.length).toBeLessThanOrEqual(124);
    expect(result.activeVariantIds.every((id) => result.dayVariants.some((variant) => variant.variantId === id))).toBe(true);
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'LIMIT_REACHED', required: false }),
    ]));
  });

  it('fails closed with a structured conflict when no dates are available', () => {
    const result = buildRoadTripLogisticsOverlay({ destinations: ['Sibiu'] });
    expect(result.baseStays).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ code: 'MISSING_BASE', required: true }),
    ]);
  });

  it('rejects a nonexistent calendar date instead of letting it silently roll into the next month', () => {
    // "2026-02-30" doesn't exist; JS Date arithmetic would otherwise silently turn it into
    // 2026-03-02, shifting every date derived from it without any signal that happened.
    const result = buildRoadTripLogisticsOverlay({
      destinations: ['Sibiu'],
      startDate: '2026-02-30',
      endDate: '2026-03-05',
    });
    expect(result.baseStays).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ code: 'MISSING_BASE', required: true }),
    ]);
  });
});
