import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { tripNameToFileSlug } from '../src/utils/tripNameSlug';
import { renderSimplifiedItineraryMarkdown } from '../src/services/itineraryMarkdownRenderer';
import { computeUnmatchedDestinationAndAttractionWarnings } from '../src/services/attractionMatchWarnings';
import { validateAndRepairItineraryStructure } from '../src/services/itineraryStructureValidator';

type ReplayRun = {
  provider?: string;
  model?: string;
  label?: string;
};

type ReplayFile = {
  request?: Record<string, unknown>;
  runs?: ReplayRun[];
  outputDir?: string;
  captureRaw?: boolean;
};

type CliOptions = {
  requestPath: string | null;
  outputDir: string | null;
  runs: ReplayRun[];
  captureRaw: boolean;
  gold: boolean;
  comparePath: string | null;
  judge: boolean;
  help: boolean;
};

const usage = `Usage:
  npm --prefix server run replay:itinerary -- --request ./request.json --models openai:gpt-4o-mini,anthropic:claude-sonnet-4-5

Options:
  --request, -r <file>     JSON file containing either the service request or { "request": ..., "runs": [...] }.
                           Supported shapes: service request, API route body, compact promptRequest,
                           raw itinerary_generation capture, or a wizard-shaped input (see
                           server/scripts/wizardCliInputTypes.ts for the format + a worked example).
  --out, -o <dir>          Directory for replay result JSON files. Defaults to server/logs/ai-replay/<timestamp>.
  --models <list>          Comma-separated provider:model entries. Overrides runs in the file.
  --provider <provider>    Single provider override, used with --model.
  --model <model>          Single model override, used with --provider.
  --raw-capture            Sets ENABLE_RAW_AI_CAPTURE=1 for this replay process.
  --gold                   Run a high-effort local reference generation (no plan-cache writes).
  --compare <gold-file>    Compare the generated production result with a stored gold JSON file.
  --judge                  Reserved opt-in judge hook; never runs unless explicitly implemented.
  --help                   Show this help.

COST WARNING: --gold runs a high-effort generation (stronger model, doubled max_tokens, forced
chunking, full ~20-item shortlist, and all itinerary plan-cache reads/writes disabled). It is
intentionally expensive per trip and MUST NEVER be run in a per-PR CI job. Use it on-demand
locally, or from a slow nightly/scheduled job over a fixed fixture set — never on every pull
request. See server/prompts/itinerary-improvements-coding-plan.md Phase 8 for the full policy.
`;

