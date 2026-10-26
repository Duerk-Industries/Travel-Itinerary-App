import Papa from 'papaparse';
import { ITINERARY_STATUSES } from './itineraryStatus';
import { normalizeTransferType } from './transferTypes';

export type ImportIssue = {
  row?: number;
  field?: string;
  severity: 'warning' | 'error';
  message: string;
};

export type ImportReviewRow<TFields extends Record<string, unknown>> = {
  sourceRow: number;
  action: 'create' | 'update' | 'skip';
  existingId?: string;
  expectedFingerprint?: string;
  fields: TFields;
  warnings: ImportIssue[];
  errors: ImportIssue[];
  /** `WanderBunnies Record ID` / `Record Fingerprint` cells, when the file carries them. */
  recordId?: string;
  recordFingerprint?: string;
  /** Destination fields that had a CSV column; an update only writes these, never a default. */
  mappedKeys?: string[];
  /** The row matched an existing record by its ID but differs from it. */
  changed?: boolean;
};

export type ParsedCsv = {
  headers: string[];
  rows: Array<Record<string, string>>;
  issues: ImportIssue[];
};

export type TransferEntity = 'activities' | 'lodgings' | 'transfers' | 'car-rentals' | 'day-plan';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 150;
export const MAX_IMPORT_COLUMNS = 50;
export const MAX_IMPORT_CELL_LENGTH = 4000;

const cleanHeader = (value: string): string => value.replace(/^﻿/, '').trim();

export const parseCsv = (text: string): ParsedCsv => {
  const issues: ImportIssue[] = [];
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_IMPORT_BYTES) {
    return { headers: [], rows: [], issues: [{ severity: 'error', message: 'CSV file exceeds the 2 MiB limit.' }] };
  }
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: cleanHeader,
  });
  result.errors.forEach((error) => issues.push({
    row: error.row == null ? undefined : error.row + 2,
    severity: 'error',
    message: error.message,
  }));
  const headers = (result.meta.fields ?? []).map(cleanHeader);
  if (!headers.length) issues.push({ severity: 'error', message: 'CSV has no header row.' });
  if (headers.length > MAX_IMPORT_COLUMNS) issues.push({ severity: 'error', message: `CSV has more than ${MAX_IMPORT_COLUMNS} columns.` });
  const normalizedHeaders = new Set<string>();
  headers.forEach((header) => {
    const key = header.toLowerCase();
    if (!header) issues.push({ severity: 'error', message: 'CSV contains a blank header.' });
    if (normalizedHeaders.has(key)) issues.push({ severity: 'error', field: header, message: `Duplicate CSV header: ${header}` });
    normalizedHeaders.add(key);
  });
  if (result.data.length > MAX_IMPORT_ROWS) issues.push({ severity: 'error', message: `CSV contains more than ${MAX_IMPORT_ROWS} data rows.` });
  result.data.forEach((row, index) => {
    Object.entries(row).forEach(([field, value]) => {
      if (String(value ?? '').length > MAX_IMPORT_CELL_LENGTH) {
        issues.push({ row: index + 2, field, severity: 'error', message: `${field} exceeds the maximum field length.` });
      }
    });
  });
  return { headers, rows: result.data, issues };
};

