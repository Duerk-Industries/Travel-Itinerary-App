/// <reference types="jest" />
/// <reference types="node" />
const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

describe('generic multi-leg transport extraction', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = require('../src/db') as typeof import('../src/db');
    await db.initDb();
    await db.createWebUser('Multi', 'Leg', 'multi-leg@example.com', 'secret123');
  });

  it('emits separate generic flight items when the document contains repeated leg markers', async () => {
    const db = require('../src/db') as typeof import('../src/db');
    const user = await db.findUserByEmail('multi-leg@example.com');
    expect(user).not.toBeNull();

    const { RegexExtractor } = require('../src/ingestion/extraction') as typeof import('../src/ingestion/extraction');
    const extractor = new RegexExtractor();
    const doc = {
      importJobId: 'job-multi-leg',
      userId: user!.id,
      sourceType: 'MANUAL_UPLOAD' as const,
      sourceId: 'source-1',
      originalFilename: 'multi-leg-flight.txt',
      mimeType: 'text/plain',
      contentHash: 'raw-hash',
      normalizedContentHash: 'normalized-hash',
      normalizedText: `
        Traveler 1: Bryan Duerk
        Confirmation code ZXCVB9
        Flight 1: Tue, Apr 14, 2026
        Airline: Sample Airlines
        From BOS
        To LAX
        Departure 2026-04-14 08:00
        Flight number SA 101

        Flight 2: Fri, Apr 17, 2026
        Airline: Sample Airlines
        From LAX
        To BOS
        Departure 2026-04-17 17:30
        Flight number SA 202
      `,
      normalizedHtml: null,
      extractedTextSource: 'text' as const,
      normalizationQuality: 'FULL_TEXT' as const,
      rawSourceReference: 'manual:multi-leg',
      metadata: {},
      receivedAt: '2026-03-20T00:00:00.000Z',
      correlationId: 'corr-multi-leg',
    };

    const result = await extractor.extract(doc, {
      allowLargeLlm: false,
      allowSmallLlm: false,
      tokenBudgetUsd: 0.1,
      contentHash: doc.normalizedContentHash,
      userId: doc.userId,
      importJobId: doc.importJobId,
      correlationId: doc.correlationId,
      logicVersion: 'test-multi-leg-generic',
    });

    expect(result.parsedItems).toHaveLength(2);
    expect(result.parsedItems.map((item) => item.itemType)).toEqual(['flight', 'flight']);
    expect(result.parsedItems.map((item) => item.extractedFields.flightNumber)).toEqual(['SA101', 'SA202']);
    expect(result.parsedItems.map((item) => item.extractedFields.departureLocation)).toEqual(['BOS', 'LAX']);
    expect(result.parsedItems.map((item) => item.extractedFields.arrivalLocation)).toEqual(['LAX', 'BOS']);
  });
});
