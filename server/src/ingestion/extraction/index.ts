import { INGESTION_CONFIDENCE_HIGH, INGESTION_CONFIDENCE_REVIEW_READY, INGESTION_JOB_TOKEN_BUDGET_USD, INGESTION_LOGIC_VERSION } from '../config';
import type { ExtractionConfig, ExtractionResult, NormalizedDocument, ParsedItemCandidate, ParsedItemType, TimezoneStatus } from '../contracts';
import { buildParsedItemFingerprint } from '../shared/hashing';
import { getExtractionCacheEntry, recordParseAttempt, recordUsageMetering, saveExtractionCacheEntry } from '../shared/repository';
import { resolveTimezone } from '../shared/timezoneResolver';
import { reserveApiUsageOrThrow, ApiLimitExceededError } from '../../apis/usageLimiter';
import { logInfo } from '../../logger';
import { getUserById } from '../../db';
import { extractLabeledFieldValue, extractPhoneLikeValue, toTitleCaseWords } from './hotelFieldExtractors';
import { extractSemanticFieldsForType } from './semanticFieldHelpers';
import { sanitizeExtractionResult } from './fieldSanitizer';

export interface ExtractionStrategy {
  canHandle(doc: NormalizedDocument): boolean;
  extract(doc: NormalizedDocument, config: ExtractionConfig): Promise<ExtractionResult>;
  readonly strategyName: string;
  readonly minConfidenceToSkipNext: number;
}

// ── Generic helpers ─────────────────────────────────────────────────────────

const extractDate = (text: string): string | null => {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return new Date(`${iso[1]}T12:00:00Z`).toISOString();
  const named = text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2}\b/i);
  if (!named) return null;
  const parsed = new Date(named[0]);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const HOTEL_FIELD_STOP_TOKENS = [
  'Check-in',
  'Check-out',
  'Guest name',
  'Location',
  'Address',
  'Phone',
  'Contact',
  'Booking details',
  'Reservation details',
  'Room type',
  'Rooms',
  'Meals',
  'Breakfast',
  'Cancellation',
  'Prepayment',
  'Payment',
  'Total Price',
  'You paid',
  'Max capacity',
  'Price details',
];

const buildHotelFieldRegex = (label: string, extraStops: string[] = []): RegExp => {
  const stopPattern = [...HOTEL_FIELD_STOP_TOKENS, ...extraStops]
    .filter((token) => token !== label)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`${label}\\s*:?[\\s]*([\\s\\S]{1,220}?)(?=\\s+(?:${stopPattern})\\b|$)`, 'i');
};

const cleanHotelField = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .trim()
    .replace(/^[,;:\-–]+/, '')
    .replace(/[,;:\-–]+$/, '')
    .trim();
  return cleaned || null;
};

