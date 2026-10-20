import { digestDueAt, quietUntil, validTimezone } from '../src/services/notificationTiming';

describe('notification quiet hours', () => {
  const timing = { timezone: 'America/New_York', quietStart: '22:00', quietEnd: '08:00' };
  it('defers overnight delivery until local morning', () => {
    expect(quietUntil(timing, Date.parse('2026-10-19T03:00:00Z'))).toBe(Date.parse('2026-10-19T12:00:00Z'));
    expect(quietUntil(timing, Date.parse('2026-10-19T16:00:00Z'))).toBeNull();
  });
  it('handles the spring-forward gap and repeated fall-back hour', () => {
    expect(quietUntil({ ...timing, quietEnd: '02:30' }, Date.parse('2026-03-08T06:00:00Z'))).toBe(Date.parse('2026-03-08T07:00:00Z'));
    expect(quietUntil(timing, Date.parse('2026-11-01T05:30:00Z'))).toBe(Date.parse('2026-11-01T13:00:00Z'));
  });
  it('supports same-day windows and explicit disable', () => {
    expect(quietUntil({ timezone: 'UTC', quietStart: '12:00', quietEnd: '14:00' }, Date.parse('2026-10-19T13:00:00Z'))).toBe(Date.parse('2026-10-19T14:00:00Z'));
    expect(quietUntil({ ...timing, quietEnd: '22:00' })).toBeNull();
    expect(validTimezone('unknown/not-a-zone')).toBe(false);
    expect(quietUntil(null)).toBeNull();
  });
});


it('schedules a local digest after its UTC source window and handles DST gaps', () => {
  expect(digestDueAt({ timezone: 'America/New_York', time: '08:00' }, Date.parse('2026-10-19T00:00:00Z'))).toBe(Date.parse('2026-10-19T12:00:00Z'));
  expect(digestDueAt({ timezone: 'America/New_York', time: '02:30' }, Date.parse('2026-03-08T00:00:00Z'))).toBe(Date.parse('2026-03-08T07:00:00Z'));
  expect(digestDueAt({ timezone: 'America/New_York', time: '01:30' }, Date.parse('2026-11-01T00:00:00Z'))).toBe(Date.parse('2026-11-01T05:30:00Z'));
  expect(digestDueAt({ timezone: 'Asia/Tokyo', time: '08:00' }, Date.parse('2026-10-19T00:00:00Z'))).toBe(Date.parse('2026-10-19T23:00:00Z'));
  expect(digestDueAt({ timezone: 'Europe/Berlin', time: '01:59' }, Date.parse('2026-10-25T00:00:00Z'))).toBe(Date.parse('2026-10-26T00:59:00Z'));
});
