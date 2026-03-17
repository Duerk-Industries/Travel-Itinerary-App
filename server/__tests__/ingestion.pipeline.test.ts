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
    const db = await import('../src/db');
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
    const { saveExtractionCacheEntry } = await import('../src/ingestion/shared/repository');
    const { extractCandidates } = await import('../src/ingestion/extraction');
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
    const { writeTempBytes } = await import('../src/ingestion/shared/tempStorage');
    const { runIngestionPipeline } = await import('../src/ingestion/orchestrator');
    const { listReviewQueueItems, listImportJobsForUser } = await import('../src/ingestion/shared/repository');
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
});
