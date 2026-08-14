import { parseRoadTripHints } from '../src/routes/itineraryRoutes';

describe('parseRoadTripHints', () => {
  it('returns undefined for missing, non-object, or entirely-empty input', () => {
    expect(parseRoadTripHints(undefined)).toBeUndefined();
    expect(parseRoadTripHints(null)).toBeUndefined();
    expect(parseRoadTripHints('nope')).toBeUndefined();
    expect(parseRoadTripHints({})).toBeUndefined();
    expect(parseRoadTripHints({ corridors: [], deadlines: [], variants: [], locationCoordinates: {} })).toBeUndefined();
  });

  it('parses valid corridors and drops invalid/incomplete ones', () => {
    const result = parseRoadTripHints({
      corridors: [
        { fromLocationId: 'bucharest', toLocationId: 'brasov', minutes: 165, mode: 'drive', confidence: 'estimated' },
        { fromLocationId: 'a', toLocationId: 'b', minutes: -5 }, // invalid: non-positive
        { fromLocationId: 'a', toLocationId: 'b', minutes: 5000 }, // invalid: exceeds 1440
        { fromLocationId: '', toLocationId: 'b', minutes: 60 }, // invalid: empty id
        { fromLocationId: 'a', toLocationId: 'b', minutes: 60, mode: 'teleport' }, // unknown mode dropped, entry kept
      ],
    });
    expect(result?.corridors).toHaveLength(2);
    expect(result?.corridors?.[0]).toMatchObject({ fromLocationId: 'bucharest', toLocationId: 'brasov', minutes: 165, mode: 'drive', confidence: 'estimated' });
    expect(result?.corridors?.[1]).toMatchObject({ fromLocationId: 'a', toLocationId: 'b', minutes: 60 });
    expect(result?.corridors?.[1]).not.toHaveProperty('mode');
  });

  it('caps corridors at 32 entries', () => {
    const corridors = Array.from({ length: 40 }, (_, i) => ({ fromLocationId: `a${i}`, toLocationId: `b${i}`, minutes: 60 }));
    const result = parseRoadTripHints({ corridors });
    expect(result?.corridors).toHaveLength(32);
  });

  it('parses valid deadlines and rejects malformed dates/times/missing reason codes', () => {
    const result = parseRoadTripHints({
      deadlines: [
        { date: '2026-09-17', at: '12:00', reasonCode: 'CAR_RETURN_PREP', requiredSlackMinutes: 60 },
        { date: '2026-9-17', at: '12:00', reasonCode: 'BAD_DATE' }, // invalid date format
        { date: '2026-09-17', at: '25:99', reasonCode: 'BAD_TIME' }, // invalid time format
        { date: '2026-09-17', at: '12:00', reasonCode: '' }, // missing reason code
      ],
    });
    expect(result?.deadlines).toHaveLength(1);
    expect(result?.deadlines?.[0]).toMatchObject({ date: '2026-09-17', at: '12:00', reasonCode: 'CAR_RETURN_PREP', requiredSlackMinutes: 60 });
  });

  it('clamps requiredSlackMinutes into [0, 1440]', () => {
    const result = parseRoadTripHints({
      deadlines: [{ date: '2026-09-17', at: '12:00', reasonCode: 'X', requiredSlackMinutes: -50 }],
    });
    expect(result?.deadlines?.[0].requiredSlackMinutes).toBe(0);
  });

  it('parses valid variants, filters unknown conditions, and defaults exclusiveGroup from date', () => {
    const result = parseRoadTripHints({
      variants: [
        {
          variantId: 'dry-route', date: '2026-09-16', labelReasonCode: 'DRY_ROUTE',
          activityNames: ['Transfăgărășan'], conditions: ['dry', 'blizzard'], estimatedMinutes: 420,
        },
        { variantId: '', date: '2026-09-16', labelReasonCode: 'MISSING_ID' }, // invalid: empty id
        { variantId: 'ok', date: 'not-a-date', labelReasonCode: 'BAD_DATE' }, // invalid date
      ],
    });
    expect(result?.variants).toHaveLength(1);
    expect(result?.variants?.[0]).toMatchObject({
      variantId: 'dry-route',
      date: '2026-09-16',
      exclusiveGroup: 'day_2026-09-16',
      conditions: ['dry'],
      estimatedMinutes: 420,
    });
  });

  it('parses valid location coordinates and rejects out-of-range or malformed entries', () => {
    const result = parseRoadTripHints({
      locationCoordinates: {
        bucharest: { lat: 44.4268, lng: 26.1025 },
        brasov: { lat: 45.6427, lng: 25.5887 },
        invalid_lat: { lat: 999, lng: 0 },
        invalid_lng: { lat: 0, lng: -999 },
        not_an_object: 'nope',
      },
    });
    expect(result?.locationCoordinates).toEqual({
      bucharest: { lat: 44.4268, lng: 26.1025 },
      brasov: { lat: 45.6427, lng: 25.5887 },
    });
  });

  it('caps location coordinates at 16 entries', () => {
    const locationCoordinates = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`loc_${i}`, { lat: 0, lng: 0 }])
    );
    const result = parseRoadTripHints({ locationCoordinates });
    expect(Object.keys(result?.locationCoordinates ?? {})).toHaveLength(16);
  });

  it('rejects an array passed as locationCoordinates instead of a keyed object', () => {
    const result = parseRoadTripHints({ locationCoordinates: [{ lat: 0, lng: 0 }] });
    expect(result).toBeUndefined();
  });
});
