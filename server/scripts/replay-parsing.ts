import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { INGESTION_LOGIC_VERSION } from '../src/ingestion/config';
import type { ExtractionResult, NormalizedDocument, ParsedItemCandidate } from '../src/ingestion/contracts';
import { compareExtractionResults } from '../src/ai/evaluation/comparisonEngine';
import { captureAiInteraction } from '../src/ai/capture/captureService';

type ReplayRun = {
  provider?: string;
  model?: string;
  label?: string;
};

type ParseReplayFile = {
  doc?: NormalizedDocument;
  productionItems?: Array<Record<string, unknown>>;
  request?: {
    doc?: NormalizedDocument;
    productionItems?: Array<Record<string, unknown>>;
  };
  runs?: ReplayRun[];
  outputDir?: string;
  dryRun?: boolean;
};

type CliOptions = {
  intakeId: string | null;
  requestPath: string | null;
  outputDir: string | null;
  runs: ReplayRun[];
  dryRun: boolean;
  persistCapture: boolean;
  help: boolean;
};

const usage = `Usage:
  npm --prefix server run replay:parsing -- --intake <intakeId> --models openai:gpt-4o-mini,anthropic:claude-sonnet-4-5
  npm --prefix server run replay:parsing -- --request ./parse-request.json --models gemini:gemini-2.5-flash

Options:
  --intake <id>            Replay an existing import job payload by intake/import job id.
  --request, -r <file>     JSON file containing { "doc": NormalizedDocument, "productionItems": [...] }.
  --out, -o <dir>          Directory for replay result JSON files. Defaults to server/logs/ai-replay/parsing/<timestamp>.
  --models <list>          Comma-separated provider:model entries. Overrides runs in the file.
  --provider <provider>    Single provider override, used with --model.
  --model <model>          Single model override, used with --provider.
  --persist-capture        Persist parsing_replay_cli capture records for JSON-file replays.
  --dry-run                Do not persist admin/intake replay captures. Default for --request.
  --help                   Show this help.
`;

const loadEnv = () => {
  const rootDir = path.resolve(__dirname, '../..');
  for (const relativePath of ['.env', '.local_env', 'server/.env', 'server/.local_env']) {
    const envPath = path.join(rootDir, relativePath);
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
  }
};

const parseProviderModel = (value: string): ReplayRun => {
  const [provider, ...modelParts] = value.split(':');
  return {
    provider: provider?.trim() || undefined,
    model: modelParts.join(':').trim() || undefined,
  };
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    intakeId: null,
    requestPath: null,
    outputDir: null,
    runs: [],
    dryRun: false,
    persistCapture: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--intake') {
      options.intakeId = next ?? null;
      i += 1;
    } else if (arg === '--request' || arg === '-r') {
      options.requestPath = next ?? null;
      i += 1;
    } else if (arg === '--out' || arg === '-o') {
      options.outputDir = next ?? null;
      i += 1;
    } else if (arg === '--models') {
      options.runs = String(next ?? '').split(',').map((entry) => entry.trim()).filter(Boolean).map(parseProviderModel);
      i += 1;
    } else if (arg === '--provider') {
      options.runs[0] = { ...(options.runs[0] ?? {}), provider: next };
      i += 1;
    } else if (arg === '--model') {
      options.runs[0] = { ...(options.runs[0] ?? {}), model: next };
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--persist-capture') {
      options.persistCapture = true;
    } else if (!options.requestPath && !options.intakeId && !arg.startsWith('-')) {
      options.requestPath = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
};

const timestamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

const safeFilePart = (value: string): string =>
  value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'run';

const normalizeRuns = (cliRuns: ReplayRun[], fileRuns?: ReplayRun[]): ReplayRun[] => {
  const selected = cliRuns.length ? cliRuns : Array.isArray(fileRuns) ? fileRuns : [];
  return selected.length ? selected : [{ label: 'default' }];
};

const readJson = (filePath: string): ParseReplayFile => JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));

