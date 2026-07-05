/// <reference types="jest" />
/// <reference types="node" />

import type { ExtractionResult, NormalizedDocument } from '../../src/ingestion/contracts';
import { captureAiInteraction } from '../../src/ai/capture/captureService';
import { compareExtractionResults } from '../../src/ai/evaluation/comparisonEngine';
import { maybeRunShadowParse, __shadowParseShouldSampleForTests } from '../../src/ai/services/shadowParseService';

jest.mock('../../src/db', () => ({
  getAdminSetting: jest.fn(async (key: string) => {
    if (key === 'shadow_parse_sample_rate_percent') return { key, value: '100', updatedAt: new Date().toISOString() };
    if (key === 'shadow_parse_monthly_budget_usd') return { key, value: '20', updatedAt: new Date().toISOString() };
    return null;
  }),
}));

jest.mock('../../src/apis/providerBudgeting', () => ({
  getCurrentApiBudgetStatus: jest.fn(async () => ({
    provider: 'SHADOW_PARSE',
    windowKey: '2026-07',
    monthlyBudgetUsd: 20,
    alertThresholdPercent: 80,
    estimatedSpendMicrosUsd: 0,
    estimatedSpendUsd: 0,
    budgetUsagePercent: 0,
    isOverBudget: false,
  })),
  recordApiCost: jest.fn(async () => 0),
  getApiBudgetWindowKey: jest.fn(() => '2026-07'),
}));

jest.mock('../../src/ai/capture/captureService', () => ({
  captureAiInteraction: jest.fn(),
}));

jest.mock('../../src/ingestion/extraction/llmExtractor', () => ({
  LlmExtractor: jest.fn().mockImplementation(() => ({
    extract: jest.fn(async () => ({
      parsedItems: [
        {
          itemType: 'hotel',
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
          rawSourceReference: 'shadow:test',
          confidenceScore: 0.9,
          reviewStatus: 'READY_FOR_REVIEW',
          deduplicationFingerprint: 'fp-shadow',
          extractedFields: { name: 'Hotel Test', checkInDate: '2026-08-01' },
          editedFields: null,
        },
      ],
      usageMetrics: { tokensIn: 10, tokensOut: 5, provider: 'llm', modelName: 'gpt-4o-mini', estimatedCostUsd: 0.01 },
      metadata: { logicVersion: 'v-test', extractedAt: '2026-07-04T00:00:00.000Z', strategyName: 'ShadowLlmExtractor' },
    })),
  })),
}));

const mockedCapture = captureAiInteraction as jest.MockedFunction<typeof captureAiInteraction>;
const providerBudgeting = require('../../src/apis/providerBudgeting') as {
  getCurrentApiBudgetStatus: jest.Mock;
  recordApiCost: jest.Mock;
  getApiBudgetWindowKey: jest.Mock;
};

const doc: NormalizedDocument = {
  importJobId: 'intake-1',
  userId: 'user-1',
  sourceType: 'MANUAL_UPLOAD',
  sourceId: 'source-1',
  originalFilename: 'hotel.txt',
  mimeType: 'text/plain',
  contentHash: 'raw',
  normalizedContentHash: 'norm',
  normalizedText: 'Hotel Test',
  normalizedHtml: null,
  extractedTextSource: 'text',
  normalizationQuality: 'FULL_TEXT',
  rawSourceReference: 'manual:test',
  metadata: {},
  receivedAt: '2026-07-04T00:00:00.000Z',
  correlationId: 'corr-1',
};

const productionResult: ExtractionResult = {
  parsedItems: [
    {
      itemType: 'hotel',
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
      rawSourceReference: 'manual:test',
      confidenceScore: 0.8,
      reviewStatus: 'READY_FOR_REVIEW',
      deduplicationFingerprint: 'fp-prod',
      extractedFields: { name: 'Hotel Test', checkInDate: '2026-08-01', confirmationNumber: 'ABC123' },
      editedFields: null,
    },
  ],
  usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'regex', modelName: null, estimatedCostUsd: 0 },
  metadata: { logicVersion: 'v-test', extractedAt: '2026-07-04T00:00:00.000Z', strategyName: 'RegexExtractor' },
};