export const normalizeHeader = (value: string): string =>
  cleanHeader(value).toLowerCase().replace(/[?]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const aliases = (values: string[]): Set<string> => new Set(values.map(normalizeHeader));

const RECORD_ALIASES = {
  recordId: aliases(['WanderBunnies Record ID']),
  recordFingerprint: aliases(['WanderBunnies Record Fingerprint']),
};

export const ACTIVITY_HEADER_ALIASES: Record<string, Set<string>> = {
  ...RECORD_ALIASES,
  date: aliases(['Date', 'Activity Date']),
  activityType: aliases(['Activity Type', 'Type', 'Category']),
  lodgingLocation: aliases(['Lodging Location', 'Base', 'Lodging']),
  startTime: aliases(['Start Time', 'Time']),
  duration: aliases(['Duration', 'Length']),
  name: aliases(['Activity Name', 'Name', 'Activity']),
  notes: aliases(['Activity Notes', 'Notes', 'Description']),
  startLocation: aliases(['Activity Start Address', 'Start Address', 'Address', 'Location']),
  bookAhead: aliases(['Book Ahead Required', 'Book Ahead', 'Requires Booking']),
  status: aliases(['Status']),
  cost: aliases(['Cost', 'Price']),
  bookedOn: aliases(['Booked On']),
  reference: aliases(['Booking Reference', 'Reference', 'Confirmation']),
  freeCancelBy: aliases(['Free Cancellation By', 'Cancel By']),
};

export const LODGING_HEADER_ALIASES: Record<string, Set<string>> = {
  ...RECORD_ALIASES,
  checkInDate: aliases(['Check In', 'Check-in', 'Check In Date']),
  checkOutDate: aliases(['Check Out', 'Check-out', 'Check Out Date']),
  days: aliases(['Days', 'Nights']),
  suggestedLocation: aliases(['Suggested Location', 'Location', 'Area']),
  name: aliases(['Hotel', 'Lodging Name', 'Name']),
  booked: aliases(['Booked', 'Booked?']),
  breakfast: aliases(['Breakfast', 'Breakfast?']),
  dinner: aliases(['Dinner', 'Dinner?']),
  laundry: aliases(['Laundry', 'Laundry?']),
  refundBy: aliases(['Cancel By', 'Cancellation Date', 'Refund By']),
  totalCost: aliases(['Cost', 'Total Cost', 'Price']),
  bookedOn: aliases(['Booked On', 'Booking Source', 'Provider']),
  address: aliases(['Address', 'Hotel Address']),
  status: aliases(['Status']),
  notes: aliases(['Notes', 'Lodging Notes']),
  features: aliases(['Features']),
  rooms: aliases(['Rooms']),
};

// `Departure` and `Arrival` are deliberately not aliases: a printout uses those labels for
// "HH:mm · CODE" values, which would land times in the location columns.
export const TRANSFER_HEADER_ALIASES: Record<string, Set<string>> = {
  ...RECORD_ALIASES,
  transferType: aliases(['Transfer Type', 'Mode', 'Type']),
  departureLocation: aliases(['From', 'Departure Location', 'Origin']),
  arrivalLocation: aliases(['To', 'Arrival Location', 'Destination']),
  departureDate: aliases(['Date', 'Departure Date']),
  departureTime: aliases(['Departure Time', 'Depart', 'Start Time']),
  arrivalDate: aliases(['Arrival Date']),
  arrivalTime: aliases(['Arrival Time', 'Arrive']),
  carrier: aliases(['Carrier', 'Operator', 'Line']),
  flightNumber: aliases(['Service Number', 'Train Number', 'Number']),
  cost: aliases(['Cost', 'Price']),
  reference: aliases(['Booking Reference', 'Reference', 'Confirmation']),
  status: aliases(['Status']),
};

export const CAR_RENTAL_HEADER_ALIASES: Record<string, Set<string>> = {
  ...RECORD_ALIASES,
  vendor: aliases(['Vendor', 'Company', 'Rental Company']),
  model: aliases(['Vehicle', 'Car', 'Model']),
  pickupDate: aliases(['Pick Up Date', 'Pickup Date']),
  pickupLocation: aliases(['Pick Up Location', 'Pickup Location', 'Pick Up']),
  dropoffDate: aliases(['Drop Off Date', 'Dropoff Date']),
  dropoffLocation: aliases(['Drop Off Location', 'Dropoff Location', 'Drop Off']),
  prepaid: aliases(['Prepaid']),
  cost: aliases(['Cost', 'Price']),
  reference: aliases(['Reference', 'Booking Reference', 'Confirmation']),
  notes: aliases(['Notes', 'Description']),
  status: aliases(['Status']),
};

export const DAY_PLAN_HEADER_ALIASES: Record<string, Set<string>> = {
  ...RECORD_ALIASES,
  date: aliases(['Date', 'Day']),
  kind: aliases(['Kind', 'Item Type', 'Type']),
  time: aliases(['Time', 'Start Time']),
  title: aliases(['Title', 'Name']),
  cost: aliases(['Cost', 'Price']),
  body: aliases(['Body', 'Note', 'Notes', 'Description']),
  checklist: aliases(['Checklist Items', 'Checklist', 'Items']),
  address: aliases(['Address', 'Location']),
  coordinates: aliases(['Coordinates']),
  position: aliases(['Order', 'Day Order']),
};

export const HEADER_ALIASES: Record<TransferEntity, Record<string, Set<string>>> = {
  activities: ACTIVITY_HEADER_ALIASES,
  lodgings: LODGING_HEADER_ALIASES,
  transfers: TRANSFER_HEADER_ALIASES,
  'car-rentals': CAR_RENTAL_HEADER_ALIASES,
  'day-plan': DAY_PLAN_HEADER_ALIASES,
};

export const mapColumns = (
  headers: string[],
  definition: Record<string, Set<string>>,
): { mapping: Record<string, string>; unknown: string[]; issues: ImportIssue[] } => {
  const mapping: Record<string, string> = {};
  const unknown: string[] = [];
  const issues: ImportIssue[] = [];
  headers.forEach((header) => {
    const normalized = normalizeHeader(header);
    const destination = Object.entries(definition).find(([, names]) => names.has(normalized))?.[0];
    if (!destination) {
      unknown.push(header);
      return;
    }
    if (mapping[destination]) {
      issues.push({ field: header, severity: 'error', message: `Multiple CSV columns map to ${destination}.` });
      return;
    }
    mapping[destination] = header;
  });
  return { mapping, unknown, issues };
};

const cell = (row: Record<string, string>, mapping: Record<string, string>, key: string): string => String(mapping[key] ? row[mapping[key]] ?? '' : '').trim();

const monthNames: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
  sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

export const parseImportDate = (raw: string, tripStart: string, tripEnd: string): string | null => {
  const source = raw.trim();
  if (!source) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    const date = new Date(`${source}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : source;
  }
  const match = source.replace(/,$/, '').match(/^(?:[A-Za-z]{3,9}[,\s]+)?([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (!match) return null;
  const month = monthNames[match[1].toLowerCase()];
  const day = Number(match[2]);
  if (!month || !Number.isInteger(day) || day < 1 || day > 31) return null;
  const startYear = Number(tripStart.slice(0, 4));
  const endYear = Number(tripEnd.slice(0, 4));
  const years = match[3] ? [Number(match[3])] : Array.from({ length: Math.max(1, endYear - startYear + 1) }, (_, index) => startYear + index);
  const candidates = years.map((year) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
  }).filter((value): value is string => Boolean(value)).filter((value) => value >= tripStart && value <= tripEnd);
  return candidates.length === 1 ? candidates[0] : null;
};

const activityTypeMap: Record<string, string> = {
  'food drink': 'Food & Drink',
  'temple shrine': 'Sights & Landmarks',
  castle: 'Sights & Landmarks',
  garden: 'Sights & Landmarks',
  museum: 'Sights & Landmarks',
  neighborhood: 'Sights & Landmarks',
  sightseeing: 'Sights & Landmarks',
  hike: 'Hike',
  market: 'Shopping',
  'onsen ryokan': 'Spa/Wellness',
  'free buffer': 'Open Access',
};

export const mapActivityType = (raw: string): { value: string; warning?: string } => {
  const value = activityTypeMap[normalizeHeader(raw)] ?? (raw && ['Class', 'Concert/Show', 'Day Trip', 'Event', 'Fun & Games', 'Nightlife', 'Open Access', 'Outdoor Activity', 'Reservation', 'Shopping', 'Sights & Landmarks', 'Spa/Wellness', 'Ticketed Attraction', 'Tour', 'Other'].includes(raw) ? raw : 'Other');
  return raw && value === 'Other' && normalizeHeader(raw) !== 'other' ? { value, warning: `Unrecognized activity type “${raw}”; mapped to Other.` } : { value };
};

export const parseMoney = (raw: string): number => {
  const value = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(value) && value >= 0 ? value : 0;
};

const STATUS_LOOKUP = new Map<string, string>((ITINERARY_STATUSES as readonly string[]).map((status) => [status.toLowerCase(), status]));

/**
 * Reads a Status cell. `Needed` is the old name for `Proposed`; `Needs Booking` is kept as itself.
 * A blank cell yields no value, so the caller can apply its own default.
 */
export const parseStatus = (raw: string): { value?: string; warning?: string } => {
  const source = raw.trim();
  if (!source) return {};
  const key = source.toLowerCase();
  if (key === 'needed') return { value: 'Proposed' };
  const hit = STATUS_LOOKUP.get(key);
  return hit ? { value: hit } : { warning: `Unrecognized status “${source}”; using Proposed.` };
};

/** A 24-hour clock time (`9:05` becomes `09:05`); anything else is flagged invalid. */
export const parseClock = (raw: string): { value: string; invalid?: boolean } => {
  const source = raw.trim();
  if (!source) return { value: '' };
  const match = /^(\d{1,2}):(\d{2})$/.exec(source);
  if (match && Number(match[1]) < 24 && Number(match[2]) < 60) return { value: `${match[1].padStart(2, '0')}:${match[2]}` };
  return { value: source, invalid: true };
};

/** `lat, lng` within range; `null` means blank, `undefined` means present but unusable. */
export const parseCoordinates = (raw: string): { lat: number; lng: number } | null | undefined => {
  const source = raw.trim();
  if (!source) return null;
  const match = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(source);
  if (!match) return undefined;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : undefined;
};

const parseFeatureList = (raw: string): string[] => [...new Set(raw.split(/[;,]/).map((tag) => tag.trim()).filter(Boolean))];

const addDaysIso = (iso: string, days: number): string => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const mappedKeysOf = (mapping: Record<string, string>): string[] => Object.keys(mapping).filter((key) => key !== 'recordId' && key !== 'recordFingerprint');

const rowIdentity = (row: Record<string, string>, mapping: Record<string, string>) => ({
  recordId: cell(row, mapping, 'recordId') || undefined,
  recordFingerprint: cell(row, mapping, 'recordFingerprint') || undefined,
  mappedKeys: mappedKeysOf(mapping),
});

export const toActivityReviewRows = (rows: Array<Record<string, string>>, mapping: Record<string, string>, tripStart: string, tripEnd: string): ImportReviewRow<Record<string, unknown>>[] => rows.map((row, index) => {
  const warnings: ImportIssue[] = [];
  const errors: ImportIssue[] = [];
  const date = parseImportDate(cell(row, mapping, 'date'), tripStart, tripEnd) ?? '';
  if (cell(row, mapping, 'date') && !date) errors.push({ row: index + 2, field: 'date', severity: 'error', message: 'Date is invalid or ambiguous.' });
  const name = cell(row, mapping, 'name');
  if (!name) errors.push({ row: index + 2, field: 'name', severity: 'error', message: 'Activity name is required.' });
  const type = mapActivityType(cell(row, mapping, 'activityType'));
  if (type.warning) warnings.push({ row: index + 2, field: 'activityType', severity: 'warning', message: type.warning });
  const status = parseStatus(cell(row, mapping, 'status'));
  if (status.warning) warnings.push({ row: index + 2, field: 'status', severity: 'warning', message: status.warning });
  const freeCancelRaw = cell(row, mapping, 'freeCancelBy');
  const freeCancelBy = parseImportDate(freeCancelRaw, tripStart, tripEnd);
  if (freeCancelRaw && !freeCancelBy) warnings.push({ row: index + 2, field: 'freeCancelBy', severity: 'warning', message: 'Free cancellation date is invalid and was ignored.' });
  const sourceContext = [
    cell(row, mapping, 'lodgingLocation') ? `Lodging location: ${cell(row, mapping, 'lodgingLocation')}` : '',
    cell(row, mapping, 'bookAhead') ? `Book ahead required: ${cell(row, mapping, 'bookAhead')}` : '',
  ].filter(Boolean);
  const notes = [cell(row, mapping, 'notes'), ...sourceContext].filter(Boolean).join('\n');
  return {
    sourceRow: index + 2,
    action: 'create',
    fields: {
      date, name, activityType: type.value, startTime: cell(row, mapping, 'startTime'), duration: cell(row, mapping, 'duration'),
      startLocation: cell(row, mapping, 'startLocation'), notes, status: status.value ?? 'Proposed', cost: parseMoney(cell(row, mapping, 'cost')),
      freeCancelBy: freeCancelBy ?? '', bookedOn: cell(row, mapping, 'bookedOn'), reference: cell(row, mapping, 'reference'),
    },
    warnings, errors, ...rowIdentity(row, mapping),
  };
});

export const toLodgingReviewRows = (rows: Array<Record<string, string>>, mapping: Record<string, string>, tripStart: string, tripEnd: string): ImportReviewRow<Record<string, unknown>>[] => rows.map((row, index) => {
  const warnings: ImportIssue[] = [];
  const errors: ImportIssue[] = [];
  const checkInDate = parseImportDate(cell(row, mapping, 'checkInDate'), tripStart, tripEnd);
  const checkOutDate = parseImportDate(cell(row, mapping, 'checkOutDate'), tripStart, tripEnd);
  if (!checkInDate || !checkOutDate || checkOutDate <= checkInDate) errors.push({ row: index + 2, field: 'checkInDate', severity: 'error', message: 'Check-in/check-out dates are invalid or out of order.' });
  const suggested = cell(row, mapping, 'suggestedLocation');
  const sourceName = cell(row, mapping, 'name');
  const name = sourceName || (suggested ? `Lodging in ${suggested}` : '');
  if (!name) errors.push({ row: index + 2, field: 'name', severity: 'error', message: 'Hotel or suggested location is required.' });
  const features: string[] = parseFeatureList(cell(row, mapping, 'features'));
  const featureNotes: string[] = [];
  (['breakfast', 'dinner', 'laundry'] as const).forEach((key) => {
    const value = cell(row, mapping, key);
    if (/^(yes|true)$/i.test(value) || (value && !/^(no|false)$/i.test(value))) {
      const label = key[0].toUpperCase() + key.slice(1);
      if (!features.includes(label)) features.push(label);
      if (value && !/^(yes|true)$/i.test(value)) featureNotes.push(`${label}: ${value}`);
    }
  });
  if (cell(row, mapping, 'days') && checkInDate && checkOutDate) {
    const nights = Math.round((Date.parse(`${checkOutDate}T00:00:00Z`) - Date.parse(`${checkInDate}T00:00:00Z`)) / 86400000);
    if (Number(cell(row, mapping, 'days')) !== nights) warnings.push({ row: index + 2, field: 'days', severity: 'warning', message: 'Days differs from the calculated number of nights.' });
  }
  const notes = [cell(row, mapping, 'notes'), suggested ? `Suggested location: ${suggested}` : '', cell(row, mapping, 'bookedOn') ? `Booked via: ${cell(row, mapping, 'bookedOn')}` : '', ...featureNotes].filter(Boolean).join('\n');
  const totalCost = parseMoney(cell(row, mapping, 'totalCost'));
  const nights = checkInDate && checkOutDate ? Math.max(0, Math.round((Date.parse(`${checkOutDate}T00:00:00Z`) - Date.parse(`${checkInDate}T00:00:00Z`)) / 86400000)) : 0;
  // An explicit Status column wins over the older Booked? yes/no.
  const status = parseStatus(cell(row, mapping, 'status'));
  if (status.warning) warnings.push({ row: index + 2, field: 'status', severity: 'warning', message: status.warning });
  const rooms = Math.max(1, Math.round(Number(cell(row, mapping, 'rooms'))) || 1);
  return {
    sourceRow: index + 2,
    action: 'create',
    fields: {
      name, checkInDate, checkOutDate, status: status.value ?? (/^yes$/i.test(cell(row, mapping, 'booked')) ? 'Booked' : 'Proposed'),
      refundBy: parseImportDate(cell(row, mapping, 'refundBy'), tripStart, tripEnd), totalCost, costPerNight: nights ? totalCost / nights : 0,
      rooms, address: cell(row, mapping, 'address'), notes, features,
    },
    warnings, errors, ...rowIdentity(row, mapping),
  };
});

export const toTransferReviewRows = (rows: Array<Record<string, string>>, mapping: Record<string, string>, tripStart: string, tripEnd: string): ImportReviewRow<Record<string, unknown>>[] => rows.map((row, index) => {
  const warnings: ImportIssue[] = [];
  const errors: ImportIssue[] = [];
  const at = index + 2;
  const typeRaw = cell(row, mapping, 'transferType');
  const typeKey = normalizeHeader(typeRaw);
  let transferType = 'Other';
  if (['flight', 'plane', 'air'].includes(typeKey)) {
    errors.push({ row: at, field: 'transferType', severity: 'error', message: 'Flights cannot be imported from CSV; use document import or add the flight manually.' });
  } else if (['train', 'rail', 'shinkansen', 'bullet train', 'limited express', 'express', 'bus', 'highway bus', 'coach', 'ferry', 'boat', 'subway', 'metro', 'tram', 'public transit', 'local transit'].includes(typeKey)) {
    transferType = 'Public Transit';
  } else if (['taxi', 'shuttle', 'car service', 'private transfer', 'private'].includes(typeKey)) {
    transferType = 'Private Transfer';
  } else if (typeKey && typeKey !== 'other') {
    warnings.push({ row: at, field: 'transferType', severity: 'warning', message: `Unrecognized transfer type “${typeRaw}”; mapped to Other.` });
  } else if (!typeKey) {
    errors.push({ row: at, field: 'transferType', severity: 'error', message: 'Transfer type is required.' });
  }
  const departureDate = parseImportDate(cell(row, mapping, 'departureDate'), tripStart, tripEnd) ?? '';
  if (!departureDate) errors.push({ row: at, field: 'departureDate', severity: 'error', message: 'Departure date is required, valid and unambiguous.' });
  const arrivalRaw = cell(row, mapping, 'arrivalDate');
  const arrivalParsed = parseImportDate(arrivalRaw, tripStart, tripEnd);
  if (arrivalRaw && !arrivalParsed) errors.push({ row: at, field: 'arrivalDate', severity: 'error', message: 'Arrival date is invalid or ambiguous.' });
  const arrivalDate = arrivalParsed ?? departureDate;
  const departureTime = parseClock(cell(row, mapping, 'departureTime'));
  const arrivalTime = parseClock(cell(row, mapping, 'arrivalTime'));
  if (departureTime.invalid) errors.push({ row: at, field: 'departureTime', severity: 'error', message: 'Departure time must be HH:mm (24-hour).' });
  if (arrivalTime.invalid) errors.push({ row: at, field: 'arrivalTime', severity: 'error', message: 'Arrival time must be HH:mm (24-hour).' });
  const departureLocation = cell(row, mapping, 'departureLocation');
  const arrivalLocation = cell(row, mapping, 'arrivalLocation');
  if (!departureLocation) errors.push({ row: at, field: 'departureLocation', severity: 'error', message: 'From is required.' });
  if (!arrivalLocation) errors.push({ row: at, field: 'arrivalLocation', severity: 'error', message: 'To is required.' });
  if (departureDate && arrivalDate) {
    if (arrivalDate < departureDate) errors.push({ row: at, field: 'arrivalDate', severity: 'error', message: 'Arrival is before departure.' });
    else if (departureTime.value && arrivalTime.value && !departureTime.invalid && !arrivalTime.invalid
      && `${arrivalDate}T${arrivalTime.value}` <= `${departureDate}T${departureTime.value}`) {
      errors.push({ row: at, field: 'arrivalTime', severity: 'error', message: 'Arrival must be after departure; an overnight leg needs an Arrival Date.' });
    }
  }
  const status = parseStatus(cell(row, mapping, 'status'));
  if (status.warning) warnings.push({ row: at, field: 'status', severity: 'warning', message: status.warning });
  return {
    sourceRow: at,
    action: 'create',
    fields: {
      transferType, departureDate, departureTime: departureTime.value, arrivalDate, arrivalTime: arrivalTime.value, departureLocation, arrivalLocation,
      carrier: cell(row, mapping, 'carrier'), flightNumber: cell(row, mapping, 'flightNumber'), cost: parseMoney(cell(row, mapping, 'cost')),
      reference: cell(row, mapping, 'reference'), status: status.value ?? 'Proposed',
    },
    warnings, errors, ...rowIdentity(row, mapping),
  };
});

export const toCarRentalReviewRows = (rows: Array<Record<string, string>>, mapping: Record<string, string>, tripStart: string, tripEnd: string): ImportReviewRow<Record<string, unknown>>[] => rows.map((row, index) => {
  const warnings: ImportIssue[] = [];
  const errors: ImportIssue[] = [];
  const at = index + 2;
  const pickupDate = parseImportDate(cell(row, mapping, 'pickupDate'), tripStart, tripEnd) ?? '';
  const dropoffDate = parseImportDate(cell(row, mapping, 'dropoffDate'), tripStart, tripEnd) ?? '';
  if (!pickupDate) errors.push({ row: at, field: 'pickupDate', severity: 'error', message: 'Pick-up date is required, valid and unambiguous.' });
  if (!dropoffDate) errors.push({ row: at, field: 'dropoffDate', severity: 'error', message: 'Drop-off date is required, valid and unambiguous.' });
  if (pickupDate && dropoffDate && dropoffDate < pickupDate) errors.push({ row: at, field: 'dropoffDate', severity: 'error', message: 'Drop-off is before pick-up.' });
  const pickupLocation = cell(row, mapping, 'pickupLocation');
  if (!pickupLocation) errors.push({ row: at, field: 'pickupLocation', severity: 'error', message: 'Pick-up location is required.' });
  const status = parseStatus(cell(row, mapping, 'status'));
  if (status.warning) warnings.push({ row: at, field: 'status', severity: 'warning', message: status.warning });
  return {
    sourceRow: at,
    action: 'create',
    fields: {
      vendor: cell(row, mapping, 'vendor'), model: cell(row, mapping, 'model'), pickupDate, pickupLocation, dropoffDate,
      dropoffLocation: cell(row, mapping, 'dropoffLocation'), prepaid: cell(row, mapping, 'prepaid'), cost: parseMoney(cell(row, mapping, 'cost')),
      reference: cell(row, mapping, 'reference'), notes: cell(row, mapping, 'notes'), status: status.value ?? 'Proposed',
    },
    warnings, errors, ...rowIdentity(row, mapping),
  };
});

const DAY_PLAN_KINDS: Record<string, string> = { activity: 'activity', place: 'place', note: 'note', checklist: 'checklist' };

/** `[x] label` is checked, `[ ] label` is open, and a line with no prefix is an open item. */
export const parseChecklistCell = (raw: string): Array<{ label: string; checked: boolean }> =>
  raw.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = /^\[([xX ]?)\]\s*(.*)$/.exec(line);
    return match ? { label: match[2].trim(), checked: match[1].toLowerCase() === 'x' } : { label: line, checked: false };
  }).filter((item) => item.label);

export const toDayPlanReviewRows = (rows: Array<Record<string, string>>, mapping: Record<string, string>, tripStart: string, tripEnd: string): ImportReviewRow<Record<string, unknown>>[] => rows.map((row, index) => {
  const warnings: ImportIssue[] = [];
  const errors: ImportIssue[] = [];
  const at = index + 2;
  const kind = DAY_PLAN_KINDS[normalizeHeader(cell(row, mapping, 'kind'))] ?? '';
  if (!kind) errors.push({ row: at, field: 'kind', severity: 'error', message: 'Kind must be Activity, Place, Note or Checklist.' });
  const title = cell(row, mapping, 'title');
  if (!title) errors.push({ row: at, field: 'title', severity: 'error', message: 'Title is required.' });
  const dateRaw = cell(row, mapping, 'date');
  // A bare number is a trip day (Day 1 is the first day); anything else is a date.
  const date = /^\d{1,3}$/.test(dateRaw) && Number(dateRaw) >= 1 ? addDaysIso(tripStart, Number(dateRaw) - 1) : (parseImportDate(dateRaw, tripStart, tripEnd) ?? '');
  if (!date) errors.push({ row: at, field: 'date', severity: 'error', message: 'Date is required, valid and unambiguous.' });
  const time = cell(row, mapping, 'time');
  const costRaw = cell(row, mapping, 'cost');
  const checklist = parseChecklistCell(cell(row, mapping, 'checklist'));
  if (kind === 'checklist' && !checklist.length) errors.push({ row: at, field: 'checklist', severity: 'error', message: 'A checklist needs at least one item.' });
  const coordinates = parseCoordinates(cell(row, mapping, 'coordinates'));
  if (coordinates === undefined) warnings.push({ row: at, field: 'coordinates', severity: 'warning', message: 'Coordinates must be “lat, lng” within range; they were ignored.' });
  const positionRaw = cell(row, mapping, 'position');
  const position = Number(positionRaw);
  if (positionRaw && !(Number.isInteger(position) && position > 0)) warnings.push({ row: at, field: 'position', severity: 'warning', message: 'Order must be a positive whole number; the file order is used.' });
  const fields: Record<string, unknown> = {
    kind, date, time, title, cost: costRaw ? parseMoney(costRaw) : null, body: cell(row, mapping, 'body'), address: cell(row, mapping, 'address'),
    checklist: kind === 'checklist' ? checklist : [],
    ...(coordinates ? { lat: coordinates.lat, lng: coordinates.lng } : {}),
    ...(positionRaw && Number.isInteger(position) && position > 0 ? { position } : {}),
  };
  return { sourceRow: at, action: 'create', fields, warnings, errors, ...rowIdentity(row, mapping) };
});

export const toReviewRows = (
  entity: TransferEntity,
  rows: Array<Record<string, string>>,
  mapping: Record<string, string>,
  tripStart: string,
  tripEnd: string,
): ImportReviewRow<Record<string, unknown>>[] => {
  const build = { activities: toActivityReviewRows, lodgings: toLodgingReviewRows, transfers: toTransferReviewRows, 'car-rentals': toCarRentalReviewRows, 'day-plan': toDayPlanReviewRows }[entity];
  return build(rows, mapping, tripStart, tripEnd);
};

const csvCell = (value: unknown): string => {
  let text = String(value ?? '');
  if (/^\s*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (headers: string[], rows: Array<Record<string, unknown>>): string => `﻿${[headers, ...rows.map((row) => headers.map((header) => row[header]))].map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;

export const normalizeRecordFingerprint = (record: Record<string, unknown>, keys: string[]): string => JSON.stringify(keys.reduce<Record<string, unknown>>((result, key) => { result[key] = String(record[key] ?? '').trim().toLowerCase(); return result; }, {}));

/**
 * Fields that identify a record for the optimistic-concurrency check. The server computes the same
 * fingerprint from the stored record (server/src/routes/dataTransferRoutes.ts), so keep them equal.
 * Transfers have no notes field, so theirs has none.
 */
export const FINGERPRINT_KEYS: Record<TransferEntity, string[]> = {
  activities: ['name', 'date', 'startTime', 'startLocation', 'notes'],
  lodgings: ['name', 'checkInDate', 'checkOutDate', 'address', 'notes'],
  transfers: ['transferType', 'departureDate', 'departureTime', 'departureLocation', 'arrivalLocation'],
  'car-rentals': ['vendor', 'pickupDate', 'pickupLocation', 'dropoffDate', 'notes'],
  'day-plan': ['date', 'kind', 'title', 'time', 'body'],
};

/** The key that makes two rows "the same" when no Record ID is present. */
const MATCH_KEYS: Record<TransferEntity, string[]> = {
  activities: ['name', 'date', 'startTime', 'startLocation'],
  lodgings: ['name', 'checkInDate', 'checkOutDate', 'address'],
  transfers: ['transferType', 'departureDate', 'departureTime', 'departureLocation', 'arrivalLocation'],
  'car-rentals': ['vendor', 'pickupDate', 'pickupLocation'],
  'day-plan': ['date', 'kind', 'title', 'time'],
};

/** Every importable field, used to tell an unchanged row from an edited one. */
const COMPARE_KEYS: Record<TransferEntity, string[]> = {
  activities: ['name', 'date', 'startTime', 'startLocation', 'notes', 'activityType', 'duration', 'status', 'cost', 'freeCancelBy', 'bookedOn', 'reference'],
  lodgings: ['name', 'checkInDate', 'checkOutDate', 'address', 'notes', 'status', 'rooms', 'refundBy', 'totalCost', 'features'],
  transfers: ['transferType', 'departureDate', 'departureTime', 'departureLocation', 'arrivalLocation', 'arrivalDate', 'arrivalTime', 'carrier', 'flightNumber', 'cost', 'reference', 'status'],
  'car-rentals': ['vendor', 'model', 'pickupDate', 'pickupLocation', 'dropoffDate', 'dropoffLocation', 'prepaid', 'cost', 'reference', 'notes', 'status'],
  'day-plan': ['date', 'kind', 'title', 'time', 'cost', 'body', 'checklist'],
};

/** A stored date as YYYY-MM-DD, whether the adapter returned a string, an ISO timestamp or a Date. */
const dateOnly = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
};

// A blank time is stored as 00:00, so both read as blank.
const blankMidnight = (value: unknown): unknown => (String(value ?? '').trim() === '00:00' ? '' : value);

const pick = (record: Record<string, any>, ...names: string[]): unknown => {
  for (const name of names) if (record[name] !== undefined && record[name] !== null) return record[name];
  return '';
};

/** Maps a stored record (either casing) to the same field names the review rows use. */
export const canonicalRecord = (entity: TransferEntity, record: Record<string, any>, context: { tripStart?: string | null } = {}): Record<string, unknown> => {
  switch (entity) {
    case 'activities':
      return {
        name: record.name, date: dateOnly(record.date), startTime: record.startTime, startLocation: record.startLocation, notes: record.notes, activityType: record.activityType,
        duration: record.duration, status: record.status, cost: record.cost, freeCancelBy: dateOnly(record.freeCancelBy), bookedOn: record.bookedOn, reference: record.reference,
      };
    case 'lodgings':
      return {
        name: record.name, checkInDate: dateOnly(pick(record, 'checkInDate', 'check_in_date')), checkOutDate: dateOnly(pick(record, 'checkOutDate', 'check_out_date')), address: record.address,
        notes: record.notes, status: record.status, rooms: record.rooms, refundBy: dateOnly(pick(record, 'refundBy', 'refund_by')), totalCost: pick(record, 'totalCost', 'total_cost'),
        features: Array.isArray(record.features) ? record.features : [],
      };
    case 'transfers':
      return {
        transferType: normalizeTransferType(pick(record, 'transferType', 'transfer_type')), departureDate: dateOnly(pick(record, 'departureDate', 'departure_date')),
        departureTime: blankMidnight(pick(record, 'departureTime', 'departure_time')), departureLocation: pick(record, 'departureLocation', 'departure_location'),
        arrivalLocation: pick(record, 'arrivalLocation', 'arrival_location'), arrivalDate: dateOnly(pick(record, 'arrivalDate', 'arrival_date')),
        arrivalTime: blankMidnight(pick(record, 'arrivalTime', 'arrival_time')), carrier: record.carrier, flightNumber: pick(record, 'flightNumber', 'flight_number'),
        cost: record.cost, reference: pick(record, 'bookingReference', 'booking_reference'), status: record.status,
      };
    case 'car-rentals':
      return {
        vendor: record.vendor, model: record.model, pickupDate: dateOnly(record.pickupDate), pickupLocation: record.pickupLocation, dropoffDate: dateOnly(record.dropoffDate),
        dropoffLocation: record.dropoffLocation, prepaid: record.prepaid, cost: record.cost, reference: record.reference, notes: record.notes, status: record.status,
      };
    case 'day-plan':
      return {
        date: context.tripStart && Number(record.day) >= 1 ? addDaysIso(dateOnly(context.tripStart), Number(record.day) - 1) : '', kind: record.kind ?? 'activity',
        title: record.activity, time: record.time ?? '', cost: record.cost ?? '', body: record.noteBody ?? '',
        checklist: Array.isArray(record.checklistItems) ? record.checklistItems.map((item: any) => ({ label: item.label, checked: Boolean(item.checkedAt) })) : [],
      };
  }
};

export const recordFingerprint = (entity: TransferEntity, record: Record<string, any>, context: { tripStart?: string | null } = {}): string =>
  normalizeRecordFingerprint(canonicalRecord(entity, record, context), FINGERPRINT_KEYS[entity]);

const comparable = (value: unknown): string => {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => (item && typeof item === 'object' ? { label: String((item as any).label ?? '').trim().toLowerCase(), checked: Boolean((item as any).checked) } : String(item ?? '').trim().toLowerCase())));
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(String(value))) return String(Number(value));
  return String(value).trim().toLowerCase();
};

