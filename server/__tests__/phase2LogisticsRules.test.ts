import { accumulateDayFriction } from '../src/services/frictionAccumulatorService';
import { buildArrivalDepartureFacts, renderLogisticsFactBlock } from '../src/services/arrivalDepartureRulesService';

describe('Phase 2 fatigue and endpoint logistics', () => {
  test('flags a transfer-heavy base-change day for rest/hub status', () => {
    const result = accumulateDayFriction({ transferMinutes: 300, transferCount: 2, baseChange: true, activityMinutes: 240, walkingKm: 3, groupBufferMinutes: 30 });
    expect(result.status).toBe('rest-hub');
    expect(result.reasons).toEqual(expect.arrayContaining(['four or more transfer hours', 'base change']));
  });

  test('creates heavy-arrival recovery and protected-departure facts', () => {
    const facts = buildArrivalDepartureFacts({
      arrival: { date: '2026-08-01', localTime: '18:30', isLongHaul: true, durationHours: 9 },
      departure: { date: '2026-08-07', localTime: '15:00' }, departureBufferMinutes: 180,
    });
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-08-01', kind: 'arrival', maxActivities: 1 }),
      expect.objectContaining({ date: '2026-08-02', kind: 'recovery', earliestActivityTime: '10:00' }),
      expect.objectContaining({ date: '2026-08-07', kind: 'departure', latestActivityTime: '12:00' }),
    ]));
    expect(renderLogisticsFactBlock(facts)).toContain('Heavy arrival day');
  });
});

