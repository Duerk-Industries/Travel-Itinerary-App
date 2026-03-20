/**
 * Detects the originating source/provider of a travel document from its normalized text.
 * Used to select source-specific learned parsers before falling back to generic regex.
 */

import type { NormalizedDocument } from '../contracts';

interface SourceSignature {
  sourceKey: string;
  patterns: RegExp[];
  /** All patterns must match (AND) if true; any pattern matches (OR) if false. Default: false (OR). */
  requireAll?: boolean;
}

const SOURCE_SIGNATURES: SourceSignature[] = [
  { sourceKey: 'booking.com', patterns: [/booking\.com/i, /is expecting you/i, /booking is confirmed/i] },
  { sourceKey: 'chase_travel', patterns: [/Chase Travel/i], requireAll: false },
  { sourceKey: 'expedia', patterns: [/expedia\.com/i, /itinerary\s*#/i] },
  { sourceKey: 'hotels.com', patterns: [/hotels\.com/i] },
  { sourceKey: 'airbnb', patterns: [/airbnb\.com/i, /your reservation is confirmed/i] },
  { sourceKey: 'kayak', patterns: [/kayak\.com/i] },
  { sourceKey: 'tripadvisor', patterns: [/tripadvisor\.com/i] },
  { sourceKey: 'agoda', patterns: [/agoda\.com/i] },
  { sourceKey: 'google_flights', patterns: [/google\.com\/travel/i] },
  { sourceKey: 'united_airlines', patterns: [/united\.com/i, /united airlines/i] },
  { sourceKey: 'delta', patterns: [/delta\.com/i, /delta air lines/i] },
  { sourceKey: 'american_airlines', patterns: [/aa\.com/i, /american airlines/i] },
  { sourceKey: 'southwest', patterns: [/southwest\.com/i, /southwest airlines/i] },
];

/**
 * Detect the source/provider of a travel document.
 * Also checks `metadata.fromAddress` if available (e.g., noreply@booking.com).
 */
export const detectSource = (doc: NormalizedDocument): string | null => {
  const text = doc.normalizedText;
  const fromAddress = String(doc.metadata?.fromAddress ?? doc.metadata?.from ?? '').toLowerCase();

  for (const sig of SOURCE_SIGNATURES) {
    // Check email sender domain first (fastest, most reliable)
    if (fromAddress) {
      const domainKey = sig.sourceKey.replace(/_/g, '.');
      if (fromAddress.includes(`@${domainKey}`) || fromAddress.includes(`.${domainKey}`)) {
        return sig.sourceKey;
      }
    }

    // Check text patterns
    if (sig.requireAll) {
      if (sig.patterns.every((p) => p.test(text))) return sig.sourceKey;
    } else {
      if (sig.patterns.some((p) => p.test(text))) return sig.sourceKey;
    }
  }

  return null;
};

/**
 * Detect the primary item type from text using keyword signals.
 * Shared between SourceSpecificExtractor and LlmExtractor.
 */
export const detectItemType = (text: string): string => {
  const lower = text.toLowerCase();
  const isChaseFlightItinerary =
    /chase travel/i.test(text)
    && /trip id/i.test(text)
    && (/\bflight\s+\d+\s*:/i.test(text) || /\bairline confirmation\b/i.test(text));
  if (isChaseFlightItinerary) {
    return 'flight';
  }
  const hasHotelSignal = /\b(hotel|lodging|check-in|check-out|booking is confirmed|guest name|reservation details|booking details)\b/.test(lower);
  const hasStrongFlightSignal = /\b(flight|airline|boarding pass|pnr|record locator)\b/.test(lower);
  const hasWeakFlightSignal = /\b(departure|arrival)\b/.test(lower);
  if (hasHotelSignal) {
    return 'hotel';
  }
  if (hasStrongFlightSignal || (hasWeakFlightSignal && !hasHotelSignal)) {
    if (/\b(train|rail)\b/.test(lower)) return 'rail';
    if (/\b(ferry|bus transfer|coach)\b/.test(lower)) return 'ferry_bus_transfer';
    return 'flight';
  }
  if (/\b(car rental|pickup|dropoff|rental agreement)\b/.test(lower)) return 'car_rental';
  if (/\brestaurant\b/.test(lower)) return 'restaurant_reservation';
  if (/\b(event|concert|ticket)\b/.test(lower)) return 'event_ticket';
  if (/\b(tour|activity)\b/.test(lower)) return 'tour_activity';
  return 'generic_note';
};