const sameFields = (entity: TransferEntity, fields: Record<string, unknown>, mappedKeys: string[] | undefined, existing: Record<string, unknown>): boolean =>
  COMPARE_KEYS[entity].every((key) => {
    // A column the file does not have is not a change.
    if (mappedKeys && !mappedKeys.includes(key)) return true;
    return comparable(fields[key]) === comparable(existing[key]);
  });

const keyOf = (entity: TransferEntity, source: Record<string, unknown>): string =>
  MATCH_KEYS[entity].map((key) => String(source[key] ?? '').trim().toLowerCase()).join('|');

/**
 * Links each review row to a record already in the trip.
 *  1. A Record ID from this trip wins. An unchanged row defaults to Skip; an edited row is marked
 *     Changed and also defaults to Skip, and including it makes it an update.
 *  2. Otherwise an exact key match defaults to Skip (matches are consumed one-to-one so a legitimate
 *     repeat row survives).
 * An unknown ID, or one from another trip, is ignored. The server re-checks everything.
 */
export const matchExistingRecords = (
  entity: TransferEntity,
  reviewRows: Array<ImportReviewRow<Record<string, unknown>>>,
  existingRecords: Array<Record<string, any>>,
  context: { tripStart?: string | null } = {},
): Array<ImportReviewRow<Record<string, unknown>>> => {
  const byId = new Map(existingRecords.map((record) => [String(record.id), record]));
  const claimed = new Set<string>();
  const index = new Map<string, Array<Record<string, any>>>();
  existingRecords.forEach((record) => {
    const key = keyOf(entity, canonicalRecord(entity, record, context));
    index.set(key, [...(index.get(key) ?? []), record]);
  });
  reviewRows.forEach((row) => {
    const byRecordId = row.recordId ? byId.get(row.recordId) : undefined;
    if (byRecordId && !claimed.has(String(byRecordId.id))) {
      claimed.add(String(byRecordId.id));
      const canonical = canonicalRecord(entity, byRecordId, context);
      row.existingId = String(byRecordId.id);
      row.expectedFingerprint = normalizeRecordFingerprint(canonical, FINGERPRINT_KEYS[entity]);
      row.action = 'skip';
      if (sameFields(entity, row.fields, row.mappedKeys, canonical)) {
        row.warnings.push({ severity: 'warning', message: 'Unchanged since export; row defaults to Skip.' });
      } else {
        row.changed = true;
        row.warnings.push({ severity: 'warning', message: 'Changed since export. Include this row to update the existing record.' });
      }
      return;
    }
    const key = keyOf(entity, row.fields);
    const candidates = (index.get(key) ?? []).filter((record) => !claimed.has(String(record.id)));
    const match = candidates[0];
    if (match) {
      claimed.add(String(match.id));
      row.existingId = String(match.id);
      row.expectedFingerprint = recordFingerprint(entity, match, context);
      row.action = 'skip';
      row.warnings.push({ severity: 'warning', message: 'Exact match found; row defaults to Skip.' });
    }
  });
  return reviewRows;
};

