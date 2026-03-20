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
    const { createCandidateExported } = await import('./index');

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