const extractConfirmation = (text: string): string | null => {
  const match = text.match(/\b(?:confirmation|booking|reservation|record locator|pnr|order)\s*(?:number|code|ref(?:erence)?)?[:#\s-]*\(?([A-Z0-9]{5,10})\)?\b/i);
  return match ? match[1].toUpperCase() : null;
};

const extractTripTotalCost = (text: string): { amount: number; currency: string } | null => {
  const patterns: Array<{ regex: RegExp; currency?: string }> = [
    { regex: /Trip total\s*(?:approx\.?\s*)?(?:US)?\$\s*([0-9,.]+)/i, currency: 'USD' },
    { regex: /Trip total\s*(?:approx\.?\s*)?€\s*([0-9,.]+)/i, currency: 'EUR' },
    { regex: /Trip total\s*(?:approx\.?\s*)?£\s*([0-9,.]+)/i, currency: 'GBP' },
    { regex: /Trip total\s*(?:approx\.?\s*)?([A-Z]{3})\s*([0-9,.]+)/i },
  ];
  for (const { regex, currency } of patterns) {
    const match = text.match(regex);
    if (!match) continue;
    const detectedCurrency = currency ?? String(match[1] ?? '').toUpperCase();
    const amountIndex = currency ? 1 : 2;
    const amount = Number(String(match[amountIndex] ?? '').replace(/,/g, ''));
    if (detectedCurrency && Number.isFinite(amount) && amount > 0) {
      return { amount, currency: detectedCurrency };
    }
  }
  return null;
};

const normalizeTravelerName = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const extractTravelerNames = (text: string): string[] => {
  const structured: string[] = [];
  const travelerPattern = /Traveler\s+\d+\s*:\s*([\s\S]{1,120}?)(?=\s+Traveler\s+\d+\s*:|\s+Important flight information\b|\s+Rules(?:\s|,)|\s+Payment summary\b|\s+Real ID Requirements\b|$)/gi;
  let tm;
  while ((tm = travelerPattern.exec(text)) !== null) {
    const raw = tm[1]
      .replace(/\b(?:airline confirmation|trip total|payment summary)\b[\s\S]*$/i, '')
      .trim();
    const name = normalizeTravelerName(raw);
    if (/^[A-Z][A-Za-z' -]{1,40}(?:\s+[A-Z][A-Za-z' -]{1,40}){1,3}$/.test(name)) {
      structured.push(name);
    }
  }
  if (structured.length) return Array.from(new Set(structured)).slice(0, 6);

  // Fallback: title-case first+last pairs
  const matches = Array.from(text.matchAll(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g)).map((match) => match[1].trim());
  return Array.from(new Set(matches)).slice(0, 6);
};

const extractionUserCache = new Map<string, Promise<Awaited<ReturnType<typeof getUserById>>>>();

const getExtractionUser = async (userId: string) => {
  if (!extractionUserCache.has(userId)) {
    extractionUserCache.set(userId, getUserById(userId));
  }
  return extractionUserCache.get(userId)!;
};

const extractAccountHolderName = (text: string): string | null => {
  const inlineHeader = text.match(/^\s*([A-Z][A-Za-z' -]{1,80})\s*<[^>]+>/);
  if (inlineHeader?.[1]) return normalizeTravelerName(inlineHeader[1]);
  const recipient = text.match(/\bTo:\s*([^\n<]+?)\s*<[^>]+>/i);
  if (recipient?.[1]) return normalizeTravelerName(recipient[1]);
  return null;
};

const filterTravelerNamesForUser = async (travelerNames: string[], _userId: string, _text: string): Promise<string[]> =>
  Array.from(new Set(travelerNames.map((name) => normalizeTravelerName(name)).filter(Boolean)));

const extractRawDatetimeString = (text: string): string | null => {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\b/);
  if (iso) return iso[1];
  const named = text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i);
  return named ? named[0] : null;
};

const extractIataCode = (text: string, direction: 'from' | 'to'): string | null => {
  const pattern = direction === 'from'
    ? /\bfrom\s+(?:[A-Z][A-Za-z .'-]+\s+)?(?:\(([A-Z]{3})\)|([A-Z]{3}))\b/i
    : /\bto\s+(?:[A-Z][A-Za-z .'-]+\s+)?(?:\(([A-Z]{3})\)|([A-Z]{3}))\b/i;
  const match = text.match(pattern);
  if (match) return (match[1] ?? match[2])?.toUpperCase() ?? null;
  // Also try standalone 3-letter codes near departure/arrival keywords
  const codePattern = direction === 'from'
    ? /\b(?:departure|origin|from)\s*(?:[:=-])?\s*([A-Z]{3})\b/i
    : /\b(?:arrival|destination|to)\s*(?:[:=-])?\s*([A-Z]{3})\b/i;
  const codeMatch = text.match(codePattern);
  return codeMatch?.[1]?.toUpperCase() ?? null;
};

// ── Chase Travel helpers ────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Parse a named date like "Jun 08, 2024" into a UTC Date at noon. */
const parseNamedDateUtc = (text: string): { date: Date; raw: string } | null => {
  const m = text.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)\s+(\d{1,2}),?\s+(20\d{2})/i);
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase().slice(0, 3)];
  if (month === undefined) return null;
  const date = new Date(Date.UTC(parseInt(m[3], 10), month, parseInt(m[2], 10), 12, 0, 0));
  return Number.isNaN(date.getTime()) ? null : { date, raw: m[0] };
};

/** Merge a UTC-noon Date with a "HH:MM am/pm" time string. */
const combineDateAndTime = (dateUtc: Date, time: string): string => {
  const m = time.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return dateUtc.toISOString();
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (m[3].toLowerCase() === 'pm' && h !== 12) h += 12;
  if (m[3].toLowerCase() === 'am' && h === 12) h = 0;
  const result = new Date(dateUtc);
  result.setUTCHours(h, min, 0, 0);
  return result.toISOString();
};

/** Scan a text section for "HH:MM am/pm" immediately followed by a 3-letter IATA code. */
const extractTimeCodePairs = (section: string): Array<{ time: string; code: string }> => {
  const pairs: Array<{ time: string; code: string }> = [];
  const timeRegex = /(\d{1,2}:\d{2}\s*[ap]m)/gi;
  let m;
  while ((m = timeRegex.exec(section)) !== null) {
    // Look for an IATA code within the next 50 chars (allowing newlines / whitespace)
    const after = section.slice(m.index + m[0].length, m.index + m[0].length + 50);
    const codeMatch = after.match(/^\s*\n?\s*([A-Z]{3})\b/);
    if (codeMatch) pairs.push({ time: m[1].trim(), code: codeMatch[1] });
  }
  return pairs;
};

// ── Hotel helpers ────────────────────────────────────────────────────────────

const extractHotelName = (text: string): string | null => {
  const patterns = [
    /confirmed\s+at\s+(.{2,140}?)(?=\s+(?:\d+\s+message|Booking\.com\b|From:|To:|Date:|Subject:|Confirmation\b|PIN\b|Thanks,))/i,
    /\b([A-Z][A-Za-z0-9 '&.-]{2,120}?)\s+is expecting you\b/i,
    /\bYour booking summary[\s\S]{0,120}?\b([A-Z][A-Za-z0-9 '&.-]{2,120}?)\s+Confirmed\b/i,
    buildHotelFieldRegex('Property', ['Confirmed']),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const cleaned = cleanHotelField(match?.[1]);
    if (cleaned) return cleaned;
  }
  // Name with common accommodation suffix (case-insensitive on suffix)
  const withSuffix = text.match(/\b([A-Z][A-Za-z0-9 '&.-]{2,100}\s+(?:Hotel|Resort|Inn|Suites|Lodge|Hostel|Motel|Villa|Boutique hotel))\b/i);
  if (withSuffix) return cleanHotelField(withSuffix[1]);
  return null;
};

const extractCheckInOutDates = (text: string): { checkIn: string | null; checkOut: string | null } => {
  const parseDateField = (fieldText: string): string | null => {
    const named = fieldText.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})/i);
    if (named) { const pd = parseNamedDateUtc(named[1]); return pd ? pd.date.toISOString() : null; }
    const iso = fieldText.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (iso) return new Date(`${iso[1]}T12:00:00Z`).toISOString();
    return null;
  };
  const ciValue = extractLabeledFieldValue(
    text,
    ['Check-in'],
    ['Check-out', 'Guest name', 'Rooms', 'Room type', 'Location', 'Address', 'Phone', 'Contact', 'Booking details', 'Reservation details'],
    true,
    140
  );
  const coValue = extractLabeledFieldValue(
    text,
    ['Check-out'],
    ['Guest name', 'Rooms', 'Room type', 'Location', 'Address', 'Phone', 'Contact', 'Booking details', 'Reservation details', 'Cancellation'],
    true,
    140
  );
  return {
    checkIn: ciValue ? parseDateField(ciValue) : null,
    checkOut: coValue ? parseDateField(coValue) : null,
  };
};

const extractHotelAddress = (text: string): string | null => {
  const labeled = extractLabeledFieldValue(
    text,
    ['Location', 'Address'],
    ['Phone', 'Contact', 'Reservation details', 'Booking details', 'Guest name', 'Check-in', 'Check-out']
  );
  if (labeled) return labeled;
  const inlineBeforePhone = cleanHotelField(
    text.match(/\b(?:Hotel|Resort|Inn|Suites|Lodge|Hostel|Motel|Villa|Boutique hotel)\s+([^.\n]{10,180}?)(?=\s+Phone\b)/i)?.[1]
  );
  return inlineBeforePhone;
};

const extractHotelCost = (text: string): { amount: number; currency: string } => {
  const patterns: Array<{ regex: RegExp; currency: string }> = [
    { regex: /You paid\s*(?:approx\.?\s*)?(?:US)?\$\s*([0-9,.]+)/i, currency: 'USD' },
    { regex: /You paid\s*(?:approx\.?\s*)?€\s*([0-9,.]+)/i, currency: 'EUR' },
    { regex: /You paid\s*(?:approx\.?\s*)?£\s*([0-9,.]+)/i, currency: 'GBP' },
    { regex: /Total Price\s*(?:approx\.?\s*)?€\s*([0-9,.]+)/i, currency: 'EUR' },
    { regex: /Total Price\s*(?:approx\.?\s*)?£\s*([0-9,.]+)/i, currency: 'GBP' },
    { regex: /Total Price\s*(?:approx\.?\s*)?(?:US)?\$\s*([0-9,.]+)/i, currency: 'USD' },
    { regex: /Trip total\s*(?:approx\.?\s*)?(?:US)?\$\s*([0-9,.]+)/i, currency: 'USD' },
    { regex: /Trip total\s*(?:approx\.?\s*)?€\s*([0-9,.]+)/i, currency: 'EUR' },
    { regex: /Trip total\s*(?:approx\.?\s*)?£\s*([0-9,.]+)/i, currency: 'GBP' },
    { regex: /Total price\s*:\s*approx\.?\s*(?:US)?\$\s*([0-9,.]+)/i, currency: 'USD' },
  ];
  for (const { regex, currency } of patterns) {
    const match = text.match(regex);
    if (match) return { amount: parseFloat(match[1].replace(/,/g, '')), currency };
  }
  const dollar = text.match(/\$\s*([0-9,.]+)/);
  if (dollar) return { amount: parseFloat(dollar[1].replace(/,/g, '')), currency: 'USD' };
  const euro = text.match(/€\s*([0-9,.]+)/);
  if (euro) return { amount: parseFloat(euro[1].replace(/,/g, '')), currency: 'EUR' };
  return { amount: 0, currency: 'USD' };
};

const extractHotelGuestName = (text: string): string | null => {
  const labeled = extractLabeledFieldValue(
    text,
    ['Guest name'],
    ['Check-in', 'Check-out', 'Max capacity', 'Breakfast', 'Prepayment', 'Payment', 'Room', 'Location', 'Address', 'Phone', 'Contact', 'Reservation details', 'Booking details'],
    true,
    180
  );
  if (labeled && /^[A-Z]/.test(labeled) && !/[<>@]/.test(labeled)) {
    return labeled.replace(/\s*\d[\s\S]*$/, '').trim() || null;
  }
  const fallback = text.match(/Thanks,\s*([A-Z][A-Za-z' -]{1,80})\s*!?\s+Your booking/i)?.[1];
  return fallback ? normalizeTravelerName(fallback) : null;
};

const extractHotelPhone = (text: string): string | null =>
  extractPhoneLikeValue(
    extractLabeledFieldValue(
    text,
    ['Phone'],
    ['Contact', 'Reservation details', 'Booking details', 'Guest name', 'Check-in', 'Check-out'],
    false,
    80
    ) ?? text
  );

const extractFreeCancelDate = (text: string): string | null => {
  // "Until 23:59 on November 23, 2025 FREE"
  const untilOnFree = text.match(/until\s+[\d:]+\s+on\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\s*(?:FREE|€\s*0|\$\s*0)/i);
  if (untilOnFree) { const pd = parseNamedDateUtc(untilOnFree[1]); if (pd) return pd.date.toISOString(); }
  // "until October 29, 2024 11:59 PM: € 0"
  const untilDateZero = text.match(/until\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\s+[\d:]+\s*(?:AM|PM)\s*:\s*(?:€|US?\$|\$)\s*0/i);
  if (untilDateZero) { const pd = parseNamedDateUtc(untilDateZero[1]); if (pd) return pd.date.toISOString(); }
  // "free cancellation until DATE" / "cancel for free until DATE"
  const freeUntil = text.match(/(?:free cancellation|cancel for free|free cancel[a-z]*)\s+(?:.*?)((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2}|20\d{2}-\d{2}-\d{2})/i);
  if (freeUntil) { const pd = parseNamedDateUtc(freeUntil[1]); if (pd) return pd.date.toISOString(); return extractDate(freeUntil[1]); }
  return null;
};

// ── Chase Travel helpers ────────────────────────────────────────────────────

const isChaseTravel = (text: string): boolean =>
  /Chase Travel/i.test(text) && /Trip ID/i.test(text);

const containsTravelUpsellSignals = (text: string): boolean =>
  /\b(book a hotel|find activities|attractions or tours|enhance your stay|need a car|add a car|book a car|things to do|travel protection|manage your trip online)\b/i.test(text);

const hasStrongHotelBookingSignals = (text: string, fields: Record<string, unknown>, hotelName: string | null): boolean =>
  Boolean(
    hotelName
    && !/\bbook a hotel\b/i.test(hotelName)
    && (
      fields.checkInDate
      || fields.checkOutDate
      || fields.guestName
      || extractConfirmation(text)
    )
  );

const hasStrongCarRentalSignals = (text: string, fields: Record<string, unknown>, providerVendor: string | null): boolean =>
  Boolean(
    (fields.pickupLocation && fields.dropoffLocation)
    || (providerVendor && /\b(Hertz|Avis|Enterprise|Budget|National|Alamo|Sixt|Dollar|Thrifty|Fox)\b/i.test(providerVendor))
    || /\b(car rental confirmation|rental confirmation|pickup date|dropoff date|vehicle class)\b/i.test(text)
  );

const hasStrongActivitySignals = (text: string, fields: Record<string, unknown>): boolean =>
  Boolean(
    fields.startDateTimeUtc
    && fields.name
    && !/\b(find activities|attractions or tours|enhance your stay|things to do)\b/i.test(String(fields.name))
    && /\b(confirmation|reservation|ticket|event|tour|activity)\b/i.test(text)
  );

const formatFlightNumberWithSpace = (flightNumber: string): string => {
  const match = flightNumber.match(/^([A-Z0-9]{2})(\d{2,4})$/i);
  return match ? `${match[1].toUpperCase()} ${match[2]}` : flightNumber;
};

interface ChaseFlightLeg {
  date: Date | null;
  departureDate: string | null;
  rawDate: string | null;
  confirmationNumber: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  departureCode: string | null;
  arrivalCode: string | null;
  airline: string | null;
  flightNumber: string | null;
  flightNumbers: string[];
  duration: string | null;
  stops: string | null;
  fareClass: string | null;
  legCost: number | null;
}

interface GenericTransportLeg {
  sectionText: string;
  startDateTimeUtc: string | null;
  rawDatetimeString: string | null;
  departureCode: string | null;
  arrivalCode: string | null;
  providerVendor: string | null;
  flightNumber: string | null;
  departureLocation: string | null;
  arrivalLocation: string | null;
}

/**
 * Parse Chase Travel flight confirmation PDFs into per-leg data.
 * Handles formats: "Flight 1: Sat, Jun 08, 2024" sections and "Depart:" sections.
 */
const parseChaseFlightLegs = (text: string): ChaseFlightLeg[] => {
  // Find "Flight N:" section positions (skip the "Flight $xxx" price header)
  const sectionPositions: { index: number; header: string }[] = [];
  const flightSectionRegex = /Flight\s+(\d+)\s*:/gi;
  let sm;
  while ((sm = flightSectionRegex.exec(text)) !== null) {
    if (sm[0].includes('$')) continue; // Skip "Flight $591.20" price line
    sectionPositions.push({ index: sm.index, header: sm[0] });
  }

  // If no "Flight N:" sections, try "Depart:" marker
  if (!sectionPositions.length) {
    const departRegex = /Depart\s*:\s*([^\n]*)/gi;
    let dm;
    while ((dm = departRegex.exec(text)) !== null) {
        sectionPositions.push({ index: dm.index, header: dm[0] });
    }
  }

  // Chase email confirmations can use prose section headers instead of numbered legs.
  if (!sectionPositions.length) {
    const chaseEmailSectionRegex = /\b(?:Departure|Return)\s+flight\b/gi;
    let cm;
    while ((cm = chaseEmailSectionRegex.exec(text)) !== null) {
      sectionPositions.push({ index: cm.index, header: cm[0] });
    }
  }

  if (!sectionPositions.length) return [];

  // Build route→date map from Rules section (e.g. "BOS LAX\nSat, Jun 08, 2024 - ...")
  const routeDateMap = new Map<string, Date>();
  const rdRegex = /\b([A-Z]{3})\b[^\n]*?\b([A-Z]{3})\b\s*\n\s*(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*,?\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})/g;
  let rdm;
  while ((rdm = rdRegex.exec(text)) !== null) {
    const pd = parseNamedDateUtc(rdm[3]);
    if (pd) routeDateMap.set(rdm[1] + rdm[2], pd.date);
  }

  // Find "Traveler 1:" position to bound last section
  const travelerStart = text.search(/\bTraveler\s+1\s*:/i);

  const legs: ChaseFlightLeg[] = [];
  for (let i = 0; i < sectionPositions.length; i++) {
    const start = sectionPositions[i].index;
    const end = sectionPositions[i + 1]?.index
      ?? (travelerStart > start ? travelerStart : Math.min(start + 3000, text.length));
    const section = text.slice(start, end);

    // Date: from section header or body
    const sectionDate = parseNamedDateUtc(sectionPositions[i].header) ?? parseNamedDateUtc(section);

    // Time + airport code pairs
    const pairs = extractTimeCodePairs(section);
    const departureTime = pairs[0]?.time ?? null;
    const departureCode = pairs[0]?.code ?? null;
    const arrivalTime = pairs[1]?.time ?? null;
    const arrivalCode = pairs[1]?.code ?? null;

    // Date fallback from route-date map
    const legDate = sectionDate?.date
      ?? (departureCode && arrivalCode ? routeDateMap.get(departureCode + arrivalCode) ?? null : null);

    // Airline: "Jetblue Airways", "Delta Air Lines", "Cathay Pacific Airways", etc.
    const airlineMatch =
      section.match(/\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+)*[ \t]+(?:Air[ \t]+Lines|Airlines?|Airways?))\b(?=[\r\n ]+[A-Z0-9]{2}\s+\d{2,4})/i)
      ?? section.match(/\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+)*[ \t]+(?:Air[ \t]+Lines|Airlines?|Airways?))\b/i);
    const airline = airlineMatch?.[1]?.trim().replace(/^Stop\s+/i, '') ?? null;

    // Flight numbers: "B6 187 Airbus ..." or "CX 740 Airbus ..."
    const flightNumbers: string[] = [];
    const fnRegex = /\b([A-Z0-9]{2})\s+(\d{2,4})\s+(?:Airbus|Boeing|ATR|Embraer|Bombardier|[A-Z]{2,}[- ])/gi;
    let fnm;
    while ((fnm = fnRegex.exec(section)) !== null) {
      flightNumbers.push(`${fnm[1]}${fnm[2]}`);
    }
    // Broader fallback if no aircraft-qualified matches
    if (!flightNumbers.length) {
      const fnSimple = section.match(/\b([A-Z0-9]{2})\s+(\d{2,4})\b/);
      if (fnSimple) flightNumbers.push(`${fnSimple[1]}${fnSimple[2]}`);
    }

    if (!departureCode || !arrivalCode || !flightNumbers.length) continue;

    // Duration & stops
    const duration = section.match(/(\d+h\s*\d+m)/i)?.[1] ?? null;
    const stops = section.match(/\b(Non-Stop|\d+\s+Stops?)\b/i)?.[1] ?? null;

    // Fare class
    const fareMatch = section.match(/\bFare\s*:\s*(.+)/i);
    const fareClass = fareMatch?.[1]?.trim() ?? null;
    const legCost = Number(section.match(/\$([0-9,.]+)/)?.[1]?.replace(/,/g, '') ?? 'NaN');
    const legConfirmation = section.match(/\bAirline confirmation\s*:\s*([A-Z0-9]{4,10})\b/i)?.[1]?.toUpperCase() ?? null;

    legs.push({
      date: legDate,
      departureDate: legDate ? legDate.toISOString().slice(0, 10) : null,
      rawDate: sectionDate?.raw ?? null,
      confirmationNumber: legConfirmation,
      departureTime,
      arrivalTime,
      departureCode,
      arrivalCode,
      airline,
      flightNumber: flightNumbers[0] ? formatFlightNumberWithSpace(flightNumbers[0]) : null,
      flightNumbers,
      duration,
      stops,
      fareClass,
      legCost: Number.isFinite(legCost) ? legCost : null,
    });
  }

  return legs;
};

/**
 * Attempt to extract structured flight candidates from a Chase Travel confirmation.
 * Returns null if the document is not a Chase Travel format.
 */
const extractChaseFlights = async (doc: NormalizedDocument): Promise<ParsedItemCandidate[] | null> => {
  const text = doc.normalizedText;
  if (!isChaseTravel(text)) return null;

  const legs = parseChaseFlightLegs(text);
  if (!legs.length) return null;

  // Document-level fields
  const confirmation = text.match(/\bAirline confirmation\s*:\s*([A-Z0-9]{4,10})\b/i)?.[1]?.toUpperCase()
    ?? extractConfirmation(text);
  const travelers = extractTravelerNames(text);
  const tripTotal = extractTripTotalCost(text);
  const totalCost = tripTotal?.amount ?? 0;
  const currency = tripTotal?.currency ?? null;
  const travelerCount = parseInt(text.match(/(\d+)\s+travelers?\b/i)?.[1] ?? '0', 10) || travelers.length;

  const candidates: ParsedItemCandidate[] = [];
  for (const [index, leg] of legs.entries()) {
    // Compute full departure/arrival datetimes
    let startDateTimeUtc: string | null = null;
    let endDateTimeUtc: string | null = null;
    let rawDatetimeString: string | null = null;

    if (leg.date) {
      startDateTimeUtc = leg.departureTime ? combineDateAndTime(leg.date, leg.departureTime) : leg.date.toISOString();
      endDateTimeUtc = leg.arrivalTime ? combineDateAndTime(leg.date, leg.arrivalTime) : null;
      rawDatetimeString = leg.rawDate
        ? `${leg.rawDate}${leg.departureTime ? ` ${leg.departureTime}` : ''}`
        : leg.departureTime ?? null;
    }

    candidates.push(
      await createCandidate({
        itemType: 'flight',
        doc,
        providerVendor: leg.airline,
        confirmationNumber: leg.confirmationNumber ?? confirmation,
        extractedFields: {
          providerVendor: 'Chase Travel',
          airline: leg.airline,
          departureAirportCode: leg.departureCode,
          arrivalAirportCode: leg.arrivalCode,
          departureLocation: leg.departureCode,
          arrivalLocation: leg.arrivalCode,
          departureDate: leg.departureDate,
          departureTime: leg.departureTime,
          arrivalTime: leg.arrivalTime,
          confirmationNumber: leg.confirmationNumber ?? confirmation,
          flightNumber: leg.flightNumber,
          flightNumbers: leg.flightNumbers.length > 1 ? leg.flightNumbers : undefined,
          duration: leg.duration,
          stops: leg.stops,
          fareClass: leg.fareClass,
          cost: leg.legCost ?? (index === 0 ? totalCost : 0),
          totalCost: leg.legCost ?? totalCost,
          currency,
          paid: totalCost > 0,
          guestName: travelers[0] ?? null,
          travelers,
          travelerCount,
          startDateTimeUtc,
          endDateTimeUtc,
        },
        confidenceScore: 0.94,
        // Per-leg overrides
        startDateTimeUtcOverride: startDateTimeUtc,
        endDateTimeUtcOverride: endDateTimeUtc,
        rawDatetimeStringOverride: rawDatetimeString,
        travelerNamesOverride: travelers.length ? travelers : undefined,
        departureCodeOverride: leg.departureCode,
        arrivalCodeOverride: leg.arrivalCode,
      })
    );
  }

  return candidates.length ? candidates : null;
};

const splitTransportSections = (text: string): string[] => {
  const markerRegex = /\b(?:Flight|Segment|Leg)\s+\d+\s*:|\bDepart\s*:/gi;
  const markers = Array.from(text.matchAll(markerRegex)).map((match) => ({
    index: match.index ?? 0,
    value: match[0],
  }));

  const meaningfulMarkers = markers.filter((marker) => !marker.value.includes('$'));
  if (meaningfulMarkers.length < 2) return [];

  const sections: string[] = [];
  for (let index = 0; index < meaningfulMarkers.length; index += 1) {
    const start = meaningfulMarkers[index].index;
    const end = meaningfulMarkers[index + 1]?.index ?? text.length;
    const section = text.slice(start, end).trim();
    if (section.length >= 40) {
      sections.push(section);
    }
  }
  return sections;
};

const extractGenericTransportLegs = (text: string): GenericTransportLeg[] => {
  const sections = splitTransportSections(text);
  if (sections.length < 2) return [];

  const legs: GenericTransportLeg[] = [];
  for (const section of sections) {
    const semanticFields = extractSemanticFieldsForType('flight', section);
    const departureCode =
      extractIataCode(section, 'from')
      ?? (String(semanticFields.departureAirportCode ?? '').toUpperCase() || null);
    const arrivalCode =
      extractIataCode(section, 'to')
      ?? (String(semanticFields.arrivalAirportCode ?? '').toUpperCase() || null);
    const flightNumber =
      String(semanticFields.flightNumber ?? '').replace(/\s+/g, '')
      || section.match(/\b([A-Z0-9]{2}\s?\d{2,4})\b/)?.[1]?.replace(/\s+/g, '')
      || null;
    const providerVendor =
      String(semanticFields.providerVendor ?? '').trim()
      || section.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+(?:Airlines|Airways|Rail|Ferry|Bus))\b/)?.[1]
      || null;
    const rawDatetimeString =
      extractRawDatetimeString(section)
      ?? extractLabeledFieldValue(section, ['Departure', 'Depart', 'Date'], ['Arrival', 'Flight number', 'Confirmation', 'Booking'], false, 140)
      ?? null;
    const startDateTimeUtc =
      extractDate(section)
      ?? (typeof semanticFields.startDateTimeUtc === 'string' ? semanticFields.startDateTimeUtc : null);
    const departureLocation =
      String(semanticFields.departureLocation ?? '').trim()
      || section.match(/\bfrom\s+([A-Z][A-Za-z .'-]+)/i)?.[1]?.trim()
      || departureCode;
    const arrivalLocation =
      String(semanticFields.arrivalLocation ?? '').trim()
      || section.match(/\bto\s+([A-Z][A-Za-z .'-]+)/i)?.[1]?.trim()
      || arrivalCode;

    const signalCount = [departureCode, arrivalCode, flightNumber, rawDatetimeString].filter(Boolean).length;
    if (signalCount >= 2) {
      legs.push({
        sectionText: section,
        startDateTimeUtc,
        rawDatetimeString,
        departureCode,
        arrivalCode,
        providerVendor,
        flightNumber,
        departureLocation,
        arrivalLocation,
      });
    }
  }

  return legs.length >= 2 ? legs : [];
};

const extractTransportCandidates = async (
  doc: NormalizedDocument,
  itemType: ParsedItemType
): Promise<ParsedItemCandidate[] | null> => {
  if (itemType !== 'flight' && itemType !== 'rail' && itemType !== 'ferry_bus_transfer') {
    return null;
  }

  if (itemType === 'flight') {
    const chaseFlights = await extractChaseFlights(doc);
    if (chaseFlights?.length) return chaseFlights;
  }

  const legs = extractGenericTransportLegs(doc.normalizedText);
  if (!legs.length) return null;

  const travelers = extractTravelerNames(doc.normalizedText);
  const confirmation = extractConfirmation(doc.normalizedText);
  const tripTotal = extractTripTotalCost(doc.normalizedText);
  const candidates: ParsedItemCandidate[] = [];

  for (const [index, leg] of legs.entries()) {
    candidates.push(
      await createCandidate({
        itemType,
        doc,
        providerVendor: leg.providerVendor,
        confirmationNumber: confirmation,
        extractedFields: {
          providerVendor: leg.providerVendor,
          departureAirportCode: leg.departureCode,
          arrivalAirportCode: leg.arrivalCode,
          departureLocation: leg.departureLocation,
          arrivalLocation: leg.arrivalLocation,
          flightNumber: leg.flightNumber,
          cost: index === 0 ? tripTotal?.amount ?? 0 : 0,
          totalCost: tripTotal?.amount ?? null,
          currency: tripTotal?.currency ?? null,
          startDateTimeUtc: leg.startDateTimeUtc,
        },
        confidenceScore: 0.9,
        startDateTimeUtcOverride: leg.startDateTimeUtc,
        rawDatetimeStringOverride: leg.rawDatetimeString,
        travelerNamesOverride: travelers.length ? travelers : undefined,
        departureCodeOverride: leg.departureCode,
        arrivalCodeOverride: leg.arrivalCode,
      })
    );
  }

  return candidates.length ? candidates : null;
};

// ── Candidate builder ───────────────────────────────────────────────────────

const createCandidate = async (params: {
  itemType: ParsedItemType;
  doc: NormalizedDocument;
  providerVendor?: string | null;
  confirmationNumber?: string | null;
  extractedFields: Record<string, unknown>;
  confidenceScore: number;
  // Optional overrides for per-item data (e.g., multi-flight documents)
  startDateTimeUtcOverride?: string | null;
  endDateTimeUtcOverride?: string | null;
  rawDatetimeStringOverride?: string | null;
  travelerNamesOverride?: string[];
  departureCodeOverride?: string | null;
  arrivalCodeOverride?: string | null;
}): Promise<ParsedItemCandidate> => {
  const rawTravelerNames = params.travelerNamesOverride ?? extractTravelerNames(params.doc.normalizedText);
  const travelerNames = await filterTravelerNamesForUser(rawTravelerNames, params.doc.userId, params.doc.normalizedText);
  const startDateTimeUtc = params.startDateTimeUtcOverride !== undefined
    ? params.startDateTimeUtcOverride
    : extractDate(params.doc.normalizedText);
  const rawDatetimeString = params.rawDatetimeStringOverride !== undefined
    ? params.rawDatetimeStringOverride
    : extractRawDatetimeString(params.doc.normalizedText);

  // Timezone resolution using the priority-ordered resolver
  const departureCode = params.departureCodeOverride !== undefined
    ? params.departureCodeOverride
    : (extractIataCode(params.doc.normalizedText, 'from')
      ?? (String(params.extractedFields.departureAirportCode ?? '').toUpperCase() || null));
  const arrivalCode = params.arrivalCodeOverride !== undefined
    ? params.arrivalCodeOverride
    : (extractIataCode(params.doc.normalizedText, 'to')
      ?? (String(params.extractedFields.arrivalAirportCode ?? '').toUpperCase() || null));
  const departureCity = String(params.extractedFields.departureLocation ?? '').trim() || null;
  const arrivalCity = String(params.extractedFields.arrivalLocation ?? '').trim() || null;
  const propertyCity = String(params.extractedFields.address ?? params.extractedFields.location ?? '').trim() || null;

  const tzResult = await resolveTimezone({
    itemType: params.itemType,
    explicitTimezone: null,
    departureCode,
    arrivalCode,
    departureCity,
    arrivalCity,
    propertyCity,
    locationText: propertyCity,
  });

  const timezoneStatus: TimezoneStatus = tzResult.departureTimezone.timezoneStatus;
  const originalTimezone = tzResult.departureTimezone.timezone;
  const displayHint = tzResult.departureTimezone.displayHint;

  const candidate: ParsedItemCandidate = {
    itemType: params.itemType,
    sourceType: params.doc.sourceType,
    sourceDate: params.doc.receivedAt,
    providerVendor: params.providerVendor ?? null,
    travelerNames,
    confirmationNumber: params.confirmationNumber ?? null,
    startDateTimeUtc,
    endDateTimeUtc: params.endDateTimeUtcOverride ?? null,
    originalTimezone,
    timezoneStatus,
    rawDatetimeString,
    timezoneDisplayHint: displayHint,
    rawSourceReference: params.doc.rawSourceReference,
    confidenceScore: params.confidenceScore,
    reviewStatus: params.confidenceScore >= INGESTION_CONFIDENCE_REVIEW_READY ? 'READY_FOR_REVIEW' : 'LOW_CONFIDENCE',
    deduplicationFingerprint: '',
    extractedFields: params.extractedFields,
    editedFields: null,
  };
  candidate.deduplicationFingerprint = buildParsedItemFingerprint(candidate);
  return candidate;
};

// ── Extraction strategies ───────────────────────────────────────────────────

export class RegexExtractor implements ExtractionStrategy {
  readonly strategyName = 'RegexExtractor';
  readonly minConfidenceToSkipNext = INGESTION_CONFIDENCE_REVIEW_READY;

  canHandle(doc: NormalizedDocument): boolean {
    return doc.normalizedText.trim().length > 0;
  }

  async extract(doc: NormalizedDocument, _config: ExtractionConfig): Promise<ExtractionResult> {
    const text = doc.normalizedText;
    const lower = text.toLowerCase();
    const items: ParsedItemCandidate[] = [];
    const chaseTravelDocument = isChaseTravel(text);
    const hasHotelSignal = /\b(hotel|lodging|check-in|check-out|booking is confirmed|guest name|reservation details|booking details)\b/.test(lower);
    const hasStrongFlightSignal = /\b(flight|airline|boarding pass|pnr|record locator)\b/.test(lower);
    const hasWeakFlightSignal = /\b(departure|arrival)\b/.test(lower);
    let chaseFlightsFound = false;
    if (hasStrongFlightSignal || (hasWeakFlightSignal && !hasHotelSignal)) {
      const transportItemType = hasStrongFlightSignal
        ? 'flight'
        : /\b(train|rail)\b/.test(lower)
          ? 'rail'
        : /\b(ferry|bus transfer|coach)\b/.test(lower)
          ? 'ferry_bus_transfer'
          : 'flight';
      const transportCandidates = await extractTransportCandidates(doc, transportItemType);
      if (transportCandidates?.length) {
        chaseFlightsFound = chaseTravelDocument && transportItemType === 'flight';
        items.push(...transportCandidates);
      } else {
        const semanticFlightFields = extractSemanticFieldsForType(
          transportItemType,
          text
        );
        const greetingGuestName = normalizeTravelerName(text.match(/\bHello,\s*([A-Z][A-Za-z' -]+)\b/)?.[1] ?? '') || null;
        const flightGuestName = String(semanticFlightFields.guestName ?? '').trim() || greetingGuestName;
        items.push(
          await createCandidate({
            itemType: transportItemType,
            doc,
            providerVendor: String(
              semanticFlightFields.providerVendor
              ?? text.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)* (?:Airlines|Airways|Air Lines|Rail|Ferry|Bus))\b/)?.[1]
              ?? ''
            ) || null,
            confirmationNumber: extractConfirmation(text),
            travelerNamesOverride: flightGuestName ? [flightGuestName] : undefined,
            extractedFields: {
              ...semanticFlightFields,
              providerVendor: semanticFlightFields.providerVendor ?? text.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)* (?:Airlines|Airways|Air Lines|Rail|Ferry|Bus))\b/)?.[1] ?? null,
              airline: semanticFlightFields.airline ?? semanticFlightFields.providerVendor ?? text.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)* (?:Airlines|Airways|Air Lines|Rail|Ferry|Bus))\b/)?.[1] ?? null,
              confirmationNumber: semanticFlightFields.confirmationNumber ?? extractConfirmation(text),
              guestName: flightGuestName,
              travelers: flightGuestName ? [flightGuestName] : undefined,
              departureLocation: semanticFlightFields.departureLocation ?? text.match(/\bfrom\s+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
              arrivalLocation: semanticFlightFields.arrivalLocation ?? text.match(/\bto\s+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
              flightNumber: semanticFlightFields.flightNumber ?? text.match(/\b([A-Z]{2}\s?\d{2,4})\b/)?.[1]?.replace(/\s+/g, '') ?? null,
              startDateTimeUtc: semanticFlightFields.startDateTimeUtc ?? extractDate(text),
            },
            confidenceScore: /\b(boarding pass|flight number|pnr|record locator)\b/.test(lower) ? 0.94 : 0.82,
          })
        );
      }
    }
    if (/\b(hotel|lodging|check-in|check-out|booking is confirmed)\b/.test(lower)) {
      const semanticHotelFields = extractSemanticFieldsForType('hotel', text);
      const hotelName = extractHotelName(text);
      const { checkIn, checkOut } = extractCheckInOutDates(text);
      const address = extractHotelAddress(text);
      const phone = extractHotelPhone(text);
      const { amount: totalCost, currency } = extractHotelCost(text);
      const guestName = extractHotelGuestName(text);
      // Booking.com uses long numeric confirmation codes
      const confirmation = text.match(/\bConfirmation\s*(?:number)?[:#\s-]+([A-Z0-9]{4,25})\b/i)?.[1]
        ?? extractConfirmation(text);
      const rooms = Number(text.match(/\b(\d+)\s+rooms?\b/i)?.[1] ?? '1');
      const breakfastIncluded = /breakfast\s+(?:is\s+)?included/i.test(text);
      const freeCancelBy = extractFreeCancelDate(text);
      const paid = /you paid/i.test(text)
        ? true
        : /\b(?:you'?ll pay when you stay|pay at the property|payment will be handled by)\b/i.test(text)
          ? false
          : false;

      const hotelFields = {
        ...semanticHotelFields,
        name: hotelName ?? 'Imported lodging',
        guestName: semanticHotelFields.guestName ?? guestName,
        address: semanticHotelFields.address ?? address,
        phone: semanticHotelFields.phone ?? phone,
        checkInDate: semanticHotelFields.checkInDate ?? checkIn,
        checkOutDate: semanticHotelFields.checkOutDate ?? checkOut,
        freeCancelBy: semanticHotelFields.freeCancelBy ?? freeCancelBy,
        rooms: semanticHotelFields.rooms ?? rooms,
        breakfastIncluded: semanticHotelFields.breakfastIncluded ?? breakfastIncluded,
        totalCost: totalCost > 0 ? totalCost : semanticHotelFields.totalCost ?? totalCost,
        currency: totalCost > 0 ? currency : semanticHotelFields.currency ?? currency,
        paid: semanticHotelFields.paid ?? paid,
      };
      const shouldSkipHotel =
        !hasStrongHotelBookingSignals(text, hotelFields, hotelName)
        || ((chaseTravelDocument || containsTravelUpsellSignals(text)) && !hasStrongHotelBookingSignals(text, hotelFields, hotelName))
        || (chaseFlightsFound && /\bbook a hotel\b/i.test(text) && !hotelFields.checkInDate && !hotelFields.checkOutDate);
      if (!shouldSkipHotel) {
        items.push(
          await createCandidate({
            itemType: 'hotel',
            doc,
            providerVendor: hotelName,
            confirmationNumber: confirmation,
            extractedFields: hotelFields,
            confidenceScore: ((semanticHotelFields.checkInDate ?? checkIn) && (semanticHotelFields.checkOutDate ?? checkOut)) ? 0.94 : /\b(check-in|check-out|reservation|booking is confirmed)\b/.test(lower) ? 0.91 : 0.75,
            startDateTimeUtcOverride: (semanticHotelFields.checkInDate as string | null | undefined) ?? checkIn ?? undefined,
            endDateTimeUtcOverride: (semanticHotelFields.checkOutDate as string | null | undefined) ?? checkOut ?? undefined,
            travelerNamesOverride: (semanticHotelFields.guestName ?? guestName) ? [String(semanticHotelFields.guestName ?? guestName)] : undefined,
          })
        );
      }
    }
    if (/\b(car rental|pickup|dropoff|rental agreement)\b/.test(lower)) {
      const semanticCarFields = extractSemanticFieldsForType('car_rental', text);
      const providerVendor = text.match(/\b(Hertz|Avis|Enterprise|Budget|National|Alamo|Sixt|Dollar|Thrifty|Fox)\b/i)?.[1] ?? null;
      const carFields = {
        ...semanticCarFields,
        pickupLocation: semanticCarFields.pickupLocation ?? text.match(/\bpickup[:\s]+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
        dropoffLocation: semanticCarFields.dropoffLocation ?? text.match(/\bdropoff[:\s]+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
        model: semanticCarFields.model ?? text.match(/\b(vehicle|car)\s*[:\-]\s*([A-Za-z0-9 -]+)/i)?.[2] ?? null,
        cost: semanticCarFields.cost ?? Number(text.match(/\$([0-9,.]+)/)?.[1]?.replace(/,/g, '') ?? '0'),
        startDateTimeUtc: semanticCarFields.startDateTimeUtc ?? extractDate(text),
      };
      const shouldSkipCarRental =
        !hasStrongCarRentalSignals(text, carFields, providerVendor)
        || ((chaseTravelDocument || containsTravelUpsellSignals(text)) && !hasStrongCarRentalSignals(text, carFields, providerVendor));
      if (!shouldSkipCarRental) {
        items.push(
          await createCandidate({
            itemType: 'car_rental',
            doc,
            providerVendor,
            confirmationNumber: extractConfirmation(text),
            extractedFields: carFields,
            confidenceScore: 0.83,
          })
        );
      }
    }
    if (/\b(restaurant reservation|restaurant|table for|event ticket|concert|tour|activity)\b/.test(lower)) {
      const itemType: ParsedItemType = /\brestaurant\b/.test(lower)
        ? 'restaurant_reservation'
        : /\b(event|concert|ticket)\b/.test(lower)
          ? 'event_ticket'
          : 'tour_activity';
      const semanticActivityFields = extractSemanticFieldsForType(itemType, text);
      const activityFields = {
        ...semanticActivityFields,
        name: semanticActivityFields.name ?? text.match(/\b(?:event|tour|activity|restaurant)\s*[:\-]\s*([A-Z][A-Za-z0-9 '&.-]+)/i)?.[1] ?? 'Imported activity',
        location: semanticActivityFields.location ?? text.match(/\blocation[:\s]+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
        duration: semanticActivityFields.duration ?? text.match(/\b(\d+\s*(?:hours?|hrs?|minutes?|mins?))\b/i)?.[1] ?? null,
        cost: semanticActivityFields.cost ?? Number(text.match(/\$([0-9,.]+)/)?.[1]?.replace(/,/g, '') ?? '0'),
        startDateTimeUtc: semanticActivityFields.startDateTimeUtc ?? extractDate(text),
      };
      const shouldSkipActivity =
        !hasStrongActivitySignals(text, activityFields)
        || ((chaseTravelDocument || containsTravelUpsellSignals(text)) && !hasStrongActivitySignals(text, activityFields));
      if (!shouldSkipActivity) {
        items.push(
          await createCandidate({
            itemType,
            doc,
            providerVendor: text.match(/\bprovider[:\s]+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
            confirmationNumber: extractConfirmation(text),
            extractedFields: activityFields,
            confidenceScore: 0.78,
          })
        );
      }
    }
    if (!items.length) {
      items.push(
        await createCandidate({
          itemType: 'generic_note',
          doc,
          providerVendor: null,
          confirmationNumber: extractConfirmation(text),
          extractedFields: {
            summary: text.slice(0, 500),
            notes: text.slice(0, 2000),
          },
          confidenceScore: extractDate(text) ? 0.72 : 0.48,
        })
      );
    }
    return {
      parsedItems: items,
      usageMetrics: {
        tokensIn: 0,
        tokensOut: 0,
        provider: 'regex',
        modelName: null,
        estimatedCostUsd: 0,
      },
      metadata: {
        logicVersion: INGESTION_LOGIC_VERSION,
        extractedAt: new Date().toISOString(),
        strategyName: this.strategyName,
      },
    };
  }
}

class NoopLlmExtractor implements ExtractionStrategy {
  constructor(
    readonly strategyName: string,
    readonly minConfidenceToSkipNext: number,
    private readonly canRun: (config: ExtractionConfig) => boolean,
    private readonly apiLimitCaller: string
  ) {}

  canHandle(_doc: NormalizedDocument): boolean {
    return true;
  }

  async extract(doc: NormalizedDocument, config: ExtractionConfig): Promise<ExtractionResult> {
    if (!this.canRun(config)) {
      return {
        parsedItems: [],
        usageMetrics: {
          tokensIn: 0,
          tokensOut: 0,
          provider: this.strategyName,
          modelName: null,
          estimatedCostUsd: 0,
        },
        metadata: {
          logicVersion: config.logicVersion,
          extractedAt: new Date().toISOString(),
          strategyName: this.strategyName,
        },
      };
    }

    // Reserve API usage through the shared rate limiter
    try {
      await reserveApiUsageOrThrow({ provider: 'LLM_PARSER', caller: this.apiLimitCaller });
    } catch (error) {
      if (error instanceof ApiLimitExceededError) {
        return {
          parsedItems: [],
          usageMetrics: { tokensIn: 0, tokensOut: 0, provider: this.strategyName, modelName: null, estimatedCostUsd: 0 },
          metadata: { logicVersion: config.logicVersion, extractedAt: new Date().toISOString(), strategyName: this.strategyName },
        };
      }
      throw error;
    }

    return {
      parsedItems: [
        await createCandidate({
          itemType: 'generic_note',
          doc,
          extractedFields: {
            summary: doc.normalizedText.slice(0, 500),
          },
          confidenceScore: 0.55,
        }),
      ],
      usageMetrics: {
        tokensIn: 200,
        tokensOut: 100,
        provider: 'llm',
        modelName: this.strategyName,
        estimatedCostUsd: 0.01,
      },
      metadata: {
        logicVersion: config.logicVersion,
        extractedAt: new Date().toISOString(),
        strategyName: this.strategyName,
      },
    };
  }
}

// Re-export createCandidate for use by learnedExtractor and llmExtractor (avoids circular import of the full module)
export const createCandidateExported = createCandidate;
export const extractTransportCandidatesExported = extractTransportCandidates;

// Lazy-load the new extractors to avoid circular imports at module parse time
const getLearnedStrategies = async (): Promise<ExtractionStrategy[]> => {
  const { SourceSpecificExtractor } = require('./learnedExtractor');
  const { LlmExtractor } = require('./llmExtractor');
  return [
    new SourceSpecificExtractor(),
    new RegexExtractor(),
    new LlmExtractor('LlmExtractor', INGESTION_CONFIDENCE_REVIEW_READY, (config: ExtractionConfig) => config.allowSmallLlm || config.allowLargeLlm),
  ];
};

const defaultStrategies = [
  new RegexExtractor(),
  new NoopLlmExtractor('SmallLLMExtractor', INGESTION_CONFIDENCE_REVIEW_READY, (config: ExtractionConfig) => config.allowSmallLlm, 'INGESTION_SMALL_LLM'),
  new NoopLlmExtractor('LargeLLMExtractor', 1, (config: ExtractionConfig) => config.allowLargeLlm, 'INGESTION_LARGE_LLM'),
];

export const extractCandidates = async (
  doc: NormalizedDocument,
  config: Omit<ExtractionConfig, 'logicVersion' | 'tokenBudgetUsd'> & Partial<Pick<ExtractionConfig, 'logicVersion' | 'tokenBudgetUsd'>>,
  strategies?: ExtractionStrategy[]
): Promise<ExtractionResult> => {
  if (!strategies) {
    try {
      strategies = await getLearnedStrategies();
    } catch {
      strategies = defaultStrategies;
    }
  }
  const extractionConfig: ExtractionConfig = {
    logicVersion: config.logicVersion ?? INGESTION_LOGIC_VERSION,
    tokenBudgetUsd: config.tokenBudgetUsd ?? INGESTION_JOB_TOKEN_BUDGET_USD,
    allowSmallLlm: config.allowSmallLlm,
    allowLargeLlm: config.allowLargeLlm,
    contentHash: config.contentHash,
    userId: config.userId,
    importJobId: config.importJobId,
    correlationId: config.correlationId,
  };

  const cached = await getExtractionCacheEntry(extractionConfig.userId, extractionConfig.contentHash, extractionConfig.logicVersion);
  if (cached) {
    return cached as unknown as ExtractionResult;
  }

  let bestResult: ExtractionResult | null = null;
  let attemptNumber = 0;
  let cumulativeCost = 0;
  let bestConfidence = 0;

  for (const strategy of strategies) {
    if (!strategy.canHandle(doc)) continue;
    if (
      (strategy.strategyName.includes('LLM') || strategy.strategyName.includes('Llm')) &&
      bestResult &&
      bestConfidence < INGESTION_CONFIDENCE_REVIEW_READY
    ) {
      logInfo(
        `[ingestion][extract] low-confidence fallback to LLM source=${doc.sourceType} file="${doc.originalFilename}" previous_strategy=${bestResult.metadata.strategyName} confidence=${bestConfidence.toFixed(2)}`
      );
    }
    const startedAt = new Date().toISOString();
    attemptNumber += 1;
    const result = await strategy.extract(doc, extractionConfig);
    const completedAt = new Date().toISOString();
    const resultConfidence = Math.max(...result.parsedItems.map((item) => item.confidenceScore), 0);
    cumulativeCost += result.usageMetrics.estimatedCostUsd;
    await recordParseAttempt({
      importJobId: extractionConfig.importJobId,
      stage: strategy.strategyName.includes('LLM') || strategy.strategyName.includes('Llm') ? 'SMALL_LLM' : strategy.strategyName.includes('SourceSpecific') ? 'SOURCE_SPECIFIC' : 'REGEX',
      extractorName: strategy.strategyName,
      logicVersion: extractionConfig.logicVersion,
      attemptNumber,
      startedAt,
      completedAt,
      outcome: result.parsedItems.length ? `${strategy.strategyName.toLowerCase()}_succeeded` : `${strategy.strategyName.toLowerCase()}_empty`,
      confidenceScore: resultConfidence,
      tokensIn: result.usageMetrics.tokensIn,
      tokensOut: result.usageMetrics.tokensOut,
      modelName: result.usageMetrics.modelName,
      errorCode: null,
    });
    await recordUsageMetering({
      userId: extractionConfig.userId,
      importJobId: extractionConfig.importJobId,
      sourceType: doc.sourceType,
      parserStage: strategy.strategyName,
      provider: result.usageMetrics.provider,
      modelName: result.usageMetrics.modelName,
      tokenCountIn: result.usageMetrics.tokensIn,
      tokenCountOut: result.usageMetrics.tokensOut,
      estimatedCostUsd: result.usageMetrics.estimatedCostUsd,
    });
    if (!bestResult || resultConfidence > bestConfidence) {
      bestResult = result;
      bestConfidence = resultConfidence;
    }
    if (cumulativeCost > extractionConfig.tokenBudgetUsd) {
      throw new Error('Token budget exceeded for import job');
    }
    if (result.parsedItems.some((item) => item.confidenceScore >= strategy.minConfidenceToSkipNext)) {
      break;
    }
  }

  const finalResult =
    bestResult ??
    ({
      parsedItems: [],
      usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'none', modelName: null, estimatedCostUsd: 0 },
      metadata: {
        logicVersion: extractionConfig.logicVersion,
        extractedAt: new Date().toISOString(),
        strategyName: 'none',
      },
    } satisfies ExtractionResult);
  const sanitizedFinalResult = sanitizeExtractionResult(finalResult);
  await saveExtractionCacheEntry(
    extractionConfig.userId,
    extractionConfig.contentHash,
    extractionConfig.logicVersion,
    sanitizedFinalResult as unknown as Record<string, unknown>
  );
  return sanitizedFinalResult;
};

// Exported for testing
export { extractChaseFlights as _extractChaseFlights, parseChaseFlightLegs as _parseChaseFlightLegs, extractTimeCodePairs as _extractTimeCodePairs, extractTravelerNames as _extractTravelerNames, isChaseTravel as _isChaseTravel };
