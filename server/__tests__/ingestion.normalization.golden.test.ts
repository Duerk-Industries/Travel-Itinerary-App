import fs from 'fs';
import path from 'path';

const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

describe('ingestion normalization golden fixtures', () => {
  const fixturePath = (...parts: string[]) => path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'golden', ...parts);

  beforeEach(async () => {
    jest.resetModules();
    setMemoryEnv();
    const db = await import('../src/db');
    await db.initDb();
  });

  const fixtures = [
    {
      file: fixturePath('plain-text-email.txt'),
      mimeType: 'text/plain',
      expectedText:
        'Subject: Flight confirmation\nTraveler: Bryan Duerk\nAirline: Delta Airlines\nFlight Number: DL123\nConfirmation Code: ABC123\nDeparture: 2026-07-04 09:30\nFrom: Boston\nTo: San Francisco',
    },
    {
      file: fixturePath('html-booking-confirmation.html'),
      mimeType: 'text/html',
      expectedText: 'Hotel Confirmation Hotel Name: Harbor View Hotel Check-in: July 10, 2026 Check-out: July 13, 2026 Confirmation Number: HVH889',
    },
    {
      file: fixturePath('pdf-single-item.pdf'),
      mimeType: 'application/pdf',
      expectedText:
        'Boarding Pass\nPassenger: Casey Rivera\nAirline: Alaska Airlines\nFlight Number: AS404\nConfirmation Code: SEA404\nDeparture: 2026-08-01 13:15\nFrom: Seattle\nTo: Denver',
    },
    {
      file: fixturePath('pdf-two-items.pdf'),
      mimeType: 'application/pdf',
      expectedText:
        'Travel Itinerary\nFlight\nPassenger: Morgan Lee\nAirline: United Airlines\nFlight Number: UA900\nConfirmation Code: UA900Z\nDeparture: 2026-08-11 08:00\nFrom: Chicago\nTo: Rome\nHotel\nHotel Name: Roma Central Hotel\nCheck-in: August 12, 2026\nCheck-out: August 16, 2026\nConfirmation Number: ROMA77',
    },
    {
      file: fixturePath('image-boarding-pass.png'),
      mimeType: 'image/png',
      expectedText:
        'Printed Boarding Pass\nPassenger: Jamie Chen\nAirline: JetBlue Airways\nFlight Number: B6123\nConfirmation Code: JET123\nDeparture: 2026-09-05 06:45\nFrom: New York\nTo: Miami',
    },
  ];

  it.each(fixtures)('normalizes $file exactly', async ({ file, mimeType, expectedText }) => {
    const { writeTempBytes, deleteTempBytes } = await import('../src/ingestion/shared/tempStorage');
    const { normalizeIngestionPayload } = await import('../src/ingestion/normalization');
    const bytes = fs.readFileSync(file);
    const ref = await writeTempBytes(path.basename(file), bytes);
    try {
      const normalized = await normalizeIngestionPayload('job-1', {
        sourceType: 'MANUAL_UPLOAD',
        sourceId: 'source-1',
        userId: 'user-1',
        externalMessageId: 'manual:test',
        receivedAt: '2026-03-17T12:00:00.000Z',
        originalFilename: path.basename(file),
        mimeType,
        contentBytesRef: ref,
        contentHash: 'hash-1',
        metadata: {},
        correlationId: 'corr-1',
        dryRun: false,
        virusScanStatus: 'SKIPPED',
      });
      expect(normalized.normalizedText).toBe(expectedText);
    } finally {
      await deleteTempBytes(ref);
    }
  });
});
