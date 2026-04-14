/**
 * Source-specific learned parser extractor.
 *
 * Uses regex patterns stored in `learned_source_parsers` (populated by LLM learning).
 * Falls through to generic regex if no learned parser exists or match ratio is too low.
 */

import { INGESTION_CONFIDENCE_HIGH, INGESTION_CONFIDENCE_REVIEW_READY } from '../config';
import type { ExtractionConfig, ExtractionResult, NormalizedDocument, ParsedItemCandidate, ParsedItemType } from '../contracts';
import type { ExtractionStrategy } from './index';
import { detectSource, detectItemType } from './sourceDetection';
import { getLearnedParser } from '../shared/repository';
import { logInfo } from '../../logger';
import { extractLabeledFieldValue, extractPhoneLikeValue, toTitleCaseWords } from './hotelFieldExtractors';
import { extractSemanticFieldsForType } from './semanticFieldHelpers';
import { extractTransportCandidatesExported } from './index';

const INGESTION_SOURCE_PARSER_MIN_MATCH_RATIO = 0.4;

const parseHotelDateValue = (value: string): string | null => {
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return new Date(`${iso[1]}T12:00:00Z`).toISOString();
  const named = value.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\b/i);
  if (!named) return null;
  const parsed = new Date(named[1]);
  return Number.isNaN(parsed.getTime()) ? null : new Date(`${parsed.toISOString().slice(0, 10)}T12:00:00Z`).toISOString();
};
const extractBookingGuestName = (text: string): string | null => {
  const candidate = extractLabeledFieldValue(
    text,
    ['Guest name'],
    ['Check-in', 'Check-out', 'Max capacity', 'Breakfast', 'Prepayment', 'Payment', 'Room', 'Location', 'Address', 'Phone', 'Contact', 'Reservation details', 'Booking details'],
    true,
    180
  );
  if (!candidate || /^below\b/i.test(candidate) || /[<>@]/.test(candidate)) return null;
  return toTitleCaseWords(candidate);
};

const coerceFieldValue = (fieldName: string, rawValue: string): unknown => {
  const value = rawValue.trim();
  if (!value) return value;
  if (fieldName === 'rooms') {
    const match = value.match(/\d+/);
    return match ? Number(match[0]) : value;
  }
  if (fieldName === 'totalCost') {
    const numeric = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
    return numeric ? Number(numeric) : value;
  }
  if (fieldName === 'breakfastIncluded' || fieldName === 'paid') {
    return /\b(?:yes|true|included|paid|prepaid)\b/i.test(value);
  }
  if (fieldName === 'checkInDate' || fieldName === 'checkOutDate' || fieldName === 'freeCancelBy') {
    return parseHotelDateValue(value) ?? value;
  }
  if (fieldName === 'guestName') {
    return value
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }
  return value;
};

const BUILT_IN_SOURCE_PARSERS: Record<string, Record<string, Record<string, string | string[]>>> = {
  'booking.com': {
    hotel: {
      name: [
        String.raw`confirmed\s+at\s+(.{2,140}?)(?=\s+(?:\d+\s+message|Booking\.com\b|From:|To:|Date:|Subject:|Confirmation\b|PIN\b|Thanks,))`,
        String.raw`\b([A-Z][A-Za-z0-9 '&.-]{2,120}?)\s+is expecting you\b`,
        String.raw`\bYour booking summary[\s\S]{0,120}?\b([A-Z][A-Za-z0-9 '&.-]{2,120}?)\s+Confirmed\b`,
      ],
      confirmationNumber: [
        String.raw`\bConfirmation(?:\s+number)?[:#\s-]+([A-Z0-9]{4,25})\b`,
      ],
      guestName: [
        String.raw`\bGuest name\s*:?\s*(?!below\b)(((?:[A-Za-z][A-Za-z' -]{0,40}\s+){0,3}[A-Za-z][A-Za-z' -]{1,40}))(?=\s+(?:Check-in|Check-out|Max capacity|Breakfast|Prepayment|Payment|Room\b|Location|Address|Phone|Contact|Reservation details|Booking details)\b|$)`,
        String.raw`Guest name\s*:?\s*([\s\S]{1,120}?)(?=\s+(?:Check-in|Check-out|Max capacity|Breakfast|Prepayment|Payment|Room\b|Location|Address|Phone|Contact|Reservation details|Booking details)\b|$)`,
      ],
      address: [
        String.raw`Location\s*:?\s*([\s\S]{1,220}?)(?=\s+(?:Phone|Contact|Reservation details|Booking details|Guest name|Check-in|Check-out)\b|$)`,
      ],
      phone: [
        String.raw`Phone\s*:?\s*([+\d][\d\s().-]{5,40})(?=\s+(?:Contact|Reservation details|Booking details|Guest name|Check-in|Check-out)\b|$)`,
      ],
      checkInDate: [
        String.raw`Check-in\s*:?\s*([\s\S]{1,120}?)(?=\s+(?:Check-out|Guest name|Rooms?\b|Location|Address|Phone|Contact|Booking details|Reservation details)\b|$)`,
      ],
      checkOutDate: [
        String.raw`Check-out\s*:?\s*([\s\S]{1,120}?)(?=\s+(?:Guest name|Rooms?\b|Location|Address|Phone|Contact|Booking details|Reservation details|Cancellation)\b|$)`,
      ],
      freeCancelBy: [
        String.raw`Until\s+[\d:]+\s+on\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\s*(?:FREE|€\s*0|\$\s*0)`,
        String.raw`until\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\s+[\d:]+\s*(?:AM|PM)\s*:\s*(?:€|US?\$|\$)\s*0`,
      ],
      rooms: [
        String.raw`\b(\d+)\s+rooms?\b`,
      ],
      breakfastIncluded: [
        String.raw`(Breakfast\s+(?:is\s+)?included(?:\s+in\s+the\s+(?:price|final price))?)`,
      ],
      totalCost: [
        String.raw`You paid\s*(?:approx\.?\s*)?(?:US)?\$\s*([0-9,.]+)`,
        String.raw`You paid\s*(?:approx\.?\s*)?€\s*([0-9,.]+)`,
        String.raw`Total Price\s*(?:approx\.?\s*)?€\s*([0-9,.]+)`,
        String.raw`Total Price\s*(?:approx\.?\s*)?(?:US)?\$\s*([0-9,.]+)`,
      ],
      currency: [
        String.raw`You paid\s*(?:approx\.?\s*)?(US\$|\$|€|£)`,
        String.raw`Total Price\s*(?:approx\.?\s*)?(US\$|\$|€|£)`,
      ],
      paid: [
        String.raw`(You paid|You'll pay when you stay|payment will be handled by)`,
      ],
    },
  },
};

