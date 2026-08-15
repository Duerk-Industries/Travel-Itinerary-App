import { __buildProductionConsensusForTests } from '../src/ingestion/extraction';
import type { ExtractionResult, NormalizedDocument, ParsedItemCandidate } from '../src/ingestion/contracts';

const candidate = (fields: Record<string, unknown>, providerVendor = 'Static Air'): ParsedItemCandidate => ({
  itemType: 'flight',
  sourceType: 'MANUAL_UPLOAD',
  sourceDate: null,
  providerVendor,
  travelerNames: typeof fields.travelerNames === 'string' ? [fields.travelerNames] : [],
  confirmationNumber: typeof fields.confirmationNumber === 'string' ? fields.confirmationNumber : null,
  startDateTimeUtc: null,
  endDateTimeUtc: null,
  originalTimezone: null,
  timezoneStatus: 'UNKNOWN',
  rawDatetimeString: null,
  timezoneDisplayHint: null,
  rawSourceReference: 'redacted',
  confidenceScore: 0.8,
  reviewStatus: 'READY_FOR_REVIEW',
  deduplicationFingerprint: 'fingerprint',
  extractedFields: fields,
  editedFields: null,
});

const result = (item: ParsedItemCandidate, provider: string): ExtractionResult => ({
  parsedItems: [item],
  usageMetrics: { tokensIn: 10, tokensOut: 5, provider, modelName: `${provider}-model`, estimatedCostUsd: 0.001 },
  metadata: { logicVersion: 'test', extractedAt: new Date().toISOString(), strategyName: provider },
});

const doc: NormalizedDocument = {
  importJobId: 'job-1',
  userId: 'user-1',
  sourceType: 'MANUAL_UPLOAD',
  sourceId: 'source-1',
  originalFilename: 'booking.pdf',
  mimeType: 'application/pdf',
  contentHash: 'hash',
  normalizedContentHash: 'normalized-hash',
  normalizedText: 'booking',
  normalizedHtml: null,
  extractedTextSource: 'pdf',
  normalizationQuality: 'STRUCTURAL_EXTRACT',
  rawSourceReference: 'redacted',
  metadata: {},
  receivedAt: new Date().toISOString(),
  correlationId: 'corr-1',
};

describe('production parser consensus', () => {
  it('promotes only matching LLM fields and keeps static values on disagreement', async () => {
    const staticResult = result(candidate({ flightNumber: 'STATIC-1', departureAirportCode: 'JFK' }), 'static');
    const llmA = result(candidate({ flightNumber: 'AA100', departureAirportCode: 'JFK', carrier: 'Air Alpha' }), 'openai');
    const llmB = result(candidate({ flightNumber: 'AA100', departureAirportCode: 'LAX', carrier: 'Air Alpha' }), 'gemini');

    const { result: consensus, comparison } = await __buildProductionConsensusForTests(doc, {
      logicVersion: 'test',
      tokenBudgetUsd: 1,
      allowSmallLlm: true,
      allowLargeLlm: true,
      contentHash: 'hash',
      userId: 'user-1',
      importJobId: 'job-1',
      correlationId: 'corr-1',
    }, staticResult, llmA, llmB);

    expect(consensus.parsedItems[0].extractedFields.flightNumber).toBe('AA100');
    expect(consensus.parsedItems[0].extractedFields.departureAirportCode).toBe('JFK');
    expect(consensus.parsedItems[0].extractedFields.carrier).toBe('Air Alpha');
    expect(comparison.fields.find((field) => field.fieldName === 'flightNumber')?.status).toBe('llm_agree_static_differs');
    expect(comparison.fields.find((field) => field.fieldName === 'departureAirportCode')?.status).toBe('llm_disagree_static_used');
    expect(comparison.fields.every((field) => !('staticValue' in field))).toBe(true);
  });

  it('does not select a field when static is absent and the LLMs disagree', async () => {
    const staticResult = result(candidate({}, 'Static Air'), 'static');
    const llmA = result(candidate({ flightNumber: 'AA100' }), 'openai');
    const llmB = result(candidate({ flightNumber: 'BB200' }), 'gemini');
    const { result: consensus } = await __buildProductionConsensusForTests(doc, {
      logicVersion: 'test', tokenBudgetUsd: 1, allowSmallLlm: true, allowLargeLlm: true,
      contentHash: 'hash', userId: 'user-1', importJobId: 'job-2', correlationId: 'corr-2',
    }, { ...staticResult, parsedItems: [] }, llmA, llmB);
    expect(consensus.parsedItems[0].extractedFields.flightNumber).toBeUndefined();
  });
});