/** The fields to send for a row: an update writes only the columns the file actually had. */
export const fieldsForCommit = (row: ImportReviewRow<Record<string, unknown>>): Record<string, unknown> => {
  if (!(row.action === 'update' || row.existingId) || !row.mappedKeys) return row.fields;
  const allowed = new Set(row.mappedKeys);
  // costPerNight follows the stay's dates and total, so it travels with them.
  if (allowed.has('totalCost') || allowed.has('checkInDate') || allowed.has('checkOutDate')) allowed.add('costPerNight');
  // Some fields are assembled from several columns (Booked? and Status; Breakfast, Dinner and Laundry;
  // the extra context lines in notes). They are written only when one of those columns was present.
  const derivedFrom: Record<string, string[]> = {
    status: ['status', 'booked'],
    features: ['features', 'breakfast', 'dinner', 'laundry'],
    notes: ['notes', 'suggestedLocation', 'bookedOn', 'lodgingLocation', 'bookAhead', 'breakfast', 'dinner', 'laundry'],
  };
  Object.entries(derivedFrom).forEach(([key, sources]) => { if (key in row.fields && sources.some((source) => row.mappedKeys!.includes(source))) allowed.add(key); });
  if (row.fields.lat !== undefined) { allowed.add('lat'); allowed.add('lng'); }
  return Object.fromEntries(Object.entries(row.fields).filter(([key]) => allowed.has(key)));
};

