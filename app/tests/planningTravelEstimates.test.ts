import { travelEstimate } from '../../packages/domain/src/planningTravelEstimates';

it('estimates adjacent stops with the free walking and driving speeds', () => {
  expect(travelEstimate({ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 })).toBe('~14 min walk · ~3 min drive');
});
it('does not invent a route over unresolved or invalid stops', () => {
  expect(travelEstimate(undefined, { lat: 0, lng: 0 })).toBeNull();
  expect(travelEstimate({ lat: NaN, lng: 0 }, { lat: 0, lng: 0 })).toBeNull();
  expect(travelEstimate({}, { lat: 0, lng: 0 })).toBeNull();
  expect(travelEstimate({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe('Same area');
});
