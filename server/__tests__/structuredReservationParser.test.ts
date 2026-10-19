import { extractStructured } from '../src/ingestion/extraction/structuredExtractor';
import { suggestTrips } from '../src/ingestion/assignment/tripSuggestions';
import type { NormalizedDocument, PersistedParsedItem } from '../src/ingestion/contracts';
import type { Trip } from '../src/types';

const doc = (fields: Partial<NormalizedDocument>): NormalizedDocument => ({ importJobId: 'job', userId: 'owner', sourceType: 'MANUAL_UPLOAD', sourceId: 'source', originalFilename: 'confirmation', mimeType: 'text/html', contentHash: 'hash', normalizedContentHash: 'hash', normalizedText: '', extractedTextSource: 'text', normalizationQuality: 'FULL_TEXT', rawSourceReference: 'private', metadata: {}, receivedAt: '2026-10-19T12:00:00Z', correlationId: 'test', ...fields });
describe('bounded structured confirmation parsing', () => {
  it('reads JSON-LD alongside plain text without executing scripts or remote contexts', () => {
    const result = extractStructured(doc({ normalizedText: 'Stripped confirmation', normalizedHtml: `<script>alert('must not run')</script><script type="application/ld+json">${JSON.stringify({ '@context': 'https://attacker.invalid/context', '@type': 'HotelReservation', reservationId: 'DEMO123', checkinTime: '2027-05-02T15:00:00+02:00', checkoutTime: '2027-05-04T11:00:00+02:00', reservationFor: { name: 'Demo Hotel', address: 'Paris' } })}</script>` }), 'v1');
    expect(result?.parsedItems).toHaveLength(1);
    expect(result?.parsedItems[0]).toMatchObject({ itemType: 'hotel', startDateTimeUtc: '2027-05-02T13:00:00.000Z', extractedFields: { automaticAssignmentAllowed: false, address: 'Paris' } });
    expect(result?.usageMetrics.tokensOut).toBe(0);
  });
  it('deduplicates calendar UIDs and keeps cancellations/recurrence in review without expanding', () => {
    const result = extractStructured(doc({ mimeType: 'text/calendar', normalizedText: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:demo\r\nDTSTART:20270502T100000Z\r\nDTEND:20270502T110000Z\r\nSUMMARY:Garden\r\nSTATUS:CANCELLED\r\nRRULE:FREQ=DAILY;COUNT=100000\r\nEND:VEVENT\r\nEND:VCALENDAR' }), 'v1');
    expect(result?.parsedItems).toHaveLength(1);
    expect(result?.parsedItems[0].extractedFields).toMatchObject({ requiresReview: true, recurrenceExpanded: false, automaticAssignmentAllowed: false });
  });
  it('does not resolve floating dates and bounds malformed structured input', () => {
    const floating = extractStructured(doc({ mimeType: 'text/calendar', normalizedText: 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:float\nDTSTART:20270502T100000\nSUMMARY:Check timezone\nEND:VEVENT\nEND:VCALENDAR' }), 'v1');
    expect(floating?.parsedItems[0].timezoneStatus).toBe('UNKNOWN');
    const malformed = extractStructured(doc({ normalizedHtml: '<script type="application/ld+json">{broken}</script>' }), 'v1');
    expect(malformed?.parsedItems[0].itemType).toBe('generic_note');
    expect(extractStructured(doc({ normalizedHtml: '<script type="application/ld+json">' + ' '.repeat(260000) + '</script>' }), 'v1')?.parsedItems[0].confidenceScore).toBeLessThan(0.7);
  });
  it('does not use origin geography to choose between overlapping trips', () => {
    const item = { startDateTimeUtc: '2027-05-02T10:00:00Z', timezoneStatus: 'RESOLVED', extractedFields: { departureLocation: 'Paris', arrivalLocation: 'Rome' } } as PersistedParsedItem;
    const trips = [{ id: 'paris', destination: 'Paris' }, { id: 'rome', destination: 'Rome' }].map(trip => ({ ...trip, startDate: '2027-05-01', endDate: '2027-05-05' })) as Trip[];
    const suggestions = suggestTrips(item, trips);
    expect(suggestions[0].tripId).toBe('rome'); expect(suggestions[1].reasons).toHaveLength(1);
  });
});
