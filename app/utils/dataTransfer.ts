import Papa from 'papaparse';

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
};

export type ParsedCsv = {
  headers: string[];
  rows: Array<Record<string, string>>;
  issues: ImportIssue[];
};

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 150;
export const MAX_IMPORT_COLUMNS = 50;
export const MAX_IMPORT_CELL_LENGTH = 4000;

const cleanHeader = (value: string): string => value.replace(/^\uFEFF/, '').trim();

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

export const ACTIVITY_HEADER_ALIASES: Record<string, Set<string>> = {
  date: aliases(['Date', 'Activity Date']),
  activityType: aliases(['Activity Type', 'Type', 'Category']),
  lodgingLocation: aliases(['Lodging Location', 'Base', 'Lodging']),
  startTime: aliases(['Start Time', 'Time']),
  duration: aliases(['Duration', 'Length']),
  name: aliases(['Activity Name', 'Name', 'Activity']),
  notes: aliases(['Activity Notes', 'Notes', 'Description']),
  startLocation: aliases(['Activity Start Address', 'Start Address', 'Address', 'Location']),
  bookAhead: aliases(['Book Ahead Required', 'Book Ahead', 'Requires Booking']),
};

export const LODGING_HEADER_ALIASES: Record<string, Set<string>> = {
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

export const toActivityReviewRows = (rows: Array<Record<string, string>>, mapping: Record<string, string>, tripStart: string, tripEnd: string): ImportReviewRow<Record<string, unknown>>[] => rows.map((row, index) => {
  const warnings: ImportIssue[] = [];
  const errors: ImportIssue[] = [];
  const date = parseImportDate(cell(row, mapping, 'date'), tripStart, tripEnd);
  if (!date) errors.push({ row: index + 2, field: 'date', severity: 'error', message: 'Date is missing, invalid, or ambiguous.' });
  const name = cell(row, mapping, 'name');
  if (!name) errors.push({ row: index + 2, field: 'name', severity: 'error', message: 'Activity name is required.' });
  const type = mapActivityType(cell(row, mapping, 'activityType'));
  if (type.warning) warnings.push({ row: index + 2, field: 'activityType', severity: 'warning', message: type.warning });
  const sourceContext = [
    cell(row, mapping, 'lodgingLocation') ? `Lodging location: ${cell(row, mapping, 'lodgingLocation')}` : '',
    cell(row, mapping, 'bookAhead') ? `Book ahead required: ${cell(row, mapping, 'bookAhead')}` : '',
  ].filter(Boolean);
  const notes = [cell(row, mapping, 'notes'), ...sourceContext].filter(Boolean).join('\n');
  return { sourceRow: index + 2, action: 'create', fields: { date, name, activityType: type.value, startTime: cell(row, mapping, 'startTime'), duration: cell(row, mapping, 'duration'), startLocation: cell(row, mapping, 'startLocation'), notes, status: 'Needed', cost: 0 }, warnings, errors };
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
  const features: string[] = [];
  const featureNotes: string[] = [];
  (['breakfast', 'dinner', 'laundry'] as const).forEach((key) => {
    const value = cell(row, mapping, key);
    if (/^(yes|true)$/i.test(value) || (value && !/^(no|false)$/i.test(value))) {
      features.push(key[0].toUpperCase() + key.slice(1));
      if (value && !/^(yes|true)$/i.test(value)) featureNotes.push(`${key[0].toUpperCase() + key.slice(1)}: ${value}`);
    }
  });
  if (cell(row, mapping, 'days') && checkInDate && checkOutDate) {
    const nights = Math.round((Date.parse(`${checkOutDate}T00:00:00Z`) - Date.parse(`${checkInDate}T00:00:00Z`)) / 86400000);
    if (Number(cell(row, mapping, 'days')) !== nights) warnings.push({ row: index + 2, field: 'days', severity: 'warning', message: 'Days differs from the calculated number of nights.' });
  }
  const notes = [suggested ? `Suggested location: ${suggested}` : '', cell(row, mapping, 'bookedOn') ? `Booked via: ${cell(row, mapping, 'bookedOn')}` : '', ...featureNotes].filter(Boolean).join('\n');
  const totalCost = parseMoney(cell(row, mapping, 'totalCost'));
  const nights = checkInDate && checkOutDate ? Math.max(0, Math.round((Date.parse(`${checkOutDate}T00:00:00Z`) - Date.parse(`${checkInDate}T00:00:00Z`)) / 86400000)) : 0;
  return { sourceRow: index + 2, action: 'create', fields: { name, checkInDate, checkOutDate, status: /^yes$/i.test(cell(row, mapping, 'booked')) ? 'Booked' : 'Needed', refundBy: parseImportDate(cell(row, mapping, 'refundBy'), tripStart, tripEnd), totalCost, costPerNight: nights ? totalCost / nights : 0, rooms: 1, address: cell(row, mapping, 'address'), notes, features }, warnings, errors };
});

const csvCell = (value: unknown): string => {
  let text = String(value ?? '');
  if (/^\s*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (headers: string[], rows: Array<Record<string, unknown>>): string => `\uFEFF${[headers, ...rows.map((row) => headers.map((header) => row[header]))].map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;

export const normalizeRecordFingerprint = (record: Record<string, unknown>, keys: string[]): string => JSON.stringify(keys.reduce<Record<string, unknown>>((result, key) => { result[key] = String(record[key] ?? '').trim().toLowerCase(); return result; }, {}));
