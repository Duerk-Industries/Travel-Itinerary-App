import { accumulateDayFriction, calculateRouteFrictionScore } from '../src/services/frictionAccumulatorService';

describe('friction scoring', () => {
  test('calculates the documented inter-base friction score', () => {
    expect(calculateRouteFrictionScore({ transferHours: 4, transfersCount: 2, baseChanges: 1 })).toBe(13);
  });

  test('keeps same-day fatigue thresholds deterministic', () => {
    expect(accumulateDayFriction({ transferMinutes: 240, transferCount: 1, baseChange: false, activityMinutes: 120, walkingKm: 0 }).status).toBe('lighten');
  });
});