// ---------------------------------------------------------------------------------------------
// Export

export const EXPORT_HEADERS: Record<TransferEntity, string[]> = {
  activities: ['WanderBunnies Record ID', 'WanderBunnies Record Fingerprint', 'Date', 'Activity Type', 'Start Time', 'Duration', 'Activity Name', 'Activity Notes', 'Activity Start Address', 'Status', 'Cost', 'Booked On', 'Booking Reference', 'Free Cancellation By'],
  lodgings: ['WanderBunnies Record ID', 'WanderBunnies Record Fingerprint', 'Check In', 'Check Out', 'Hotel', 'Booked?', 'Cancel By', 'Cost', 'Address', 'Notes', 'Features', 'Rooms', 'Status'],
  transfers: ['WanderBunnies Record ID', 'WanderBunnies Record Fingerprint', 'Date', 'Transfer Type', 'From', 'To', 'Departure Time', 'Arrival Date', 'Arrival Time', 'Carrier', 'Service Number', 'Cost', 'Booking Reference', 'Status'],
  'car-rentals': ['WanderBunnies Record ID', 'WanderBunnies Record Fingerprint', 'Vendor', 'Vehicle', 'Pick Up Date', 'Pick Up Location', 'Drop Off Date', 'Drop Off Location', 'Prepaid', 'Cost', 'Reference', 'Notes', 'Status'],
  'day-plan': ['WanderBunnies Record ID', 'WanderBunnies Record Fingerprint', 'Date', 'Kind', 'Time', 'Title', 'Cost', 'Body', 'Checklist Items', 'Address', 'Coordinates', 'Order'],
};

