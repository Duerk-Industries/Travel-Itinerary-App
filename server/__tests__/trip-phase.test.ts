/// <reference types="jest" />
import { classifyTripPhase, localDateIn } from '../src/utils/tripPhase';

const trip = { startDate: '2026-07-10', endDate: '2026-07-14' };

describe('classifyTripPhase', () => {
  it('uses inclusive trip-local start and end dates', () => {
    const at = (iso: string) => classifyTripPhase({ ...trip, occurredAt: iso, tripTimezone: 'Europe/Paris' }).phase;
    expect(at('2026-07-09T21:59:00Z')).toBe('pre_trip'); // 23:59 Jul 9 in Paris
    expect(at('2026-07-09T22:00:00Z')).toBe('during_trip'); // 00:00 Jul 10 in Paris
    expect(at('2026-07-14T21:59:00Z')).toBe('during_trip'); // last minute of Jul 14 in Paris
    expect(at('2026-07-14T22:00:00Z')).toBe('post_trip');
  });

  it('classifies by the trip zone, not server UTC, across the date line', () => {
    // 2026-07-10T05:00Z is still Jul 9 (19:00) in Honolulu but already Jul 10 in UTC.
    expect(classifyTripPhase({ ...trip, occurredAt: '2026-07-10T05:00:00Z', tripTimezone: 'Pacific/Honolulu' }).phase).toBe('pre_trip');
    expect(classifyTripPhase({ ...trip, occurredAt: '2026-07-10T05:00:00Z', tripTimezone: 'UTC' }).phase).toBe('during_trip');
  });

  it('handles daylight-saving transitions without shifting the calendar date', () => {
    expect(localDateIn('2026-03-08T07:30:00Z', 'America/New_York')).toBe('2026-03-08'); // DST starts that morning
    expect(localDateIn('2026-11-01T05:30:00Z', 'America/New_York')).toBe('2026-11-01'); // DST ends that morning
  });

  it('falls back segment → trip → device → unknown and reports the level used', () => {
    const occurredAt = '2026-07-12T12:00:00Z';
    expect(classifyTripPhase({ ...trip, occurredAt, segmentTimezone: 'Asia/Tokyo', tripTimezone: 'Europe/Paris', deviceTimezone: 'UTC' }).timezoneSource).toBe('segment');
    expect(classifyTripPhase({ ...trip, occurredAt, tripTimezone: 'Europe/Paris', deviceTimezone: 'UTC' }).timezoneSource).toBe('trip');
    expect(classifyTripPhase({ ...trip, occurredAt, deviceTimezone: 'America/Chicago' })).toMatchObject({ timezoneSource: 'device', phase: 'during_trip' });
    expect(classifyTripPhase({ ...trip, occurredAt, tripTimezone: 'Not/AZone', deviceTimezone: 'UTC' }).timezoneSource).toBe('device');
    expect(classifyTripPhase({ ...trip, occurredAt })).toEqual({ phase: 'unknown', timezoneSource: 'none', localDate: null, dateVersion: null });
  });

  it('treats missing, invalid or inverted dates as unknown, and a single date as a one-day trip', () => {
    const occurredAt = '2026-07-12T12:00:00Z';
    expect(classifyTripPhase({ occurredAt, deviceTimezone: 'UTC' }).phase).toBe('unknown');
    expect(classifyTripPhase({ occurredAt, startDate: '2026-02-30', endDate: '2026-03-02', deviceTimezone: 'UTC' }).phase).toBe('unknown');
    expect(classifyTripPhase({ occurredAt, startDate: '2026-07-14', endDate: '2026-07-10', deviceTimezone: 'UTC' }).phase).toBe('unknown');
    expect(classifyTripPhase({ occurredAt, startDate: '2026-07-12', deviceTimezone: 'UTC' }).phase).toBe('during_trip');
  });

  it('changes dateVersion when the dates or zone change, so history is not silently rewritten', () => {
    const occurredAt = '2026-07-12T12:00:00Z';
    const a = classifyTripPhase({ ...trip, occurredAt, tripTimezone: 'UTC' }).dateVersion;
    const b = classifyTripPhase({ ...trip, endDate: '2026-07-15', occurredAt, tripTimezone: 'UTC' }).dateVersion;
    const c = classifyTripPhase({ ...trip, occurredAt, deviceTimezone: 'UTC' }).dateVersion;
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('classifyTripPhase with database Date values', () => {
  it('accepts DATE columns returned as UTC-midnight or local-midnight Date objects', () => {
    const occurredAt = '2026-07-12T12:00:00Z';
    const utcMidnight = new Date(Date.UTC(2026, 6, 10));
    const localMidnight = new Date(2026, 6, 14);
    expect(classifyTripPhase({ occurredAt, startDate: utcMidnight, endDate: localMidnight, deviceTimezone: 'UTC' }).phase).toBe('during_trip');
    expect(classifyTripPhase({ occurredAt: '2026-07-09T12:00:00Z', startDate: utcMidnight, endDate: localMidnight, deviceTimezone: 'UTC' }).phase).toBe('pre_trip');
  });
});
