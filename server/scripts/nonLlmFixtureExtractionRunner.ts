import fs from 'fs';
import path from 'path';

process.env.DB_PROVIDER = 'memory';
process.env.USE_IN_MEMORY_DB = '1';
process.env.DATABASE_URL = 'pg-mem://localhost/test';
delete process.env.FIRESTORE_EMULATOR_HOST;

const repoInputPath = (...parts: string[]) => path.resolve(__dirname, '..', '..', 'test_inputs', ...parts);

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

const main = async () => {
  const { initDb, findOrCreateUser } = require('../src/db');
  const { writeTempBytes, deleteTempBytes } = require('../src/ingestion/shared/tempStorage');
  const { normalizeIngestionPayload } = require('../src/ingestion/normalization');
  const { createImportJob, getOrCreateIngestionSource } = require('../src/ingestion/shared/repository');
  const { RegexExtractor } = require('../src/ingestion/extraction');
  const { SourceSpecificExtractor } = require('../src/ingestion/extraction/learnedExtractor');

  await initDb();
  const sourceSpecific = new SourceSpecificExtractor();
  const regex = new RegexExtractor();
  const results: Array<Record<string, unknown>> = [];

  for (const fixture of fixtureCases) {
    const { subdirParts, pdf, label } = fixture;
    const filename = pdf;
    const bytes = fs.readFileSync(repoInputPath(...subdirParts, filename));
    const ref = await writeTempBytes(filename, bytes);

    try {
      const user = await findOrCreateUser(`fixture-${Buffer.from(`${label}-${filename}`).toString('hex').slice(0, 12)}@example.com`, 'email');
      const ingestionSourceId = await getOrCreateIngestionSource(user.id, 'MANUAL_UPLOAD');
      const job = await createImportJob({
        userId: user.id,
        ingestionSourceId,
        sourceType: 'MANUAL_UPLOAD',
        idempotencyKey: `parser-${subdirParts.join('-')}-${filename}`,
        contentHash: `hash-${subdirParts.join('-')}-${filename}`,
        externalMessageId: `manual:${subdirParts.join('/')}::${filename}`,
        originalFilename: filename,
        mimeType: 'application/pdf',
        correlationId: `corr-${subdirParts.join('-')}-${filename}`,
        dryRun: false,
      });

      const doc = await normalizeIngestionPayload(job.id, {
        sourceType: 'MANUAL_UPLOAD',
        sourceId: ingestionSourceId,
        userId: user.id,
        externalMessageId: `manual:${subdirParts.join('/')}::${filename}`,
        receivedAt: '2026-03-19T00:00:00.000Z',
        originalFilename: filename,
        mimeType: 'application/pdf',
        contentBytesRef: ref,
        contentHash: `hash-${subdirParts.join('-')}-${filename}`,
        metadata: { fromAddress: providerFromFilename(filename) },
        correlationId: `corr-${subdirParts.join('-')}-${filename}`,
        dryRun: false,
        virusScanStatus: 'SKIPPED',
      });

      const extractionConfig = {
        allowLargeLlm: false,
        allowSmallLlm: false,
        tokenBudgetUsd: 0.1,
        contentHash: doc.normalizedContentHash,
        userId: doc.userId,
        importJobId: doc.importJobId,
        correlationId: doc.correlationId,
        logicVersion: 'test-non-llm-fixtures',
      };
      const sourceResult = sourceSpecific.canHandle(doc) ? await sourceSpecific.extract(doc, extractionConfig) : { parsedItems: [] };
      const result = sourceResult.parsedItems.length ? sourceResult : await regex.extract(doc, extractionConfig);
      results.push({
        key: `${label}/${pdf}`,
        metadata: result.metadata ?? null,
        item: result.parsedItems[0] ?? null,
      });
    } finally {
      await deleteTempBytes(ref);
    }
  }

  process.stdout.write('__FIXTURE_RESULTS_START__\n');
  process.stdout.write(`${JSON.stringify(results)}\n`);
  process.stdout.write('__FIXTURE_RESULTS_END__\n');
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
