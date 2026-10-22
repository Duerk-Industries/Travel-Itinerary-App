/// <reference types="jest" />
/// <reference types="node" />

import {
  MAX_OPTIMIZE_STOPS,
  haversineKm,
  moveStop,
  optimizeDayOrder,
  routeLengthKm,
  type RouteStop,
} from '../../packages/domain/src/dayRouteOptimizer';
import { compareDayActivities, orderDayActivities } from '../../packages/domain/src/dayOrder';

// Points roughly on a west-to-east line through Tokyo, so the best route is easy to reason about.
const WEST: RouteStop = { id: 'west', lat: 35.68, lng: 139.5 };
const MID: RouteStop = { id: 'mid', lat: 35.68, lng: 139.7 };
const EAST: RouteStop = { id: 'east', lat: 35.68, lng: 139.9 };
const FAR_EAST: RouteStop = { id: 'far-east', lat: 35.68, lng: 140.1 };

describe('haversine and route length', () => {
  it('measures a known distance within a small tolerance', () => {
    // Tokyo Station to Shinjuku Station is about 6.1 km.
    const km = haversineKm({ lat: 35.6812, lng: 139.7671 }, { lat: 35.6896, lng: 139.7006 });
    expect(km).toBeGreaterThan(5.8);
    expect(km).toBeLessThan(6.5);
  });

  it('adds the return leg when an anchor is given and skips stops without coordinates', () => {
    const noCoords: RouteStop = { id: 'unknown' };
    const open = routeLengthKm([WEST, noCoords, EAST]);
    const loop = routeLengthKm([WEST, noCoords, EAST], { lat: WEST.lat!, lng: WEST.lng! });
    expect(open).toBeCloseTo(haversineKm({ lat: 35.68, lng: 139.5 }, { lat: 35.68, lng: 139.9 }), 6);
    expect(loop).toBeCloseTo(open * 2, 6);
  });
});

describe('optimizeDayOrder', () => {
  it('straightens a zig-zag route and reports the saving', () => {
    const result = optimizeDayOrder([WEST, FAR_EAST, MID, EAST]);
    expect(result.changed).toBe(true);
    expect(result.order).toEqual(['west', 'mid', 'east', 'far-east']);
    expect(result.afterKm).toBeLessThan(result.beforeKm);
  });

  it('is deterministic: the same input always gives the same suggestion', () => {
    const stops = [EAST, WEST, FAR_EAST, MID];
    expect(optimizeDayOrder(stops)).toEqual(optimizeDayOrder(stops));
  });

  it('leaves an already-short route alone and says why', () => {
    const result = optimizeDayOrder([WEST, MID, EAST, FAR_EAST]);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe('already_best');
    expect(result.order).toEqual(['west', 'mid', 'east', 'far-east']);
  });

  it('keeps booked (fixed) stops in their exact slot and only moves flexible ones around them', () => {
    const booked: RouteStop = { ...MID, id: 'booked-tour', fixed: true };
    const result = optimizeDayOrder([WEST, booked, FAR_EAST, EAST]);
    expect(result.order[1]).toBe('booked-tour');
    expect(result.keptInPlace).toEqual(['booked-tour']);
    expect(result.afterKm).toBeLessThanOrEqual(result.beforeKm);
  });

  it('keeps stops without coordinates where they are and never invents a position for them', () => {
    const unknown: RouteStop = { id: 'no-address' };
    const result = optimizeDayOrder([FAR_EAST, unknown, WEST, MID, EAST]);
    expect(result.order[1]).toBe('no-address');
    expect(result.keptInPlace).toContain('no-address');
    expect([...result.order].sort()).toEqual(['east', 'far-east', 'mid', 'no-address', 'west']);
  });

  it('starts and ends at the anchor when one is given', () => {
    const lodging = { lat: 35.68, lng: 139.95 };
    const withAnchor = optimizeDayOrder([MID, WEST, EAST], lodging);
    // The shortest loop out of the lodging and back sweeps the line once each way: twice the
    // distance to the farthest stop. Either direction of that sweep is equally short.
    const direct = haversineKm(lodging, { lat: WEST.lat!, lng: WEST.lng! });
    expect(withAnchor.changed).toBe(true);
    expect(withAnchor.afterKm).toBeCloseTo(direct * 2, 3);
    expect(withAnchor.afterKm).toBeLessThan(withAnchor.beforeKm);
    expect(['east,mid,west', 'west,mid,east']).toContain(withAnchor.order.join(','));
  });

  it('treats a loop and its reverse as equally good and leaves the user\'s order alone', () => {
    const lodging = { lat: 35.68, lng: 139.95 };
    expect(optimizeDayOrder([WEST, MID, EAST], lodging).changed).toBe(false);
  });

  it('never returns a longer route than it was given', () => {
    const stops: RouteStop[] = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`,
      lat: 35 + Math.sin(i * 1.7) * 0.2,
      lng: 139 + Math.cos(i * 2.3) * 0.3,
    }));
    const result = optimizeDayOrder(stops);
    expect(result.afterKm).toBeLessThanOrEqual(result.beforeKm + 1e-9);
    expect([...result.order].sort()).toEqual(stops.map((s) => s.id).sort());
  });

  it('refuses days that are too small, too large, or have fewer than two movable stops', () => {
    expect(optimizeDayOrder([WEST]).reason).toBe('too_few');
    const tooMany = Array.from({ length: MAX_OPTIMIZE_STOPS + 1 }, (_, i) => ({ id: `s${i}`, lat: 35, lng: 139 + i / 100 }));
    expect(optimizeDayOrder(tooMany).reason).toBe('too_many');
    expect(optimizeDayOrder([WEST, { ...MID, fixed: true }]).reason).toBe('nothing_to_move');
    expect(optimizeDayOrder([WEST, { id: 'x' }]).reason).toBe('nothing_to_move');
  });
});

describe('moveStop', () => {
  it('moves a stop one place up or down', () => {
    expect(moveStop(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveStop(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('does nothing at the edges or for an unknown id, and never mutates the input', () => {
    const input = ['a', 'b', 'c'];
    expect(moveStop(input, 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveStop(input, 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moveStop(input, 'zzz', 1)).toEqual(['a', 'b', 'c']);
    expect(input).toEqual(['a', 'b', 'c']);
  });
});

describe('shared day ordering', () => {
  const stops = [
    { id: 'c', name: 'Charlie', startTime: '09:00', dayPosition: null },
    { id: 'b', name: 'Bravo', startTime: '14:00', dayPosition: 0 },
    { id: 'a', name: 'Alpha', startTime: null, dayPosition: 1 },
    { id: 'd', name: 'Delta', startTime: '08:00', dayPosition: null },
  ];

  it('puts explicitly placed stops first by position, then unplaced stops by start time', () => {
    expect(orderDayActivities(stops).map((s) => s.id)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('is a total order: ties on position, time and name fall back to id', () => {
    const tied = [{ id: 'z', name: 'Same' }, { id: 'y', name: 'Same' }];
    expect(orderDayActivities(tied).map((s) => s.id)).toEqual(['y', 'z']);
    expect(compareDayActivities(tied[0]!, tied[1]!)).toBeGreaterThan(0);
  });

  it('does not mutate its input', () => {
    const copy = [...stops];
    orderDayActivities(stops);
    expect(stops).toEqual(copy);
  });
});