const loadEnv = () => {
  const rootDir = path.resolve(__dirname, '../..');
  for (const relativePath of ['.env', '.local_env', 'server/.env', 'server/.local_env']) {
    const envPath = path.join(rootDir, relativePath);
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
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

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    requestPath: null,
    outputDir: null,
    runs: [],
    captureRaw: false,
    gold: false,
    comparePath: null,
    judge: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--request' || arg === '-r') {
      options.requestPath = next ?? null;
      i += 1;
    } else if (arg === '--out' || arg === '-o') {
      options.outputDir = next ?? null;
      i += 1;
    } else if (arg === '--models') {
      options.runs = String(next ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map(parseProviderModel);
      i += 1;
    } else if (arg === '--provider') {
      options.runs[0] = { ...(options.runs[0] ?? {}), provider: next };
      i += 1;
    } else if (arg === '--model') {
      options.runs[0] = { ...(options.runs[0] ?? {}), model: next };
      i += 1;
    } else if (arg === '--raw-capture') {
      options.captureRaw = true;
    } else if (arg === '--gold') {
      options.gold = true;
    } else if (arg === '--compare') {
      options.comparePath = next ?? null;
      i += 1;
    } else if (arg === '--judge') {
      options.judge = true;
    } else if (!options.requestPath && !arg.startsWith('-')) {
      options.requestPath = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
};

const readJson = (filePath: string): ReplayFile | Record<string, unknown> => {
  const absolute = resolveReplayPath(filePath);
  if (!fs.existsSync(absolute)) {
    const serverRelative = path.resolve(__dirname, '..', filePath);
    if (fs.existsSync(serverRelative)) {
      return JSON.parse(fs.readFileSync(serverRelative, 'utf8'));
    }
  }
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
};

const timestamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

const safeFilePart = (value: string): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100) || 'run';

const normalizeRuns = (cliRuns: ReplayRun[], fileRuns: ReplayRun[] | undefined, requestProvider: unknown): ReplayRun[] => {
  const selected = cliRuns.length ? cliRuns : Array.isArray(fileRuns) ? fileRuns : [];
  if (selected.length) return selected;
  const provider = requestProvider && typeof requestProvider === 'object' ? (requestProvider as ReplayRun) : null;
  return [{ provider: provider?.provider, model: provider?.model, label: 'default' }];
};

const extractJsonBetween = (text: string, startMarker: string, endMarker: RegExp): Record<string, unknown> | null => {
  const start = text.indexOf(startMarker);
  if (start < 0) return null;
  const afterStart = text.slice(start + startMarker.length);
  const end = afterStart.search(endMarker);
  const candidate = (end >= 0 ? afterStart.slice(0, end) : afterStart).trim();
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
};

const extractPromptRequestFromCapture = (value: Record<string, unknown>): Record<string, unknown> | null => {
  const stages = (value.payload as any)?.stages;
  if (!Array.isArray(stages)) return null;
  const normStage = stages.find((stage) => stage?.stage === 'p0_norm') ?? stages[0];
  const userPrompt = typeof normStage?.userPrompt === 'string' ? normStage.userPrompt : '';
  return extractJsonBetween(userPrompt, 'INPUT (JSON):', /\n\s*\n(?:RULES:|OUTPUT|$)/);
};

export const compactPromptRequestToServiceRequest = (promptRequest: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> => ({
  destinations: Array.isArray(promptRequest.d) ? promptRequest.d : [],
  days: Number(promptRequest.dur ?? (source.payload as any)?.days ?? 1),
  budgetMin: Number(promptRequest.budgetMin ?? 0),
  budgetMax: Number(promptRequest.budgetMax ?? promptRequest.rs ?? 0),
  mustSeeAttractions: Array.isArray(promptRequest.ms) ? promptRequest.ms : [],
  departureAirport: typeof promptRequest.s === 'string' ? promptRequest.s : undefined,
  tripStyle: typeof promptRequest.tripStyle === 'string' ? promptRequest.tripStyle : undefined,
  promptTraits: {
    tt: promptRequest.tt && typeof promptRequest.tt === 'object' ? promptRequest.tt : undefined,
    ut: promptRequest.ut && typeof promptRequest.ut === 'object' ? promptRequest.ut : undefined,
  },
  groupTraits: [],
  tripStartDate: typeof promptRequest.sd === 'string' ? promptRequest.sd : null,
  tripEndDate: typeof promptRequest.ed === 'string' ? promptRequest.ed : null,
  userId: typeof source.userId === 'string' ? source.userId : undefined,
  tripIdSeed: typeof source.jobId === 'string' ? source.jobId : typeof source.captureId === 'string' ? source.captureId : undefined,
});

export const apiRouteBodyToServiceRequest = (request: Record<string, unknown>): Record<string, unknown> => {
  const locations = Array.isArray(request.locations)
    ? request.locations.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  const country = String(request.country ?? '').trim();
  return {
    destinations: locations.length ? locations : country ? [country] : [],
    days: request.days,
    budgetMin: request.budgetMin,
    budgetMax: request.budgetMax,
    mustSeeAttractions: Array.isArray(request.mustSeeAttractions) ? request.mustSeeAttractions : [],
    departureAirport: request.departureAirport,
    tripStyle: request.tripStyle,
    promptTraits: {
      tt: request.tt && typeof request.tt === 'object' ? request.tt : undefined,
      ut: request.ut && typeof request.ut === 'object' ? request.ut : undefined,
    },
    groupTraits: [],
    tripIdSeed: request.tripId,
  };
};

// Wizard-shaped input (see wizardCliInputTypes.ts) — a human-friendly file
// format mirroring the create-trip wizard's AI-generation fields, distinct
// from the wire/internal shapes the other converters handle.
export const wizardCliInputToServiceRequest = (input: Record<string, unknown>): Record<string, unknown> => ({
  destinations: Array.isArray(input.destinations)
    ? input.destinations.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [],
  days: input.days,
  budgetMin: input.budgetMin,
  budgetMax: input.budgetMax,
  mustSeeAttractions: Array.isArray(input.mustSeeAttractions) ? input.mustSeeAttractions : [],
  departureAirport: input.departureAirport,
  tripStyle: input.tripStyle,
  promptTraits: {
    tt: (input.promptTraits as any)?.tt && typeof (input.promptTraits as any).tt === 'object' ? (input.promptTraits as any).tt : undefined,
    ut: (input.promptTraits as any)?.ut && typeof (input.promptTraits as any).ut === 'object' ? (input.promptTraits as any).ut : undefined,
  },
  groupTraits: [],
  tripStartDate: typeof input.tripStartDate === 'string' ? input.tripStartDate : null,
  tripEndDate: typeof input.tripEndDate === 'string' ? input.tripEndDate : null,
  tripIdSeed: typeof input.tripName === 'string' ? input.tripName : undefined,
});

export const resolveReplayRequest = (file: ReplayFile | Record<string, unknown>): Record<string, unknown> => {
  const wrapper = file as ReplayFile;
  const candidate = (wrapper.request && typeof wrapper.request === 'object' ? wrapper.request : file) as Record<string, unknown>;
  // Must be checked before the plain-service-request passthrough below,
  // since a wizard-shaped input also has a top-level `destinations` array —
  // without this check first it would fall through unconverted and silently
  // lose its `tripName`-driven file naming.
  if (typeof candidate.tripName === 'string' && Array.isArray(candidate.destinations)) {
    return wizardCliInputToServiceRequest(candidate);
  }
  if (Array.isArray(candidate.destinations)) return candidate;
  if ((candidate.result as any)?.promptRequest) {
    return compactPromptRequestToServiceRequest((candidate.result as any).promptRequest, candidate);
  }
  if ((candidate.promptRequest as any)?.$ === 'req1') {
    return compactPromptRequestToServiceRequest(candidate.promptRequest as Record<string, unknown>, candidate);
  }
  if ((candidate as any).$ === 'req1') {
    return compactPromptRequestToServiceRequest(candidate, candidate);
  }
  if (Array.isArray(candidate.locations) || typeof candidate.country === 'string') {
    return apiRouteBodyToServiceRequest(candidate);
  }
  if (candidate.featureKey === 'itinerary_generation') {
    const promptRequest = extractPromptRequestFromCapture(candidate);
    if (promptRequest) return compactPromptRequestToServiceRequest(promptRequest, candidate);
  }
  return candidate;
};

export const validateRequest = (request: Record<string, unknown>) => {
  const destinations = request.destinations;
  if (!Array.isArray(destinations) || destinations.length === 0) {
    throw new Error(
      'request.destinations must be a non-empty string array. Supported inputs are: service request, API route body, compact promptRequest, wizard-shaped input, or raw itinerary_generation capture with raw stage prompts.'
    );
  }
  const days = Number(request.days);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('request.days must be a positive number');
  }
  const budgetMin = Number(request.budgetMin);
  const budgetMax = Number(request.budgetMax);
  if (!Number.isFinite(budgetMin) || !Number.isFinite(budgetMax) || budgetMin < 0 || budgetMax < budgetMin) {
    throw new Error('request.budgetMin and request.budgetMax must be a valid range');
  }
};

// Warns (without failing or substituting) when a destination or must-see
// attraction in the request doesn't confidently match the same CSV-backed
// dataset the app's own autocomplete uses. Applies to all resolved request
// shapes, not just the wizard-shaped input. Delegates the actual matching
// to a shared service also used by the live generation path.
export const warnOnUnmatchedDestinationsAndAttractions = async (request: Record<string, unknown>): Promise<void> => {
  const warnings = await computeUnmatchedDestinationAndAttractionWarnings(request);
  for (const warning of warnings) {
    process.stderr.write(`[itinerary-replay] warning: ${warning}\n`);
  }
};

type ItineraryComparison = {
  goldItemCount: number;
  productionItemCount: number;
  itemCountDelta: number;
  goldDays: number;
  productionDays: number;
  attractionCoveragePercent: number | null;
  goldStructuralIssues: string[];
  productionStructuralIssues: string[];
};

const extractItineraryShape = (value: unknown): { dy: any[] } | null => {
  const days = Array.isArray((value as any)?.itinerary?.dy)
    ? (value as any).itinerary.dy
    : Array.isArray((value as any)?.result?.itinerary?.dy)
      ? (value as any).result.itinerary.dy
      : null;
  return days ? { dy: days } : null;
};

const itineraryItemNames = (value: unknown): string[] => {
  const days = extractItineraryShape(value)?.dy ?? [];
  return days.flatMap((day: any) => Array.isArray(day?.it) ? day.it.map((item: any) => String(item?.[2] ?? '').trim()).filter(Boolean) : []);
};

// Reuses the same structural checker the live pipeline runs after every generation
// (itineraryStructureValidator.ts) rather than re-implementing diff/validity logic here, per the
// coding plan's Phase 8 requirement. Any issue it reports (capped days, repaired meal codes,
// verified-closure removals, etc.) on either side is surfaced as-is, not re-derived.
const structuralIssuesFor = (value: unknown): string[] => {
  const itinerary = extractItineraryShape(value);
  if (!itinerary) return [];
  return validateAndRepairItineraryStructure({ itinerary }).issues;
};

export const compareItineraryRuns = (gold: unknown, production: unknown): ItineraryComparison => {
  const goldItems = itineraryItemNames(gold);
  const productionItems = itineraryItemNames(production);
  const productionNormalized = new Set(productionItems.map((item) => item.toLowerCase()));
  const matched = goldItems.filter((item) => productionNormalized.has(item.toLowerCase())).length;
  const goldDays = extractItineraryShape(gold)?.dy.length ?? 0;
  const productionDays = extractItineraryShape(production)?.dy.length ?? 0;
  return {
    goldItemCount: goldItems.length,
    productionItemCount: productionItems.length,
    itemCountDelta: productionItems.length - goldItems.length,
    goldDays,
    productionDays,
    attractionCoveragePercent: goldItems.length ? Math.round((matched / goldItems.length) * 10000) / 100 : null,
    goldStructuralIssues: structuralIssuesFor(gold),
    productionStructuralIssues: structuralIssuesFor(production),
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.requestPath) {
    process.stdout.write(usage);
    process.exit(options.help ? 0 : 1);
  }

  loadEnv();
  const file = readJson(options.requestPath);
  const wrapper = file as ReplayFile;
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';
  process.env.E2E_MODE = process.env.E2E_MODE ?? '1';
  process.env.DB_PROVIDER = process.env.DB_PROVIDER ?? 'memory';
  process.env.USE_IN_MEMORY_DB = process.env.USE_IN_MEMORY_DB ?? '1';
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'pg-mem://localhost/itinerary-replay';
  process.env.AUTH_SECRET = process.env.AUTH_SECRET && process.env.AUTH_SECRET !== 'development-secret'
    ? process.env.AUTH_SECRET
    : 'itinerary-replay-secret';
  if (options.captureRaw || wrapper.captureRaw) process.env.ENABLE_RAW_AI_CAPTURE = '1';
  if (options.gold) {
    process.env.ITINERARY_GOLD_MODE = '1';
    process.env.ITINERARY_GOLD_TOKEN_MULTIPLIER = '2';
  }
  if (options.judge) {
    process.stderr.write('[itinerary-replay] --judge is opt-in and requires an explicit judge implementation; deterministic comparison only.\n');
  }

  const requestCandidate = (wrapper.request && typeof wrapper.request === 'object' ? wrapper.request : file) as Record<string, unknown>;
  const request = resolveReplayRequest(file);
  validateRequest(request);
  await warnOnUnmatchedDestinationsAndAttractions(request);
  const runs = options.gold
    ? [{ provider: 'openai', model: 'gpt-4o', label: 'gold' }]
    : normalizeRuns(options.runs, wrapper.runs, request.aiProvider);
  const outputDir = options.outputDir || wrapper.outputDir
    ? resolveReplayPath(String(options.outputDir ?? wrapper.outputDir))
    : path.resolve(__dirname, '../logs/ai-replay', timestamp());
  fs.mkdirSync(outputDir, { recursive: true });

  // Wizard-shaped inputs get their original (pre-conversion) JSON captured
  // verbatim once per invocation, named after the trip.
  if (typeof requestCandidate.tripName === 'string') {
    const inputCapturePath = path.join(outputDir, `${tripNameToFileSlug(requestCandidate.tripName)}-input.json`);
    fs.writeFileSync(inputCapturePath, JSON.stringify(requestCandidate, null, 2));
    process.stdout.write(`[itinerary-replay] input-capture=${inputCapturePath}\n`);
  }

  const { initDb } = await import('../src/db');
  const { generateItineraryViaPromptPlan } = await import('../src/services/itineraryPromptPlanService');
  const { clearAiProviderConfigCache } = await import('../src/services/aiProviderConfigService');
  await initDb();

  const summary: Array<Record<string, unknown>> = [];
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    clearAiProviderConfigCache('itinerary_generation');
    const label = run.label || [run.provider, run.model].filter(Boolean).join('-') || `run-${i + 1}`;
    const captureId = `${safeFilePart(String(request.captureId ?? request.tripIdSeed ?? 'itinerary-replay'))}-${safeFilePart(label)}-${Date.now()}`;
    const startedAt = new Date().toISOString();
    try {
      const result = await generateItineraryViaPromptPlan({
        ...(request as any),
        aiProvider: {
          ...((request.aiProvider && typeof request.aiProvider === 'object') ? request.aiProvider : {}),
          ...(run.provider ? { provider: run.provider } : {}),
          ...(run.model ? { model: run.model } : {}),
        },
        captureId,
      });
      const outputPath = path.join(outputDir, `${String(i + 1).padStart(2, '0')}-${safeFilePart(label)}.json`);
      fs.writeFileSync(outputPath, JSON.stringify({
        run, mode: options.gold ? 'gold' : 'production',
        overrides: options.gold ? { strongerModel: 'gpt-4o', tokenMultiplier: 2, shortlistTarget: 20, cacheWritesDisabled: true } : undefined,
        captureId, startedAt, completedAt: new Date().toISOString(), result,
      }, null, 2));
      if (options.gold) {
        const tripSpecId = safeFilePart(
          typeof requestCandidate.tripIdSeed === 'string'
            ? requestCandidate.tripIdSeed
            : typeof requestCandidate.tripName === 'string' ? requestCandidate.tripName : label
        );
        const goldFixtureDir = path.resolve(__dirname, '../__fixtures__/gold');
        fs.mkdirSync(goldFixtureDir, { recursive: true });
        const goldFixturePath = path.join(goldFixtureDir, `${tripSpecId}.json`);
        fs.copyFileSync(outputPath, goldFixturePath);
        process.stdout.write(`[itinerary-replay] gold-fixture=${goldFixturePath}\n`);
      }

      const tripName = typeof requestCandidate.tripName === 'string' ? requestCandidate.tripName : label;
      const markdownPath = path.join(outputDir, `${String(i + 1).padStart(2, '0')}-${safeFilePart(label)}.md`);
      fs.writeFileSync(markdownPath, renderSimplifiedItineraryMarkdown(result, tripName));

      summary.push({ run, captureId, ok: true, outputPath, markdownPath, totalTokens: result.tokenUsage.totalTokens });
      process.stdout.write(`[itinerary-replay] ok label=${label} output=${outputPath} markdown=${markdownPath}\n`);
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
      process.stderr.write(`[itinerary-replay] failed label=${label} output=${outputPath} error=${error.message}\n`);
    }
  }

  if (options.comparePath && summary.some((run) => run.ok)) {
    const gold = readJson(options.comparePath);
    const productionOutput = summary.find((run) => run.ok)?.outputPath;
    if (productionOutput) {
      const production = JSON.parse(fs.readFileSync(String(productionOutput), 'utf8'));
      const comparison = compareItineraryRuns(gold, production);
      const comparisonPath = path.join(outputDir, 'comparison.json');
      fs.writeFileSync(comparisonPath, JSON.stringify(comparison, null, 2));
      process.stdout.write(`[itinerary-replay] comparison=${comparisonPath}\n`);
    }
  }

  const summaryPath = path.join(outputDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({ requestPath: resolveReplayPath(options.requestPath), outputDir, runs: summary }, null, 2));
  process.stdout.write(`[itinerary-replay] summary=${summaryPath}\n`);
  if (summary.some((run) => run.ok === false)) process.exitCode = 1;
};

// Only run when executed directly (`node`/`tsx` on this file), not when
// imported by tests for its exported pure functions.
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
