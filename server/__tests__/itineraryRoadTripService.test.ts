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

  it('fails closed with a structured conflict when no dates are available', () => {
    const result = buildRoadTripLogisticsOverlay({ destinations: ['Sibiu'] });
    expect(result.baseStays).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ code: 'MISSING_BASE', required: true }),
    ]);
  });
});
