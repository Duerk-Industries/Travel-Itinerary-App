/// <reference types="jest" />
/// <reference types="node" />

const getAirportByIataCode = jest.fn();

jest.mock('../src/db', () => ({
  getAirportByIataCode: (...args: any[]) => getAirportByIataCode(...args),
}));

import { validateAndAdjustExtractionResult } from '../src/ingestion/extraction/fieldValidator';
import type { ExtractionResult, ParsedItemCandidate } from '../src/ingestion/contracts';

const baseCandidate = (overrides: Partial<ParsedItemCandidate> = {}): ParsedItemCandidate => ({
  itemType: 'flight',
  sourceType: 'MANUAL_UPLOAD',
  sourceDate: '2026-03-17T00:00:00.000Z',
  providerVendor: 'Test Air',
  travelerNames: ['Test Traveler'],
  confirmationNumber: 'ABC123',
  startDateTimeUtc: '2026-06-01T10:00:00.000Z',
  endDateTimeUtc: null,
  originalTimezone: null,
  timezoneStatus: 'UNKNOWN',
  rawDatetimeString: null,
  timezoneDisplayHint: null,
  rawSourceReference: 'manual:test',
  confidenceScore: 0.94,
  reviewStatus: 'READY_FOR_REVIEW',
  deduplicationFingerprint: 'fp-1',
  extractedFields: {},
  editedFields: null,
  ...overrides,
});

const asResult = (parsedItems: ParsedItemCandidate[]): ExtractionResult => ({
  parsedItems,
  usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'regex', modelName: null, estimatedCostUsd: 0 },
  metadata: { logicVersion: 'v-test', extractedAt: '2026-03-17T00:00:00.000Z', strategyName: 'RegexExtractor' },
});

describe('validateAndAdjustExtractionResult', () => {
  beforeEach(() => {
    getAirportByIataCode.mockReset();
  });

  it('leaves a clean candidate untouched', async () => {
    getAirportByIataCode.mockResolvedValue({ iataCode: 'BOS', name: 'Logan Intl', city: 'Boston', country: 'US', lat: 42, lng: -71 });
    const candidate = baseCandidate({
      extractedFields: { departureAirportCode: 'BOS', arrivalAirportCode: 'LAX', cost: 250 },
    });
    const result = await validateAndAdjustExtractionResult(asResult([candidate]));
    expect(result.parsedItems[0].confidenceScore).toBe(0.94);
    expect(result.parsedItems[0].reviewStatus).toBe('READY_FOR_REVIEW');
    expect(result.parsedItems[0].extractedFields.validationWarnings).toBeUndefined();
  });

  it('downgrades confidence when an airport code is not in the catalog', async () => {
    getAirportByIataCode.mockResolvedValue(null);
    const candidate = baseCandidate({
      extractedFields: { departureAirportCode: 'ZZZ', arrivalAirportCode: 'LAX' },
    });
    const result = await validateAndAdjustExtractionResult(asResult([candidate]));
    const item = result.parsedItems[0];
    expect(item.confidenceScore).toBeLessThan(0.7);
    expect(item.reviewStatus).toBe('LOW_CONFIDENCE');
    expect(item.extractedFields.validationWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining('ZZZ')])
    );
  });

  it('flags a malformed (non-3-letter) airport code without querying the catalog', async () => {
    const candidate = baseCandidate({
      extractedFields: { departureAirportCode: 'BOS9', arrivalAirportCode: 'LAX' },
    });
    getAirportByIataCode.mockResolvedValue({ iataCode: 'LAX', name: 'LAX', city: 'Los Angeles', country: 'US', lat: 0, lng: 0 });
    const result = await validateAndAdjustExtractionResult(asResult([candidate]));
    expect(result.parsedItems[0].reviewStatus).toBe('LOW_CONFIDENCE');
    expect(getAirportByIataCode).not.toHaveBeenCalledWith('BOS9');
  });

  it('flags a hotel checkout date before check-in', async () => {
    const candidate = baseCandidate({
      itemType: 'hotel',
      extractedFields: { checkInDate: '2026-06-10', checkOutDate: '2026-06-05' },
    });
    const result = await validateAndAdjustExtractionResult(asResult([candidate]));
    const item = result.parsedItems[0];
    expect(item.reviewStatus).toBe('LOW_CONFIDENCE');
    expect(item.extractedFields.validationWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining('before')])
    );
  });

  it('flags an implausible year (garbled date)', async () => {
    const candidate = baseCandidate({
      itemType: 'hotel',
      extractedFields: { checkInDate: '1899-06-10', checkOutDate: '1899-06-12' },
    });
    const result = await validateAndAdjustExtractionResult(asResult([candidate]));
    expect(result.parsedItems[0].reviewStatus).toBe('LOW_CONFIDENCE');
  });

  it('flags a negative cost', async () => {
    const candidate = baseCandidate({ extractedFields: { cost: -50 } });
    const result = await validateAndAdjustExtractionResult(asResult([candidate]));
    expect(result.parsedItems[0].reviewStatus).toBe('LOW_CONFIDENCE');
  });

  it('flags an implausibly large total cost', async () => {
    const candidate = baseCandidate({ extractedFields: { totalCost: 50_000_000 } });
    const result = await validateAndAdjustExtractionResult(asResult([candidate]));
    expect(result.parsedItems[0].reviewStatus).toBe('LOW_CONFIDENCE');
  });

  it('does not let an airport lookup failure itself flag the item (fails open)', async () => {
    getAirportByIataCode.mockRejectedValue(new Error('db unavailable'));
    const candidate = baseCandidate({ extractedFields: { departureAirportCode: 'BOS' } });
    const result = await validateAndAdjustExtractionResult(asResult([candidate]));
    expect(result.parsedItems[0].reviewStatus).toBe('READY_FOR_REVIEW');
  });

  it('never lowers confidenceScore below its original value when already low', async () => {
    getAirportByIataCode.mockResolvedValue(null);
    const candidate = baseCandidate({
      confidenceScore: 0.5,
      reviewStatus: 'LOW_CONFIDENCE',
      extractedFields: { departureAirportCode: 'ZZZ' },
    });
    const result = await validateAndAdjustExtractionResult(asResult([candidate]));
    expect(result.parsedItems[0].confidenceScore).toBe(0.5);
  });
});
