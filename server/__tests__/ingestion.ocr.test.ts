const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

describe('image normalization OCR', () => {
  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    setMemoryEnv();
    const db = await import('../src/db');
    await db.initDb();
  });

  it('uses OCR output for image payloads when OCR succeeds', async () => {
    jest.doMock('../src/ingestion/normalization/ocr', () => ({
      extractImageTextViaOcr: jest.fn().mockResolvedValue(
        'Printed Boarding Pass\nPassenger: Jamie Chen\nAirline: JetBlue Airways\nFlight Number: B6123\nConfirmation Code: JET123'
      ),
    }));
    const { writeTempBytes, deleteTempBytes } = await import('../src/ingestion/shared/tempStorage');
    const { normalizeIngestionPayload } = await import('../src/ingestion/normalization');
    const ref = await writeTempBytes(
      'boarding-pass.png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
    );
    try {
      const normalized = await normalizeIngestionPayload('11111111-1111-4111-8111-111111111111', {
        sourceType: 'MANUAL_UPLOAD',
        sourceId: 'source-1',
        userId: 'user-1',
        externalMessageId: 'manual:test',
        receivedAt: '2026-03-19T12:00:00.000Z',
        originalFilename: 'boarding-pass.png',
        mimeType: 'image/png',
        contentBytesRef: ref,
        contentHash: 'hash-ocr-1',
        metadata: {},
        correlationId: 'corr-ocr-1',
        dryRun: false,
        virusScanStatus: 'SKIPPED',
      });

      expect(normalized.extractedTextSource).toBe('ocr');
      expect(normalized.normalizationQuality).toBe('OCR');
      expect(normalized.normalizedText).toContain('Passenger: Jamie Chen');
      expect(normalized.normalizedText).not.toContain('PNG');
    } finally {
      await deleteTempBytes(ref);
    }
  });

  it('falls back to byte decode only when OCR does not produce usable text', async () => {
    jest.doMock('../src/ingestion/normalization/ocr', () => ({
      extractImageTextViaOcr: jest.fn().mockResolvedValue(''),
    }));
    const { writeTempBytes, deleteTempBytes } = await import('../src/ingestion/shared/tempStorage');
    const { normalizeIngestionPayload } = await import('../src/ingestion/normalization');
    const readableFallback = Buffer.from(
      'Printed Boarding Pass\nPassenger: Jamie Chen\nAirline: JetBlue Airways\nFlight Number: B6123\nConfirmation Code: JET123',
      'utf8'
    );
    const ref = await writeTempBytes('boarding-pass.png', readableFallback);
    try {
      const normalized = await normalizeIngestionPayload('22222222-2222-4222-8222-222222222222', {
        sourceType: 'MANUAL_UPLOAD',
        sourceId: 'source-1',
        userId: 'user-1',
        externalMessageId: 'manual:test',
        receivedAt: '2026-03-19T12:00:00.000Z',
        originalFilename: 'boarding-pass.png',
        mimeType: 'image/png',
        contentBytesRef: ref,
        contentHash: 'hash-ocr-2',
        metadata: {},
        correlationId: 'corr-ocr-2',
        dryRun: false,
        virusScanStatus: 'SKIPPED',
      });

      expect(normalized.extractedTextSource).toBe('fallback');
      expect(normalized.normalizationQuality).toBe('FALLBACK_DECODE');
      expect(normalized.normalizedText).toContain('Printed Boarding Pass');
    } finally {
      await deleteTempBytes(ref);
    }
  });
});
