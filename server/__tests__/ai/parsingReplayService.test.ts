/// <reference types="jest" />
/// <reference types="node" />

jest.mock('../../src/ingestion/shared/repository', () => ({
  getImportJobPayload: jest.fn(),
}));

jest.mock('../../src/ingestion/normalization', () => ({
  normalizeIngestionPayload: jest.fn(),
}));

jest.mock('../../src/ingestion/extraction/llmExtractor', () => ({
  LlmExtractor: jest.fn().mockImplementation(() => ({
    extract: jest.fn(async () => ({
      parsedItems: [
        {
          itemType: 'hotel',
          extractedFields: { name: 'Hotel Test', checkInDate: '2026-08-01' },
        },
      ],
      usageMetrics: { tokensIn: 10, tokensOut: 5, provider: 'llm', modelName: 'gpt-4o-mini', estimatedCostUsd: 0.01 },
      metadata: { logicVersion: 'v-test', extractedAt: '2026-07-04T00:00:00.000Z', strategyName: 'ReplayLlmExtractor' },
    })),
  })),
}));

jest.mock('../../src/ai/analytics/captureBrowser', () => ({
  getLocalAiCaptureRecord: jest.fn(),
}));

jest.mock('../../src/ai/capture/captureService', () => ({
  captureAiInteraction: jest.fn(),
}));

import { getImportJobPayload } from '../../src/ingestion/shared/repository';
import { normalizeIngestionPayload } from '../../src/ingestion/normalization';
import { getLocalAiCaptureRecord } from '../../src/ai/analytics/captureBrowser';
import { captureAiInteraction } from '../../src/ai/capture/captureService';
import {
  replayParsingIntake,
  ReplayIntakeNotFoundError,
  ReplaySourceUnavailableError,
} from '../../src/ai/replay/parsingReplayService';

const mockedGetImportJobPayload = getImportJobPayload as jest.MockedFunction<typeof getImportJobPayload>;
const mockedNormalize = normalizeIngestionPayload as jest.MockedFunction<typeof normalizeIngestionPayload>;
const mockedGetCapture = getLocalAiCaptureRecord as jest.MockedFunction<typeof getLocalAiCaptureRecord>;
const mockedCaptureAiInteraction = captureAiInteraction as jest.MockedFunction<typeof captureAiInteraction>;

const jobPayload = {
  jobId: 'intake-1',
  sourceId: 'source-1',
  userId: 'user-1',
  sourceType: 'MANUAL_UPLOAD' as const,
  externalMessageId: 'ext-1',
  receivedAt: '2026-07-01T00:00:00.000Z',
  originalFilename: 'hotel.txt',
  mimeType: 'text/plain',
  contentBytesRef: '/tmp/intake-1.txt',
  contentHash: 'hash-1',
  metadata: {},
  correlationId: 'corr-1',
  dryRun: false,
  virusScanStatus: 'PASSED' as const,
  processorConfig: { allowSmallLlm: true, allowLargeLlm: true, logicVersion: 'v-test', enforceFutureDated: false },
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const normalizedDoc = {
  importJobId: 'intake-1',
  userId: 'user-1',
  sourceType: 'MANUAL_UPLOAD' as const,
  sourceId: 'source-1',
  originalFilename: 'hotel.txt',
  mimeType: 'text/plain',
  contentHash: 'hash-1',
  normalizedContentHash: 'norm-hash-1',
  normalizedText: 'Hotel Test, check in 2026-08-01',
  normalizedHtml: null,
  extractedTextSource: 'text' as const,
  normalizationQuality: 'FULL_TEXT' as const,
  rawSourceReference: 'manual:intake-1',
  metadata: {},
  receivedAt: '2026-07-01T00:00:00.000Z',
  correlationId: 'corr-1',
};

describe('parsingReplayService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetImportJobPayload.mockResolvedValue(jobPayload as any);
    mockedNormalize.mockResolvedValue(normalizedDoc as any);
    mockedGetCapture.mockResolvedValue({
      captureSchemaVersion: 1,
      captureId: 'intake-1',
      featureKey: 'parsing',
      capturedAt: '2026-07-01T00:00:00.000Z',
      outcome: 'success',
      payload: {
        parsedItems: [
          { itemType: 'hotel', extractedFields: { name: 'Hotel Test', checkInDate: '2026-08-02', confirmationNumber: 'ABC123' } },
        ],
      },
    } as any);
  });

  it('throws ReplayIntakeNotFoundError when the intake does not exist', async () => {
    mockedGetImportJobPayload.mockResolvedValueOnce(null);
    await expect(replayParsingIntake({ intakeId: 'missing', dryRun: true })).rejects.toBeInstanceOf(ReplayIntakeNotFoundError);
  });

  it('throws ReplaySourceUnavailableError when the raw content is gone from temp storage', async () => {
    const enoent = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    mockedNormalize.mockRejectedValueOnce(enoent);
    await expect(replayParsingIntake({ intakeId: 'intake-1', dryRun: true })).rejects.toBeInstanceOf(ReplaySourceUnavailableError);
  });

  it('computes a field-level comparison without persisting anything in dry-run mode', async () => {
    const result = await replayParsingIntake({ intakeId: 'intake-1', dryRun: true });

    expect(result.persistedCaptureId).toBeNull();
    expect(mockedCaptureAiInteraction).not.toHaveBeenCalled();
    expect(result.productionItemCount).toBe(1);
    expect(result.llmItemCount).toBe(1);
    expect(result.comparison.itemComparisons[0].fieldComparisons).toEqual(
      expect.arrayContaining([
        { fieldName: 'name', status: 'same' },
        { fieldName: 'confirmationNumber', status: 'production_only', productionValue: 'ABC123' },
        { fieldName: 'checkInDate', status: 'both_different', productionValue: '2026-08-02', llmValue: '2026-08-01' },
      ])
    );
  });

  it('persists the replay under a new captureId distinct from the original intake capture, in non-dry-run mode', async () => {
    const result = await replayParsingIntake({ intakeId: 'intake-1', dryRun: false });

    expect(result.persistedCaptureId).toBeTruthy();
    expect(result.persistedCaptureId).not.toBe('intake-1');
    expect(mockedCaptureAiInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        captureId: result.persistedCaptureId,
        featureKey: 'parsing_replay',
        payload: expect.objectContaining({ replayOfIntakeId: 'intake-1' }),
      })
    );
  });
});
