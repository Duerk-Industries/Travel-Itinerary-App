/// <reference types="jest" />

import { buildTripDayMapUrl, type TripMapPoint } from '../utils/googleMaps';

const BACKEND_URL = 'https://api.example.com';

describe('buildTripDayMapUrl', () => {
  it('returns an empty string when there are no points', () => {
    expect(buildTripDayMapUrl([], BACKEND_URL)).toBe('');
  });

  it('returns an empty string when backendUrl is missing or not an http(s) URL', () => {
    const points: TripMapPoint[] = [{ kind: 'activity', address: 'Somewhere' }];
    expect(buildTripDayMapUrl(points, undefined)).toBe('');
    expect(buildTripDayMapUrl(points, '')).toBe('');
    expect(buildTripDayMapUrl(points, 'not-a-url')).toBe('');
  });

  it('drops points with neither an address nor lat/lng, keeping the rest', () => {
    const points: TripMapPoint[] = [
      { kind: 'activity', address: '' },
      { kind: 'lodging', address: 'Selina Puerto Viejo' },
    ];
    const url = buildTripDayMapUrl(points, BACKEND_URL);
    const parsed = new URL(url);
    const decoded = JSON.parse(parsed.searchParams.get('points')!);
    expect(decoded).toEqual([{ kind: 'lodging', address: 'Selina Puerto Viejo' }]);
  });

  it('returns an empty string when every point is unusable', () => {
    const points: TripMapPoint[] = [{ kind: 'activity', address: '' }, { kind: 'activity' }];
    expect(buildTripDayMapUrl(points, BACKEND_URL)).toBe('');
  });

  it('builds a URL against /api/maps/trip-day carrying the point list as JSON', () => {
    const points: TripMapPoint[] = [
      { kind: 'flight', address: 'SFO' },
      { kind: 'activity', lat: 41.9, lng: 12.5 },
    ];
    const url = buildTripDayMapUrl(points, `${BACKEND_URL}/`);
    expect(url.startsWith(`${BACKEND_URL}/api/maps/trip-day?points=`)).toBe(true);

    const parsed = new URL(url);
    const decoded = JSON.parse(parsed.searchParams.get('points')!);
    expect(decoded).toEqual(points);
  });

  it('caps the number of points sent, keeping the first N in order', () => {
    const points: TripMapPoint[] = Array.from({ length: 20 }).map((_, i) => ({
      kind: 'activity' as const,
      address: `Stop ${i}`,
    }));
    const url = buildTripDayMapUrl(points, BACKEND_URL);
    const parsed = new URL(url);
    const decoded = JSON.parse(parsed.searchParams.get('points')!);
    expect(decoded).toHaveLength(12);
    expect(decoded[0].address).toBe('Stop 0');
    expect(decoded[11].address).toBe('Stop 11');
  });
});
