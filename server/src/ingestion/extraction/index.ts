import { INGESTION_CONFIDENCE_HIGH, INGESTION_CONFIDENCE_REVIEW_READY, INGESTION_JOB_TOKEN_BUDGET_USD, INGESTION_LOGIC_VERSION } from '../config';
import type { ExtractionConfig, ExtractionResult, NormalizedDocument, ParsedItemCandidate, ParsedItemType, TimezoneStatus } from '../contracts';
import { buildParsedItemFingerprint } from '../shared/hashing';
import { getExtractionCacheEntry, recordParseAttempt, recordUsageMetering, saveExtractionCacheEntry } from '../shared/repository';
import { resolveTimezone } from '../shared/timezoneResolver';
import { reserveApiUsageOrThrow, ApiLimitExceededError } from '../../apis/usageLimiter';
import { logInfo } from '../../logger';

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

const extractConfirmation = (text: string): string | null => {
  const match = text.match(/\b(?:confirmation|booking|reservation|record locator|pnr)\s*(?:number|code|ref(?:erence)?)?[:#\s-]+([A-Z0-9]{5,10})\b/i);
  return match ? match[1].toUpperCase() : null;
};

const extractTravelerNames = (text: string): string[] => {
  // Try structured "Traveler N:" format first (handles ALL-CAPS and mixed case names)
  const structured: string[] = [];
  const travelerPattern = /Traveler\s+\d+\s*:\s*(.+)/gi;
  let tm;
  while ((tm = travelerPattern.exec(text)) !== null) {
    const raw = tm[1].trim();
    // Normalize "BRYAN Edward Duerk" → "Bryan Edward Duerk"
    const name = raw.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    structured.push(name);
  }
  if (structured.length) return Array.from(new Set(structured)).slice(0, 6);

  // Fallback: title-case first+last pairs
  const matches = Array.from(text.matchAll(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g)).map((match) => match[1].trim());
  return Array.from(new Set(matches)).slice(0, 6);
};

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
  // "confirmed at HOTEL_NAME" (Booking.com, Hotels.com, Expedia, etc.)
  const confirmedAt = text.match(/confirmed\s+at\s+([^\n]+)/i);
  if (confirmedAt) return confirmedAt[1].trim();
  // "HOTEL_NAME is expecting you" (Booking.com)
  const expecting = text.match(/\b(.+?)\s+is expecting you\b/i);
  if (expecting) return expecting[1].trim();
  // Name with common accommodation suffix (case-insensitive on suffix)
  const withSuffix = text.match(/\b([A-Z][A-Za-z0-9 '&.-]+\s+(?:Hotel|Resort|Inn|Suites|Lodge|Hostel|Motel|Villa|Boutique hotel))\b/i);
  if (withSuffix) return withSuffix[1].trim();
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
  const ciMatch = text.match(/Check-in\s+([^\n]+)/i);
  const coMatch = text.match(/Check-out\s+([^\n]+)/i);
  return {
    checkIn: ciMatch ? parseDateField(ciMatch[1]) : null,
    checkOut: coMatch ? parseDateField(coMatch[1]) : null,
  };
};

const extractHotelAddress = (text: string): string | null => {
  // "Location 16 Wiedner Gürtel, ..." (Booking.com)
  const location = text.match(/\bLocation\s+(\d[^\n]+)/i);
  if (location) return location[1].trim();
  const address = text.match(/\bAddress[:\s]+([^\n]+)/i);
  if (address) return address[1].trim();
  return null;
};

const extractHotelCost = (text: string): { amount: number; currency: string } => {
  const patterns: Array<{ regex: RegExp; currency: string }> = [
    { regex: /(?:You paid|Total Price|Trip total)\s+(?:approx\.?\s*)?(?:US)?\$\s*([0-9,.]+)/i, currency: 'USD' },
    { regex: /(?:You paid|Total Price|Trip total)\s+(?:approx\.?\s*)?€\s*([0-9,.]+)/i, currency: 'EUR' },
    { regex: /(?:You paid|Total Price|Trip total)\s+(?:approx\.?\s*)?£\s*([0-9,.]+)/i, currency: 'GBP' },
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

interface ChaseFlightLeg {
  date: Date | null;
  rawDate: string | null;
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
}

/**
 * Parse Chase Travel flight confirmation PDFs into per-leg data.
 * Handles formats: "Flight 1: Sat, Jun 08, 2024" sections and "Depart:" sections.
 */
const parseChaseFlightLegs = (text: string): ChaseFlightLeg[] => {
  // Find "Flight N:" section positions (skip the "Flight $xxx" price header)
  const sectionPositions: { index: number; endOfHeader: number; header: string }[] = [];
  const flightSectionRegex = /Flight\s+(\d+)\s*:?\s*([^\n]*)/gi;
  let sm;
  while ((sm = flightSectionRegex.exec(text)) !== null) {
    if (/\$/.test(sm[0])) continue; // Skip "Flight $591.20" price line
    sectionPositions.push({ index: sm.index, endOfHeader: sm.index + sm[0].length, header: sm[0] });
  }

  // If no "Flight N:" sections, try "Depart:" marker
  if (!sectionPositions.length) {
    const departRegex = /Depart\s*:\s*([^\n]*)/gi;
    let dm;
    while ((dm = departRegex.exec(text)) !== null) {
      sectionPositions.push({ index: dm.index, endOfHeader: dm.index + dm[0].length, header: dm[0] });
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

    // Airline: "Jetblue Airways", "Lao Airlines", "Cathay Pacific Airways", etc.
    const airlineMatch = section.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Airlines?|Airways?))\b/i);
    const airline = airlineMatch?.[1]?.trim() ?? null;

    // Flight numbers: "B6 187 Airbus ..." or "CX 740 Airbus ..."
    const flightNumbers: string[] = [];
    const fnRegex = /\b([A-Z]{2})\s+(\d{2,4})\s+(?:Airbus|Boeing|ATR|Embraer|Bombardier|[A-Z]{2,}[- ])/gi;
    let fnm;
    while ((fnm = fnRegex.exec(section)) !== null) {
      flightNumbers.push(`${fnm[1]}${fnm[2]}`);
    }
    // Broader fallback if no aircraft-qualified matches
    if (!flightNumbers.length) {
      const fnSimple = section.match(/\b([A-Z]{2})\s+(\d{2,4})\b/);
      if (fnSimple) flightNumbers.push(`${fnSimple[1]}${fnSimple[2]}`);
    }

    // Duration & stops
    const duration = section.match(/(\d+h\s*\d+m)/i)?.[1] ?? null;
    const stops = section.match(/\b(Non-Stop|\d+\s+Stops?)\b/i)?.[1] ?? null;

    // Fare class
    const fareMatch = section.match(/\bFare\s*:\s*(.+)/i);
    const fareClass = fareMatch?.[1]?.trim() ?? null;

    legs.push({
      date: legDate,
      rawDate: sectionDate?.raw ?? null,
      departureTime,
      arrivalTime,
      departureCode,
      arrivalCode,
      airline,
      flightNumber: flightNumbers[0] ?? null,
      flightNumbers,
      duration,
      stops,
      fareClass,
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
  const totalCost = parseFloat(text.match(/Trip total\s+\$([0-9,.]+)/i)?.[1]?.replace(/,/g, '') ?? '0');
  const travelerCount = parseInt(text.match(/(\d+)\s+travelers?\b/i)?.[1] ?? '0', 10) || travelers.length;

  const candidates: ParsedItemCandidate[] = [];
  for (const leg of legs) {
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
        confirmationNumber: confirmation,
        extractedFields: {
          providerVendor: leg.airline,
          departureAirportCode: leg.departureCode,
          arrivalAirportCode: leg.arrivalCode,
          departureLocation: leg.departureCode,
          arrivalLocation: leg.arrivalCode,
          departureTime: leg.departureTime,
          arrivalTime: leg.arrivalTime,
          flightNumber: leg.flightNumber,
          flightNumbers: leg.flightNumbers.length > 1 ? leg.flightNumbers : undefined,
          duration: leg.duration,
          stops: leg.stops,
          fareClass: leg.fareClass,
          totalCost,
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
  const travelerNames = params.travelerNamesOverride ?? extractTravelerNames(params.doc.normalizedText);
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

class RegexExtractor implements ExtractionStrategy {
  readonly strategyName = 'RegexExtractor';
  readonly minConfidenceToSkipNext = INGESTION_CONFIDENCE_REVIEW_READY;

  canHandle(doc: NormalizedDocument): boolean {
    return doc.normalizedText.trim().length > 0;
  }

  async extract(doc: NormalizedDocument, _config: ExtractionConfig): Promise<ExtractionResult> {
    const text = doc.normalizedText;
    const lower = text.toLowerCase();
    const items: ParsedItemCandidate[] = [];
    if (/\b(flight|airline|boarding pass|departure|arrival|pnr|record locator)\b/.test(lower)) {
      // Try Chase Travel specialized parser first (produces per-leg candidates)
      const chaseFlights = await extractChaseFlights(doc);
      if (chaseFlights?.length) {
        items.push(...chaseFlights);
      } else {
        items.push(
          await createCandidate({
            itemType: /\b(train|rail)\b/.test(lower) ? 'rail' : /\b(ferry|bus transfer|coach)\b/.test(lower) ? 'ferry_bus_transfer' : 'flight',
            doc,
            providerVendor: text.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)* (?:Airlines|Airways|Rail|Ferry|Bus))\b/)?.[1] ?? null,
            confirmationNumber: extractConfirmation(text),
            extractedFields: {
              providerVendor: text.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)* (?:Airlines|Airways|Rail|Ferry|Bus))\b/)?.[1] ?? null,
              departureLocation: text.match(/\bfrom\s+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
              arrivalLocation: text.match(/\bto\s+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
              flightNumber: text.match(/\b([A-Z]{2}\s?\d{2,4})\b/)?.[1]?.replace(/\s+/g, '') ?? null,
              startDateTimeUtc: extractDate(text),
            },
            confidenceScore: /\b(boarding pass|flight number|pnr|record locator)\b/.test(lower) ? 0.94 : 0.82,
          })
        );
      }
    }
    if (/\b(hotel|lodging|check-in|check-out|booking is confirmed)\b/.test(lower)) {
      const hotelName = extractHotelName(text);
      const { checkIn, checkOut } = extractCheckInOutDates(text);
      const address = extractHotelAddress(text);
      const { amount: totalCost, currency } = extractHotelCost(text);
      const guestName = text.match(/Guest name\s+(.+)/i)?.[1]?.trim() ?? null;
      // Booking.com uses long numeric confirmation codes
      const confirmation = text.match(/\bConfirmation\s*(?:number)?[:#\s-]+([A-Z0-9]{4,25})\b/i)?.[1]
        ?? extractConfirmation(text);
      const rooms = Number(text.match(/\b(\d+)\s+rooms?\b/i)?.[1] ?? '1');
      const breakfastIncluded = /breakfast\s+(?:is\s+)?included/i.test(text);
      const freeCancelBy = extractFreeCancelDate(text);
      const paid = /you paid/i.test(text);

      items.push(
        await createCandidate({
          itemType: 'hotel',
          doc,
          providerVendor: hotelName,
          confirmationNumber: confirmation,
          extractedFields: {
            name: hotelName ?? 'Imported lodging',
            guestName,
            address,
            checkInDate: checkIn,
            checkOutDate: checkOut,
            freeCancelBy,
            rooms,
            breakfastIncluded,
            totalCost,
            currency,
            paid,
          },
          confidenceScore: (checkIn && checkOut) ? 0.94 : /\b(check-in|check-out|reservation|booking is confirmed)\b/.test(lower) ? 0.91 : 0.75,
          startDateTimeUtcOverride: checkIn ?? undefined,
          endDateTimeUtcOverride: checkOut ?? undefined,
          travelerNamesOverride: guestName ? [guestName] : undefined,
        })
      );
    }
    if (/\b(car rental|pickup|dropoff|rental agreement)\b/.test(lower)) {
      items.push(
        await createCandidate({
          itemType: 'car_rental',
          doc,
          providerVendor: text.match(/\b(Hertz|Avis|Enterprise|Budget|National|Alamo|Sixt)\b/i)?.[1] ?? null,
          confirmationNumber: extractConfirmation(text),
          extractedFields: {
            pickupLocation: text.match(/\bpickup[:\s]+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
            dropoffLocation: text.match(/\bdropoff[:\s]+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
            model: text.match(/\b(vehicle|car)\s*[:\-]\s*([A-Za-z0-9 -]+)/i)?.[2] ?? null,
            cost: Number(text.match(/\$([0-9,.]+)/)?.[1]?.replace(/,/g, '') ?? '0'),
            startDateTimeUtc: extractDate(text),
          },
          confidenceScore: 0.83,
        })
      );
    }
    if (/\b(restaurant reservation|restaurant|table for|event ticket|concert|tour|activity)\b/.test(lower)) {
      const itemType: ParsedItemType = /\brestaurant\b/.test(lower)
        ? 'restaurant_reservation'
        : /\b(event|concert|ticket)\b/.test(lower)
          ? 'event_ticket'
          : 'tour_activity';
      items.push(
        await createCandidate({
          itemType,
          doc,
          providerVendor: text.match(/\bprovider[:\s]+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
          confirmationNumber: extractConfirmation(text),
          extractedFields: {
            name: text.match(/\b(?:event|tour|activity|restaurant)\s*[:\-]\s*([A-Z][A-Za-z0-9 '&.-]+)/i)?.[1] ?? 'Imported activity',
            location: text.match(/\blocation[:\s]+([A-Z][A-Za-z .'-]+)/i)?.[1] ?? null,
            duration: text.match(/\b(\d+\s*(?:hours?|hrs?|minutes?|mins?))\b/i)?.[1] ?? null,
            cost: Number(text.match(/\$([0-9,.]+)/)?.[1]?.replace(/,/g, '') ?? '0'),
            startDateTimeUtc: extractDate(text),
          },
          confidenceScore: 0.78,
        })
      );
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
      reserveApiUsageOrThrow({ provider: 'OPENAI', caller: this.apiLimitCaller });
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

// Lazy-load the new extractors to avoid circular imports at module parse time
const getLearnedStrategies = async (): Promise<ExtractionStrategy[]> => {
  const { SourceSpecificExtractor } = await import('./learnedExtractor');
  const { LlmExtractor } = await import('./llmExtractor');
  return [
    new SourceSpecificExtractor(),
    new RegexExtractor(),
    new LlmExtractor('LlmExtractor', INGESTION_CONFIDENCE_REVIEW_READY, (config) => config.allowSmallLlm || config.allowLargeLlm),
  ];
};

const defaultStrategies = [
  new RegexExtractor(),
  new NoopLlmExtractor('SmallLLMExtractor', INGESTION_CONFIDENCE_REVIEW_READY, (config) => config.allowSmallLlm, 'INGESTION_SMALL_LLM'),
  new NoopLlmExtractor('LargeLLMExtractor', 1, (config) => config.allowLargeLlm, 'INGESTION_LARGE_LLM'),
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
  await saveExtractionCacheEntry(extractionConfig.userId, extractionConfig.contentHash, extractionConfig.logicVersion, finalResult as unknown as Record<string, unknown>);
  return finalResult;
};

// Exported for testing
export { extractChaseFlights as _extractChaseFlights, parseChaseFlightLegs as _parseChaseFlightLegs, extractTimeCodePairs as _extractTimeCodePairs, extractTravelerNames as _extractTravelerNames, isChaseTravel as _isChaseTravel };
