/// <reference types="jest" />

import { normalizeTripMapPoints } from '../src/routes/staticMapRoutes';

describe('normalizeTripMapPoints', () => {
  it('keeps valid address points and assigns sequential auto-labels', () => {
    const points = normalizeTripMapPoints(
      [
        { kind: 'flight', address: 'SFO' },
        { kind: 'lodging', address: 'Selina Puerto Viejo' },
      ],
      12
    );
    expect(points).toEqual([
      { kind: 'flight', label: 'A', location: 'SFO' },
      { kind: 'lodging', label: 'B', location: 'Selina Puerto Viejo' },
    ]);
  });

  it('prefers lat/lng over address when both are present', () => {
    const points = normalizeTripMapPoints([{ kind: 'activity', address: 'ignored', lat: 41.9, lng: 12.5 }], 12);
    expect(points).toEqual([{ kind: 'activity', label: 'A', location: '41.9,12.5' }]);
  });

  it('defaults an unrecognized or missing kind to "activity"', () => {
    const points = normalizeTripMapPoints([{ address: 'somewhere' }, { kind: 'bogus', address: 'elsewhere' }], 12);
    expect(points.map((p) => p.kind)).toEqual(['activity', 'activity']);
  });

  it('drops entries with neither a usable address nor valid coordinates', () => {
    const points = normalizeTripMapPoints(
      [
        { kind: 'activity', address: '' },
        { kind: 'activity', address: '   ' },
        { kind: 'activity', lat: 200, lng: 12.5 }, // out of range latitude
        { kind: 'activity', lat: 41.9 }, // missing lng
        { kind: 'activity', address: 'Valid Place' },
      ],
      12
    );
    expect(points).toHaveLength(1);
    expect(points[0].location).toBe('Valid Place');
  });

  it('truncates to maxPoints, keeping the first entries in order', () => {
    const raw = Array.from({ length: 20 }).map((_, i) => ({ kind: 'activity', address: `Stop ${i}` }));
    const points = normalizeTripMapPoints(raw, 12);
    expect(points).toHaveLength(12);
    expect(points[0].location).toBe('Stop 0');
    expect(points[11].location).toBe('Stop 11');
  });

  it('caps address length to prevent an oversized upstream URL', () => {
    const longAddress = 'A'.repeat(500);
    const points = normalizeTripMapPoints([{ kind: 'activity', address: longAddress }], 12);
    expect(points[0].location.length).toBe(200);
  });

  it('respects a client-supplied single alphanumeric label instead of auto-assigning', () => {
    const points = normalizeTripMapPoints([{ kind: 'activity', address: 'X', label: 'z' }], 12);
    expect(points[0].label).toBe('Z');
  });

  it('ignores a malformed multi-character label and falls back to auto-assignment', () => {
    const points = normalizeTripMapPoints([{ kind: 'activity', address: 'X', label: 'Stop 1' }], 12);
    expect(points[0].label).toBe('A');
  });

  it('returns an empty array for non-array input', () => {
    expect(normalizeTripMapPoints(null, 12)).toEqual([]);
    expect(normalizeTripMapPoints(undefined, 12)).toEqual([]);
    expect(normalizeTripMapPoints('not an array', 12)).toEqual([]);
    expect(normalizeTripMapPoints({ kind: 'activity', address: 'X' }, 12)).toEqual([]);
  });

  it('skips non-object entries mixed into the array', () => {
    const points = normalizeTripMapPoints([null, 'x', 42, { kind: 'activity', address: 'Valid' }], 12);
    expect(points).toHaveLength(1);
  });
});
