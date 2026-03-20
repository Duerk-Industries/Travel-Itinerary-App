import fs from 'fs';
import path from 'path';

const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

describe('Chase Travel flight regex extraction', () => {
  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = await import('../src/db');
    await db.initDb();
    await db.createWebUser('Bryan', 'Duerk', 'bryan.duerk@gmail.com', 'secret123');
  });

  it('keeps both real flight items and preserves all extracted travelers for the Boston-to-LA PDF', async () => {
    const fixturePath = path.resolve(__dirname, '..', '..', 'test_inputs', 'transfers', 'Boston to Los Angeles.pdf');
    const bytes = fs.readFileSync(fixturePath);

    const db = await import('../src/db');
    const user = await db.findUserByEmail('bryan.duerk@gmail.com');
    expect(user).not.toBeNull();

    const { writeTempBytes, deleteTempBytes } = await import('../src/ingestion/shared/tempStorage');
    const { sha256 } = await import('../src/ingestion/shared/hashing');
    const { normalizeIngestionPayload } = await import('../src/ingestion/normalization');
    const { extractCandidates } = await import('../src/ingestion/extraction');
    const { createImportJob, getOrCreateIngestionSource } = await import('../src/ingestion/shared/repository');

    const tempRef = await writeTempBytes(path.basename(fixturePath), bytes);
    try {
      const payload = {
        sourceType: 'MANUAL_UPLOAD' as const,
        sourceId: 'source-1',
        userId: user!.id,
        externalMessageId: 'manual:boston-la',
        receivedAt: '2026-03-19T18:09:10.000Z',
        originalFilename: path.basename(fixturePath),
        mimeType: 'application/pdf',
        contentBytesRef: tempRef,
        contentHash: sha256(bytes.toString('base64')),
        metadata: {},
        correlationId: 'corr-boston-la',
        dryRun: false,
        virusScanStatus: 'SKIPPED' as const,
      };
      const ingestionSourceId = await getOrCreateIngestionSource(user!.id, payload.sourceType);
      const job = await createImportJob({
        userId: user!.id,
        ingestionSourceId,
        sourceType: payload.sourceType,
        idempotencyKey: 'boston-la-test',
        contentHash: payload.contentHash,
        externalMessageId: payload.externalMessageId,
        originalFilename: payload.originalFilename,
        mimeType: payload.mimeType,
        correlationId: payload.correlationId,
        dryRun: payload.dryRun,
      });

      const normalized = await normalizeIngestionPayload(job.id, payload);
      const result = await extractCandidates(normalized, {
        allowLargeLlm: false,
        allowSmallLlm: false,
        contentHash: normalized.normalizedContentHash,
        userId: user!.id,
        importJobId: job.id,
        correlationId: payload.correlationId,
        logicVersion: 'test-chase-flight',
      });

      expect(result.parsedItems).toHaveLength(2);
      expect(result.parsedItems.every((item) => item.itemType === 'flight')).toBe(true);
      expect(result.parsedItems.map((item) => item.travelerNames)).toEqual([
        ['Bryan Edward Duerk', 'Vicky Duerk', 'Tristan Duerk'],
        ['Bryan Edward Duerk', 'Vicky Duerk', 'Tristan Duerk'],
      ]);
      expect(result.parsedItems.map((item) => item.confirmationNumber)).toEqual(['SJCKCS', 'SJCKCS']);
      expect(result.parsedItems.map((item) => item.extractedFields.departureAirportCode)).toEqual(['BOS', 'SFO']);
      expect(result.parsedItems.map((item) => item.extractedFields.arrivalAirportCode)).toEqual(['LAX', 'BOS']);
      expect(result.parsedItems.map((item) => item.extractedFields.flightNumber)).toEqual(['B6187', 'B6734']);
      expect(result.parsedItems.map((item) => item.extractedFields.cost)).toEqual([1257.6, 0]);
      expect(result.parsedItems.map((item) => item.extractedFields.currency)).toEqual(['USD', 'USD']);
    } finally {
      await deleteTempBytes(tempRef);
    }
  });

  it('source-specific extraction also returns one parsed item per Chase flight leg', async () => {
    const fixturePath = path.resolve(__dirname, '..', '..', 'test_inputs', 'transfers', 'Boston to Los Angeles.pdf');
    const bytes = fs.readFileSync(fixturePath);

    const db = await import('../src/db');
    const user = await db.findUserByEmail('bryan.duerk@gmail.com');
    expect(user).not.toBeNull();

    const { writeTempBytes, deleteTempBytes } = await import('../src/ingestion/shared/tempStorage');
    const { sha256 } = await import('../src/ingestion/shared/hashing');
    const { normalizeIngestionPayload } = await import('../src/ingestion/normalization');
    const { SourceSpecificExtractor } = await import('../src/ingestion/extraction/learnedExtractor');
    const { createImportJob, getOrCreateIngestionSource } = await import('../src/ingestion/shared/repository');

    const tempRef = await writeTempBytes(path.basename(fixturePath), bytes);
    try {
      const payload = {
        sourceType: 'MANUAL_UPLOAD' as const,
        sourceId: 'source-1',
        userId: user!.id,
        externalMessageId: 'manual:boston-la-source-specific',
        receivedAt: '2026-03-19T18:09:10.000Z',
        originalFilename: path.basename(fixturePath),
        mimeType: 'application/pdf',
        contentBytesRef: tempRef,
        contentHash: sha256(bytes.toString('base64')),
        metadata: {},
        correlationId: 'corr-boston-la-source-specific',
        dryRun: false,
        virusScanStatus: 'SKIPPED' as const,
      };
      const ingestionSourceId = await getOrCreateIngestionSource(user!.id, payload.sourceType);
      const job = await createImportJob({
        userId: user!.id,
        ingestionSourceId,
        sourceType: payload.sourceType,
        idempotencyKey: 'boston-la-source-specific-test',
        contentHash: payload.contentHash,
        externalMessageId: payload.externalMessageId,
        originalFilename: payload.originalFilename,
        mimeType: payload.mimeType,
        correlationId: payload.correlationId,
        dryRun: payload.dryRun,
      });

      const normalized = await normalizeIngestionPayload(job.id, payload);
      const extractor = new SourceSpecificExtractor();
      const result = await extractor.extract(normalized, {
        allowLargeLlm: false,
        allowSmallLlm: false,
        contentHash: normalized.normalizedContentHash,
        userId: user!.id,
        importJobId: job.id,
        correlationId: payload.correlationId,
        logicVersion: 'test-chase-flight-source-specific',
        tokenBudgetUsd: 0.1,
      });

      expect(result.parsedItems).toHaveLength(2);
      expect(result.parsedItems.map((item) => item.extractedFields.flightNumber)).toEqual(['B6187', 'B6734']);
      expect(result.parsedItems.map((item) => item.travelerNames)).toEqual([
        ['Bryan Edward Duerk', 'Vicky Duerk', 'Tristan Duerk'],
        ['Bryan Edward Duerk', 'Vicky Duerk', 'Tristan Duerk'],
      ]);
    } finally {
      await deleteTempBytes(tempRef);
    }
  });

  it('parses both Chase flight sections even when PDF extraction flattens them onto one line', async () => {
    const { _parseChaseFlightLegs } = await import('../src/ingestion/extraction');

    const flattenedText = [
      'Flight 1: Sat, Jun 08, 2024 airline logo Jetblue Airways 07:15 pm BOS 10:42 pm LAX 6h 27m | Non-Stop Jetblue Airways B6 187 Airbus A320',
      'Flight 2: Thu, Jun 20, 2024 airline logo Jetblue Airways 03:00 pm SFO 11:41 pm BOS 5h 41m | Non-Stop Jetblue Airways B6 734 Airbus A320',
      'Traveler 1: BRYAN Edward Duerk Traveler 2: Vicky Duerk Traveler 3: Tristan Duerk',
    ].join(' ');

    expect(_parseChaseFlightLegs(flattenedText).map((leg) => leg.flightNumber)).toEqual(['B6187', 'B6734']);
  });

  it('extracts two flight legs from the HAN-LPQ-CNX Chase Travel PDF', async () => {
    const fixturePath = path.resolve(__dirname, '..', '..', 'test_inputs', 'transfers', 'Gmail - Travel Reservation Center Trip ID # 1005017403.pdf');
    if (!fs.existsSync(fixturePath)) return;
    const bytes = fs.readFileSync(fixturePath);

    const db = await import('../src/db');
    const user = await db.findUserByEmail('bryan.duerk@gmail.com');
    expect(user).not.toBeNull();

    const { writeTempBytes, deleteTempBytes } = await import('../src/ingestion/shared/tempStorage');
    const { sha256 } = await import('../src/ingestion/shared/hashing');
    const { normalizeIngestionPayload } = await import('../src/ingestion/normalization');
    const { extractCandidates } = await import('../src/ingestion/extraction');
    const { createImportJob, getOrCreateIngestionSource } = await import('../src/ingestion/shared/repository');

    const tempRef = await writeTempBytes(path.basename(fixturePath), bytes);
    try {
      const payload = {
        sourceType: 'MANUAL_UPLOAD' as const,
        sourceId: 'source-1',
        userId: user!.id,
        externalMessageId: 'manual:han-lpq-cnx',
        receivedAt: '2026-03-20T00:00:00.000Z',
        originalFilename: path.basename(fixturePath),
        mimeType: 'application/pdf',
        contentBytesRef: tempRef,
        contentHash: sha256(bytes.toString('base64')),
        metadata: {},
        correlationId: 'corr-han-lpq-cnx',
        dryRun: false,
        virusScanStatus: 'SKIPPED' as const,
      };
      const ingestionSourceId = await getOrCreateIngestionSource(user!.id, payload.sourceType);
      const job = await createImportJob({
        userId: user!.id,
        ingestionSourceId,
        sourceType: payload.sourceType,
        idempotencyKey: 'han-lpq-cnx-test',
        contentHash: payload.contentHash,
        externalMessageId: payload.externalMessageId,
        originalFilename: payload.originalFilename,
        mimeType: payload.mimeType,
        correlationId: payload.correlationId,
        dryRun: payload.dryRun,
      });

      const normalized = await normalizeIngestionPayload(job.id, payload);
      const result = await extractCandidates(normalized, {
        allowLargeLlm: false,
        allowSmallLlm: false,
        contentHash: normalized.normalizedContentHash,
        userId: user!.id,
        importJobId: job.id,
        correlationId: payload.correlationId,
        logicVersion: 'test-han-lpq-cnx',
      });

      const flights = result.parsedItems.filter((item) => item.itemType === 'flight');
      expect(flights).toHaveLength(2);
      expect(flights.map((item) => item.extractedFields.departureAirportCode)).toEqual(['HAN', 'LPQ']);
      expect(flights.map((item) => item.extractedFields.arrivalAirportCode)).toEqual(['LPQ', 'CNX']);
      expect(flights[0].confirmationNumber).toBe('NGMDB9');
      expect(flights.map((item) => item.extractedFields.cost)).toEqual([591.2, 0]);
      expect(flights.map((item) => item.extractedFields.currency)).toEqual(['USD', 'USD']);
    } finally {
      await deleteTempBytes(tempRef);
    }
  });
});
