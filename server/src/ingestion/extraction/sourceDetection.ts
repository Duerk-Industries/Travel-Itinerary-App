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
  {
    sourceKey: 'booking.com',
    patterns: [
      /booking\.com|noreply@booking\.com/i,
      /is expecting you|check-in number|booking details|guest name|confirmation:\s*\d+/i,
    ],
    requireAll: true,
  },
  { sourceKey: 'chase_travel', patterns: [/Chase Travel/i], requireAll: false },
  { sourceKey: 'viator', patterns: [/\bviator\b/i] },
  { sourceKey: 'getyourguide', patterns: [/\bgetyourguide\b/i] },
  { sourceKey: 'guruwalk', patterns: [/\bguruwalk\b/i] },
  { sourceKey: 'klook', patterns: [/\bklook\b/i] },
  { sourceKey: 'fareharbor', patterns: [/\bfareharbor\b/i] },
  { sourceKey: 'expedia', patterns: [/expedia\.com/i, /itinerary\s*#/i] },
  { sourceKey: 'hotels.com', patterns: [/hotels\.com/i] },
  { sourceKey: 'airbnb', patterns: [/airbnb\.com/i, /your reservation is confirmed/i] },
  { sourceKey: 'kayak', patterns: [/kayak\.com/i] },
  { sourceKey: 'tripadvisor', patterns: [/tripadvisor\.com/i] },
  { sourceKey: 'agoda', patterns: [/agoda\.com/i] },
  { sourceKey: 'google_flights', patterns: [/google\.com\/travel/i] },
  { sourceKey: 'united_airlines', patterns: [/united\.com/i, /united airlines/i] },
  { sourceKey: 'delta', patterns: [/delta\.com/i, /delta air lines/i] },
  { sourceKey: 'austrian_airlines', patterns: [/austrian airlines|operated by:\s*austrian|austrian air/i] },
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
  const hasKnownActivityProvider = /\b(viator|getyourguide|guruwalk|fareharbor)\b/.test(lower);
  const hasKnownKlookProvider = /\bklook\b/.test(lower);
  const isChaseFlightItinerary =
    /chase travel/i.test(text)
    && /trip id/i.test(text)
    && (/\bflight\s+\d+\s*:/i.test(text) || /\bairline confirmation\b/i.test(text));
  const isChaseHotelItinerary =
    /chase travel/i.test(text)
    && /\bhotel confirmation\b/i.test(text)
    && /\bcheck-in\s*:/i.test(text);
  if (isChaseHotelItinerary) {
    return 'hotel';
  }
  if (isChaseFlightItinerary) {
    return 'flight';
  }
  const hasHotelSignal =
    /\b(hotel|lodging|guest name|room type|room\b|property|check-out|is expecting you|max capacity|breakfast included)\b/.test(lower)
    || (/\bcheck-in\b/.test(lower) && /\b(room|property|hotel|reservation details|booking details)\b/.test(lower));
  const hasStrongFlightSignal = /\b(flight|airline|boarding pass|pnr|record locator|terminal \d|gate [a-z]?\d+)\b/.test(lower);
  const hasFlightRouteSignal =
    /\b(depart(?:ure|ing)|arriv(?:al|ing))\b/.test(lower)
    && /\b(airport|airline|flight|terminal|gate|operated by|record locator)\b/.test(lower);
  const hasRailSignal = /\b(train|rail|high speed rail|rail ticket|station\b|thsr|hsr\b)\b/.test(lower);
  const hasPrivateTransferSignal =
    /\b(one-way transfer|private transfer|pickup details|pick-up and drop-off|drop-off|pickup location|pickup at|driver(?:'s)? info|vehicle\b)\b/.test(lower);
  const hasCarRentalSignal =
    /\b(car rental with driver|charter time|5-seater car|vehicle assigned|car rental|rental agreement|customized itinerary|driver customized itinerary)\b/.test(lower);
  const hasActivitySignal =
    /\b(tour|activity|walking tour|hot spring|cruise|excursion|day trip|museum|studio tour|canyon|sanctuary|cooking class|food tour|glacier|pyramids|canal cruise|trek|wine tour)\b/.test(lower);
  const hasEventTicketSignal = /\b(concert|festival|performance|admission ticket|show ticket|arena|stadium)\b/.test(lower);

  if (hasKnownKlookProvider) {
    if (hasCarRentalSignal) return 'car_rental';
    if (hasRailSignal) return 'rail';
    if (/\b(hot spring|spring city resort)\b/.test(lower)) return 'tour_activity';
    if (hasPrivateTransferSignal) return 'ferry_bus_transfer';
    if (hasActivitySignal) return 'tour_activity';
  }
  if (/\bgetyourguide\b/.test(lower)) {
    if (/\b(one-way transfer|pickup location|pickup at)\b/.test(lower)) return 'ferry_bus_transfer';
  }
  if (hasKnownActivityProvider && (hasActivitySignal || /\b(booking code|activity provider|walking tour community)\b/.test(lower))) {
    return 'tour_activity';
  }
  if (hasCarRentalSignal) return 'car_rental';
  if (hasRailSignal) return 'rail';
  if (hasPrivateTransferSignal) return 'ferry_bus_transfer';
  if (hasHotelSignal && !hasActivitySignal && !hasPrivateTransferSignal && !hasRailSignal) {
    return 'hotel';
  }
  if (hasStrongFlightSignal || hasFlightRouteSignal) {
    if (hasRailSignal) return 'rail';
    if (/\b(ferry|bus transfer|coach)\b/.test(lower)) return 'ferry_bus_transfer';
    return 'flight';
  }
  if (/\brestaurant\b/.test(lower)) return 'restaurant_reservation';
  if (hasEventTicketSignal) return 'event_ticket';
  if (hasActivitySignal) return 'tour_activity';
  if (/\bticket\b/.test(lower) && /\b(hot spring|museum|tour|activity|reservation)\b/.test(lower)) return 'tour_activity';
  if (/\bticket\b/.test(lower)) return 'event_ticket';
  return 'generic_note';
};
