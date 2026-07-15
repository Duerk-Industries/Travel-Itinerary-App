import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createHash } from 'crypto';
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
  filePath: string | null;
  dirPath: string | null;
  outputDir: string | null;
  runs: ReplayRun[];
  bothPaths: boolean;
  dryRun: boolean;
  persistCapture: boolean;
  help: boolean;
};

type ParserComparisonOutput = {
  label: string;
  result: ExtractionResult;
};

type ConsensusFieldAgreement = {
  itemIndex: number;
  itemType: string;
  fieldName: string;
  value: unknown;
  agreementCount: number;
  agreeingModels: string[];
};

type ParserUpdateGap = {
  itemIndex: number;
  itemType: string;
  fieldName: string;
  consensusValue: unknown;
  nonLlmStatus: 'missing' | 'different';
  nonLlmValue?: unknown;
  agreementCount: number;
  agreeingModels: string[];
};

const usage = `Usage:
  npm --prefix server run replay:parsing -- --intake <intakeId> --models openai:gpt-4o-mini,anthropic:claude-sonnet-4-5
  npm --prefix server run replay:parsing -- --request ./parse-request.json --models gemini:gemini-2.5-flash
  npm --prefix server run replay:parsing -- --file "./test_inputs/transfers/Boston to Los Angeles.pdf" --both-paths --models openai:gpt-4o-mini
  npm --prefix server run replay:parsing -- --dir ./test_inputs/transfers --llm openai:gpt-4o-mini --llm anthropic:claude-sonnet-4-5
  npm --prefix server run replay:parsing -- --file ./booking.pdf --llm openai:gpt-4o-mini --llm anthropic:claude-sonnet-4-5

Options:
  --intake <id>            Replay an existing import job payload by intake/import job id.
  --request, -r <file>     JSON file containing { "doc": NormalizedDocument, "productionItems": [...] }.
  --file <file>            Normalize a local source file, then run non-LLM extraction and LLM extraction.
  --dir <dir>              Parse every supported PDF/image file in a local input directory.
  --both-paths             With --file, run both existing non-LLM and LLM parser paths. This is the default for --file.
  --out, -o <dir>          Directory for replay result JSON files. Defaults to server/logs/ai-replay/parsing/<timestamp>.
  --models <list>          Comma-separated provider:model entries. Overrides runs in the file.
  --llms <list>            Alias for --models.
  --llm <provider:model>   Add one LLM parser run. May be repeated.
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

export const resolveReplayPath = (value: string): string => {
  if (path.isAbsolute(value)) return path.normalize(value);
  const normalized = value.replace(/\\/g, '/');
  const rootDir = path.resolve(__dirname, '../..');
  if (normalized === 'server' || normalized.startsWith('server/')) {
    return path.resolve(rootDir, normalized);
  }
  return path.resolve(value);
};

const parseProviderModel = (value: string): ReplayRun => {
  const [provider, ...modelParts] = value.split(':');
  return {
    provider: provider?.trim() || undefined,
    model: modelParts.join(':').trim() || undefined,
  };
};

const appendProviderModelRuns = (runs: ReplayRun[], value: string | undefined): ReplayRun[] => [
  ...runs,
  ...String(value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean).map(parseProviderModel),
];

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    intakeId: null,
    requestPath: null,
    filePath: null,
    dirPath: null,
    outputDir: null,
    runs: [],
    bothPaths: false,
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
    } else if (arg === '--file') {
      options.filePath = next ?? null;
      options.bothPaths = true;
      i += 1;
    } else if (arg === '--dir') {
      options.dirPath = next ?? null;
      i += 1;
    } else if (arg === '--out' || arg === '-o') {
      options.outputDir = next ?? null;
      i += 1;
    } else if (arg === '--models' || arg === '--llms') {
      options.runs = appendProviderModelRuns([], next);
      i += 1;
    } else if (arg === '--llm') {
      options.runs = appendProviderModelRuns(options.runs, next);
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
    } else if (arg === '--both-paths') {
      options.bothPaths = true;
    } else if (!options.requestPath && !options.intakeId && !options.filePath && !options.dirPath && !arg.startsWith('-')) {
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

const csvEscape = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const fieldValue = (item: ParsedItemCandidate | undefined, fieldName: string): unknown => {
  if (!item) return '';
  return (item.extractedFields ?? {})[fieldName];
};

export const isSkippedLlmExtraction = (result: ExtractionResult): boolean =>
  result.metadata.status === 'skipped' ||
  (
    result.parsedItems.length === 0 &&
    result.usageMetrics.tokensIn === 0 &&
    result.usageMetrics.tokensOut === 0 &&
    result.usageMetrics.provider === 'llm' &&
    result.usageMetrics.modelName == null
  );

const skippedReason = (result: ExtractionResult): string =>
  result.metadata.skipReason || 'llm-extraction-skipped';

const hasFieldValue = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== '';

const stableValue = (value: unknown): string => JSON.stringify(value ?? null);

const VALIDATION_EXCLUDED_FIELDS = new Set(['llmExtracted']);

export const buildParserComparisonCsv = (parsers: ParserComparisonOutput[]): string => {
  const fieldKeys = new Set<string>();
  const maxItemCount = Math.max(0, ...parsers.map((parser) => parser.result.parsedItems.length));

  for (let itemIndex = 0; itemIndex < maxItemCount; itemIndex += 1) {
    for (const parser of parsers) {
      const item = parser.result.parsedItems[itemIndex];
      for (const fieldName of Object.keys(item?.extractedFields ?? {})) {
        fieldKeys.add(`${itemIndex}\u001f${fieldName}`);
      }
    }
  }

  const rows: unknown[][] = [
    ['item_index', 'item_type', 'field', ...parsers.map((parser) => parser.label)],
  ];

  const sortedKeys = Array.from(fieldKeys).sort((a, b) => {
    const [aIndex, aField] = a.split('\u001f');
    const [bIndex, bField] = b.split('\u001f');
    const indexDelta = Number(aIndex) - Number(bIndex);
    return indexDelta || aField.localeCompare(bField);
  });

  for (const key of sortedKeys) {
    const [itemIndexText, fieldName] = key.split('\u001f');
    const itemIndex = Number(itemIndexText);
    const itemType = parsers.map((parser) => parser.result.parsedItems[itemIndex]?.itemType).find(Boolean) ?? '';
    rows.push([
      itemIndex + 1,
      itemType,
      fieldName,
      ...parsers.map((parser) => fieldValue(parser.result.parsedItems[itemIndex], fieldName)),
    ]);
  }

  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
};

export const buildAiConsensusValidation = (
  aiParsers: ParserComparisonOutput[],
  generatedAt = new Date().toISOString()
) => {
  const minimumAgreement = 2;
  const agreements: ConsensusFieldAgreement[] = [];
  const maxItemCount = Math.max(0, ...aiParsers.map((parser) => parser.result.parsedItems.length));

  for (let itemIndex = 0; itemIndex < maxItemCount; itemIndex += 1) {
    const fieldNames = new Set<string>();
    for (const parser of aiParsers) {
      const item = parser.result.parsedItems[itemIndex];
      for (const fieldName of Object.keys(item?.extractedFields ?? {})) {
        fieldNames.add(fieldName);
      }
    }

    for (const fieldName of Array.from(fieldNames).sort()) {
      const values = new Map<string, { value: unknown; agreeingModels: string[] }>();
      for (const parser of aiParsers) {
        const item = parser.result.parsedItems[itemIndex];
        const value = fieldValue(item, fieldName);
        if (!hasFieldValue(value)) continue;
        const key = stableValue(value);
        const entry = values.get(key) ?? { value, agreeingModels: [] };
        entry.agreeingModels.push(parser.label);
        values.set(key, entry);
      }

      for (const entry of values.values()) {
        if (entry.agreeingModels.length < minimumAgreement) continue;
        const itemType = aiParsers.map((parser) => parser.result.parsedItems[itemIndex]?.itemType).find(Boolean) ?? '';
        agreements.push({
          itemIndex: itemIndex + 1,
          itemType,
          fieldName,
          value: entry.value,
          agreementCount: entry.agreeingModels.length,
          agreeingModels: entry.agreeingModels,
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    generatedAt,
    minimumAgreement,
    aiModelCount: aiParsers.length,
    models: aiParsers.map((parser) => parser.label),
    agreementCount: agreements.length,
    agreements,
  };
};

export const buildParserUpdateValidation = (params: {
  nonLlmParser: ParserComparisonOutput;
  aiParsers: ParserComparisonOutput[];
  sourceFile?: string | null;
  generatedAt?: string;
}) => {
  const minimumAgreement = 2;
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const gaps: ParserUpdateGap[] = [];
  const maxItemCount = Math.max(0, ...params.aiParsers.map((parser) => parser.result.parsedItems.length));

  for (let itemIndex = 0; itemIndex < maxItemCount; itemIndex += 1) {
    const fieldNames = new Set<string>();
    for (const parser of params.aiParsers) {
      const item = parser.result.parsedItems[itemIndex];
      for (const fieldName of Object.keys(item?.extractedFields ?? {})) {
        if (!VALIDATION_EXCLUDED_FIELDS.has(fieldName)) fieldNames.add(fieldName);
      }
    }

    for (const fieldName of Array.from(fieldNames).sort()) {
      const values = new Map<string, { value: unknown; agreeingModels: string[] }>();
      for (const parser of params.aiParsers) {
        const item = parser.result.parsedItems[itemIndex];
        const value = fieldValue(item, fieldName);
        if (!hasFieldValue(value)) continue;
        const key = stableValue(value);
        const entry = values.get(key) ?? { value, agreeingModels: [] };
        entry.agreeingModels.push(parser.label);
        values.set(key, entry);
      }

      for (const [key, entry] of values.entries()) {
        if (entry.agreeingModels.length < minimumAgreement) continue;
        const nonLlmItem = params.nonLlmParser.result.parsedItems[itemIndex];
        const nonLlmValue = fieldValue(nonLlmItem, fieldName);
        const nonLlmHasValue = hasFieldValue(nonLlmValue);
        if (nonLlmHasValue && stableValue(nonLlmValue) === key) continue;

        const itemType =
          params.aiParsers.map((parser) => parser.result.parsedItems[itemIndex]?.itemType).find(Boolean)
          ?? nonLlmItem?.itemType
          ?? '';
        gaps.push({
          itemIndex: itemIndex + 1,
          itemType,
          fieldName,
          consensusValue: entry.value,
          nonLlmStatus: nonLlmHasValue ? 'different' : 'missing',
          ...(nonLlmHasValue ? { nonLlmValue } : {}),
          agreementCount: entry.agreeingModels.length,
          agreeingModels: entry.agreeingModels,
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    generatedAt,
    purpose: 'non_llm_parser_update_validation',
    instructions: [
      'Use this file to update the deterministic non-LLM parser for the source document.',
      'Add fields listed as missing and adjust fields listed as different when the consensus value is correct for the document.',
      'Do not remove existing non-LLM parsed fields unless a separate human review explicitly asks for removal.',
      'Each gap appears only when at least two successful AI model runs returned the same value and the non-LLM parser omitted or differed on that field.',
    ],
    sourceFile: params.sourceFile ?? null,
    minimumAgreement,
    nonLlmParser: params.nonLlmParser.label,
    aiModelCount: params.aiParsers.length,
    aiModels: params.aiParsers.map((parser) => parser.label),
    gapCount: gaps.length,
    gaps,
  };
};

const normalizeRuns = (cliRuns: ReplayRun[], fileRuns?: ReplayRun[]): ReplayRun[] => {
  const selected = cliRuns.length ? cliRuns : Array.isArray(fileRuns) ? fileRuns : [];
  return selected.length ? selected : [{ label: 'default' }];
};

const readJson = (filePath: string): ParseReplayFile => JSON.parse(fs.readFileSync(resolveReplayPath(filePath), 'utf8'));

const SUPPORTED_DIRECTORY_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);

const listSupportedInputFiles = (dirPath: string): string[] => {
  const absoluteDir = resolveReplayPath(dirPath);
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && SUPPORTED_DIRECTORY_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(absoluteDir, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
};

const inferMimeType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.html' || ext === '.htm') return 'text/html';
  if (ext === '.txt') return 'text/plain';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
};

const providerFromFilename = (filename: string): string => {
  const lower = filename.toLowerCase();
  if (lower.includes('viator')) return 'booking@t1.viator.com';
  if (lower.includes('getyourguide')) return 'do-not-reply@notification.getyourguide.com';
  if (lower.includes('guruwalk')) return 'support@guruwalk.com';
  if (lower.includes('klook')) return 'support-noreply@klook.com';
  if (lower.includes('antelope') || lower.includes('fareharbor')) return 'messages@fareharbor.com';
  if (lower.includes('ryanair')) return 'itinerary@ryanair.com';
  if (lower.includes('chase') || lower.includes('trip id') || lower.includes('boston to los angeles')) return 'donotreply@chasetravel.com';
  return 'fixtures@example.com';
};

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

const buildExtractionConfig = (doc: NormalizedDocument, run?: ReplayRun) => ({
  logicVersion: INGESTION_LOGIC_VERSION,
  allowSmallLlm: true,
  allowLargeLlm: true,
  tokenBudgetUsd: 1,
  contentHash: doc.normalizedContentHash,
  userId: doc.userId,
  importJobId: doc.importJobId,
  correlationId: doc.correlationId,
  aiProvider: {
    ...(run?.provider ? { provider: run.provider } : {}),
    ...(run?.model ? { model: run.model } : {}),
  },
});

const normalizeLocalFile = async (filePath: string): Promise<NormalizedDocument> => {
  const absolutePath = resolveReplayPath(filePath);
  const bytes = fs.readFileSync(absolutePath);
  const filename = path.basename(absolutePath);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const importJobId = `cli-file-parse-${Date.now()}`;
  const correlationId = `${importJobId}-${contentHash.slice(0, 12)}`;
  const { writeTempBytes, deleteTempBytes } = await import('../src/ingestion/shared/tempStorage');
  const { normalizeIngestionPayload } = await import('../src/ingestion/normalization');
  const ref = await writeTempBytes(filename, bytes);
  try {
    return await normalizeIngestionPayload(importJobId, {
      sourceType: 'MANUAL_UPLOAD',
      sourceId: 'cli-local-file',
      userId: 'cli-replay-user',
      externalMessageId: `local-file:${absolutePath}`,
      receivedAt: new Date().toISOString(),
      originalFilename: filename,
      mimeType: inferMimeType(absolutePath),
      contentBytesRef: ref,
      contentHash,
      metadata: { fromAddress: providerFromFilename(filename), localFilePath: absolutePath },
      correlationId,
      dryRun: true,
      virusScanStatus: 'SKIPPED',
    });
  } finally {
    await deleteTempBytes(ref);
  }
};

const runNonLlmExtraction = async (doc: NormalizedDocument): Promise<ExtractionResult> => {
  const { RegexExtractor } = await import('../src/ingestion/extraction');
  const { SourceSpecificExtractor } = await import('../src/ingestion/extraction/learnedExtractor');
  const sourceSpecific = new SourceSpecificExtractor();
  const regex = new RegexExtractor();
  const config = buildExtractionConfig(doc);
  const sourceResult = sourceSpecific.canHandle(doc) ? await sourceSpecific.extract(doc, config) : null;
  return sourceResult?.parsedItems.length ? sourceResult : regex.extract(doc, config);
};

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

const runLocalFileReplay = async (params: {
  filePath: string;
  outputDir: string;
  runs: ReplayRun[];
}): Promise<{ summary: Array<Record<string, unknown>>; failed: boolean; summaryPath: string }> => {
  const { clearAiProviderConfigCache } = await import('../src/services/aiProviderConfigService');
  const summary: Array<Record<string, unknown>> = [];
  const comparisonOutputs: ParserComparisonOutput[] = [];
  const aiConsensusOutputs: ParserComparisonOutput[] = [];
  const sourceFile = resolveReplayPath(params.filePath);

  fs.mkdirSync(params.outputDir, { recursive: true });
  const doc = await normalizeLocalFile(params.filePath);
  const normalizedPath = path.join(params.outputDir, '00-normalized-document.json');
  fs.writeFileSync(normalizedPath, JSON.stringify({ sourceFile, doc }, null, 2));
  process.stdout.write(`[parsing-replay] normalized=${normalizedPath}\n`);

  const nonLlmStartedAt = new Date().toISOString();
  try {
    const nonLlmResult = await runNonLlmExtraction(doc);
    const nonLlmPath = path.join(params.outputDir, '01-non-llm.json');
    fs.writeFileSync(nonLlmPath, JSON.stringify({
      path: 'non-llm',
      startedAt: nonLlmStartedAt,
      completedAt: new Date().toISOString(),
      result: nonLlmResult,
    }, null, 2));
    summary.push({ path: 'non-llm', ok: true, outputPath: nonLlmPath, itemCount: nonLlmResult.parsedItems.length });
    comparisonOutputs.push({ label: 'non-llm', result: nonLlmResult });
    process.stdout.write(`[parsing-replay] ok path=non-llm output=${nonLlmPath}\n`);

    for (let i = 0; i < params.runs.length; i += 1) {
      const run = params.runs[i];
      clearAiProviderConfigCache('ingestion_llm_extract');
      const label = run.label || [run.provider, run.model].filter(Boolean).join('-') || `llm-${i + 1}`;
      const captureId = `${safeFilePart(doc.importJobId)}-${safeFilePart(label)}-${Date.now()}`;
      const startedAt = new Date().toISOString();
      try {
        const { LlmExtractor } = await import('../src/ingestion/extraction/llmExtractor');
        const extractor = new LlmExtractor('CliReplayLlmExtractor', 1, () => true);
        const llmResult = await extractor.extract(doc, buildExtractionConfig(doc, run));
        const comparison = compareExtractionResults(nonLlmResult, llmResult);
        const outputPath = path.join(params.outputDir, `${String(i + 2).padStart(2, '0')}-${safeFilePart(label)}.json`);
        fs.writeFileSync(outputPath, JSON.stringify({
          path: 'llm',
          run,
          captureId,
          startedAt,
          completedAt: new Date().toISOString(),
          status: isSkippedLlmExtraction(llmResult) ? 'skipped' : 'ok',
          result: {
            llmItemCount: llmResult.parsedItems.length,
            nonLlmItemCount: nonLlmResult.parsedItems.length,
            comparison,
            llmResult,
          },
        }, null, 2));
        if (isSkippedLlmExtraction(llmResult)) {
          const reason = skippedReason(llmResult);
          summary.push({
            path: 'llm',
            run,
            captureId,
            ok: false,
            skipped: true,
            outputPath,
            itemCount: 0,
            error: `LLM extraction skipped: ${reason}`,
          });
          process.stderr.write(`[parsing-replay] skipped path=llm label=${label} output=${outputPath} reason=${reason}\n`);
        } else {
          summary.push({ path: 'llm', run, captureId, ok: true, outputPath, itemCount: llmResult.parsedItems.length });
          comparisonOutputs.push({ label, result: llmResult });
          aiConsensusOutputs.push({ label, result: llmResult });
          process.stdout.write(`[parsing-replay] ok path=llm label=${label} output=${outputPath}\n`);
        }
      } catch (err) {
        const outputPath = path.join(params.outputDir, `${String(i + 2).padStart(2, '0')}-${safeFilePart(label)}.error.json`);
        const error = err instanceof Error
          ? {
              message: err.message,
              stack: err.stack,
              originalStack: (err as any).originalStack,
              status: (err as any).status,
              responseData: (err as any).responseData,
            }
          : { message: String(err) };
        fs.writeFileSync(outputPath, JSON.stringify({ path: 'llm', run, captureId, startedAt, completedAt: new Date().toISOString(), error }, null, 2));
        summary.push({ path: 'llm', run, captureId, ok: false, outputPath, error: error.message });
        process.stderr.write(`[parsing-replay] failed path=llm label=${label} output=${outputPath} error=${error.message}\n`);
      }
    }
  } catch (err) {
    const outputPath = path.join(params.outputDir, '01-non-llm.error.json');
    const error = err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) };
    fs.writeFileSync(outputPath, JSON.stringify({ path: 'non-llm', startedAt: nonLlmStartedAt, completedAt: new Date().toISOString(), error }, null, 2));
    summary.push({ path: 'non-llm', ok: false, outputPath, error: error.message });
    process.stderr.write(`[parsing-replay] failed path=non-llm output=${outputPath} error=${error.message}\n`);
  }

  const summaryPath = path.join(params.outputDir, 'summary.json');
  const csvPath = path.join(params.outputDir, 'comparison.csv');
  if (comparisonOutputs.length) {
    fs.writeFileSync(csvPath, buildParserComparisonCsv(comparisonOutputs), 'utf8');
    process.stdout.write(`[parsing-replay] comparisonCsv=${csvPath}\n`);
  }
  const validationPath = path.join(params.outputDir, 'validation.json');
  const validation = comparisonOutputs.length
    ? buildParserUpdateValidation({
        sourceFile,
        nonLlmParser: comparisonOutputs[0],
        aiParsers: aiConsensusOutputs,
      })
    : buildParserUpdateValidation({
        sourceFile,
        nonLlmParser: { label: 'non-llm', result: buildProductionResult([], safeFilePart(path.basename(sourceFile))) },
        aiParsers: aiConsensusOutputs,
      });
  fs.writeFileSync(validationPath, JSON.stringify(validation, null, 2));
  process.stdout.write(`[parsing-replay] validationJson=${validationPath}\n`);
  fs.writeFileSync(summaryPath, JSON.stringify({
    filePath: sourceFile,
    outputDir: params.outputDir,
    comparisonCsvPath: comparisonOutputs.length ? csvPath : null,
    validationJsonPath: validationPath,
    runs: summary,
  }, null, 2));
  process.stdout.write(`[parsing-replay] summary=${summaryPath}\n`);

  return {
    summary,
    failed: summary.some((run) => run.ok === false),
    summaryPath,
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || (!options.intakeId && !options.requestPath && !options.filePath && !options.dirPath)) {
    process.stdout.write(usage);
    process.exit(options.help ? 0 : 1);
  }
  const inputCount = [options.intakeId, options.requestPath, options.filePath, options.dirPath].filter(Boolean).length;
  if (inputCount > 1) throw new Error('Use only one input mode: --intake, --request, --file, or --dir');

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
  const outputDir = options.outputDir || file?.outputDir
    ? resolveReplayPath(String(options.outputDir ?? file?.outputDir))
    : path.resolve(__dirname, '../logs/ai-replay/parsing', timestamp());
  fs.mkdirSync(outputDir, { recursive: true });

  const { initDb } = await import('../src/db');
  const { clearAiProviderConfigCache } = await import('../src/services/aiProviderConfigService');
  await initDb();

  const summary: Array<Record<string, unknown>> = [];
  const comparisonOutputs: ParserComparisonOutput[] = [];
  const aiConsensusOutputs: ParserComparisonOutput[] = [];
  if (options.filePath) {
    const result = await runLocalFileReplay({ filePath: options.filePath, outputDir, runs });
    if (result.failed) process.exitCode = 1;
    return;
  }

  if (options.dirPath) {
    const inputDir = resolveReplayPath(options.dirPath);
    const files = listSupportedInputFiles(inputDir);
    if (!files.length) throw new Error(`No supported PDF/image files found in ${inputDir}`);
    const directoryRuns: Array<Record<string, unknown>> = [];
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const filePath = files[fileIndex];
      const fileOutputDir = path.join(
        outputDir,
        `${String(fileIndex + 1).padStart(3, '0')}-${safeFilePart(path.basename(filePath, path.extname(filePath)))}`
      );
      process.stdout.write(`[parsing-replay] file=${filePath} outputDir=${fileOutputDir}\n`);
      const result = await runLocalFileReplay({ filePath, outputDir: fileOutputDir, runs });
      directoryRuns.push({
        filePath,
        outputDir: fileOutputDir,
        summaryPath: result.summaryPath,
        ok: !result.failed,
      });
    }
    const summaryPath = path.join(outputDir, 'summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify({
      inputDir,
      outputDir,
      supportedExtensions: Array.from(SUPPORTED_DIRECTORY_EXTENSIONS).sort(),
      fileCount: files.length,
      runs: directoryRuns,
    }, null, 2));
    process.stdout.write(`[parsing-replay] directorySummary=${summaryPath}\n`);
    if (directoryRuns.some((run) => run.ok === false)) process.exitCode = 1;
    return;
  }

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
        const replayResult = result as {
          productionResult: ExtractionResult;
          llmResult: ExtractionResult;
        };
        if (!comparisonOutputs.length) comparisonOutputs.push({ label: 'production', result: replayResult.productionResult });
        if (!isSkippedLlmExtraction(replayResult.llmResult)) {
          comparisonOutputs.push({ label, result: replayResult.llmResult });
          aiConsensusOutputs.push({ label, result: replayResult.llmResult });
        }
      } else {
        const doc = validateDoc(request.doc);
        result = await replayJsonDoc({
          doc,
          productionItems: request.productionItems,
          run,
          captureId,
          persistCapture: options.persistCapture && !options.dryRun,
        });
        const replayResult = result as {
          llmResult: ExtractionResult;
        };
        if (!comparisonOutputs.length) {
          comparisonOutputs.push({ label: 'production', result: buildProductionResult(request.productionItems, captureId) });
        }
        if (!isSkippedLlmExtraction(replayResult.llmResult)) {
          comparisonOutputs.push({ label, result: replayResult.llmResult });
          aiConsensusOutputs.push({ label, result: replayResult.llmResult });
        }
      }
      const outputPath = path.join(outputDir, `${String(i + 1).padStart(2, '0')}-${safeFilePart(label)}.json`);
      const llmResult = (result as { llmResult?: ExtractionResult })?.llmResult;
      const skipped = llmResult ? isSkippedLlmExtraction(llmResult) : false;
      fs.writeFileSync(outputPath, JSON.stringify({
        run,
        captureId,
        startedAt,
        completedAt: new Date().toISOString(),
        status: skipped ? 'skipped' : 'ok',
        result,
      }, null, 2));
      if (skipped) {
        const reason = llmResult ? skippedReason(llmResult) : 'llm-extraction-skipped';
        summary.push({
          run,
          captureId,
          ok: false,
          skipped: true,
          outputPath,
          error: `LLM extraction skipped: ${reason}`,
        });
        process.stderr.write(`[parsing-replay] skipped label=${label} output=${outputPath} reason=${reason}\n`);
      } else {
        summary.push({ run, captureId, ok: true, outputPath });
        process.stdout.write(`[parsing-replay] ok label=${label} output=${outputPath}\n`);
      }
    } catch (err) {
      const outputPath = path.join(outputDir, `${String(i + 1).padStart(2, '0')}-${safeFilePart(label)}.error.json`);
      const error = err instanceof Error
        ? {
            message: err.message,
            stack: err.stack,
            originalStack: (err as any).originalStack,
            status: (err as any).status,
            responseData: (err as any).responseData,
          }
        : { message: String(err) };
      fs.writeFileSync(outputPath, JSON.stringify({ run, captureId, startedAt, completedAt: new Date().toISOString(), error }, null, 2));
      summary.push({ run, captureId, ok: false, outputPath, error: error.message });
      process.stderr.write(`[parsing-replay] failed label=${label} output=${outputPath} error=${error.message}\n`);
    }
  }

  const summaryPath = path.join(outputDir, 'summary.json');
  const csvPath = path.join(outputDir, 'comparison.csv');
  if (comparisonOutputs.length) {
    fs.writeFileSync(csvPath, buildParserComparisonCsv(comparisonOutputs), 'utf8');
    process.stdout.write(`[parsing-replay] comparisonCsv=${csvPath}\n`);
  }
  const validationPath = path.join(outputDir, 'validation.json');
  const validation = comparisonOutputs.length
    ? buildParserUpdateValidation({
        sourceFile: options.intakeId ?? (options.requestPath ? resolveReplayPath(options.requestPath) : null),
        nonLlmParser: comparisonOutputs[0],
        aiParsers: aiConsensusOutputs,
      })
    : buildParserUpdateValidation({
        sourceFile: options.intakeId ?? (options.requestPath ? resolveReplayPath(options.requestPath) : null),
        nonLlmParser: { label: 'production', result: buildProductionResult([], 'parse-replay') },
        aiParsers: aiConsensusOutputs,
      });
  fs.writeFileSync(validationPath, JSON.stringify(validation, null, 2));
  process.stdout.write(`[parsing-replay] validationJson=${validationPath}\n`);
  fs.writeFileSync(summaryPath, JSON.stringify({
    intakeId: options.intakeId,
    requestPath: options.requestPath ? resolveReplayPath(options.requestPath) : null,
    outputDir,
    comparisonCsvPath: comparisonOutputs.length ? csvPath : null,
    validationJsonPath: validationPath,
    runs: summary,
  }, null, 2));
  process.stdout.write(`[parsing-replay] summary=${summaryPath}\n`);
  if (summary.some((run) => run.ok === false)) process.exitCode = 1;
};

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