const toProductionCandidate = (item: Record<string, unknown>, replayId: string): ParsedItemCandidate => ({
  itemType: item.itemType as ParsedItemCandidate['itemType'],
  sourceType: 'MANUAL_UPLOAD',
  sourceDate: null,
  providerVendor: (item.providerVendor as string | null) ?? null,
  travelerNames: Array.isArray(item.travelerNames) ? (item.travelerNames as string[]) : [],
  confirmationNumber: (item.confirmationNumber as string | null) ?? null,
  startDateTimeUtc: (item.startDateTimeUtc as string | null) ?? null,
  endDateTimeUtc: (item.endDateTimeUtc as string | null) ?? null,
  originalTimezone: null,
  timezoneStatus: 'UNKNOWN',
  rawDatetimeString: null,
  timezoneDisplayHint: null,
  rawSourceReference: `cli-replay:${replayId}`,
  confidenceScore: (item.confidenceScore as number | undefined) ?? 0,
  reviewStatus: (item.reviewStatus as ParsedItemCandidate['reviewStatus']) ?? 'READY_FOR_REVIEW',
  deduplicationFingerprint: `cli-replay:${replayId}:${String(item.itemType)}`,
  extractedFields: (item.extractedFields as Record<string, unknown>) ?? item,
  editedFields: null,
});

const buildProductionResult = (productionItems: Array<Record<string, unknown>> | undefined, replayId: string): ExtractionResult => ({
  parsedItems: (productionItems ?? []).map((item) => toProductionCandidate(item, replayId)),
  usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'captured', modelName: null, estimatedCostUsd: 0 },
  metadata: {
    logicVersion: INGESTION_LOGIC_VERSION,
    extractedAt: new Date().toISOString(),
    strategyName: 'captured_production',
  },
});

const validateDoc = (doc: NormalizedDocument | undefined): NormalizedDocument => {
  if (!doc || typeof doc !== 'object') throw new Error('request.doc is required for JSON-file parsing replay');
  if (!doc.normalizedText || typeof doc.normalizedText !== 'string') throw new Error('request.doc.normalizedText is required');
  return {
    ...doc,
    importJobId: doc.importJobId || `cli-parse-${Date.now()}`,
    userId: doc.userId || 'cli-replay-user',
    sourceType: doc.sourceType || 'MANUAL_UPLOAD',
    sourceId: doc.sourceId || 'cli-replay',
    originalFilename: doc.originalFilename || 'cli-replay.txt',
    mimeType: doc.mimeType || 'text/plain',
    contentHash: doc.contentHash || `cli-${Date.now()}`,
    normalizedContentHash: doc.normalizedContentHash || doc.contentHash || `cli-normalized-${Date.now()}`,
    extractedTextSource: doc.extractedTextSource || 'text',
    normalizationQuality: doc.normalizationQuality || 'FULL_TEXT',
    rawSourceReference: doc.rawSourceReference || 'cli-replay',
    metadata: doc.metadata || {},
    receivedAt: doc.receivedAt || new Date().toISOString(),
    correlationId: doc.correlationId || `cli-parse-${Date.now()}`,
  };
};

