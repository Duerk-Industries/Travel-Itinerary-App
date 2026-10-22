import { describeLocateSummary, locateStops, locateTargets, type LocateTarget } from '../utils/locateStops';
import type { PlanningMapPoint } from '../../server/src/types';

const point = (overrides: Partial<PlanningMapPoint>): PlanningMapPoint => ({ id: 'x', kind: 'activity', title: 'Stop', ...overrides });

describe('locateTargets', () => {
  it('lists only unlocated stops that can be looked up from a saved address', () => {
    const targets = locateTargets([
      point({ id: 'a1', kind: 'activity', title: 'Senso-ji' }),
      point({ id: 'a2', kind: 'activity', title: 'Already there', lat: 35.7, lng: 139.8, coordinateSource: 'manual' }),
      point({ id: 'l1', kind: 'lodging', title: 'Hotel' }),
      point({ id: 'f1:departure', kind: 'flight', title: 'BOS' }),
      point({ id: 'r1:pickup', kind: 'car_rental', title: 'Narita' }),
      point({ id: 'r1:dropoff', kind: 'car_rental', title: 'Haneda', lat: 35.5, lng: 139.7, coordinateSource: 'geocoder' }),
      point({ id: 'r2', kind: 'car_rental', title: 'Malformed id' }),
    ]);
    expect(targets).toEqual([
      { kind: 'activity', itemId: 'a1', title: 'Senso-ji' },
      { kind: 'lodging', itemId: 'l1', title: 'Hotel' },
      { kind: 'car_rental', itemId: 'r1', which: 'pickup', title: 'Narita' },
    ]);
  });

  it('is empty when everything is already on the map', () => {
    expect(locateTargets([point({ lat: 1, lng: 2, coordinateSource: 'catalog' })])).toEqual([]);
  });
});

describe('locateStops', () => {
  const targets: LocateTarget[] = [
    { kind: 'lodging', itemId: 'l1', title: 'Hotel' },
    { kind: 'activity', itemId: 'a1', title: 'Museum' },
    { kind: 'car_rental', itemId: 'r1', which: 'dropoff', title: 'Drop' },
  ];
  const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
  const run = (fetchImpl: jest.Mock) => locateStops({ backendUrl: 'https://api.test', tripId: 'trip 1', headers: { Authorization: 'Bearer t' }, targets, fetchImpl: fetchImpl as unknown as typeof fetch });

  it('asks the server to look up each item by id, never sending text to look up', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply({ status: 'located' }));
    const summary = await run(fetchImpl);
    expect(summary).toEqual({ located: 3, notFound: 0, failed: 0, stoppedForLimit: false, attempted: 3 });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.test/api/trips/trip%201/locate-item');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ kind: 'lodging', itemId: 'l1' });
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({ kind: 'car_rental', itemId: 'r1', which: 'dropoff' });
    expect(fetchImpl.mock.calls[0][1].headers).toEqual(expect.objectContaining({ Authorization: 'Bearer t' }));
  });

  it('counts not-found, failed and rejected lookups separately and keeps going', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(reply({ status: 'not_found' }))
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(reply({ status: 'unavailable' }, 200));
    expect(await run(fetchImpl)).toEqual({ located: 0, notFound: 1, failed: 2, stoppedForLimit: false, attempted: 3 });
  });

  it('stops at the first limit instead of hammering the server', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(reply({ status: 'located' })).mockResolvedValueOnce(reply({ error: 'slow down' }, 429));
    const summary = await run(fetchImpl);
    expect(summary).toEqual({ located: 1, notFound: 0, failed: 0, stoppedForLimit: true, attempted: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const quota = jest.fn().mockResolvedValue(reply({ status: 'quota' }));
    expect((await run(quota)).stoppedForLimit).toBe(true);
    expect(quota).toHaveBeenCalledTimes(1);
  });
});

describe('describeLocateSummary', () => {
  it('reads as plain sentences', () => {
    expect(describeLocateSummary({ located: 1, notFound: 0, failed: 0, stoppedForLimit: false, attempted: 1 })).toBe('Placed 1 stop on the map.');
    expect(describeLocateSummary({ located: 3, notFound: 2, failed: 1, stoppedForLimit: true, attempted: 6 }))
      .toBe("Placed 3 stops on the map. 2 couldn't be found. Check their address. 1 couldn't be looked up right now. Try again later. The lookup limit was reached. Try again later.");
    expect(describeLocateSummary({ located: 0, notFound: 0, failed: 0, stoppedForLimit: false, attempted: 0 })).toBe('Nothing to look up.');
  });
});
