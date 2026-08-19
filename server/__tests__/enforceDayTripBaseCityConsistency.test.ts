import { enforceDayTripBaseCityConsistency } from '../src/services/itineraryPromptPlanService';
import type { AttractionCatalogEntry } from '../src/types';

const osloAttraction: AttractionCatalogEntry = {
  id: 'cat-oslo-opera',
  destinationKey: 'oslo norway',
  destinationDisplayName: 'Oslo',
  name: 'Oslo Opera House',
  rank: 1,
  activityType: 'Sight',
  interestTags: ['culture'],
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const shortlistByDestination: Record<string, AttractionCatalogEntry[]> = {
  'Oslo, Norway': [osloAttraction],
};

const buildRoute = (dayTrips: string[]) => ({
  eh: 'OSL',
  xh: 'OSL',
  b: [{ l: 'Oslo, Norway', ci: '2026-09-01', co: '2026-09-05', dn: dayTrips, r: undefined }],
  x: [],
  rc: null,
  w: {},
  a: [],
});

describe('enforceDayTripBaseCityConsistency', () => {
  test('removes a catalog-verified base-city attraction scheduled the same day as a named day trip', () => {
    const itinerary = {
      dy: [
        {
          d: 1,
          dt: '2026-09-02',
          b: 'Oslo, Norway',
          it: [
            ['M', 'A', 'Day trip toward Lillehammer'],
            ['D', 'A', 'Oslo Opera House'],
          ],
        },
      ],
    };
    const result = enforceDayTripBaseCityConsistency(itinerary as any, buildRoute(['Lillehammer']) as any, shortlistByDestination);
    expect(result.itinerary.dy[0].it).toEqual([['M', 'A', 'Day trip toward Lillehammer']]);
    expect(result.conflicts).toEqual([
      '2026-09-02: removed "Oslo Opera House" — a verified Oslo, Norway attraction can\'t be visited the same day as the Oslo, Norway day trip.',
    ]);
  });

  test('leaves the day alone when no day trip is scheduled that day', () => {
    const itinerary = {
      dy: [
        { d: 1, dt: '2026-09-02', b: 'Oslo, Norway', it: [['D', 'A', 'Oslo Opera House']] },
      ],
    };
    const result = enforceDayTripBaseCityConsistency(itinerary as any, buildRoute(['Lillehammer']) as any, shortlistByDestination);
    expect(result.itinerary.dy[0].it).toEqual([['D', 'A', 'Oslo Opera House']]);
    expect(result.conflicts).toEqual([]);
  });

  test('leaves a day trip alone when the base has no day-trip names on record', () => {
    const itinerary = {
      dy: [
        {
          d: 1,
          dt: '2026-09-02',
          b: 'Oslo, Norway',
          it: [
            ['M', 'A', 'Day trip toward Lillehammer'],
            ['D', 'A', 'Oslo Opera House'],
          ],
        },
      ],
    };
    const result = enforceDayTripBaseCityConsistency(itinerary as any, buildRoute([]) as any, shortlistByDestination);
    expect(result.itinerary.dy[0].it).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
  });

  test('never touches an item the catalog cannot verify as physically in the base city', () => {
    const itinerary = {
      dy: [
        {
          d: 1,
          dt: '2026-09-02',
          b: 'Oslo, Norway',
          it: [
            ['M', 'A', 'Day trip toward Lillehammer'],
            ['D', 'A', 'Some uncatalogued local walk'],
          ],
        },
      ],
    };
    const result = enforceDayTripBaseCityConsistency(itinerary as any, buildRoute(['Lillehammer']) as any, shortlistByDestination);
    expect(result.itinerary.dy[0].it).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
  });

  test('is a no-op when the attractions catalog is empty', () => {
    const itinerary = {
      dy: [
        {
          d: 1,
          dt: '2026-09-02',
          b: 'Oslo, Norway',
          it: [
            ['M', 'A', 'Day trip toward Lillehammer'],
            ['D', 'A', 'Oslo Opera House'],
          ],
        },
      ],
    };
    const result = enforceDayTripBaseCityConsistency(itinerary as any, buildRoute(['Lillehammer']) as any, {});
    expect(result.itinerary.dy[0].it).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
  });
});
