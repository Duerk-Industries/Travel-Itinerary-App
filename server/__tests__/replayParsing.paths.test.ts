/// <reference types="jest" />
/// <reference types="node" />
import {
  buildAiConsensusValidation,
  buildParserComparisonCsv,
  buildParserUpdateValidation,
  isSkippedLlmExtraction,
  resolveReplayPath,
} from '../scripts/replay-parsing';
import type { ExtractionResult } from '../src/ingestion/contracts';

const extraction = (fields: Record<string, unknown>, itemType = 'hotel'): ExtractionResult => ({
  parsedItems: [
    {
      itemType: itemType as any,
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
      rawSourceReference: 'test',
      confidenceScore: 1,
      reviewStatus: 'READY_FOR_REVIEW',
      deduplicationFingerprint: 'test',
      extractedFields: fields,
      editedFields: null,
    },
  ],
  usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'test', modelName: null, estimatedCostUsd: 0 },
  metadata: { logicVersion: 'test', extractedAt: '2026-07-10T00:00:00.000Z', strategyName: 'test' },
});

describe('parsing replay path resolution', () => {
  it('resolves server-prefixed paths from the repository root even when cwd is server', () => {
    const originalCwd = process.cwd();
    process.chdir(__dirname);
    try {
      const resolved = resolveReplayPath('server/logs/ai-replay/parsing/example.json').replace(/\\/g, '/');
      expect(resolved).toMatch(/Travel-Itinerary-App\/server\/logs\/ai-replay\/parsing\/example\.json$/);
      expect(resolved).not.toContain('/server/server/');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('renders parser comparisons as a field superset CSV with one column per parser', () => {
    const csv = buildParserComparisonCsv([
      { label: 'non-llm', result: extraction({ hotelName: 'The Inn', confirmationNumber: 'ABC123' }) },
      { label: 'openai:gpt-4o-mini', result: extraction({ hotelName: 'The Inn', checkInDate: '2026-08-01' }) },
      { label: 'anthropic:claude-sonnet-4-5', result: extraction({ hotelName: 'The Inn', notes: 'late, arrival' }) },
    ]);

    expect(csv.split('\n')[0]).toBe('item_index,item_type,field,non-llm,openai:gpt-4o-mini,anthropic:claude-sonnet-4-5');
    expect(csv).toContain('1,hotel,checkInDate,,2026-08-01,');
    expect(csv).toContain('1,hotel,confirmationNumber,ABC123,,');
    expect(csv).toContain('1,hotel,hotelName,The Inn,The Inn,The Inn');
    expect(csv).toContain('1,hotel,notes,,,"late, arrival"');
  });

  it('classifies a zero-token empty LLM fallback result as skipped', () => {
    expect(isSkippedLlmExtraction({
      parsedItems: [],
      usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'llm', modelName: null, estimatedCostUsd: 0 },
      metadata: { logicVersion: 'test', extractedAt: '2026-07-10T00:00:00.000Z', strategyName: 'test' },
    })).toBe(true);

    expect(isSkippedLlmExtraction({
      parsedItems: [],
      usageMetrics: { tokensIn: 100, tokensOut: 20, provider: 'zai', modelName: 'glm-4.5-air', estimatedCostUsd: 0.01 },
      metadata: {
        logicVersion: 'test',
        extractedAt: '2026-07-10T00:00:00.000Z',
        strategyName: 'test',
        status: 'skipped',
        skipReason: 'invalid-json-response',
      },
    })).toBe(true);

    expect(isSkippedLlmExtraction(extraction({}))).toBe(false);
  });

  it('builds validation JSON from fields where at least two AI models agree', () => {
    const validation = buildAiConsensusValidation([
      { label: 'openai', result: extraction({ hotelName: 'The Inn', checkInDate: '2026-08-01', confirmationNumber: 'A1' }) },
      { label: 'anthropic', result: extraction({ hotelName: 'The Inn', checkInDate: '2026-08-02', confirmationNumber: 'A1' }) },
      { label: 'gemini', result: extraction({ hotelName: 'The Inn', checkInDate: '2026-08-03', confirmationNumber: 'B2' }) },
    ], '2026-07-10T00:00:00.000Z');

    expect(validation).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-07-10T00:00:00.000Z',
      minimumAgreement: 2,
      aiModelCount: 3,
      models: ['openai', 'anthropic', 'gemini'],
    });
    expect(validation.agreements).toEqual([
      {
        itemIndex: 1,
        itemType: 'hotel',
        fieldName: 'confirmationNumber',
        value: 'A1',
        agreementCount: 2,
        agreeingModels: ['openai', 'anthropic'],
      },
      {
        itemIndex: 1,
        itemType: 'hotel',
        fieldName: 'hotelName',
        value: 'The Inn',
        agreementCount: 3,
        agreeingModels: ['openai', 'anthropic', 'gemini'],
      },
    ]);
  });

  it('builds parser-update validation only for AI consensus gaps in non-LLM output', () => {
    const validation = buildParserUpdateValidation({
      sourceFile: 'booking.pdf',
      nonLlmParser: {
        label: 'non-llm',
        result: extraction({ hotelName: 'The Inn', checkInDate: '2026-08-02', existingOnly: 'keep me' }),
      },
      aiParsers: [
        { label: 'openai', result: extraction({ hotelName: 'The Inn', checkInDate: '2026-08-01', confirmationNumber: 'A1', llmExtracted: true }) },
        { label: 'anthropic', result: extraction({ hotelName: 'The Inn', checkInDate: '2026-08-01', confirmationNumber: 'A1', llmExtracted: true }) },
        { label: 'gemini', result: extraction({ hotelName: 'The Inn', checkInDate: '2026-08-03', confirmationNumber: 'B2', llmExtracted: true }) },
      ],
      generatedAt: '2026-07-10T00:00:00.000Z',
    });

    expect(validation).toMatchObject({
      purpose: 'non_llm_parser_update_validation',
      sourceFile: 'booking.pdf',
      nonLlmParser: 'non-llm',
      aiModelCount: 3,
      gapCount: 2,
    });
    expect(validation.gaps).toEqual([
      {
        itemIndex: 1,
        itemType: 'hotel',
        fieldName: 'checkInDate',
        consensusValue: '2026-08-01',
        nonLlmStatus: 'different',
        nonLlmValue: '2026-08-02',
        agreementCount: 2,
        agreeingModels: ['openai', 'anthropic'],
      },
      {
        itemIndex: 1,
        itemType: 'hotel',
        fieldName: 'confirmationNumber',
        consensusValue: 'A1',
        nonLlmStatus: 'missing',
        agreementCount: 2,
        agreeingModels: ['openai', 'anthropic'],
      },
    ]);
  });
});