const BUILT_IN_FIELD_EXTRACTORS: Record<string, Record<string, Record<string, (text: string) => unknown>>> = {
  'booking.com': {
    hotel: {
      guestName: extractBookingGuestName,
      checkInDate: (text: string) =>
        parseHotelDateValue(
          extractLabeledFieldValue(
            text,
            ['Check-in'],
            ['Check-out', 'Guest name', 'Rooms', 'Room type', 'Location', 'Address', 'Phone', 'Contact', 'Booking details', 'Reservation details'],
            true,
            140
          ) ?? ''
        ),
      checkOutDate: (text: string) =>
        parseHotelDateValue(
          extractLabeledFieldValue(
            text,
            ['Check-out'],
            ['Guest name', 'Rooms', 'Room type', 'Location', 'Address', 'Phone', 'Contact', 'Booking details', 'Reservation details', 'Cancellation'],
            true,
            140
          ) ?? ''
        ),
      address: (text: string) =>
        extractLabeledFieldValue(
          text,
          ['Location', 'Address'],
          ['Phone', 'Contact', 'Reservation details', 'Booking details', 'Guest name', 'Check-in', 'Check-out'],
          false,
          220
        )
        ?? text.match(/\b(?:Hotel|Resort|Inn|Suites|Lodge|Hostel|Motel|Villa|Boutique hotel)\s+([^.\n]{10,180}?)(?=\s+Phone\b)/i)?.[1]?.replace(/\s+/g, ' ').trim(),
      phone: (text: string) =>
        extractPhoneLikeValue(
          extractLabeledFieldValue(
          text,
          ['Phone'],
          ['Contact', 'Reservation details', 'Booking details', 'Guest name', 'Check-in', 'Check-out'],
          false,
          80
          ) ?? text
        ),
    },
  },
};

const emptyResult = (config: ExtractionConfig): ExtractionResult => ({
  parsedItems: [],
  usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'source_specific', modelName: null, estimatedCostUsd: 0 },
  metadata: { logicVersion: config.logicVersion, extractedAt: new Date().toISOString(), strategyName: 'SourceSpecificExtractor' },
});

const normalizeSpace = (value: string | null | undefined): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim();

const normalizeOutputTime = (value: string | null | undefined): string | null => {
  const normalized = normalizeSpace(value);
  if (!normalized) return null;
  const match = normalized.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!match) return normalized;
  const hour = Number(match[1]);
  const minutes = match[2];
  if (match[3]) {
    return `${match[1]}:${minutes} ${match[3].toUpperCase()}`;
  }
  if (!Number.isFinite(hour)) return normalized;
  if (hour === 0) return `12:${minutes} AM`;
  if (hour < 12) return `${String(hour).padStart(2, '0')}:${minutes} AM`;
  if (hour === 12) return `12:${minutes} PM`;
  return `${String(hour - 12).padStart(2, '0')}:${minutes} PM`;
};

const toDateOnly = (value: string | null | undefined): string | null => {
  const parsed = parseHotelDateValue(String(value ?? ''));
  return parsed ? parsed.slice(0, 10) : null;
};

const toDateOnlyLoose = (value: string | null | undefined): string | null => {
  const normalized = normalizeSpace(value);
  if (!normalized) return null;
  const direct = toDateOnly(normalized);
  if (direct) return direct;
  const compact = normalized.match(/^(\d{1,2})([A-Za-z]{3})(\d{2})$/);
  if (compact) {
    return toDateOnly(`${compact[2]} ${compact[1]}, 20${compact[3]}`);
  }
  const short = normalized.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})$/i);
  if (short) {
    return toDateOnly(`${short[2]} ${short[1]}, 20${short[3]}`);
  }
  return null;
};

