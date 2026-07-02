/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import path from 'path';
import childProcess from 'child_process';

const setMemoryEnv = () => {
  process.env.DB_PROVIDER = 'memory';
  process.env.USE_IN_MEMORY_DB = '1';
  process.env.DATABASE_URL = 'pg-mem://localhost/test';
  delete process.env.FIRESTORE_EMULATOR_HOST;
};

const repoInputPath = (...parts: string[]) => path.resolve(__dirname, '..', '..', 'test_inputs', ...parts);
const normalizeSpace = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalizeAscii = (value: unknown): string =>
  normalizeSpace(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const normalizeTime = (value: unknown): string =>
  normalizeSpace(value).replace(/\s*(am|pm)$/i, (_, suffix) => ` ${String(suffix).toUpperCase()}`);
const normalizeLoose = (value: unknown): string =>
  normalizeAscii(value).replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();

const timeToMinutes = (value: unknown): number | null => {
  const normalized = normalizeTime(value);
  if (!normalized) return null;
  const match = normalized.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const suffix = match[3]?.toUpperCase() ?? null;
  if (suffix === 'AM' && hours === 12) hours = 0;
  if (suffix === 'PM' && hours < 12) hours += 12;
  return (hours * 60) + minutes;
};

const hasOverlap = (actual: unknown, expected: unknown): boolean => {
  const actualNormalized = normalizeLoose(actual);
  const expectedNormalized = normalizeLoose(expected);
  return Boolean(
    actualNormalized
    && expectedNormalized
    && (actualNormalized.includes(expectedNormalized) || expectedNormalized.includes(actualNormalized))
  );
};

const hasTokenOverlap = (actual: unknown, expected: unknown, minTokens = 2): boolean => {
  const actualTokens = new Set(normalizeLoose(actual).split(/\s+/).filter((token) => token.length >= 3));
  const expectedTokens = normalizeLoose(expected).split(/\s+/).filter((token) => token.length >= 3);
  const shared = expectedTokens.filter((token) => actualTokens.has(token));
  return shared.length >= Math.min(minTokens, expectedTokens.length);
};
const isGenericLocationExpectation = (value: unknown): boolean =>
  /see ticket for location details/i.test(String(value ?? ''));

const providerFromFilename = (filename: string): string => {
  const lower = filename.toLowerCase();
  if (lower.includes('viator')) return 'booking@t1.viator.com';
  if (lower.includes('getyourguide')) return 'do-not-reply@notification.getyourguide.com';
  if (lower.includes('guruwalk')) return 'support@guruwalk.com';
  if (lower.includes('klook')) return 'support-noreply@klook.com';
  if (lower.includes('antelope') || lower.includes('fareharbor')) return 'messages@fareharbor.com';
  if (lower.includes('ryanair')) return 'itinerary@ryanair.com';
  if (lower.includes('chase') || lower.includes('trip id')) return 'donotreply@chasetravel.com';
  return 'fixtures@example.com';
};

type FixtureCase = { subdirParts: string[]; label: string; pdf: string; json: string };

const buildCases = (...subdirParts: string[]): FixtureCase[] => {
  const dir = repoInputPath(...subdirParts);
  const label = subdirParts.join('/');
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.pdf'))
    .filter((file) => !file.startsWith('Sample '))
    .map((pdf) => {
      const json = pdf.replace(/\.pdf$/i, '.json');
      if (!fs.existsSync(path.join(dir, json))) return null;
      return { subdirParts, label, pdf, json };
    })
    .filter((entry): entry is FixtureCase => Boolean(entry));
};

const fixtureCases = [
  ...buildCases('Activities'),
  ...buildCases('transfers'),
  ...buildCases('lodging'),
];

describe('Non-LLM ingestion fixture extraction', () => {
  let extractedByKey = new Map<string, { item: Record<string, unknown> | null; metadata: Record<string, unknown> | null }>();

  beforeAll(() => {
    jest.resetModules();
    setMemoryEnv();
    const output = childProcess.execSync('npx --prefix server tsx server/scripts/nonLlmFixtureExtractionRunner.ts', {
      cwd: path.resolve(__dirname, '..', '..'),
      encoding: 'utf8',
      timeout: 120000,
    });
    const match = output.match(/__FIXTURE_RESULTS_START__\r?\n([\s\S]*?)\r?\n__FIXTURE_RESULTS_END__/);
    if (!match) {
      throw new Error(`Fixture runner output was not parseable:\n${output}`);
    }
    const parsed = JSON.parse(match[1]) as Array<{ key: string; item: Record<string, unknown> | null; metadata: Record<string, unknown> | null }>;
    extractedByKey = new Map(parsed.map((entry) => [entry.key, { item: entry.item, metadata: entry.metadata }]));
  });

  it.each(fixtureCases)('extracts expected fields from %s/%s without LLM', async ({ subdirParts, label, pdf, json }) => {
    const expected = JSON.parse(fs.readFileSync(repoInputPath(...subdirParts, json), 'utf8'));
    const result = extractedByKey.get(`${label}/${pdf}`);
    expect(result?.item).toBeTruthy();
    const item = result?.item as Record<string, unknown>;
    const fields = (item.extractedFields as Record<string, unknown> | undefined) ?? {};

    expect(item.itemType).toBe(expected.itemType);

    const actualConfirmation = String(item.confirmationNumber ?? fields.confirmationNumber ?? '').trim();
    const expectedConfirmation = String(expected.confirmationNumber ?? '').trim();
    if (expectedConfirmation) {
      expect(actualConfirmation).toBe(expectedConfirmation);
    }

    if (expected.bookingReferenceNumber) {
      expect(String(fields.bookingReferenceNumber ?? fields.bookingReference ?? item.confirmationNumber ?? '')).toContain(String(expected.bookingReferenceNumber));
    }

    if (expected.bookingReference) {
      expect(String(fields.bookingReference ?? item.confirmationNumber ?? '')).toContain(String(expected.bookingReference));
    }

    if (expected.name) {
      expect(hasOverlap(fields.name, expected.name)).toBe(true);
    }

    if (expected.totalCost != null) {
      expect(Number(fields.totalCost ?? 0)).toBeCloseTo(Number(expected.totalCost), 2);
    }

    if (expected.currency) {
      expect(String(fields.currency ?? '')).toBe(String(expected.currency));
    }

    if (expected.activityDate || expected.date) {
      const expectedDate = String(expected.activityDate ?? expected.date);
      const actualDate = String(fields.activityDate ?? fields.date ?? '');
      expect(actualDate).toContain(expectedDate);
    }

    if (expected.activityTime || expected.startTime) {
      const expectedTimeMinutes = timeToMinutes(expected.activityTime ?? expected.startTime);
      const actualTimeMinutes = timeToMinutes(fields.activityTime ?? fields.startTime);
      if (expectedTimeMinutes != null && actualTimeMinutes != null) {
        expect(actualTimeMinutes).toBe(expectedTimeMinutes);
      } else {
        expect(normalizeTime(fields.activityTime ?? fields.startTime)).toBe(normalizeTime(expected.activityTime ?? expected.startTime));
      }
    }

    if (expected.departureDate) {
      const actualDepartureDate = String(
        fields.departureDate
        ?? String(item.startDateTimeUtc ?? '').slice(0, 10)
        ?? ''
      );
      expect(actualDepartureDate).toContain(String(expected.departureDate));
    }

    if (expected.departureLocation) {
      expect(hasOverlap(fields.departureLocation, expected.departureLocation) || hasTokenOverlap(fields.departureLocation, expected.departureLocation)).toBe(true);
    }

    if (expected.departureAirportCode) {
      expect(String(fields.departureAirportCode ?? '')).toBe(String(expected.departureAirportCode));
    }

    if (expected.arrivalLocation) {
      expect(hasOverlap(fields.arrivalLocation, expected.arrivalLocation) || hasTokenOverlap(fields.arrivalLocation, expected.arrivalLocation)).toBe(true);
    }

    if (expected.arrivalAirportCode) {
      expect(String(fields.arrivalAirportCode ?? '')).toBe(String(expected.arrivalAirportCode));
    }

    if (expected.layoverLocationCode) {
      expect(String(fields.layoverLocationCode ?? '')).toBe(String(expected.layoverLocationCode));
    }

    if (expected.transferType) {
      const actualTransferType = String(
        fields.transferType
        ?? (item.itemType === 'flight' ? 'Flight' : item.itemType === 'rail' ? 'Train' : '')
      );
      expect(actualTransferType).toBe(String(expected.transferType));
    }

    if (expected.pickupDate) {
      expect(String(fields.pickupDate ?? '')).toContain(String(expected.pickupDate));
    }

    if (expected.pickupLocation) {
      expect(hasOverlap(fields.pickupLocation, expected.pickupLocation) || hasTokenOverlap(fields.pickupLocation, expected.pickupLocation)).toBe(true);
    }

    if (expected.model) {
      expect(hasOverlap(fields.model, expected.model) || hasTokenOverlap(fields.model, expected.model)).toBe(true);
    }

    if (expected.checkInDate) {
      expect(String(fields.checkInDate ?? '')).toContain(String(expected.checkInDate).slice(0, 10));
    }

    if (expected.checkOutDate) {
      expect(String(fields.checkOutDate ?? '')).toContain(String(expected.checkOutDate).slice(0, 10));
    }

    if (expected.address) {
      if (!isGenericLocationExpectation(expected.address)) {
        const allowsMeetingPointOnly =
          String(item.providerVendor ?? '').includes('GuruWalk')
          && !normalizeSpace(fields.address)
          && Boolean(normalizeSpace(fields.startLocation));
        expect(
          hasOverlap(fields.address ?? fields.startLocation, expected.address)
          || hasTokenOverlap(fields.address ?? fields.startLocation, expected.address)
          || allowsMeetingPointOnly
        ).toBe(true);
      }
    }

    if (expected.rooms != null) {
      expect(Number(fields.rooms ?? 0)).toBe(Number(expected.rooms));
    }
  });
});
