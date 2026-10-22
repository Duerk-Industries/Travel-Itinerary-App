import { createHash } from 'crypto';
import { Parser } from 'htmlparser2';
import { sync } from 'node-ical';
import { z } from 'zod';
import type { ExtractionResult, NormalizedDocument, ParsedItemCandidate, ParsedItemType } from '../contracts';
import { buildParsedItemFingerprint } from '../shared/hashing';

const text = z.string().trim().max(2000);
const reservation = z.object({
  '@type': z.enum(['FlightReservation', 'LodgingReservation', 'HotelReservation', 'TrainReservation', 'RentalCarReservation', 'FoodEstablishmentReservation', 'EventReservation']),
  reservationId: text.optional(), reservationNumber: text.optional(), reservationStatus: text.optional(),
  checkinTime: text.optional(), checkoutTime: text.optional(), startTime: text.optional(), endTime: text.optional(),
  reservationFor: z.object({ '@type': text.optional(), name: text.optional(), flightNumber: text.optional(), trainNumber: text.optional(),
    departureTime: text.optional(), arrivalTime: text.optional(),
    departureAirport: z.object({ name: text.optional(), iataCode: text.optional() }).optional(),
    arrivalAirport: z.object({ name: text.optional(), iataCode: text.optional() }).optional(),
    address: z.union([text, z.object({ streetAddress: text.optional(), addressLocality: text.optional(), addressCountry: text.optional() })]).optional(),
  }),
});
const TYPES: Record<z.infer<typeof reservation>['@type'], ParsedItemType> = {
  FlightReservation: 'flight', LodgingReservation: 'hotel', HotelReservation: 'hotel', TrainReservation: 'rail',
  RentalCarReservation: 'car_rental', FoodEstablishmentReservation: 'restaurant_reservation', EventReservation: 'event_ticket',
};
const instant = (value?: string): string | null => value && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const candidate = (doc: NormalizedDocument, itemType: ParsedItemType, fields: Record<string, unknown>, start: string | null, end: string | null, confidence: number, reference: string | null = null): ParsedItemCandidate => {
  const item: ParsedItemCandidate = {
    itemType, sourceType: doc.sourceType, sourceDate: doc.receivedAt, providerVendor: null,
    travelerNames: [], confirmationNumber: reference, startDateTimeUtc: start, endDateTimeUtc: end,
    originalTimezone: start ? 'UTC' : null, timezoneStatus: start ? 'RESOLVED' : 'UNKNOWN',
    rawDatetimeString: typeof fields.rawDate === 'string' ? fields.rawDate : null,
    timezoneDisplayHint: start ? null : 'Check the local date and timezone before adding.',
    rawSourceReference: doc.rawSourceReference, confidenceScore: confidence, reviewStatus: 'READY_FOR_REVIEW',
    deduplicationFingerprint: '', extractedFields: { ...fields, automaticAssignmentAllowed: false },
  };
  item.deduplicationFingerprint = buildParsedItemFingerprint(item); return item;
};
const boundedJson = (source: string): unknown => {
  const data: unknown = JSON.parse(source);
  const stack: Array<[unknown, number]> = [[data, 0]]; let nodes = 0;
  while (stack.length) {
    const [value, depth] = stack.pop()!;
    if (++nodes > 2000 || depth > 16) throw new Error('Structured data exceeds limits');
    if (value && typeof value === 'object') for (const child of Object.values(value)) stack.push([child, depth + 1]);
  }
  return data;
};

/** No JS evaluation, remote contexts, URL fetching, recurrence expansion or
 * trip assignment. Even complete structured bookings remain review items. */