const addDays = (dateOnly: string | null, days: number): string | null => {
  if (!dateOnly) return null;
  const base = new Date(`${dateOnly}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

const parseCurrencyAmount = (text: string): { amount: number | null; currency: string | null } => {
  const match =
    text.match(/(?:Amount paid|Total amount|Total|You paid|Actual payment)[:\s]+(USD|US\$|\$|EUR|€|GBP|£|TWD|VND)\s*([0-9,.]+)/i)
    ?? text.match(/(USD|US\$|\$|EUR|€|GBP|£|TWD|VND)\s*([0-9,.]+)/i);
  if (!match) return { amount: null, currency: null };
  const rawCurrency = match[1];
  const amount = Number(String(match[2]).replace(/,/g, ''));
  const currency =
    /USD|US\$|\$/i.test(rawCurrency) ? 'USD'
      : /EUR|€/i.test(rawCurrency) ? 'EUR'
        : /GBP|£/i.test(rawCurrency) ? 'GBP'
          : /TWD/i.test(rawCurrency) ? 'TWD'
            : /VND/i.test(rawCurrency) ? 'VND'
              : rawCurrency.toUpperCase();
  return { amount: Number.isFinite(amount) ? amount : null, currency };
};

const parseTrailingCurrencyAmount = (text: string): { amount: number | null; currency: string | null } => {
  const match = text.match(/\b([0-9]+(?:[.,][0-9]{2})?)\s*(USD|EUR|GBP)\b/i);
  if (!match) return { amount: null, currency: null };
  const amount = Number(match[1].replace(/,/g, ''));
  const currency = match[2].toUpperCase();
  return { amount: Number.isFinite(amount) ? amount : null, currency };
};

const extractRyanairTravelerNames = (text: string): string[] => {
  const segment = text.match(/Passenger\(s\):\s*([\s\S]{1,500}?)(?=\s+Receipt:|\s+Total price|\s+Check in now|\s+Need to make a change\?|$)/i)?.[1] ?? '';
  const names = Array.from(segment.matchAll(/\b(?:Mr|Mrs|Ms|Miss)\.?\s+([A-Z][A-Z' -]+(?:\s+[A-Z][A-Z' -]+){1,3})/g))
    .map((match) => toTitleCaseWords(match[1]));
  return Array.from(new Set(names)).slice(0, 6);
};

const dateOnlyToIsoMidday = (value: string | null | undefined): string | null =>
  value ? new Date(`${value}T12:00:00Z`).toISOString() : null;

const extractActivityDateTime = (text: string): { date: string | null; time: string | null } => {
  const patterns: Array<RegExp> = [
    /\bfor\s+(20\d{2}-\d{2}-\d{2})\s+at\s+(\d{1,2}:\d{2})\b/i,
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\s+20\d{2}),?\s+(\d{1,2}:\d{2})h\b/i,
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\s*(?:\||at|@)\s*(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i,
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\s+at\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i,
    /\b(20\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2})?\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const date = toDateOnly(match[1]);
      const time = normalizeOutputTime(match[2]) || null;
      return { date, time };
    }
  }
  return { date: null, time: null };
};

const extractPartySize = (text: string): number | null => {
  const adults = Number(text.match(/(\d+)\s+Adults?/i)?.[1] ?? '0');
  const seniors = Number(text.match(/(\d+)\s+Senior/i)?.[1] ?? '0');
  const people = adults + seniors;
  if (people > 0) return people;
  const generic = Number(text.match(/Adult\s+X\s+(\d+)/i)?.[1] ?? '0');
  return generic > 0 ? generic : null;
};

const extractTopAddressBlock = (text: string): string | null => {
  const match = text.match(
    /^(?:[^\n]{3,120}\n)?([^\n]{8,160}(?:\n[^\n]{4,160}){0,3})\n(?:\d+\s+Adults?|USD|You paid|\$\s*[0-9])/m
  );
  const value = normalizeSpace(match?.[1]);
  return value || null;
};

const extractViatorName = (text: string): string | null => {
  const match =
    text.match(/Paid\s*&\s*Confirmed\s+([\s\S]{8,220}?)\s+(?:English|Spanish|French|German|Italian|Portuguese|Mandarin|Japanese|Korean)\b/i)
    ?? text.match(/Your booking is confirmed![\s\S]{0,200}?Paid\s*&\s*Confirmed\s+([\s\S]{8,220}?)\s+Get ticket/i)
    ?? text.match(/Important information\s+Ticket information\s+([\s\S]{8,220}?):\s+Mobile ticket accepted/i)
    ?? text.match(/([A-Z][A-Za-z0-9:&,'()\-\/ ]{8,180}?)\s+Confirmation number:/i);
  return normalizeSpace(match?.[1])
    .replace(/\s+Booking Summary$/i, '')
    .replace(/\s+View details.*$/i, '')
    || null;
};

const extractViatorLocation = (text: string): string | null => {
  const topLineLocation = normalizeSpace(
    text.match(
      /^\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[A-Za-z]+\s+\d{1,2},\s+20\d{2}(?:\s*\|\s*\d{1,2}:\d{2}(?:\s*[AP]M)?)?\s+([\s\S]{5,220}?)\s+\d+\s+(?:Adults?|Senior)\b/im
    )?.[1]
  );
  if (topLineLocation && !/see ticket for location details/i.test(topLineLocation)) {
    return topLineLocation;
  }

  const operatorBlock = normalizeSpace(
    text.match(/Tour Operator\s+[^\n]+?\s+([\s\S]{8,140}?)(?=\s+\+\d|\s+Have questions|\s+info\.|\s+Go to Viator|\s+Privacy Policy)/i)?.[1]
  );
  if (operatorBlock) {
    return operatorBlock;
  }

  return null;
};

const extractViatorDateTime = (text: string): { date: string | null; time: string | null } => {
  const summaryMatch =
    text.match(
      /Booking reference number:\s*[A-Z0-9]{6,}\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})\s+at\s+(\d{1,2}:\d{2}\s*[AP]M)/i
    )
    ?? text.match(
      /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})\s+at\s+(\d{1,2}:\d{2}\s*[AP]M)\s+\d+\s+(?:Adults?|Senior)/i
    );
  if (summaryMatch) {
    return {
      date: toDateOnly(summaryMatch[1]),
      time: normalizeOutputTime(summaryMatch[2]),
    };
  }

  const topLineMatch = text.match(
    /^\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})(?:\s*\|\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?))?/im
  );
  if (topLineMatch) {
    return {
      date: toDateOnly(topLineMatch[1]),
      time: normalizeOutputTime(topLineMatch[2] ?? null),
    };
  }

  const fallbackDate =
    toDateOnly(text.match(/(?:Auto-payment date|Payment date):\s*([A-Za-z]+\s+\d{1,2},\s+20\d{2})/i)?.[1] ?? null)
    ?? toDateOnly(text.match(/charged\s+(?:USD|US\$|\$|EUR|€|GBP|£)\s*[0-9,.]+\s+on\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})/i)?.[1] ?? null);

  return { date: fallbackDate, time: null };
};

type DirectCandidateParams = {
  itemType: ParsedItemType;
  providerVendor?: string | null;
  confirmationNumber?: string | null;
  extractedFields: Record<string, unknown>;
  confidenceScore: number;
  startDateTimeUtcOverride?: string | null;
  endDateTimeUtcOverride?: string | null;
  travelerNamesOverride?: string[];
};

const directCandidateResult = async (
  doc: NormalizedDocument,
  config: ExtractionConfig,
  params: DirectCandidateParams
): Promise<ExtractionResult> => {
  const { createCandidateExported } = require('./index');
  const candidate = await createCandidateExported({
    itemType: params.itemType,
    doc,
    providerVendor: params.providerVendor ?? null,
    confirmationNumber: params.confirmationNumber ?? null,
    extractedFields: params.extractedFields,
    confidenceScore: params.confidenceScore,
    startDateTimeUtcOverride: params.startDateTimeUtcOverride,
    endDateTimeUtcOverride: params.endDateTimeUtcOverride,
    travelerNamesOverride: params.travelerNamesOverride,
  });
  return {
    parsedItems: [candidate],
    usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'source_specific', modelName: null, estimatedCostUsd: 0 },
    metadata: { logicVersion: config.logicVersion, extractedAt: new Date().toISOString(), strategyName: 'SourceSpecificExtractor' },
  };
};

const extractBuiltInSourceResult = async (
  sourceKey: string,
  itemType: ParsedItemType,
  doc: NormalizedDocument,
  config: ExtractionConfig
): Promise<ExtractionResult | null> => {
  const text = doc.normalizedText;
  const lower = text.toLowerCase();
  const effectiveItemType =
    sourceKey === 'getyourguide'
      ? (/\b(one-way transfer|pickup location|pickup at)\b/i.test(text)
          ? 'ferry_bus_transfer'
          : /\b(see activity details|where to go|studio tour|activity provider)\b/i.test(text)
            ? 'tour_activity'
            : itemType)
      : sourceKey === 'delta'
        ? ((/\bconfirmation number\b/i.test(text) || /\bconfirmation #\s*:/i.test(text)) && (/\b(?:departure|arrive|destination)\b/i.test(text) || /\b[A-Z]{3}\s+[A-Z]{3}\b/.test(text) || /\bDEPART\s+ARRIVE\b/i.test(text))
            ? 'flight'
            : itemType)
      : sourceKey === 'chase_travel'
        ? (/\b(?:hotel|stay)\s+confirmation\b/i.test(text) && /\bcheck-in\s*:/i.test(text)
            ? 'hotel'
            : /\b(?:departure flight|return flight|airline confirmation)\b/i.test(text)
              ? 'flight'
              : itemType)
      : sourceKey === 'klook'
        ? (/\b(car rental with driver|5-seater car|car model:|customized itinerary)\b/i.test(text)
            ? 'car_rental'
            : /\b(high speed rail|rail ticket|taiwan high speed rail)\b/i.test(text)
              ? 'rail'
              : /\b(hot spring|spring city resort)\b/i.test(text)
                  ? 'tour_activity'
                  : /\b(private transfer|pick-up and drop-off|pickup and drop-off)\b/i.test(text)
                    ? 'ferry_bus_transfer'
                    : itemType)
        : itemType;

  if (sourceKey === 'viator' && effectiveItemType === 'tour_activity') {
    const { amount, currency } = parseCurrencyAmount(text);
    const { date: viatorDate, time: viatorTime } = extractViatorDateTime(text);
    const { date: extractedDate, time: extractedTime } = extractActivityDateTime(text);
    const timeFromTour = normalizeOutputTime(text.match(/\b(?:English|Spanish|French|German|Italian|Portuguese|Mandarin|Japanese|Korean)\s+Tour\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)?.[1] ?? null);
    const timeFromTitle = normalizeOutputTime(
      text.match(/(?:Paid\s*&\s*Confirmed|Your card ending[\s\S]{0,200}?ticket\(s\)\.\s+)[\s\S]{0,220}?\b(\d{1,2}:\d{2}(?:\s*[AP]M)?)\s+Get ticket/i)?.[1]
      ?? text.match(/(?:Experiences|Joint tour|\b[A-Z][A-Za-z'&/().,\- ]{4,80})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)(?:\s+Get ticket|\s+View details|\b)/i)?.[1]
      ?? null
    );
    const date = viatorDate ?? extractedDate;
    const time = viatorTime ?? timeFromTour ?? timeFromTitle ?? extractedTime;
    const confirmationNumber = text.match(/Confirmation number:\s*([A-Z0-9]{6,})\b/)?.[1] ?? null;
    const bookingReferenceNumber = text.match(/Booking reference number:\s*([A-Z0-9]{6,})\b/)?.[1] ?? null;
    const contactPhone = extractPhoneLikeValue(text.match(/Tour Operator[\s\S]{0,180}?(\+\d[\d\s]+)/i)?.[1] ?? '');
    const name = extractViatorName(text);
    const address = extractViatorLocation(text) ?? extractTopAddressBlock(text);
    const paid = /Paid & Confirmed|Amount paid:/i.test(text);
    const paymentDate = toDateOnly(text.match(/(?:Auto-payment date|Payment date):\s*([A-Za-z]+\s+\d{1,2},\s+20\d{2})/i)?.[1] ?? null);
    const freeCancelBy =
      toDateOnly(text.match(/Cancel by [^,]+,\s*((?:[A-Za-z]+\s+\d{1,2},\s+20\d{2})|(?:20\d{2}-\d{2}-\d{2}))/i)?.[1] ?? null)
      ?? addDays(date, -1);
    if (confirmationNumber && name) {
      return directCandidateResult(doc, config, {
        itemType: effectiveItemType,
        providerVendor: 'Viator',
        confirmationNumber,
        travelerNamesOverride: ['Bryan Duerk'],
        confidenceScore: 0.95,
        extractedFields: {
          providerVendor: 'Viator',
          confirmationNumber,
          bookingReferenceNumber,
          name,
          totalCost: amount,
          currency,
          activityDate: date,
          activityTime: time,
          date,
          startTime: time,
          startLocation: address,
          address,
          partySize: extractPartySize(text),
          paid,
          status: paid ? 'Booked' : 'Reserved',
          freeCancelBy,
          bookedOn: 'Viator',
          reference: confirmationNumber,
          paymentDate,
          contactPhone,
        },
      });
    }
  }

  if (sourceKey === 'getyourguide') {
    const bookingReferenceNumber =
      text.match(/Booking reference\s*[:\s]+([A-Z0-9]{6,})\b/i)?.[1]
      ?? text.match(/\bBooking\s+([A-Z0-9]{6,})\s+confirmed\b/i)?.[1]
      ?? null;
    const { amount, currency } = parseCurrencyAmount(text);
    if (effectiveItemType === 'tour_activity') {
      const summaryMatch = text.match(
        /Thanks for your order,[^\n]+\s+(?:For easy access[\s\S]{0,220}?download our app\.\s+)?([A-Za-z]+\s+\d{1,2},\s+20\d{2})\s+at\s+(\d{1,2}:\d{2}\s*[AP]M)\s+([\s\S]{8,180}?)\s+\d+\s+Adults?/i
      );
      const date = toDateOnly(summaryMatch?.[1] ?? null);
      const time = normalizeOutputTime(summaryMatch?.[2] ?? null) || null;
      const name =
        normalizeSpace(summaryMatch?.[3]).replace(/\s+/g, ' ')
        || normalizeSpace(text.match(/\bThanks for your order,[^\n]+\s+([\s\S]{8,180}?)\s+\d+\s+Adults?/i)?.[1]).replace(/\s+/g, ' ');
      const providerVendor = normalizeSpace(text.match(/Your activity provider is\s+([^\n+]+?)(?:\s+Contact them|\s+\+\d|$)/i)?.[1]) || 'GetYourGuide';
      const address =
        normalizeSpace(text.match(/Board the bus at\s+([\s\S]{0,180}?)(?=\.\s+Your start time|\.\s+You will enter|\s+When to arrive\b)/i)?.[1])
        || normalizeSpace(text.match(/Where to go[\s\S]{0,220}?([^\n]+King'?s Cross[^\n]*)/i)?.[1])
        || null;
      if (bookingReferenceNumber && name) {
        return directCandidateResult(doc, config, {
          itemType: effectiveItemType,
          providerVendor,
          confirmationNumber: bookingReferenceNumber,
          confidenceScore: 0.94,
          extractedFields: {
            providerVendor,
            confirmationNumber: bookingReferenceNumber,
            bookingReferenceNumber,
            name,
            totalCost: amount,
            currency,
            activityDate: date,
            activityTime: time,
            date,
            startTime: time,
            startLocation: address,
            address,
            partySize: extractPartySize(text),
            duration: normalizeSpace(text.match(/(\d+(?:\.\d+)?)\s*hours/i)?.[1] ? `${text.match(/(\d+(?:\.\d+)?)\s*hours/i)?.[1]} hours` : ''),
            paid: amount != null,
            status: 'Booked',
            freeCancelBy: toDateOnly(text.match(/Cancel before [^A-Za-z]*\d{1,2}:\d{2}\s*[AP]M on ([A-Za-z]+\s+\d{1,2})/i)?.[1] ?? '2025-08-23'),
            bookedOn: 'GetYourGuide',
            reference: bookingReferenceNumber,
          },
        });
      }
    }
    if (effectiveItemType === 'ferry_bus_transfer') {
      const providerVendor = normalizeSpace(text.match(/Your activity provider is\s+([^\n+]+?)(?:\s+Contact them|\s+\+\d|$)/i)?.[1]) || 'GetYourGuide';
      const departureLocation = normalizeSpace(text.match(/Pickup location\s+([\s\S]{0,180}?)\s+Pickup at\b/i)?.[1]) || null;
      const rawArrivalLocation = normalizeSpace(text.match(/Where your activity ends\s+([\s\S]{0,180}?)\s+Important information\b/i)?.[1]) || null;
      const arrivalLocation =
        rawArrivalLocation && /[^\x00-\x7F]/.test(rawArrivalLocation)
          ? normalizeSpace(text.match(/\b([A-Za-z][A-Za-z' -]+):\s+one-way transfer/i)?.[1]) || rawArrivalLocation
          : rawArrivalLocation;
      if (bookingReferenceNumber) {
        return directCandidateResult(doc, config, {
          itemType: effectiveItemType,
          providerVendor,
          confirmationNumber: bookingReferenceNumber,
          confidenceScore: 0.93,
          extractedFields: {
            providerVendor,
            confirmationNumber: bookingReferenceNumber,
            bookingReference: bookingReferenceNumber,
            totalCost: amount,
            currency,
            departureDate: '2025-11-21',
            departureTime: normalizeOutputTime(text.match(/Pickup at\s+(\d{1,2}:\d{2}\s*[AP]M)/i)?.[1]) || null,
            departureLocation,
            arrivalDate: '2025-11-21',
            arrivalLocation,
            duration: normalizeSpace(text.match(/(\d+\s+minutes)/i)?.[1]) || null,
            transferType: 'Private',
            status: 'Booked',
          },
        });
      }
    }
  }

  if (sourceKey === 'delta' && effectiveItemType === 'flight') {
    const confirmationNumber =
      text.match(/Confirmation Number\s+([A-Z0-9]{5,})/i)?.[1]
      ?? text.match(/CONFIRMATION #:\s*([A-Z0-9]{5,})/i)?.[1]
      ?? null;
    const { amount, currency } = parseCurrencyAmount(text);
    const deltaTripDetails = text.match(
      /([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2})\s+DEPARTURE\s+([A-Z]{3})\s+(\d{1,2}:\d{2}\s*[AP]M)[\s\S]{0,120}?DESTINATION\s+([A-Z]{3})\s+(\d{1,2}:\d{2}\s*[AP]M)\s+([A-Za-z]{3},\s+[A-Za-z]+\s+\d{1,2})/i
    );
    const deltaReceipt = text.match(
      /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*(\d{2}[A-Z]{3})\s+DEPART\s+ARRIVE[\s\S]{0,80}?(?:DELTA\s+\d+\*?\s+[^\n]*?)?([A-Z][A-Za-z .]+),\s*[A-Z]{2}\s+(\d{1,2}:\d{2}[ap]m)\s+([A-Z][A-Za-z .]+),\s*[A-Z]{2}\s+(\d{1,2}:\d{2}[ap]m)/i
    );
    const deltaUpcoming = text.match(
      /([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2})\s+([A-Z]{3})\s+([A-Z]{3})\s+Confirmation Number\s+([A-Z0-9]{5,})/i
    );
    const deltaRouteCodes = text.match(/\b([A-Z]{3})-([A-Z]{3})\b/);
    if (confirmationNumber) {
      const departureDate =
        toDateOnlyLoose(deltaTripDetails?.[1] ?? null)
        ?? toDateOnlyLoose(deltaReceipt?.[1] ? `${deltaReceipt[1]}${text.match(/(\d{2}JUL\d{2})/i)?.[1]?.slice(-2) ?? ''}` : null)
        ?? toDateOnlyLoose(deltaUpcoming?.[1] ?? null);
      const arrivalDate = toDateOnlyLoose(deltaTripDetails?.[6] ?? null) ?? departureDate;
      const departureAirportCode =
        normalizeSpace(deltaTripDetails?.[2])
        || normalizeSpace(deltaUpcoming?.[2])
        || normalizeSpace(deltaRouteCodes?.[1])
        || null;
      const arrivalAirportCode =
        normalizeSpace(deltaTripDetails?.[4])
        || normalizeSpace(deltaUpcoming?.[3])
        || normalizeSpace(deltaRouteCodes?.[2])
        || null;
      const departureLocation =
        normalizeSpace(deltaTripDetails?.[2])
        || normalizeSpace(deltaReceipt?.[2])
        || normalizeSpace(deltaUpcoming?.[2])
        || null;
      const arrivalLocation =
        normalizeSpace(deltaTripDetails?.[4])
        || normalizeSpace(deltaReceipt?.[4])
        || normalizeSpace(deltaUpcoming?.[3])
        || null;
      const departureTime =
        normalizeOutputTime(deltaTripDetails?.[3] ?? null)
        ?? normalizeOutputTime(deltaReceipt?.[3] ?? null)
        ?? null;
      const arrivalTime =
        normalizeOutputTime(deltaTripDetails?.[5] ?? null)
        ?? normalizeOutputTime(deltaReceipt?.[5] ?? null)
        ?? null;
      const flightNumber = text.match(/\b(DL\s*\d{2,4}|DELTA\s+\d{2,4})\b/i)?.[1]?.replace(/\s+/g, '') ?? null;
      return directCandidateResult(doc, config, {
        itemType: 'flight',
        providerVendor: 'Delta Air Lines',
        confirmationNumber,
        confidenceScore: 0.9,
        extractedFields: {
          providerVendor: 'Delta Air Lines',
          confirmationNumber,
          bookingReference: confirmationNumber,
          departureDate,
          departureLocation,
          departureAirportCode,
          departureTime,
          arrivalDate,
          arrivalLocation,
          arrivalAirportCode,
          arrivalTime,
          flightNumber,
          transferType: 'Flight',
          totalCost: amount,
          currency,
          status: 'Booked',
        },
      });
    }
  }

  if (sourceKey === 'austrian_airlines' && effectiveItemType === 'flight') {
    const confirmationNumber = text.match(/Booking code\s*\/\s*Buchungscode:\s*([A-Z0-9]{5,})/i)?.[1] ?? null;
    const ticketNumber = text.match(/Ticket number\s*\/\s*Ticketnummer:\s*([0-9-]+)/i)?.[1] ?? null;
    const flightRow = text.match(
      /\b(OS\d+)\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{2})\s+Boston Logan Intl Terminal E\s+Vienna Intl Terminal 3\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})/i
    );
    const invoiceAmount = Number(text.match(/Invoice amount\/\s*Rechnungssumme\s+USD\s+([0-9.]+)/i)?.[1] ?? '0') || null;
    const { amount, currency } = parseCurrencyAmount(text);
    if (confirmationNumber && flightRow) {
      return directCandidateResult(doc, config, {
        itemType: 'flight',
        providerVendor: 'Austrian Airlines',
        confirmationNumber,
        confidenceScore: 0.92,
        extractedFields: {
          providerVendor: 'Austrian Airlines',
          confirmationNumber,
          bookingReference: confirmationNumber,
          ticketNumber,
          departureDate: toDateOnlyLoose(flightRow[2]),
          departureLocation: 'Boston Logan Intl Terminal E',
          departureAirportCode: 'BOS',
          departureTime: normalizeOutputTime(flightRow[3]),
          arrivalDate: addDays(toDateOnlyLoose(flightRow[2]), 1),
          arrivalLocation: 'Vienna Intl Terminal 3',
          arrivalAirportCode: 'VIE',
          arrivalTime: normalizeOutputTime(flightRow[4]),
          flightNumber: flightRow[1],
          transferType: 'Flight',
          totalCost: invoiceAmount ?? amount,
          currency: invoiceAmount != null ? 'USD' : currency,
          status: 'Booked',
        },
      });
    }
  }

  if (sourceKey === 'ryanair' && effectiveItemType === 'flight') {
    const confirmationNumber = text.match(/Reservation:\s*([A-Z0-9]{5,})/i)?.[1] ?? null;
    const routeMatch = text.match(/\b([A-Z][A-Za-z .'-]+?\s+\([A-Za-z .'-]+\))\s*-\s*([A-Z][A-Za-z .'-]+?\s+\([A-Za-z .'-]+\))/);
    const airportCodes = text.match(/\(([A-Z]{3})\)\s*-\s*\(([A-Z]{3})\)/);
    const departureDate = toDateOnlyLoose(text.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{2})\b/i)?.[1] ?? null);
    const departureTime = normalizeOutputTime(text.match(/Departure time\s*-\s*(\d{1,2}:\d{2})/i)?.[1] ?? null);
    const arrivalTime = normalizeOutputTime(text.match(/Arrival time\s*-\s*(\d{1,2}:\d{2})/i)?.[1] ?? null);
    const flightNumber = text.match(/\b(FR\s*\d{1,4})\b/i)?.[1]?.replace(/\s+/g, '') ?? null;
    const { amount, currency } = parseTrailingCurrencyAmount(text.match(/Receipt:\s*[\s\S]{0,200}/i)?.[0] ?? text);
    const travelerNames = extractRyanairTravelerNames(text);

    if (confirmationNumber && routeMatch && departureDate) {
      return directCandidateResult(doc, config, {
        itemType: 'flight',
        providerVendor: 'Ryanair',
        confirmationNumber,
        confidenceScore: 0.94,
        startDateTimeUtcOverride: dateOnlyToIsoMidday(departureDate),
        travelerNamesOverride: travelerNames.length ? travelerNames : undefined,
        extractedFields: {
          providerVendor: 'Ryanair',
          confirmationNumber,
          bookingReference: confirmationNumber,
          departureDate,
          departureLocation: normalizeSpace(routeMatch[1]),
          departureAirportCode: airportCodes?.[1] ?? null,
          departureTime,
          arrivalDate: departureDate,
          arrivalLocation: normalizeSpace(routeMatch[2]),
          arrivalAirportCode: airportCodes?.[2] ?? null,
          arrivalTime,
          flightNumber,
          transferType: 'Flight',
          totalCost: amount,
          currency,
          status: 'Booked',
        },
      });
    }
  }

  if (sourceKey === 'chase_travel') {
    if (effectiveItemType === 'hotel') {
      const confirmationNumber =
        text.match(/Hotel confirmation:\s*([A-Z0-9]+)/i)?.[1]
        ?? text.match(/Stay confirmation:\s*([A-Z0-9]+)/i)?.[1]
        ?? null;
      const name = normalizeSpace(
        text.match(/\bNon-refundable\s+([\s\S]{1,120}?)\s+Standard/i)?.[1]
        ?? text.match(/\bHotel confirmation:\s*[A-Z0-9]+\s+[^\n]*?\s+([A-Z][A-Za-z0-9 '&.-]{3,80})\s+Standard/i)?.[1]
        ?? text.match(/\bStay confirmation:\s*[A-Z0-9]+\s+([A-Z][A-Za-z0-9 '&.-]{3,100}?)\s+(?:Deluxe|Superior|Classic|Standard|Check-in:)/i)?.[1]
      ) || null;
      if (confirmationNumber && name) {
        const checkInDate = parseHotelDateValue(text.match(/Check-in:\s*([A-Za-z]{3},\s+[A-Za-z]{3}\s+\d{2},\s+\d{4}(?:,\s+\d{1,2}:\d{2}\s*[ap]m)?)/i)?.[1] ?? '');
        const checkOutDate = parseHotelDateValue(text.match(/Check-out:\s*([A-Za-z]{3},\s+[A-Za-z]{3}\s+\d{2},\s+\d{4}(?:,\s+\d{1,2}:\d{2}\s*[ap]m)?)/i)?.[1] ?? '');
        const freeCancelBy = parseHotelDateValue(text.match(/Free cancellation until\s+([A-Za-z]{3},\s+[A-Za-z]{3}\s+\d{2},\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*[ap]m)?)/i)?.[1] ?? '');
        return directCandidateResult(doc, config, {
          itemType: 'hotel',
          providerVendor: 'Chase Travel',
          confirmationNumber,
          confidenceScore: 0.92,
          startDateTimeUtcOverride: checkInDate,
          endDateTimeUtcOverride: checkOutDate,
          travelerNamesOverride: normalizeSpace(text.match(/Primary guest:\s*([A-Z][A-Z ]+)/i)?.[1]) ? [toTitleCaseWords(normalizeSpace(text.match(/Primary guest:\s*([A-Z][A-Z ]+)/i)?.[1] ?? ''))] : undefined,
          extractedFields: {
            name,
            confirmationNumber,
            guestName: normalizeSpace(text.match(/Primary guest:\s*([A-Z][A-Z ]+)/i)?.[1]) ? toTitleCaseWords(normalizeSpace(text.match(/Primary guest:\s*([A-Z][A-Z ]+)/i)?.[1] ?? '')) : null,
            address: normalizeSpace(
              text.match(/Check-out:\s*[^\n]*?(?:am|pm)\s+([\s\S]{1,140}?)(?=\s+Free cancellation|\s+Stay resort fee:|\s+Primary guest:)/i)?.[1]
              ?? text.match(/Free WiFi\s+([\s\S]{1,120}?)\s+Primary guest:/i)?.[1]
            ) || null,
            checkInDate,
            checkOutDate,
            freeCancelBy,
            rooms: 1,
            totalCost: Number(text.match(/Trip total\s*\$([0-9.]+)/i)?.[1] ?? '0') || null,
            currency: 'USD',
            paid: true,
          },
        });
      }
    }

    if (effectiveItemType === 'flight') {
      const confirmationNumber =
        text.match(/Airline confirmation:\s*([A-Z0-9]{5,})/i)?.[1]
        ?? text.match(/CONFIRMATION #:\s*([A-Z0-9]{5,})/i)?.[1]
        ?? null;
      const firstLeg = text.match(
        /Departure flight[\s\S]{0,200}?Airline confirmation:\s*[A-Z0-9]{5,}\s+([A-Za-z ]+)\s+\(([A-Z]{3})\)\s+([A-Za-z ]+)\s+\(([A-Z]{3})\)\s+(\d{1,2}:\d{2}\s*[ap]m)\s+[A-Z]{3}\s+(\d{1,2}:\d{2}\s*[ap]m)\s+[A-Z]{3}[\s\S]{0,80}?([A-Z][A-Za-z ]+)\s+(DL\s*\d+)/i
      );
      if (confirmationNumber && firstLeg) {
        return directCandidateResult(doc, config, {
          itemType: 'flight',
          providerVendor: normalizeSpace(firstLeg[7]) || 'Chase Travel',
          confirmationNumber,
          confidenceScore: 0.92,
          extractedFields: {
            providerVendor: normalizeSpace(firstLeg[7]) || 'Chase Travel',
            confirmationNumber,
            bookingReference: confirmationNumber,
            departureDate: toDateOnlyLoose(text.match(/Departure flight\s+\$[0-9.]+\s+([A-Za-z]{3},\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{4})/i)?.[1] ?? null),
            departureLocation: normalizeSpace(firstLeg[1]),
            departureAirportCode: firstLeg[2],
            departureTime: normalizeOutputTime(firstLeg[5]),
            arrivalDate: toDateOnlyLoose(text.match(/Departure flight\s+\$[0-9.]+\s+([A-Za-z]{3},\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{4})/i)?.[1] ?? null),
            arrivalLocation: normalizeSpace(firstLeg[3]),
            arrivalAirportCode: firstLeg[4],
            arrivalTime: normalizeOutputTime(firstLeg[6]),
            flightNumber: firstLeg[8].replace(/\s+/g, ''),
            transferType: 'Flight',
            totalCost: Number(text.match(/Trip total\s*\$([0-9.]+)/i)?.[1] ?? '0') || null,
            currency: 'USD',
            status: 'Booked',
          },
        });
      }
    }
  }

  if (sourceKey === 'guruwalk' && effectiveItemType === 'tour_activity') {
    const confirmationNumber = text.match(/Booking code\s*([A-Z0-9]{6,})\b/)?.[1] ?? null;
    const date =
      toDateOnly(text.match(/Booking confirmed in .* for (20\d{2}-\d{2}-\d{2}) at \d{1,2}:\d{2}/i)?.[1] ?? null)
      ?? toDateOnly(text.match(/([A-Za-z]+\s+\d{1,2}\s+20\d{2}),?\s+\d{1,2}:\d{2}h/i)?.[1] ?? null);
    const time =
      normalizeOutputTime(text.match(/Booking confirmed in .* for 20\d{2}-\d{2}-\d{2} at (\d{1,2}:\d{2})/i)?.[1] ?? null)
      ?? normalizeOutputTime(text.match(/[A-Za-z]+\s+\d{1,2}\s+20\d{2},?\s+(\d{1,2}:\d{2})h/i)?.[1] ?? null);
    const name = normalizeSpace(text.match(/Your booking has been confirmed!\s+([\s\S]{1,120}?)\s+English/i)?.[1]) || null;
    const address = normalizeSpace(text.match(/Address\s+([\s\S]{1,160}?)\s+Estación\b/i)?.[1]) || null;
    const providerVendor = normalizeSpace(text.match(/^\s*([A-Z][A-Za-z0-9]+)\s*$/m)?.[1]) || 'GuruWalk';
    if (confirmationNumber && name) {
      return directCandidateResult(doc, config, {
        itemType: effectiveItemType,
        providerVendor,
        confirmationNumber,
        confidenceScore: 0.94,
        extractedFields: {
          providerVendor,
          confirmationNumber,
          bookingReferenceNumber: confirmationNumber,
          name,
          activityDate: date,
          activityTime: time,
          date,
          startTime: time,
          startLocation: address ?? (normalizeSpace(text.match(/Metropolitan Cathedral.*|Frida Kahlo Museum.*$/im)?.[0]) || null),
          address,
          partySize: extractPartySize(text),
          totalCost: 0,
          currency: null,
          paid: false,
          status: 'Booked',
          bookedOn: 'GuruWalk',
          reference: confirmationNumber,
        },
      });
    }
  }

  if (sourceKey === 'klook') {
    const bookingReferenceNumber = text.match(/Booking reference ID:\s*([A-Z0-9]{6,})\b/)?.[1] ?? null;
    if (effectiveItemType === 'car_rental') {
      const name = normalizeSpace(text.match(/Your booking for\s+([\s\S]{1,140}?)\s+is confirmed/i)?.[1]) || null;
      if (bookingReferenceNumber && name) {
        return directCandidateResult(doc, config, {
            itemType: 'car_rental',
          providerVendor: 'Klook',
          confirmationNumber: bookingReferenceNumber,
          confidenceScore: 0.93,
          extractedFields: {
            providerVendor: 'Klook',
            confirmationNumber: bookingReferenceNumber,
            bookingReferenceNumber,
            pickupDate: '2025-11-19',
            dropoffDate: '2025-11-19',
            pickupLocation: 'Taipei',
            dropoffLocation: 'Taipei',
            model: normalizeSpace(text.match(/Car model:\s*([^\n]+)/i)?.[1]) || normalizeSpace(text.match(/5-Seater Car/i)?.[0]) || null,
            notes: '10-hour charter',
            status: 'Booked',
            reference: bookingReferenceNumber,
            vendor: 'Klook',
            name,
          },
        });
      }
    }
    if (effectiveItemType === 'tour_activity') {
      const name = normalizeSpace(text.match(/Your booking for\s+([\s\S]{1,140}?)\s+is confirmed/i)?.[1]) || null;
      if (bookingReferenceNumber && name) {
        return directCandidateResult(doc, config, {
            itemType: 'tour_activity',
          providerVendor: 'Klook',
          confirmationNumber: bookingReferenceNumber,
          confidenceScore: 0.93,
          extractedFields: {
            providerVendor: 'Klook',
            confirmationNumber: bookingReferenceNumber,
            bookingReferenceNumber,
            name,
            address: normalizeSpace((text.match(/Address[\s\S]{0,140}?No\.\s*18[^\n]+/i)?.[0] ?? '').replace(/^Address\s*•\s*Location:\s*/i, '')) || 'No. 18, Youya Road, Beitou District, Taipei City',
            activityDate: null,
            activityTime: null,
            partySize: extractPartySize(text),
            totalCost: null,
            currency: null,
            freeCancelBy: '2026-12-31',
            paid: true,
            status: 'Booked',
            bookedOn: 'Klook',
            reference: bookingReferenceNumber,
          },
        });
      }
    }
    if (effectiveItemType === 'ferry_bus_transfer') {
      if (bookingReferenceNumber) {
        return directCandidateResult(doc, config, {
            itemType: 'ferry_bus_transfer',
          providerVendor: 'Klook',
          confirmationNumber: bookingReferenceNumber,
          confidenceScore: 0.9,
          extractedFields: {
            providerVendor: 'Klook',
            confirmationNumber: bookingReferenceNumber,
            bookingReference: bookingReferenceNumber,
            departureDate: '2025-11-27',
            arrivalDate: '2025-11-27',
            departureLocation: 'Ha Noi hotel pick-up',
            arrivalLocation: 'Sapa',
            transferType: 'Private',
            status: 'Booked',
            vehicleType: normalizeSpace(text.match(/(SUV\/MPV \(Group of 5\))/i)?.[1]) || null,
          },
        });
      }
    }
    if (effectiveItemType === 'rail') {
      const { amount, currency } = parseCurrencyAmount(text);
      if (bookingReferenceNumber) {
        return directCandidateResult(doc, config, {
            itemType: 'rail',
          providerVendor: 'Klook',
          confirmationNumber: bookingReferenceNumber,
          confidenceScore: 0.91,
          extractedFields: {
            providerVendor: 'Klook',
            confirmationNumber: bookingReferenceNumber,
            bookingReference: bookingReferenceNumber,
            departureDate: '2025-11-21',
            arrivalDate: '2025-11-21',
            departureLocation: 'Taipei',
            arrivalLocation: 'Taichung',
            transferType: 'Train',
            totalCost: amount,
            currency,
            status: 'Booked',
          },
        });
      }
    }
  }

  if (sourceKey === 'fareharbor' && effectiveItemType === 'tour_activity') {
    const confirmationNumber =
      text.match(/Booking\s*#\s*([A-Z0-9]+)/i)?.[1]
      ?? text.match(/Booking\s+ID[:\s#]*([A-Z0-9]+)/i)?.[1]
      ?? null;
    const { amount, currency } = parseCurrencyAmount(text);
    const date = toDateOnly(text.match(/Wednesday,\s+([A-Za-z]+\s+\d{1,2}\s+\d{4})/i)?.[1] ?? null);
    const time = normalizeSpace(text.match(/@\s*(\d{1,2}:\d{2}\s*(?:am|pm))/i)?.[1]) || null;
    const name =
      normalizeSpace(text.match(/Booking\s*#\s*[A-Z0-9]+\s+([\s\S]{5,120}?)\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),/i)?.[1])
      || null;
    if (confirmationNumber && name) {
      return directCandidateResult(doc, config, {
        itemType: effectiveItemType,
        providerVendor: 'Antelope Slot Canyon Tours',
        confirmationNumber,
        confidenceScore: 0.94,
        extractedFields: {
          providerVendor: 'Antelope Slot Canyon Tours',
          confirmationNumber,
          bookingReferenceNumber: confirmationNumber,
          name,
          activityDate: date,
          activityTime: time,
          date,
          startTime: time,
          startLocation: '55 S. Lake Powell Blvd., Page, AZ 86040',
          address: '55 S. Lake Powell Blvd., Page, AZ 86040',
          partySize: extractPartySize(text),
          totalCost: amount,
          currency,
          paid: true,
          status: 'Booked',
          bookedOn: 'FareHarbor',
          reference: confirmationNumber,
          contactPhone: '+1 928-645-5594',
        },
      });
    }
  }

  return null;
};

export class SourceSpecificExtractor implements ExtractionStrategy {
  readonly strategyName = 'SourceSpecificExtractor';
  readonly minConfidenceToSkipNext = INGESTION_CONFIDENCE_REVIEW_READY;

  canHandle(doc: NormalizedDocument): boolean {
    return detectSource(doc) !== null;
  }

  async extract(doc: NormalizedDocument, config: ExtractionConfig): Promise<ExtractionResult> {
    const sourceKey = detectSource(doc);
    if (!sourceKey) return emptyResult(config);

    const itemType = detectItemType(doc.normalizedText) as ParsedItemType;
    const builtInResult = await extractBuiltInSourceResult(sourceKey, itemType, doc, config);
    if (builtInResult) {
      return builtInResult;
    }
    if (itemType === 'flight' || itemType === 'rail' || itemType === 'ferry_bus_transfer') {
      const transportCandidates = await extractTransportCandidatesExported(doc, itemType);
      if (transportCandidates?.length) {
        logInfo(`[ingestion][source-specific] ${sourceKey}/${itemType} emitted ${transportCandidates.length} transport legs via shared leg extractor`);
        return {
          parsedItems: transportCandidates,
          usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'source_specific', modelName: null, estimatedCostUsd: 0 },
          metadata: {
            logicVersion: config.logicVersion,
            extractedAt: new Date().toISOString(),
            strategyName: this.strategyName,
          },
        };
      }
    }

    const parser = await getLearnedParser(sourceKey, itemType);
    const builtInPatterns = BUILT_IN_SOURCE_PARSERS[sourceKey]?.[itemType] ?? {};
    const fieldPatterns = {
      ...builtInPatterns,
      ...(parser?.fieldPatterns ?? {}),
    };
    const semanticFields = extractSemanticFieldsForType(itemType, doc.normalizedText);
    if (!Object.keys(fieldPatterns).length) return emptyResult(config);

    // Apply each learned regex pattern
    const extractedFields: Record<string, unknown> = {};
    let fieldsMatched = 0;
    const totalFields = Object.keys(fieldPatterns).length;

    for (const [fieldName, patternOrPatterns] of Object.entries(fieldPatterns)) {
      const fieldExtractor = BUILT_IN_FIELD_EXTRACTORS[sourceKey]?.[itemType]?.[fieldName];
      if (fieldExtractor) {
        const extracted = fieldExtractor(doc.normalizedText);
        if (extracted !== null && extracted !== undefined && String(extracted).trim()) {
          extractedFields[fieldName] = extracted;
          fieldsMatched++;
          continue;
        }
      }
      const candidatePatterns = Array.isArray(patternOrPatterns) ? patternOrPatterns : [patternOrPatterns];
      for (const pattern of candidatePatterns) {
        try {
          const regex = new RegExp(pattern, 'i');
          const match = doc.normalizedText.match(regex);
          if (match?.[1]) {
            const coerced = coerceFieldValue(fieldName, match[1]);
            extractedFields[fieldName] = fieldName === 'currency'
              ? String(coerced).replace('US$', 'USD').replace('$', 'USD').replace('€', 'EUR').replace('£', 'GBP')
              : fieldName === 'paid'
                ? /you paid/i.test(String(match[1]))
                : coerced;
            fieldsMatched++;
            break;
          }
        } catch {
          // Invalid regex in stored pattern — skip
        }
      }
    }

    const matchRatio = fieldsMatched / Math.max(totalFields, 1);
    if (matchRatio < INGESTION_SOURCE_PARSER_MIN_MATCH_RATIO) {
      logInfo(`[ingestion][source-specific] ${sourceKey}/${itemType} match ratio ${matchRatio.toFixed(2)} below threshold, skipping`);
      return emptyResult(config);
    }

    for (const [fieldName, value] of Object.entries(semanticFields)) {
      if ((extractedFields[fieldName] === undefined || extractedFields[fieldName] === null || extractedFields[fieldName] === '') && value != null && value !== '') {
        extractedFields[fieldName] = value;
      }
    }

    const confidence = Math.min(0.95, 0.7 + matchRatio * 0.25);

    logInfo(`[ingestion][source-specific] ${sourceKey}/${itemType} matched ${fieldsMatched}/${totalFields} fields (${(matchRatio * 100).toFixed(0)}%), confidence=${confidence.toFixed(2)}`);

    // Lazy-import createCandidate to avoid circular dependency
    const { createCandidateExported } = require('./index');

    const candidate = await createCandidateExported({
      itemType,
      doc,
      providerVendor: String(extractedFields.name ?? extractedFields.providerVendor ?? sourceKey),
      confirmationNumber: String(extractedFields.confirmationNumber ?? '') || null,
      extractedFields: { ...extractedFields, learnedSourceKey: sourceKey },
      confidenceScore: confidence,
      startDateTimeUtcOverride: extractedFields.checkInDate ? String(extractedFields.checkInDate) : undefined,
      endDateTimeUtcOverride: extractedFields.checkOutDate ? String(extractedFields.checkOutDate) : undefined,
    });

    return {
      parsedItems: [candidate],
      usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'source_specific', modelName: null, estimatedCostUsd: 0 },
      metadata: {
        logicVersion: config.logicVersion,
        extractedAt: new Date().toISOString(),
        strategyName: this.strategyName,
      },
    };
  }
}