const replayJsonDoc = async (params: {
  doc: NormalizedDocument;
  productionItems?: Array<Record<string, unknown>>;
  run: ReplayRun;
  captureId: string;
  persistCapture: boolean;
}) => {
  const { LlmExtractor } = await import('../src/ingestion/extraction/llmExtractor');
  const extractor = new LlmExtractor('CliReplayLlmExtractor', 1, () => true);
  const llmResult = await extractor.extract(params.doc, {
    logicVersion: INGESTION_LOGIC_VERSION,
    allowSmallLlm: true,
    allowLargeLlm: true,
    tokenBudgetUsd: 1,
    aiProvider: {
      ...(params.run.provider ? { provider: params.run.provider } : {}),
      ...(params.run.model ? { model: params.run.model } : {}),
    },
    contentHash: params.doc.normalizedContentHash,
    userId: params.doc.userId,
    importJobId: params.doc.importJobId,
    correlationId: params.doc.correlationId,
  });
  const productionResult = buildProductionResult(params.productionItems, params.captureId);
  const comparison = compareExtractionResults(productionResult, llmResult);
  if (params.persistCapture) {
    captureAiInteraction({
      captureSchemaVersion: 1,
      captureId: params.captureId,
      featureKey: 'parsing_replay_cli',
      capturedAt: new Date().toISOString(),
      correlationId: params.doc.correlationId,
      jobId: params.doc.importJobId,
      userId: params.doc.userId,
      provider: llmResult.usageMetrics.provider,
      model: llmResult.usageMetrics.modelName ?? undefined,
      callerId: 'PARSING_CLI_REPLAY',
      outcome: 'success',
      tokenUsage: {
        promptTokens: llmResult.usageMetrics.tokensIn,
        completionTokens: llmResult.usageMetrics.tokensOut,
        totalTokens: llmResult.usageMetrics.tokensIn + llmResult.usageMetrics.tokensOut,
      },
      payload: {
        comparison,
        parsedItems: llmResult.parsedItems.map((item) => ({
          itemType: item.itemType,
          providerVendor: item.providerVendor,
          confirmationNumber: item.confirmationNumber,
          confidenceScore: item.confidenceScore,
          reviewStatus: item.reviewStatus,
          extractedFields: item.extractedFields,
        })),
      },
    });
  }
  return {
    llmItemCount: llmResult.parsedItems.length,
    productionItemCount: productionResult.parsedItems.length,
    comparison,
    llmResult,
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || (!options.intakeId && !options.requestPath)) {
    process.stdout.write(usage);
    process.exit(options.help ? 0 : 1);
  }
  if (options.intakeId && options.requestPath) throw new Error('Use either --intake or --request, not both');

  loadEnv();
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';
  process.env.E2E_MODE = process.env.E2E_MODE ?? '1';
  process.env.DB_PROVIDER = process.env.DB_PROVIDER ?? 'memory';
  process.env.USE_IN_MEMORY_DB = process.env.USE_IN_MEMORY_DB ?? '0';
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'pg-mem://localhost/parsing-replay';
  process.env.AUTH_SECRET = process.env.AUTH_SECRET && process.env.AUTH_SECRET !== 'development-secret'
    ? process.env.AUTH_SECRET
    : 'parsing-replay-secret';

  const file = options.requestPath ? readJson(options.requestPath) : null;
  const request = file?.request ?? file ?? {};
  const runs = normalizeRuns(options.runs, file?.runs);
  const outputDir = path.resolve(options.outputDir ?? file?.outputDir ?? path.join(__dirname, '../logs/ai-replay/parsing', timestamp()));
  fs.mkdirSync(outputDir, { recursive: true });

  const { initDb } = await import('../src/db');
  const { clearAiProviderConfigCache } = await import('../src/services/aiProviderConfigService');
  await initDb();

  const summary: Array<Record<string, unknown>> = [];
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    clearAiProviderConfigCache('ingestion_llm_extract');
    const label = run.label || [run.provider, run.model].filter(Boolean).join('-') || `run-${i + 1}`;
    const replayId = safeFilePart(options.intakeId ?? request.doc?.importJobId ?? 'parse-replay');
    const captureId = `${replayId}-${safeFilePart(label)}-${Date.now()}`;
    const startedAt = new Date().toISOString();
    try {
      let result: unknown;
      if (options.intakeId) {
        const { replayParsingIntake } = await import('../src/ai/replay/parsingReplayService');
        result = await replayParsingIntake({
          intakeId: options.intakeId,
          dryRun: options.dryRun,
          aiProvider: {
            ...(run.provider ? { provider: run.provider } : {}),
            ...(run.model ? { model: run.model } : {}),
          },
        });
      } else {
        const doc = validateDoc(request.doc);
        result = await replayJsonDoc({
          doc,
          productionItems: request.productionItems,
          run,
          captureId,
          persistCapture: options.persistCapture && !options.dryRun,
        });
      }
      const outputPath = path.join(outputDir, `${String(i + 1).padStart(2, '0')}-${safeFilePart(label)}.json`);
      fs.writeFileSync(outputPath, JSON.stringify({ run, captureId, startedAt, completedAt: new Date().toISOString(), result }, null, 2));
      summary.push({ run, captureId, ok: true, outputPath });
      process.stdout.write(`[parsing-replay] ok label=${label} output=${outputPath}\n`);
    } catch (err) {
      const outputPath = path.join(outputDir, `${String(i + 1).padStart(2, '0')}-${safeFilePart(label)}.error.json`);
      const error = err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) };
      fs.writeFileSync(outputPath, JSON.stringify({ run, captureId, startedAt, completedAt: new Date().toISOString(), error }, null, 2));
      summary.push({ run, captureId, ok: false, outputPath, error: error.message });
      process.stderr.write(`[parsing-replay] failed label=${label} output=${outputPath} error=${error.message}\n`);
    }
  }

  const summaryPath = path.join(outputDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({ intakeId: options.intakeId, requestPath: options.requestPath ? path.resolve(options.requestPath) : null, outputDir, runs: summary }, null, 2));
  process.stdout.write(`[parsing-replay] summary=${summaryPath}\n`);
  if (summary.some((run) => run.ok === false)) process.exitCode = 1;
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
