import {
  EXPORT_HEADERS,
  HEADER_ALIASES,
  fieldsForCommit,
  mapColumns,
  matchExistingRecords,
  parseChecklistCell,
  parseCsv,
  parseStatus,
  toCsv,
  toExportRows,
  toReviewRows,
  type TransferEntity,
} from '../utils/dataTransfer';

const TRIP_START = '2027-05-01';
const TRIP_END = '2027-05-10';

/** Export records to CSV text, read it back, and build the review rows an import would show. */
const roundTrip = (entity: TransferEntity, records: Array<Record<string, any>>, edit?: (csv: string) => string) => {
  let csv = toCsv(EXPORT_HEADERS[entity], toExportRows(entity, records, { tripStart: TRIP_START }));
  if (edit) csv = edit(csv);
  const parsed = parseCsv(csv);
  const mapped = mapColumns(parsed.headers, HEADER_ALIASES[entity]);
  const rows = toReviewRows(entity, parsed.rows, mapped.mapping, TRIP_START, TRIP_END);
  return { csv, parsed, mapped, rows, matched: matchExistingRecords(entity, rows, records, { tripStart: TRIP_START }) };
};

const activity = { id: 'a1', name: 'Sagrada Familia', date: '2027-05-03', startTime: '10:00', startLocation: 'Carrer de Mallorca 401', notes: 'Early entry.', activityType: 'Sights & Landmarks', duration: '2h', status: 'Needs Booking', cost: 58, freeCancelBy: '2027-05-01', bookedOn: 'Klook', reference: 'SF-1' };
const lodging = { id: 'l1', name: 'Ryokan, Kyoto', checkInDate: '2027-05-02T00:00:00.000Z', checkOutDate: '2027-05-04', address: '12 Gion', notes: 'Private onsen.\nSecond line.', status: 'Booked', rooms: 2, refundBy: '2027-05-01', totalCost: 400, features: ['Breakfast', 'Dinner'] };
const transfer = { id: 't1', transferType: 'Public Transit', departureDate: '2027-05-03', departureTime: '09:00', departureLocation: 'TOKYO STATION', arrivalLocation: 'KYOTO STATION', arrivalDate: '2027-05-03', arrivalTime: '11:15', carrier: 'JR', flightNumber: 'Nozomi 11', cost: 140, bookingReference: 'ABC123', status: 'Booked' };
const rental = { id: 'c1', vendor: 'Hertz', model: 'Fiat 500', pickupDate: '2027-05-03', pickupLocation: 'Airport', dropoffDate: '2027-05-05', dropoffLocation: 'City', prepaid: 'No', cost: 95, reference: 'HZ-1', notes: 'Child seat.', status: 'Booked' };
const note = { id: 'd1', day: 2, kind: 'note', activity: 'Booking priorities', time: '', cost: null, noteBody: '1. Shinkansen\n> OTHER: ryokan fills early', checklistItems: [] };
const checklist = { id: 'd2', day: 2, kind: 'checklist', activity: 'Before dinner', time: '07:00', cost: null, noteBody: null, position: 1, checklistItems: [{ label: 'Reserve table', checkedAt: '2027-05-01T00:00:00Z' }, { label: 'Charge phone', checkedAt: null }] };

describe('statuses', () => {
  it('reads Needed as Proposed and keeps Needs Booking', () => {
    expect(parseStatus('Needed')).toEqual({ value: 'Proposed' });
    expect(parseStatus('needs booking')).toEqual({ value: 'Needs Booking' });
    expect(parseStatus('')).toEqual({});
    expect(parseStatus('Maybe').warning).toMatch(/Unrecognized status/);
  });
});