const KIND_LABEL: Record<string, string> = { activity: 'Activity', place: 'Place', note: 'Note', checklist: 'Checklist' };

const byText = (a: unknown, b: unknown): number => String(a ?? '').localeCompare(String(b ?? ''));

/** Rows ready for `toCsv(EXPORT_HEADERS[entity], …)`, sorted the way the file is documented. */
export const toExportRows = (entity: TransferEntity, records: Array<Record<string, any>>, context: { tripStart?: string | null } = {}): Array<Record<string, unknown>> => {
  const identity = (record: Record<string, any>) => ({ 'WanderBunnies Record ID': record.id, 'WanderBunnies Record Fingerprint': recordFingerprint(entity, record, context) });
  switch (entity) {
    case 'activities':
      return records.map((record) => ({
        ...identity(record), Date: record.date, 'Activity Type': record.activityType, 'Start Time': record.startTime, Duration: record.duration, 'Activity Name': record.name,
        'Activity Notes': record.notes, 'Activity Start Address': record.startLocation, Status: record.status, Cost: record.cost, 'Booked On': record.bookedOn,
        'Booking Reference': record.reference, 'Free Cancellation By': record.freeCancelBy,
      }));
    case 'lodgings': {
      const canonical = (record: Record<string, any>) => canonicalRecord('lodgings', record);
      return records.map((record) => {
        const c = canonical(record);
        return {
          ...identity(record), 'Check In': c.checkInDate, 'Check Out': c.checkOutDate, Hotel: record.name, 'Booked?': record.status === 'Booked' ? 'Yes' : 'No', 'Cancel By': c.refundBy,
          Cost: c.totalCost, Address: record.address, Notes: record.notes, Features: (c.features as string[]).join(', '), Rooms: record.rooms, Status: record.status,
        };
      });
    }
    case 'transfers': {
      const rows = records.map((record) => ({ record, c: canonicalRecord('transfers', record) })).filter(({ record }) => normalizeTransferType(pick(record, 'transferType', 'transfer_type')) !== 'Flight');
      rows.sort((a, b) => byText(a.c.departureDate, b.c.departureDate) || (String(a.c.departureTime) === '' ? 1 : String(b.c.departureTime) === '' ? -1 : byText(a.c.departureTime, b.c.departureTime)) || byText(a.c.departureLocation, b.c.departureLocation));
      return rows.map(({ record, c }) => ({
        ...identity(record), Date: c.departureDate, 'Transfer Type': c.transferType, From: c.departureLocation, To: c.arrivalLocation, 'Departure Time': c.departureTime,
        'Arrival Date': c.arrivalDate, 'Arrival Time': c.arrivalTime, Carrier: c.carrier, 'Service Number': c.flightNumber, Cost: c.cost, 'Booking Reference': c.reference, Status: c.status,
      }));
    }
    case 'car-rentals':
      return [...records].sort((a, b) => byText(a.pickupDate, b.pickupDate)).map((record) => ({
        ...identity(record), Vendor: record.vendor, Vehicle: record.model, 'Pick Up Date': record.pickupDate, 'Pick Up Location': record.pickupLocation, 'Drop Off Date': record.dropoffDate,
        'Drop Off Location': record.dropoffLocation, Prepaid: record.prepaid, Cost: record.cost, Reference: record.reference, Notes: record.notes, Status: record.status,
      }));
    case 'day-plan': {
      const rows = records.map((record) => ({ record, c: canonicalRecord('day-plan', record, context) }));
      rows.sort((a, b) => byText(a.c.date, b.c.date) || (Number(a.record.position) || 0) - (Number(b.record.position) || 0));
      return rows.map(({ record, c }) => ({
        ...identity(record), Date: c.date, Kind: KIND_LABEL[String(c.kind)] ?? 'Activity', Time: record.time, Title: record.activity, Cost: record.cost, Body: record.noteBody,
        'Checklist Items': (c.checklist as Array<{ label: string; checked: boolean }>).map((item) => `[${item.checked ? 'x' : ' '}] ${item.label}`).join('\n'),
        Address: record.address ?? record.placeAddress ?? '',
        Coordinates: record.lat != null && record.lng != null ? `${record.lat}, ${record.lng}` : '', Order: record.position,
      }));
    }
  }
};
