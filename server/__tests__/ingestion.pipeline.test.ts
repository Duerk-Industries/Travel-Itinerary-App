/// <reference types="jest" />
/// <reference types="node" />
import type { ExtractionResult } from '../src/ingestion/contracts';

let USER_ID = '';
let DEAD_LETTER_USER_ID = '';

const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

describe('ingestion pipeline internals', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    await db.createWebUser('Cache', 'User', 'cache-user@example.com', 'secret123');
    await db.createWebUser('Dead', 'Letter', 'dead-letter@example.com', 'secret123');
    const cacheUser = await db.findUserByEmail('cache-user@example.com');
    const deadLetterUser = await db.findUserByEmail('dead-letter@example.com');
    expect(cacheUser).not.toBeNull();
    expect(deadLetterUser).not.toBeNull();
    USER_ID = cacheUser!.id;
    DEAD_LETTER_USER_ID = deadLetterUser!.id;
  });

  it('reuses extraction cache when logic version matches', async () => {
    const { saveExtractionCacheEntry } = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const { extractCandidates } = require('../src/ingestion/extraction') as typeof import('../src/ingestion/extraction');
    const cached = {
      parsedItems: [],
      usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'cache', modelName: null, estimatedCostUsd: 0 },
      metadata: { logicVersion: 'v-test', extractedAt: '2026-03-17T00:00:00.000Z', strategyName: 'cache' },
    };
    await saveExtractionCacheEntry(USER_ID, 'content-hash-1', 'v-test', cached);
    const doc = {
      importJobId: 'job-1',
      userId: USER_ID,
      sourceType: 'MANUAL_UPLOAD' as const,
      sourceId: 'source-1',
      originalFilename: 'file.txt',
      mimeType: 'text/plain',
      contentHash: 'raw-hash',
      normalizedContentHash: 'content-hash-1',
      normalizedText: 'hello',
      normalizedHtml: null,
      extractedTextSource: 'text' as const,
      normalizationQuality: 'FULL_TEXT' as const,
      rawSourceReference: 'manual:test',
      metadata: {},
      receivedAt: '2026-03-17T00:00:00.000Z',
      correlationId: 'corr-1',
    };
    const result = await extractCandidates(doc, {
      allowLargeLlm: false,
      allowSmallLlm: false,
      contentHash: 'content-hash-1',
      userId: USER_ID,
      importJobId: 'job-1',
      correlationId: 'corr-1',
      logicVersion: 'v-test',
    }, [
      {
        strategyName: 'ExplodeIfCalled',
        minConfidenceToSkipNext: 1,
        canHandle: () => true,
        extract: async () => {
          throw new Error('strategy should not be called');
        },
      },
    ]);
    expect(result.metadata.strategyName).toBe('cache');
  });

  it('dead-letters a job that exceeds the token budget threshold and creates no parsed items', async () => {
    const { writeTempBytes } = require('../src/ingestion/shared/tempStorage') as typeof import('../src/ingestion/shared/tempStorage');
    const { runIngestionPipeline } = require('../src/ingestion/orchestrator') as typeof import('../src/ingestion/orchestrator');
    const { listReviewQueueItems, listImportJobsForUser } = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');
    const bytesRef = await writeTempBytes('expensive.txt', Buffer.from('expensive extraction payload', 'utf8'));
    const payload = {
      sourceType: 'MANUAL_UPLOAD' as const,
      sourceId: 'source-1',
      userId: DEAD_LETTER_USER_ID,
      externalMessageId: 'manual:dead-letter',
      receivedAt: '2026-03-17T00:00:00.000Z',
      originalFilename: 'expensive.txt',
      mimeType: 'text/plain',
      contentBytesRef: bytesRef,
      contentHash: 'raw-hash',
      metadata: {},
      correlationId: 'corr-dead-letter',
      dryRun: false,
      virusScanStatus: 'SKIPPED' as const,
    };

    const expensiveResult: ExtractionResult = {
      parsedItems: [
        {
          itemType: 'generic_note',
          sourceType: 'MANUAL_UPLOAD',
          sourceDate: '2026-03-17T00:00:00.000Z',
          providerVendor: null,
          travelerNames: [],
          confirmationNumber: null,
          startDateTimeUtc: null,
          endDateTimeUtc: null,
          originalTimezone: null,
          timezoneStatus: 'UNKNOWN',
          rawDatetimeString: null,
          timezoneDisplayHint: 'timezone unknown',
          rawSourceReference: 'manual:test',
          confidenceScore: 0.4,
          reviewStatus: 'LOW_CONFIDENCE',
          deduplicationFingerprint: 'fp-1',
          extractedFields: { summary: 'expensive' },
          editedFields: null,
        },
      ],
      usageMetrics: {
        tokensIn: 1000,
        tokensOut: 1000,
        provider: 'llm',
        modelName: 'expensive-model',
        estimatedCostUsd: 0.2,
      },
      metadata: {
        logicVersion: 'v-budget',
        extractedAt: '2026-03-17T00:00:00.000Z',
        strategyName: 'ExpensiveExtractor',
      },
    };

    await expect(
      runIngestionPipeline(payload, true, true, {
        extractFn: async () => expensiveResult,
      })
    ).rejects.toThrow(/Token budget exceeded/i);

    const jobs = await listImportJobsForUser(DEAD_LETTER_USER_ID);
    expect(jobs[0]?.state).toBe('DEAD_LETTERED');
    const items = await listReviewQueueItems(DEAD_LETTER_USER_ID);
    expect(items).toHaveLength(0);
  });

  it('retries a failed manual upload cleanly when the same file is uploaded again', async () => {
    const { writeTempBytes } = require('../src/ingestion/shared/tempStorage') as typeof import('../src/ingestion/shared/tempStorage');
    const { runIngestionPipeline } = require('../src/ingestion/orchestrator') as typeof import('../src/ingestion/orchestrator');
    const { listImportJobsForUser, listReviewQueueItems } = require('../src/ingestion/shared/repository') as typeof import('../src/ingestion/shared/repository');

    const firstBytesRef = await writeTempBytes('retry.txt', Buffer.from('retry payload', 'utf8'));
    const secondBytesRef = await writeTempBytes('retry.txt', Buffer.from('retry payload', 'utf8'));

    const basePayload = {
      sourceType: 'MANUAL_UPLOAD' as const,
      sourceId: 'manual-source',
      userId: USER_ID,
      externalMessageId: 'manual:retry-test',
      receivedAt: '2026-03-17T00:00:00.000Z',
      originalFilename: 'retry.txt',
      mimeType: 'text/plain',
      contentHash: 'retry-raw-hash',
      metadata: {},
      correlationId: 'corr-retry-test',
      dryRun: false,
      virusScanStatus: 'SKIPPED' as const,
    };

    await expect(
      runIngestionPipeline(
        { ...basePayload, contentBytesRef: firstBytesRef },
        false,
        false,
        {
          extractFn: async () => {
            throw new Error('temporary extraction failure');
          },
        }
      )
    ).rejects.toThrow(/temporary extraction failure/i);

    const successResult: ExtractionResult = {
      parsedItems: [
        {
          itemType: 'generic_note',
          sourceType: 'MANUAL_UPLOAD',
          sourceDate: '2026-03-17T00:00:00.000Z',
          providerVendor: null,
          travelerNames: [],
          confirmationNumber: null,
          startDateTimeUtc: null,
          endDateTimeUtc: null,
          originalTimezone: null,
          timezoneStatus: 'UNKNOWN',
          rawDatetimeString: null,
          timezoneDisplayHint: 'timezone unknown',
          rawSourceReference: 'manual:test',
          confidenceScore: 0.8,
          reviewStatus: 'READY_FOR_REVIEW',
          deduplicationFingerprint: 'retry-success-fp',
          extractedFields: { summary: 'Recovered after retry' },
          editedFields: null,
        },
      ],
      usageMetrics: {
        tokensIn: 0,
        tokensOut: 0,
        provider: 'regex',
        modelName: null,
        estimatedCostUsd: 0,
      },
      metadata: {
        logicVersion: 'v-retry',
        extractedAt: '2026-03-17T00:00:00.000Z',
        strategyName: 'RetryExtractor',
      },
    };

    const retriedJob = await runIngestionPipeline(
      { ...basePayload, contentBytesRef: secondBytesRef, correlationId: 'corr-retry-test-2' },
      false,
      false,
      {
        extractFn: async () => successResult,
      }
    );

    expect(retriedJob.state).toBe('COMPLETED');

    const jobs = await listImportJobsForUser(USER_ID);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.state).toBe('COMPLETED');
    expect(jobs[0]?.retryCount).toBe(1);

    const items = await listReviewQueueItems(USER_ID);
    expect(items).toHaveLength(1);
  });

  it('falls back from source-specific and generic parsing to the LLM on low confidence and logs it', async () => {
    const logInfo = jest.fn();
    jest.doMock('../src/logger', () => ({
      logInfo,
      logError: jest.fn(),
    }));
    jest.doMock('../src/ingestion/shared/repository', () => ({
      getExtractionCacheEntry: jest.fn().mockResolvedValue(null),
      recordParseAttempt: jest.fn().mockResolvedValue(undefined),
      recordUsageMetering: jest.fn().mockResolvedValue(undefined),
      saveExtractionCacheEntry: jest.fn().mockResolvedValue(undefined),
    }));

    const { extractCandidates } = require('../src/ingestion/extraction') as typeof import('../src/ingestion/extraction');

    const doc = {
      importJobId: '11111111-1111-4111-8111-111111111111',
      userId: USER_ID,
      sourceType: 'MANUAL_UPLOAD' as const,
      sourceId: 'source-1',
      originalFilename: 'booking-email.txt',
      mimeType: 'text/plain',
      contentHash: 'raw-hash',
      normalizedContentHash: 'content-hash-low-confidence',
      normalizedText: 'Booking.com booking is confirmed',
      normalizedHtml: null,
      extractedTextSource: 'text' as const,
      normalizationQuality: 'FULL_TEXT' as const,
      rawSourceReference: 'manual:test',
      metadata: { fromAddress: 'noreply@booking.com' },
      receivedAt: '2026-03-19T00:00:00.000Z',
      correlationId: 'corr-low-confidence',
    };

    const makeResult = (strategyName: string, confidence: number): ExtractionResult => ({
      parsedItems: [
        {
          itemType: 'hotel',
          sourceType: 'MANUAL_UPLOAD',
          sourceDate: '2026-03-19T00:00:00.000Z',
          providerVendor: 'Booking.com',
          travelerNames: ['Bryan Duerk'],
          confirmationNumber: 'ABC123',
          startDateTimeUtc: '2026-05-01T12:00:00.000Z',
          endDateTimeUtc: '2026-05-03T12:00:00.000Z',
          originalTimezone: null,
          timezoneStatus: 'UNKNOWN',
          rawDatetimeString: '2026-05-01',
          timezoneDisplayHint: 'timezone unknown',
          rawSourceReference: 'manual:test',
          confidenceScore: confidence,
          reviewStatus: confidence >= 0.7 ? 'READY_FOR_REVIEW' : 'LOW_CONFIDENCE',
          deduplicationFingerprint: `${strategyName}-${confidence}`,
          extractedFields: { name: 'Grand Hotel' },
          editedFields: null,
        },
      ],
      usageMetrics: {
        tokensIn: strategyName === 'LlmExtractor' ? 10 : 0,
        tokensOut: strategyName === 'LlmExtractor' ? 5 : 0,
        provider: strategyName === 'LlmExtractor' ? 'llm' : 'regex',
        modelName: strategyName === 'LlmExtractor' ? 'gpt-4o-mini' : null,
        estimatedCostUsd: strategyName === 'LlmExtractor' ? 0.01 : 0,
      },
      metadata: {
        logicVersion: 'v-fallback',
        extractedAt: '2026-03-19T00:00:00.000Z',
        strategyName,
      },
    });

    const strategies = [
      {
        strategyName: 'SourceSpecificExtractor',
        minConfidenceToSkipNext: 0.7,
        canHandle: () => true,
        extract: async () => makeResult('SourceSpecificExtractor', 0.55),
      },
      {
        strategyName: 'RegexExtractor',
        minConfidenceToSkipNext: 0.7,
        canHandle: () => true,
        extract: async () => makeResult('RegexExtractor', 0.6),
      },
      {
        strategyName: 'LlmExtractor',
        minConfidenceToSkipNext: 0.7,
        canHandle: () => true,
        extract: async () => makeResult('LlmExtractor', 0.91),
      },
    ];

    const result = await extractCandidates(
      doc,
      {
        allowLargeLlm: true,
        allowSmallLlm: true,
        contentHash: doc.normalizedContentHash,
        userId: USER_ID,
        importJobId: doc.importJobId,
        correlationId: doc.correlationId,
        logicVersion: 'v-fallback',
      },
      strategies as any
    );

    expect(result.metadata.strategyName).toBe('LlmExtractor');
    expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('low-confidence fallback to LLM'));
  });

  it('updates the learned source parser when the LLM handles a recognized source', async () => {
    const logInfo = jest.fn();
    const logError = jest.fn();
    const upsertLearnedParser = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../src/logger', () => ({
      logInfo,
      logError,
    }));
    jest.doMock('../src/env', () => ({
      isLocalEnv: () => true,
      getEnvValue: (key: string) => (key === 'OPENAI_API_KEY' ? 'test-key' : undefined),
      getEnvFlag: () => false,
    }));
    jest.doMock('../src/apis/openaiApi', () => ({
      postOpenAiChatCompletion: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                itemType: 'hotel',
                items: [
                  {
                    providerVendor: 'Booking.com',
                    name: 'Grand Hotel',
                    guestName: 'Bryan Duerk',
                    address: '123 Main St',
                    checkInDate: '2026-05-01',
                    checkOutDate: '2026-05-03',
                    confirmationNumber: 'ABC123',
                  },
                ],
              }),
            },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 60,
        },
      }),
    }));
    jest.doMock('../src/ingestion/shared/repository', () => {
      const actual = jest.requireActual('../src/ingestion/shared/repository');
      return {
        ...actual,
        upsertLearnedParser,
      };
    });

    const { LlmExtractor } = require('../src/ingestion/extraction/llmExtractor') as typeof import('../src/ingestion/extraction/llmExtractor');

    const extractor = new LlmExtractor('LlmExtractor', 0.7, () => true);
    const doc = {
      importJobId: '22222222-2222-4222-8222-222222222222',
      userId: USER_ID,
      sourceType: 'MANUAL_UPLOAD' as const,
      sourceId: 'source-1',
      originalFilename: 'booking-email.txt',
      mimeType: 'text/plain',
      contentHash: 'raw-hash',
      normalizedContentHash: 'content-hash-booking',
      normalizedText: [
        'Booking.com',
        'booking is confirmed',
        'Hotel Name: Grand Hotel',
        'Guest name: Bryan Duerk',
        'Address: 123 Main St',
        'Check-in: 2026-05-01',
        'Check-out: 2026-05-03',
        'Confirmation number: ABC123',
      ].join('\n'),
      normalizedHtml: null,
      extractedTextSource: 'text' as const,
      normalizationQuality: 'FULL_TEXT' as const,
      rawSourceReference: 'manual:test',
      metadata: { fromAddress: 'noreply@booking.com' },
      receivedAt: '2026-03-19T00:00:00.000Z',
      correlationId: 'corr-learned-parser',
    };

    const result = await extractor.extract(doc, {
      allowLargeLlm: true,
      allowSmallLlm: true,
      tokenBudgetUsd: 0.1,
      contentHash: doc.normalizedContentHash,
      userId: USER_ID,
      importJobId: doc.importJobId,
      correlationId: doc.correlationId,
      logicVersion: 'v-learned-parser',
    });

    expect(result.parsedItems).toHaveLength(1);
    expect(upsertLearnedParser).toHaveBeenCalledTimes(1);
    expect(upsertLearnedParser).toHaveBeenCalledWith(
      'booking.com',
      'hotel',
      expect.objectContaining({
        guestName: expect.any(String),
        checkInDate: expect.any(String),
      }),
      expect.any(Number)
    );
  });

});