export const extractStructured = (doc: NormalizedDocument, logicVersion: string): ExtractionResult | null => {
  let items: ParsedItemCandidate[] = [];
  let recognized = false;
  try {
    if (doc.mimeType === 'text/calendar') {
      recognized = true;
      const source = doc.normalizedText;
      if (Buffer.byteLength(source) > 256 * 1024 || (source.match(/BEGIN:VEVENT/g) || []).length > 50 || (source.match(/BEGIN:VTIMEZONE/g) || []).length > 10) throw new Error('Calendar exceeds limits');
      // Recurrence is never expanded. Reject unsafe recurrence inputs before
      // the calendar library constructs recurrence rules.
      const recurring = /^(RRULE|RDATE|EXDATE|RECURRENCE-ID)[;:]/m.test(source);
      const parsed = sync.parseICS(source);
      const seen = new Set<string>();
      for (const event of Object.values(parsed)) {
        if (!event || event.type !== 'VEVENT') continue;
        const calendarEvent = event as import('node-ical').VEvent;
        const uid = String(calendarEvent.uid || '').slice(0, 200);
        const fingerprint = `${uid}:${calendarEvent.start?.toISOString?.() || ''}`;
        if (seen.has(fingerprint)) continue; seen.add(fingerprint);
        let zoneKnown = false;
        if (calendarEvent.start?.tz) {
          try { new Intl.DateTimeFormat('en', { timeZone: calendarEvent.start.tz }); zoneKnown = true; } catch { /* review unknown TZID */ }
        }
        const start = calendarEvent.start && zoneKnown && !calendarEvent.start.dateOnly ? calendarEvent.start.toISOString() : null;
        const end = calendarEvent.end && start ? calendarEvent.end.toISOString() : null;
        const special = recurring || calendarEvent.status === 'CANCELLED' || calendarEvent.start?.dateOnly || !start;
        items.push(candidate(doc, 'tour_activity', {
          name: String(calendarEvent.summary || 'Calendar event').slice(0, 2000), startLocation: String(calendarEvent.location || '').slice(0, 2000),
          notes: String(calendarEvent.description || '').slice(0, 4000), calendarUid: uid,
          rawDate: source.match(/^DTSTART[^\r\n]*/m)?.[0] || '',
          requiresReview: Boolean(special), calendarStatus: calendarEvent.status || 'CONFIRMED', recurrenceExpanded: false,
          date: start?.slice(0, 10) || null, startTime: start?.slice(11, 16) || null,
        }, start, end, special ? 0.72 : 0.91, uid || null));
      }
    } else if (doc.normalizedHtml) {
      const html = doc.normalizedHtml;
      recognized = /application\/ld\+json|itemscope/i.test(html);
      if (Buffer.byteLength(html) > 256 * 1024) throw new Error('HTML exceeds limits');
      const records: unknown[] = [];
      let scripts = 0; let aggregate = 0; let depth = 0; let tags = 0; let script = false; let scriptText = '';
      let micro: Record<string, unknown> | null = null;
      const frames: Array<{ prop?: string; value: string; item: Record<string, unknown> | null }> = [];
      const parser = new Parser({
        onopentag(name, attrs) {
          if (++depth > 128 || ++tags > 10000) throw new Error('HTML exceeds limits');
          if (name === 'script' && attrs.type?.toLowerCase() === 'application/ld+json') { recognized = true; script = true; scriptText = ''; if (++scripts > 20) throw new Error('Too many scripts'); }
          const type = attrs.itemtype?.replace(/^https?:\/\/schema.org\//, '');
          const parent = frames[frames.length - 1]?.item || micro;
          let item = parent;
          if (type && Object.prototype.hasOwnProperty.call(TYPES, type)) { recognized = true; micro = { '@type': type }; records.push(micro); item = micro; }
          else if (attrs.itemscope !== undefined && attrs.itemprop && parent) { item = {}; parent[attrs.itemprop] = item; }
          frames.push({ prop: attrs.itemprop, value: attrs.content || attrs.datetime || '', item });
        },
        ontext(value) { if (script) { aggregate += Buffer.byteLength(value); if (aggregate > 128 * 1024) throw new Error('Scripts exceed limits'); scriptText += value; } else { const frame = frames[frames.length - 1]; if (frame && frame.value.length < 2000) frame.value += value; } },
        onclosetag(name) {
          if (name === 'script' && script) { script = false; const value = boundedJson(scriptText); const list = Array.isArray(value) ? value : [value]; for (const row of list) { if (row && typeof row === 'object' && '@graph' in row && Array.isArray(row['@graph'])) records.push(...row['@graph']); else records.push(row); } }
          const frame = frames.pop(); if (frame?.prop && frame.item && frame.value.trim() && typeof frame.item[frame.prop] !== 'object') frame.item[frame.prop] = frame.value.trim();
          depth = Math.max(0, depth - 1);
        },
      }, { decodeEntities: true });
      parser.write(html); parser.end();
      for (const record of records.slice(0, 50)) {
        const result = reservation.safeParse(record); if (!result.success) continue;
        const r = result.data; const entity = r.reservationFor; const type = TYPES[r['@type']];
        const rawStart = r.checkinTime || r.startTime || entity.departureTime;
        const rawEnd = r.checkoutTime || r.endTime || entity.arrivalTime;
        const start = instant(rawStart); const end = instant(rawEnd);
        const address = typeof entity.address === 'string' ? entity.address : entity.address ? Object.values(entity.address).filter(Boolean).join(', ') : '';
        const reference = r.reservationId || r.reservationNumber || null;
        const complete = Boolean(start && reference && entity.name && (type !== 'hotel' || end));
        items.push(candidate(doc, type, {
          name: entity.name || '', propertyName: entity.name || '', address, startLocation: address || entity.name || '',
          checkInDate: rawStart?.slice(0, 10), checkOutDate: rawEnd?.slice(0, 10), date: rawStart?.slice(0, 10), rawDate: rawStart || '',
          departureDate: rawStart?.slice(0, 10), departureTime: rawStart?.slice(11, 16), arrivalDate: rawEnd?.slice(0, 10), arrivalTime: rawEnd?.slice(11, 16),
          departureLocation: entity.departureAirport?.name, departureAirportCode: entity.departureAirport?.iataCode,
          arrivalLocation: entity.arrivalAirport?.name, arrivalAirportCode: entity.arrivalAirport?.iataCode, flightNumber: entity.flightNumber,
          reference, reservationStatus: r.reservationStatus || '', requiresReview: true,
        }, start, end, complete && !/cancel/i.test(r.reservationStatus || '') ? 0.91 : 0.72, reference));
      }
    }
  } catch {
    // Malformed/adversarial structured input goes to review, not unlimited LLM
    // escalation. Never emit raw input or confirmation codes in diagnostics.
    if (recognized) items = [candidate(doc, 'generic_note', { name: 'Check this confirmation', requiresReview: true, parserReason: 'Structured details need review' }, null, null, 0.5)];
  }
  if (!items.length && recognized) items = [candidate(doc, 'generic_note', { name: 'Check this confirmation', requiresReview: true }, null, null, 0.5)];
  if (!items.length) return null;
  const unique = new Map(items.map(item => [createHash('sha256').update(JSON.stringify(item.extractedFields)).digest('hex'), item]));
  return { parsedItems: [...unique.values()], usageMetrics: { provider: 'structured', modelName: null, tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0 }, metadata: { logicVersion, extractedAt: new Date().toISOString(), strategyName: 'StructuredReservationParser' } };
};