describe('CSV round trip: export, then import the same file', () => {
  const cases: Array<[TransferEntity, Array<Record<string, any>>]> = [
    ['activities', [activity]],
    ['lodgings', [lodging]],
    ['transfers', [transfer]],
    ['car-rentals', [rental]],
    ['day-plan', [note, checklist]],
  ];

  it.each(cases)('%s: an unchanged export has no errors, no ignored columns, and every row defaults to Skip', (entity, records) => {
    const { parsed, mapped, matched } = roundTrip(entity, records);
    expect(parsed.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(mapped.unknown).toEqual([]);
    expect(mapped.issues).toEqual([]);
    expect(matched.map((row) => row.errors)).toEqual(records.map(() => []));
    expect(matched.map((row) => row.action)).toEqual(records.map(() => 'skip'));
    expect(matched.map((row) => row.existingId)).toEqual(records.map((record) => record.id));
    expect(matched.some((row) => row.changed)).toBe(false);
  });

  it('keeps notes with line breaks, commas and a quote bar exactly', () => {
    const lodgingRow = roundTrip('lodgings', [lodging]).rows[0];
    expect(lodgingRow.fields.notes).toBe('Private onsen.\nSecond line.');
    expect(lodgingRow.fields.name).toBe('Ryokan, Kyoto');
    expect(lodgingRow.fields.features).toEqual(['Breakfast', 'Dinner']);
    expect(lodgingRow.fields.checkInDate).toBe('2027-05-02');
    expect(roundTrip('day-plan', [note]).rows[0].fields.body).toBe(note.noteBody);
  });

  it('does not double the apostrophe that guards a formula-like cell', () => {
    const risky = { ...activity, notes: '=SUM(A1)' };
    const { csv, matched } = roundTrip('activities', [risky]);
    expect(csv).toContain("'=SUM(A1)");
    // The guard is part of the exported text; re-import reads it as written, so the row is "changed".
    expect(matched[0].changed).toBe(true);
  });

  it('offers an edited row as an update that sends only the columns the file had', () => {
    const { matched } = roundTrip('activities', [activity], (csv) => csv.replace('Early entry.', 'Skip the queue.'));
    expect(matched[0]).toMatchObject({ action: 'skip', changed: true, existingId: 'a1' });
    const toSend = { ...matched[0], action: 'update' as const };
    expect(fieldsForCommit(toSend)).toMatchObject({ notes: 'Skip the queue.', cost: 58, status: 'Needs Booking' });
  });

  it('never sends a default for a column the file does not have', () => {
    const csv = 'WanderBunnies Record ID,WanderBunnies Record Fingerprint,Activity Name,Activity Notes\r\na1,x,Sagrada Familia,Edited\r\n';
    const parsed = parseCsv(csv);
    const mapped = mapColumns(parsed.headers, HEADER_ALIASES.activities);
    const rows = matchExistingRecords('activities', toReviewRows('activities', parsed.rows, mapped.mapping, TRIP_START, TRIP_END), [activity], { tripStart: TRIP_START });
    expect(rows[0].changed).toBe(true);
    expect(Object.keys(fieldsForCommit({ ...rows[0], action: 'update' })).sort()).toEqual(['name', 'notes']);
  });

  it('ignores a Record ID that is not in this trip and falls back to an exact key match', () => {
    const { rows } = roundTrip('activities', [activity]);
    rows[0].recordId = 'someone-elses-id';
    const matched = matchExistingRecords('activities', rows, [activity], { tripStart: TRIP_START });
    expect(matched[0]).toMatchObject({ existingId: 'a1', action: 'skip' });
    expect(matched[0].changed).toBeUndefined();
    // A row from a different trip (its own ID, a different activity) is not matched to this trip's record.
    const csv = toCsv(EXPORT_HEADERS.activities, toExportRows('activities', [{ ...activity, id: 'zzz', name: 'Other' }], { tripStart: TRIP_START }));
    const parsed = parseCsv(csv);
    const fresh = toReviewRows('activities', parsed.rows, mapColumns(parsed.headers, HEADER_ALIASES.activities).mapping, TRIP_START, TRIP_END);
    expect(matchExistingRecords('activities', fresh, [activity], { tripStart: TRIP_START })[0]).toMatchObject({ action: 'create' });
  });
});

describe('ground transfers', () => {
  const read = (type: string, extra: Record<string, string> = {}) => {
    const csv = ['Date,Transfer Type,From,To,Departure Time,Arrival Date,Arrival Time', `2027-05-03,${type},A,B,${extra.dep ?? '09:00'},${extra.arrDate ?? ''},${extra.arr ?? '11:00'}`].join('\r\n');
    const parsed = parseCsv(csv);
    return toReviewRows('transfers', parsed.rows, mapColumns(parsed.headers, HEADER_ALIASES.transfers).mapping, TRIP_START, TRIP_END)[0];
  };

  it('maps rail, bus and ferry to Public Transit, taxis to Private Transfer, and unknown to Other with a warning', () => {
    expect(read('Shinkansen').fields.transferType).toBe('Public Transit');
    expect(read('Ferry').fields.transferType).toBe('Public Transit');
    expect(read('Taxi').fields.transferType).toBe('Private Transfer');
    const odd = read('Rickshaw');
    expect(odd.fields.transferType).toBe('Other');
    expect(odd.warnings.map((issue) => issue.field)).toContain('transferType');
  });

  it('refuses flights and bad or backwards times', () => {
    expect(read('Flight').errors.map((issue) => issue.message).join(' ')).toMatch(/Flights cannot be imported/);
    expect(read('Train', { dep: '9am' }).errors.map((issue) => issue.field)).toContain('departureTime');
    expect(read('Train', { dep: '23:00', arr: '01:00' }).errors.map((issue) => issue.field)).toContain('arrivalTime');
    expect(read('Train', { dep: '23:00', arr: '01:00', arrDate: '2027-05-04' }).errors).toEqual([]);
  });

  it('exports ground transfers only, in departure order, and treats a stored 00:00 as blank', () => {
    const flight = { ...transfer, id: 'f1', transferType: 'Flight' };
    const later = { ...transfer, id: 't2', departureDate: '2027-05-04' };
    const midnight = { ...transfer, id: 't3', departureTime: '00:00', arrivalTime: '00:00' };
    const rows = toExportRows('transfers', [later, flight, midnight, transfer]);
    expect(rows.map((row) => row['WanderBunnies Record ID'])).toEqual(['t1', 't3', 't2']);
    expect(rows[1]['Departure Time']).toBe('');
  });

  it('a Train stored under its old name matches the Public Transit it exports as', () => {
    const legacy = { ...transfer, transferType: 'Train' };
    expect(roundTrip('transfers', [legacy]).matched[0].changed).toBeUndefined();
  });
});

describe('day-plan items', () => {
  it('reads checklist cells and numbers a bare day', () => {
    expect(parseChecklistCell('[x] Passports\n[ ] Chargers\nSnacks')).toEqual([{ label: 'Passports', checked: true }, { label: 'Chargers', checked: false }, { label: 'Snacks', checked: false }]);
    const csv = ['Date,Kind,Title,Body', '2,Note,Day two,Remember'].join('\r\n');
    const parsed = parseCsv(csv);
    const row = toReviewRows('day-plan', parsed.rows, mapColumns(parsed.headers, HEADER_ALIASES['day-plan']).mapping, TRIP_START, TRIP_END)[0];
    expect(row.fields).toMatchObject({ date: '2027-05-02', kind: 'note', title: 'Day two', body: 'Remember' });
  });

  it('requires a kind, a title, a date and checklist entries', () => {
    const csv = ['Date,Kind,Title,Checklist Items', ',Poem,,', '2027-05-02,Checklist,Empty,'].join('\r\n');
    const parsed = parseCsv(csv);
    const rows = toReviewRows('day-plan', parsed.rows, mapColumns(parsed.headers, HEADER_ALIASES['day-plan']).mapping, TRIP_START, TRIP_END);
    expect(rows[0].errors.map((issue) => issue.field).sort()).toEqual(['date', 'kind', 'title']);
    expect(rows[1].errors.map((issue) => issue.field)).toEqual(['checklist']);
  });

  it('exports a checklist as [x]/[ ] lines in order', () => {
    const row = toExportRows('day-plan', [checklist], { tripStart: TRIP_START })[0];
    expect(row['Checklist Items']).toBe('[x] Reserve table\n[ ] Charge phone');
    expect(row.Date).toBe('2027-05-02');
    expect(row.Kind).toBe('Checklist');
  });
});

describe('activities and lodging, full columns', () => {
  it('imports cost, status and booking details that the export already writes', () => {
    const row = roundTrip('activities', [activity]).rows[0];
    expect(row.fields).toMatchObject({ cost: 58, status: 'Needs Booking', bookedOn: 'Klook', reference: 'SF-1', freeCancelBy: '2027-05-01' });
  });

  it('lets an explicit Status win over Booked?', () => {
    const csv = ['Check In,Check Out,Hotel,Booked?,Status', '2027-05-02,2027-05-04,Inn,Yes,Needs Booking'].join('\r\n');
    const parsed = parseCsv(csv);
    const row = toReviewRows('lodgings', parsed.rows, mapColumns(parsed.headers, HEADER_ALIASES.lodgings).mapping, TRIP_START, TRIP_END)[0];
    expect(row.fields.status).toBe('Needs Booking');
  });
});
