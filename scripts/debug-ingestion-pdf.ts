import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loadEnvFiles = () => {
  const envPaths = [
    path.resolve(__dirname, '../server/.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../server/.secrets'),
    path.resolve(__dirname, '../.secrets'),
    path.resolve(__dirname, '../server/.local_env'),
    path.resolve(__dirname, '../.local_env'),
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  }
};

const preview = (value: string, maxChars = 2500) =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars)}... [truncated ${value.length - maxChars} chars]`;

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: tsx scripts/debug-ingestion-pdf.ts <pdf-path>');
  process.exit(1);
}

const main = async () => {
  const dbModule = await import('../server/src/db.ts');
  const parserSelectionModule = await import('../server/src/ingestion/shared/parserSelection.ts');
  const hashingModule = await import('../server/src/ingestion/shared/hashing.ts');
  const tempStorageModule = await import('../server/src/ingestion/shared/tempStorage.ts');
  const normalizationModule = await import('../server/src/ingestion/normalization/index.ts');
  const sourceDetectionModule = await import('../server/src/ingestion/extraction/sourceDetection.ts');
  const extractionModule = await import('../server/src/ingestion/extraction/index.ts');
  const ingestionRepositoryModule = await import('../server/src/ingestion/shared/repository.ts');

  const db = (dbModule as any).default ?? dbModule;
  const parserSelection = (parserSelectionModule as any).default ?? parserSelectionModule;
  const hashing = (hashingModule as any).default ?? hashingModule;
  const tempStorage = (tempStorageModule as any).default ?? tempStorageModule;
  const normalization = (normalizationModule as any).default ?? normalizationModule;
  const sourceDetection = (sourceDetectionModule as any).default ?? sourceDetectionModule;
  const extraction = (extractionModule as any).default ?? extractionModule;
  const ingestionRepository = (ingestionRepositoryModule as any).default ?? ingestionRepositoryModule;

  loadEnvFiles();
  process.env.INGESTION_DEBUG_LLM = process.env.INGESTION_DEBUG_LLM || '1';

  const absolutePath = path.resolve(filePath);
  const bytes = fs.readFileSync(absolutePath);
  const tempRef = await tempStorage.writeTempBytes(path.basename(absolutePath), bytes);
  try {
    await db.initDb();

    const payload = {
      sourceType: 'MANUAL_UPLOAD' as const,
      sourceId: randomUUID(),
      userId: 'debug-user',
      externalMessageId: `debug:${path.basename(absolutePath)}`,
      receivedAt: new Date().toISOString(),
      originalFilename: path.basename(absolutePath),
      mimeType: parserSelection.normalizeMimeType('', path.basename(absolutePath)),
      contentBytesRef: tempRef,
      contentHash: hashing.sha256(bytes.toString('base64')),
      metadata: {},
      correlationId: randomUUID(),
      dryRun: false,
      virusScanStatus: 'SKIPPED' as const,
    };

    const ingestionSourceId = await ingestionRepository.getOrCreateIngestionSource(payload.userId, payload.sourceType);
    const job = await ingestionRepository.createImportJob({
      userId: payload.userId,
      ingestionSourceId,
      sourceType: payload.sourceType,
      idempotencyKey: `debug:${payload.contentHash}`,
      contentHash: payload.contentHash,
      externalMessageId: payload.externalMessageId,
      originalFilename: payload.originalFilename,
      mimeType: payload.mimeType,
      correlationId: payload.correlationId,
      dryRun: payload.dryRun,
    });
    await ingestionRepository.saveImportJobPayload({
      jobId: job.id,
      sourceId: payload.sourceId,
      userId: payload.userId,
      sourceType: payload.sourceType,
      externalMessageId: payload.externalMessageId,
      receivedAt: payload.receivedAt,
      originalFilename: payload.originalFilename,
      mimeType: payload.mimeType,
      contentBytesRef: payload.contentBytesRef,
      contentHash: payload.contentHash,
      metadata: payload.metadata,
      correlationId: payload.correlationId,
      dryRun: payload.dryRun,
      virusScanStatus: payload.virusScanStatus,
      processorConfig: {
        allowSmallLlm: true,
        allowLargeLlm: true,
        logicVersion: 'debug',
        enforceFutureDated: false,
      },
    });

    const normalized = await normalization.normalizeIngestionPayload(job.id, payload);
    const sourceKey = sourceDetection.detectSource(normalized);
    const itemType = sourceDetection.detectItemType(normalized.normalizedText);
    const beforeParser = sourceKey ? await ingestionRepository.getLearnedParser(sourceKey, itemType) : null;

    console.log('=== Normalization ===');
    console.log(JSON.stringify({
      file: absolutePath,
      mimeType: payload.mimeType,
      extractedTextSource: normalized.extractedTextSource,
      normalizationQuality: normalized.normalizationQuality,
      sourceKey,
      itemType,
      preview: preview(normalized.normalizedText),
    }, null, 2));

    console.log('=== Learned Parser Before ===');
    console.log(JSON.stringify(beforeParser, null, 2));

    const result = await extraction.extractCandidates(normalized, {
      allowLargeLlm: true,
      allowSmallLlm: true,
      contentHash: normalized.normalizedContentHash,
      userId: payload.userId,
      importJobId: job.id,
      correlationId: normalized.correlationId,
    });

    const afterParser = sourceKey ? await ingestionRepository.getLearnedParser(sourceKey, itemType) : null;

    console.log('=== Extraction Result ===');
    console.log(JSON.stringify(result, null, 2));
    console.log('=== Learned Parser After ===');
    console.log(JSON.stringify(afterParser, null, 2));
  } finally {
    await tempStorage.deleteTempBytes(tempRef);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