describe('shadowParseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns void and writes shadow output only through capture', async () => {
    const result = await maybeRunShadowParse({ intakeId: 'intake-1', doc, productionResult, randomValue: 0 });

    expect(result).toBeUndefined();
    expect(mockedCapture).toHaveBeenCalledWith(expect.objectContaining({
      captureId: 'intake-1-shadow',
      featureKey: 'shadow_parse',
    }));
  });

  it('records shadow-call cost under the SHADOW_PARSE budget bucket, not OPENAI', async () => {
    await maybeRunShadowParse({ intakeId: 'intake-1', doc, productionResult, randomValue: 0 });

    // The extractor's mocked usageMetrics.estimatedCostUsd is 0.01 (see mock above).
    expect(providerBudgeting.recordApiCost).toHaveBeenCalledWith({
      provider: 'SHADOW_PARSE',
      windowKey: '2026-07',
      amountMicros: 10_000,
    });
  });

  it('does not record cost when the extractor reports zero spend', async () => {
    const { LlmExtractor } = require('../../src/ingestion/extraction/llmExtractor');
    (LlmExtractor as jest.Mock).mockImplementationOnce(() => ({
      extract: jest.fn(async () => ({
        parsedItems: [],
        usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'llm', modelName: 'gpt-4o-mini', estimatedCostUsd: 0 },
        metadata: { logicVersion: 'v-test', extractedAt: '2026-07-04T00:00:00.000Z', strategyName: 'ShadowLlmExtractor' },
      })),
    }));

    await maybeRunShadowParse({ intakeId: 'intake-1', doc, productionResult, randomValue: 0 });

    expect(providerBudgeting.recordApiCost).not.toHaveBeenCalled();
  });

  it('skips without throwing when the shadow budget is exhausted', async () => {
    providerBudgeting.getCurrentApiBudgetStatus.mockResolvedValueOnce({
      provider: 'SHADOW_PARSE',
      windowKey: '2026-07',
      monthlyBudgetUsd: 20,
      alertThresholdPercent: 80,
      estimatedSpendMicrosUsd: 21_000_000,
      estimatedSpendUsd: 21,
      budgetUsagePercent: 105,
      isOverBudget: true,
    });

    await expect(maybeRunShadowParse({ intakeId: 'intake-1', doc, productionResult, randomValue: 0 })).resolves.toBeUndefined();
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it('sampling helper respects configured percentage deterministically', () => {
    expect(__shadowParseShouldSampleForTests(10, 0.09)).toBe(true);
    expect(__shadowParseShouldSampleForTests(10, 0.1)).toBe(false);
    expect(__shadowParseShouldSampleForTests(0, 0)).toBe(false);
    expect(__shadowParseShouldSampleForTests(100, 0.99)).toBe(true);
  });

  it('compares production and shadow fields by agreement status', () => {
    const comparison = compareExtractionResults(productionResult, {
      ...productionResult,
      parsedItems: [
        {
          ...productionResult.parsedItems[0],
          extractedFields: { name: 'Hotel Test', checkInDate: '2026-08-02', newField: 'llm' },
        },
      ],
    });

    expect(comparison.itemComparisons[0].fieldComparisons).toEqual(
      expect.arrayContaining([
        { fieldName: 'name', status: 'same' },
        { fieldName: 'confirmationNumber', status: 'production_only', productionValue: 'ABC123' },
        { fieldName: 'newField', status: 'llm_only', llmValue: 'llm' },
        { fieldName: 'checkInDate', status: 'both_different', productionValue: '2026-08-01', llmValue: '2026-08-02' },
      ])
    );
  });
});
