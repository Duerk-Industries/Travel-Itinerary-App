import { activityCalendarEvent, buildCalendarIcs, buildGoogleCalendarUrl, makeCalendarEvent, transferCalendarEvent } from '../utils/calendarEvents';

it('rejects missing/invalid dates and invalid supplied times', () => {
  for (const date of ['', 'TBD', '2027-02-30']) expect(makeCalendarEvent({ id: '1', title: 'Trip', date })).toBeNull();
  expect(makeCalendarEvent({ id: '1', title: 'Trip', date: '2027-04-01', time: '25:15' })).toBeNull();
});

it('preserves local times, parses AM/PM, and rolls durations past midnight', () => {
  const event = activityCalendarEvent({ id: '1', name: 'Night tour', date: '2027-04-01', startTime: '11:30 PM',
    duration: '1 hour 45 minutes', startLocation: 'Tokyo & Chiba', notes: '', reference: 'ABC' })!;
  expect(event.start).toBe('2027-04-01T23:30:00');
  expect(event.end).toBe('2027-04-02T01:15:00');
  const params = new URL(buildGoogleCalendarUrl(event)).searchParams;
  expect(params.get('dates')).toBe('20270401T233000/20270402T011500');
  expect(params.get('location')).toBe('Tokyo & Chiba');
});

it('uses exclusive all-day end dates without shifting days for device time zones', () => {
  const event = makeCalendarEvent({ id: '1', title: 'Hotel', date: '2027-04-01', endDate: '2027-04-04' })!;
  expect(event).toMatchObject({ allDay: true, start: '2027-04-01', end: '2027-04-04' });
  expect(buildCalendarIcs(event)).toContain('DTSTART;VALUE=DATE:20270401\r\nDTEND;VALUE=DATE:20270404');
  expect(makeCalendarEvent({ id: '2', title: 'Day', date: '2027-12-31' })?.end).toBe('2028-01-01');
});

it('uses the explicit arrival date for overnight transfers and retains arrival details', () => {
  const event = transferCalendarEvent({ id: 'f1', departureDate: '2027-04-01', departureTime: '23:00', arrivalDate: '2027-04-02',
    arrivalTime: '07:30', carrier: 'Airline', flightNumber: '123', bookingReference: 'ABC' })!;
  expect(event.end).toBe('2027-04-02T07:30:00');
  expect(event.description).toContain('Verify departure and arrival time zones');
});

it('escapes calendar text, folds Unicode safely, and keeps a stable UID', () => {
  const event = makeCalendarEvent({ id: 'tour-1', title: 'Tour, dinner; 東京'.repeat(10), date: '2027-04-01', time: '09:00',
    description: 'Line one\nLine two\\end' })!;
  const ics = buildCalendarIcs(event, new Date('2027-01-01T00:00:00Z'));
  expect(ics).toContain('UID:tour-1@wanderbunnies');
  expect(ics).toContain('DTSTAMP:20270101T000000Z');
  expect(ics).toContain('DESCRIPTION:Line one\\nLine two\\\\end');
  expect(ics).toContain('SUMMARY:Tour\\, dinner\\;');
  for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
});
