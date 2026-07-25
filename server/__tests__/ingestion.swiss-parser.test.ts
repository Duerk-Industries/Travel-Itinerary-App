/// <reference types="jest" />
import type { NormalizedDocument } from '../src/ingestion/contracts';

const makeDocument = (normalizedText: string): NormalizedDocument => ({
  importJobId: 'swiss-parser-test',
  userId: 'swiss-parser-user',
  sourceType: 'MANUAL_UPLOAD',
  sourceId: 'swiss-parser-test',
  externalMessageId: 'swiss-parser-test',
  receivedAt: '2026-07-18T16:50:00.000Z',
  originalFilename: 'swiss.pdf',
  mimeType: 'application/pdf',
  rawSourceReference: 'swiss-parser-test',
  normalizedText,
  normalizedContentHash: 'swiss-parser-test-hash',
  metadata: {},
});

const extractionConfig = {
  allowLargeLlm: false,
  allowSmallLlm: false,
  tokenBudgetUsd: 0.1,
  contentHash: 'swiss-parser-test-hash',
  userId: 'swiss-parser-user',
  importJobId: 'swiss-parser-test',
  correlationId: 'swiss-parser-test',
  logicVersion: 'swiss-parser-test',
};

describe('Swiss source-specific flight parsing', () => {
  it('extracts both itinerary legs and booking-level fields', async () => {
    const { SourceSpecificExtractor } = require('../src/ingestion/extraction/learnedExtractor') as typeof import('../src/ingestion/extraction/learnedExtractor');
    const text = [
      'From: SWISS Booking <booking@information.swiss.com>',
      'Booking code: ZHL6C7',
      'Booking details Boston - Venice',
      'Itinerary details',
      '23.08.2026 - 17:20 Boston Confirmed Logan Intl Arpt',
      '24.08.2026 - 06:20 Zurich Zurich LX55 Operated by: SWISS Airbus A350-900',
      '24.08.2026 - 08:30 Zurich Confirmed Zurich',
      '24.08.2026 - 09:35 Venice Marco Polo LX1660 Operated by: Helvetic Airways',
      'Duration: 10h 15m',
      'All times are local times.',
      'Passengers Mr Bryan Duerk Adult Ms Vicky Duerk Adult',
      'Baggage Bryan Duerk',
      'Final price USD 945.60',
      '1_BOS-ZRH.ics 2_ZRH-VCE.ics',
    ].join('\n');

    const result = await new SourceSpecificExtractor().extract(makeDocument(text), extractionConfig);

    expect(result.parsedItems).toHaveLength(2);
    expect(result.parsedItems.map((item) => item.extractedFields.flightNumber)).toEqual(['LX55', 'LX1660']);
    expect(result.parsedItems.map((item) => item.extractedFields.departureAirportCode)).toEqual(['BOS', 'ZRH']);
    expect(result.parsedItems.map((item) => item.extractedFields.arrivalAirportCode)).toEqual(['ZRH', 'VCE']);
    expect(result.parsedItems.map((item) => item.extractedFields.departureDate)).toEqual(['2026-08-23', '2026-08-24']);
    expect(result.parsedItems.map((item) => item.extractedFields.airline)).toEqual(['SWISS', 'Helvetic Airways']);
    expect(result.parsedItems.map((item) => item.extractedFields.providerVendor)).toEqual(['SWISS', 'SWISS']);
    expect(result.parsedItems.map((item) => item.extractedFields.travelers)).toEqual([
      ['Bryan Duerk', 'Vicky Duerk'],
      ['Bryan Duerk', 'Vicky Duerk'],
    ]);
    expect(result.parsedItems[0].extractedFields.totalCost).toBe(945.6);
    expect(result.parsedItems[0].extractedFields.currency).toBe('USD');
    expect(result.parsedItems[0].extractedFields.duration).toBe('10h 15m');
  });

  it('keeps the passenger name when an e-ticket email has no itinerary text', async () => {
    const { SourceSpecificExtractor } = require('../src/ingestion/extraction/learnedExtractor') as typeof import('../src/ingestion/extraction/learnedExtractor');
    const text = [
      'Bryan Duerk <bryan.duerk@gmail.com>',
      'Swiss International Air Lines <info@noti.swiss.com>',
      'Your Electronic Documents',
      'Booking reference: ZHL6C7',
      'Thank you for flying SWISS. We wish you a pleasant flight.',
      'e-ticket_7242347882653_BRYAN_DUERK.pdf',
    ].join('\n');

    const result = await new SourceSpecificExtractor().extract(makeDocument(text), extractionConfig);

    expect(result.parsedItems).toHaveLength(1);
    expect(result.parsedItems[0].confirmationNumber).toBe('ZHL6C7');
    expect(result.parsedItems[0].extractedFields.guestName).toBe('Bryan Duerk');
    expect(result.parsedItems[0].travelerNames).toEqual(['Bryan Duerk']);
    expect(result.parsedItems[0].startDateTimeUtc).toBeNull();
  });
});
