import fs from 'fs';
import path from 'path';

const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

const lodgingPath = (name: string) => path.resolve(__dirname, '..', '..', 'test_inputs', 'lodging', name);
const normalizeSpace = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();

describe('Booking.com hotel parsers', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = await import('../src/db');
    await db.initDb();
  });

  const loadNormalizedDoc = async (filename: string) => {
    const { findOrCreateUser } = await import('../src/db');
    const { writeTempBytes, deleteTempBytes } = await import('../src/ingestion/shared/tempStorage');
    const { normalizeIngestionPayload } = await import('../src/ingestion/normalization');
    const { createImportJob, getOrCreateIngestionSource } = await import('../src/ingestion/shared/repository');
    const bytes = fs.readFileSync(lodgingPath(filename));
    const ref = await writeTempBytes(filename, bytes);
    const user = await findOrCreateUser(`fixture-${filename}@example.com`, 'email');
    const ingestionSourceId = await getOrCreateIngestionSource(user.id, 'MANUAL_UPLOAD');
    const job = await createImportJob({
      userId: user.id,
      ingestionSourceId,
      sourceType: 'MANUAL_UPLOAD',
      idempotencyKey: `parser-${filename}`,
      contentHash: `hash-${filename}`,
      externalMessageId: `manual:${filename}`,
      originalFilename: filename,
      mimeType: 'application/pdf',
      correlationId: `corr-${filename}`,
      dryRun: false,
    });

    const doc = await normalizeIngestionPayload(job.id, {
      sourceType: 'MANUAL_UPLOAD',
      sourceId: ingestionSourceId,
      userId: user.id,
      externalMessageId: `manual:${filename}`,
      receivedAt: '2026-03-19T00:00:00.000Z',
      originalFilename: filename,
      mimeType: 'application/pdf',
      contentBytesRef: ref,
      contentHash: `hash-${filename}`,
      metadata: { fromAddress: 'noreply@booking.com' },
      correlationId: `corr-${filename}`,
      dryRun: false,
      virusScanStatus: 'SKIPPED',
    });

    return {
      doc,
      cleanup: async () => deleteTempBytes(ref),
    };
  };

  const expectations = [
    {
      pdf: 'Chic stay HANA Boutique hotel.pdf',
      json: 'Chic stay HANA Boutique hotel.json',
    },
    {
      pdf: 'MOOONS Vienna.pdf',
      json: 'MOOONS Vienna.json',
    },
  ];

  it.each(expectations)('generic regex hotel parser extracts Booking.com fields from $pdf', async ({ pdf, json }) => {
    const { RegexExtractor } = await import('../src/ingestion/extraction');
    const expected = JSON.parse(fs.readFileSync(lodgingPath(json), 'utf8'));
    const { doc, cleanup } = await loadNormalizedDoc(pdf);
    try {
      const extractor = new RegexExtractor();
      const result = await extractor.extract(doc, {
        allowLargeLlm: false,
        allowSmallLlm: false,
        tokenBudgetUsd: 0.1,
        contentHash: doc.normalizedContentHash,
        userId: doc.userId,
        importJobId: doc.importJobId,
        correlationId: doc.correlationId,
        logicVersion: 'test-booking-regex',
      });

      expect(result.parsedItems).toHaveLength(1);
      const item = result.parsedItems[0];
      expect(item.itemType).toBe('hotel');
      expect(normalizeSpace(item.providerVendor)).toBe(normalizeSpace(expected.hotelName));
      expect(normalizeSpace(item.extractedFields.guestName)).toBe(normalizeSpace(expected.guestName));
      expect(String(item.extractedFields.checkInDate)).toContain(expected.checkInDate);
      expect(String(item.extractedFields.checkOutDate)).toContain(expected.checkOutDate);
      expect(String(item.extractedFields.freeCancelBy)).toContain(expected.freeCancelBy);
      expect(item.extractedFields.rooms).toBe(Number(expected.rooms));
      expect(item.extractedFields.breakfastIncluded).toBe(expected.breakfastIncluded);
      expect(Number(item.extractedFields.totalCost)).toBeCloseTo(Number(expected.totalCost), 2);
      expect(item.extractedFields.currency).toBe(expected.currency);
      expect(item.extractedFields.paid).toBe(expected.paid);
      expect(normalizeSpace(item.extractedFields.address)).toBe(normalizeSpace(expected.address));
    } finally {
      await cleanup();
    }
  });

  it.each(expectations)('source-specific Booking.com parser extracts hotel fields from $pdf', async ({ pdf, json }) => {
    const { SourceSpecificExtractor } = await import('../src/ingestion/extraction/learnedExtractor');
    const expected = JSON.parse(fs.readFileSync(lodgingPath(json), 'utf8'));
    const { doc, cleanup } = await loadNormalizedDoc(pdf);
    try {
      const extractor = new SourceSpecificExtractor();
      const result = await extractor.extract(doc, {
        allowLargeLlm: false,
        allowSmallLlm: false,
        tokenBudgetUsd: 0.1,
        contentHash: doc.normalizedContentHash,
        userId: doc.userId,
        importJobId: doc.importJobId,
        correlationId: doc.correlationId,
        logicVersion: 'test-booking-source-specific',
      });

      expect(result.parsedItems).toHaveLength(1);
      const item = result.parsedItems[0];
      expect(item.itemType).toBe('hotel');
      expect(normalizeSpace(item.providerVendor)).toBe(normalizeSpace(expected.hotelName));
      expect(normalizeSpace(item.extractedFields.guestName)).toBe(normalizeSpace(expected.guestName));
      expect(String(item.extractedFields.checkInDate)).toContain(expected.checkInDate);
      expect(String(item.extractedFields.checkOutDate)).toContain(expected.checkOutDate);
      expect(String(item.extractedFields.freeCancelBy)).toContain(expected.freeCancelBy);
      expect(item.extractedFields.rooms).toBe(Number(expected.rooms));
      expect(item.extractedFields.breakfastIncluded).toBe(expected.breakfastIncluded);
      expect(Number(item.extractedFields.totalCost)).toBeCloseTo(Number(expected.totalCost), 2);
      expect(item.extractedFields.currency).toBe(expected.currency);
      expect(item.extractedFields.paid).toBe(expected.paid);
      expect(normalizeSpace(item.extractedFields.address)).toBe(normalizeSpace(expected.address));
    } finally {
      await cleanup();
    }
  });
});
