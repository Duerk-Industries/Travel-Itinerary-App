/**
 * Fingerprints for the CSV import's optimistic-concurrency check. The client computes the same
 * value when it opens the review screen (app/utils/dataTransfer.ts: canonicalRecord and
 * FINGERPRINT_KEYS); an update whose fingerprint no longer matches the stored record means someone
 * edited it since, so nothing is written. Keep the two files in step.
 */

export type DataTransferEntity = 'activities' | 'lodgings' | 'transfers' | 'car-rentals' | 'day-plan';

export const FINGERPRINT_KEYS: Record<DataTransferEntity, string[]> = {
  activities: ['name', 'date', 'startTime', 'startLocation', 'notes'],
  lodgings: ['name', 'checkInDate', 'checkOutDate', 'address', 'notes'],
  transfers: ['transferType', 'departureDate', 'departureTime', 'departureLocation', 'arrivalLocation'],
  'car-rentals': ['vendor', 'pickupDate', 'pickupLocation', 'dropoffDate', 'notes'],
  'day-plan': ['date', 'kind', 'title', 'time', 'body'],
};

type AnyRecord = Record<string, any>;

const pick = (record: AnyRecord, ...names: string[]): unknown => {
  for (const name of names) if (record[name] !== undefined && record[name] !== null) return record[name];
  return '';
};

/**
 * A stored date as YYYY-MM-DD. Adapters hand back a plain string, an ISO timestamp or a Date,
 * and the fingerprint must not depend on which.
 */
export const dateOnly = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
};

const addDaysIso = (iso: string, days: number): string => {
  const date = new Date(`${dateOnly(iso)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Train, bus and ferry are stored as Public Transit now; older rows keep the old names. */
export const canonicalTransferType = (value: unknown): string => {
  const text = String(value ?? '').trim();
  if (['Train', 'Bus', 'Ferry', 'Public Transit'].includes(text)) return 'Public Transit';
  if (text === 'Private' || text === 'Private Transfer') return 'Private Transfer';
  return text === 'Other' ? 'Other' : 'Flight';
};

// A blank time is stored as 00:00 (the transfers route does the same), so both read as blank.
const clock = (value: unknown): string => {
  const text = String(value ?? '').trim();
  return text === '00:00' ? '' : text;
};

export const canonicalFingerprintInput = (entity: DataTransferEntity, record: AnyRecord, context: { tripStart?: string | null } = {}): AnyRecord => {
  switch (entity) {
    case 'activities':
      return { name: record.name, date: dateOnly(record.date), startTime: record.startTime, startLocation: record.startLocation, notes: record.notes };
    case 'lodgings':
      return { name: record.name, checkInDate: dateOnly(pick(record, 'checkInDate', 'check_in_date')), checkOutDate: dateOnly(pick(record, 'checkOutDate', 'check_out_date')), address: record.address, notes: record.notes };
    case 'transfers':
      return {
        transferType: canonicalTransferType(pick(record, 'transferType', 'transfer_type')), departureDate: dateOnly(pick(record, 'departureDate', 'departure_date')),
        departureTime: clock(pick(record, 'departureTime', 'departure_time')), departureLocation: pick(record, 'departureLocation', 'departure_location'),
        arrivalLocation: pick(record, 'arrivalLocation', 'arrival_location'),
      };
    case 'car-rentals':
      return { vendor: record.vendor, pickupDate: dateOnly(record.pickupDate), pickupLocation: record.pickupLocation, dropoffDate: dateOnly(record.dropoffDate), notes: record.notes };
    case 'day-plan':
      return {
        date: context.tripStart && Number(record.day) >= 1 ? addDaysIso(dateOnly(context.tripStart), Number(record.day) - 1) : '', kind: record.kind ?? 'activity',
        title: record.activity, time: record.time ?? '', body: record.noteBody ?? '',
      };
  }
};

export const dataTransferFingerprint = (entity: DataTransferEntity, record: AnyRecord, context: { tripStart?: string | null } = {}): string => {
  const input = canonicalFingerprintInput(entity, record, context);
  return JSON.stringify(FINGERPRINT_KEYS[entity].reduce<Record<string, unknown>>((out, key) => {
    out[key] = String(input[key] ?? '').trim().toLowerCase();
    return out;
  }, {}));
};
