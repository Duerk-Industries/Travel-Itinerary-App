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

  test('a terminal-only day (no booked transfer, just the trip start/end date) blocks all activities', () => {
    const facts = buildArrivalDepartureFacts({
      arrival: { date: '2026-08-01', terminalOnly: true },
      departure: { date: '2026-08-07', terminalOnly: true },
      departureBufferMinutes: 180,
    });
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-08-01', kind: 'arrival', maxActivities: 0 }),
      expect.objectContaining({ date: '2026-08-07', kind: 'departure', maxActivities: 0 }),
    ]));
    expect(renderLogisticsFactBlock(facts)).toContain('Travel day: no activities scheduled');
  });

  test('terminalOnly overrides a booked departure time that would otherwise still allow one activity', () => {
    // Without terminalOnly, an afternoon departure (>= 12:00 local) still permits up to 1 activity —
    // terminalOnly must force 0 regardless, since there's no confirmed transfer to plan around.
    const facts = buildArrivalDepartureFacts({
      departure: { date: '2026-08-07', localTime: '18:00', terminalOnly: true },
      departureBufferMinutes: 180,
    });
    expect(facts[0].maxActivities).toBe(0);
  });
});

