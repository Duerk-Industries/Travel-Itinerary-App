/// <reference types="jest" />
/// <reference types="node" />
import { sanitizeParsedItemCandidate } from '../src/ingestion/extraction/fieldSanitizer';

describe('ingestion field sanitizer', () => {
  it('strips links and markup and coerces numeric fields at the final parser stage', () => {
    const sanitized = sanitizeParsedItemCandidate({
      itemType: 'hotel',
      sourceType: 'FORWARDED_MAILBOX',
      sourceDate: null,
      providerVendor: '<b>Booking.com</b> https://booking.example/abc',
      travelerNames: [' Bryan Duerk ', 'Bryan Duerk'],
      confirmationNumber: '<a href="https://example.com">ABC123</a>',
      startDateTimeUtc: '2026-04-19T12:00:00.000Z',
      endDateTimeUtc: '2026-04-21T12:00:00.000Z',
      originalTimezone: null,
      timezoneStatus: 'UNKNOWN',
      rawDatetimeString: null,
      timezoneDisplayHint: null,
      rawSourceReference: 'https://mail.example/message/123',
      confidenceScore: 0.92,
      reviewStatus: 'NEW',
      deduplicationFingerprint: '',
      extractedFields: {
        address: '<div>123 Main St., Boston, MA 02110</div> View map https://maps.example/test',
        totalCost: '$1,234.56 <a href="https://pay.example">details</a>',
        costPerNight: 'USD 617.28',
        summary: 'Stay at <b>Harbor Hotel</b> https://example.com/info',
      },
    });

    expect(sanitized.providerVendor).toBe('Booking.com');
    expect(sanitized.confirmationNumber).toBe('ABC123');
    expect(sanitized.travelerNames).toEqual(['Bryan Duerk']);
    expect(sanitized.rawSourceReference).toBe('');
    expect(sanitized.extractedFields.address).toBe('123 Main St., Boston, MA 02110');
    expect(sanitized.extractedFields.totalCost).toBe(1234.56);
    expect(sanitized.extractedFields.costPerNight).toBe(617.28);
    expect(sanitized.extractedFields.summary).toBe('Stay at Harbor Hotel');
    expect(sanitized.deduplicationFingerprint).toBeTruthy();
  });

  it('drops invalid numeric values instead of preserving linky or non-numeric text', () => {
    const sanitized = sanitizeParsedItemCandidate({
      itemType: 'tour_activity',
      sourceType: 'MANUAL_UPLOAD',
      sourceDate: null,
      providerVendor: null,
      travelerNames: [],
      confirmationNumber: null,
      startDateTimeUtc: null,
      endDateTimeUtc: null,
      originalTimezone: null,
      timezoneStatus: 'UNKNOWN',
      rawDatetimeString: null,
      timezoneDisplayHint: null,
      rawSourceReference: 'manual-upload',
      confidenceScore: 0.6,
      reviewStatus: 'NEW',
      deduplicationFingerprint: '',
      extractedFields: {
        cost: 'see receipt at https://example.com',
        startLocation: '<p>Meet at the west gate</p>',
      },
    });

    expect(sanitized.extractedFields.cost).toBeUndefined();
    expect(sanitized.extractedFields.startLocation).toBe('Meet at the west gate');
  });
});
