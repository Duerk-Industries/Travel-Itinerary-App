/**
 * Itinerary cache corpus prepopulation (design doc §11).
 *
 * Reactive miss-driven authoring alone gives every early user a degraded experience in the
 * destinations that matter most. This job authors LocationProfiles + ActivityBlocks ahead of
 * demand for a small, explicit, admin-supplied list of locations, so the corpus doesn't have to
 * be discovered one cache miss at a time.
 *
 * Deliberately NOT the full corpus_tools.py authoring workflow from the design doc (human
 * review, `audit`/`coverage`/`promote` gates, calibration against a hand-authored reference
 * corpus). This is the "real author adapter [that] belongs in the server/worker, where feature
 * flags, authentication, reserveApiUsageOrThrow, token budgets, cost recording, timeouts, and
 * audited persistence are unavoidable chokepoints" (§11) — every block it writes is tagged
 * `source: 'llm_draft'` and `last_verified: null`, never `curated`/`partner`, so downstream
 * tooling and human review can tell it apart from anything actually vetted.
 */
import { z } from 'zod';
import { ActivityBlockSchema, LocationProfileSchema, type ActivityBlock, type LocationProfile } from '../schemas/itineraryCacheSchemas';
import { isFeatureEnabled } from './entitlementService';
import { getActiveAiProvider, getConfiguredProviderApiKey } from './aiProviderConfigService';
import { resolveProvider } from '../ai/registry/aiProviderRegistry';
import { createAiCallContext } from '../ai/registry/correlation';
import type { AiCallContext } from '../ai/types/aiChat';
import { reserveApiUsageOrThrow, ApiLimitExceededError } from '../apis/usageLimiter';
import { recordProviderRequestCost } from '../apis/providerBudgeting';
import { getAdminSetting, upsertItineraryCacheBlock, upsertItineraryCacheLocationProfile } from '../db';
import { logError, logInfo } from '../logger';

// Doubles as both the entitlement feature-flag key (fail-closed gate on running this at all)
// and the AI-provider-config feature key (see adminRoutes.ts's AI_FEATURE_KEYS — admin-selectable
// LLM for authoring, same mechanism as itinerary_generation / ingestion_llm_extract).
export const PREPOPULATE_FEATURE_KEY = 'itinerary_cache_prepopulation';
const PREPOPULATE_CALLER = 'CORPUS_WRITE';
const PREPOPULATE_STORAGE_PROVIDER = 'ITINERARY_CACHE_STORAGE';

// Bounded per §11 ("finite per-run job count/concurrency/deadline"). Kept small and synchronous
// (no queue/worker infra) — an admin who wants more locations covered calls this endpoint again;
// that's a much smaller thing to build and reason about than a durable job queue, and matches how
// this feature will actually be used (occasional, supervised, low-volume authoring runs).
export const MAX_LOCATIONS_PER_RUN = 5;
export const MAX_BLOCKS_PER_LOCATION = 9; // "nine spanning blocks unlock far more signatures than four in one perfect group"
const JOB_WALL_CLOCK_DEADLINE_MS = 4 * 60 * 1000;

export type PrepopulateLocationInput = {
  locationId: string;
  name: string;
  locationType: LocationProfile['location_type'];
  countryCode?: string | null;
  timezone: string;
  demandWeight?: number;
};

/**
 * Pure, offline, no-I/O planning step — the in-process equivalent of the design doc's
 * `corpus_tools.py plan --demand demand.json`. Ranks by demand weight (ties broken by
 * locationId for determinism), dedupes, and caps to what one run is allowed to touch.
 */
export const buildPrepopulateManifest = (
  locations: PrepopulateLocationInput[],
  maxLocations: number = MAX_LOCATIONS_PER_RUN
): PrepopulateLocationInput[] => {
  const cap = Math.max(1, Math.min(MAX_LOCATIONS_PER_RUN, Math.floor(maxLocations) || MAX_LOCATIONS_PER_RUN));
  const byLocationId = new Map<string, PrepopulateLocationInput>();
  for (const location of locations) {
    const locationId = String(location.locationId ?? '').trim();
    if (!locationId) continue;
    // Last one wins on duplicate ids — matches "existing DB values are never silently
    // shadowed by an earlier, stale caller entry" behavior used elsewhere in admin inputs.
    byLocationId.set(locationId, { ...location, locationId });
  }
  return Array.from(byLocationId.values())
    .sort((a, b) => (b.demandWeight ?? 0) - (a.demandWeight ?? 0) || a.locationId.localeCompare(b.locationId))
    .slice(0, cap);
};

export type PrepopulateAuthorOutput = {
  profile: unknown;
  blocks: unknown[];
  promptTokens: number;
  completionTokens: number;
  provider: string;
  model: string;
};

/**
 * Injectable so tests can supply a fake author instead of mocking the entire
 * resolveProvider/chatCompletion chain — mirrors `extractCandidates`'s optional `strategies`
 * parameter elsewhere in this codebase.
 */
export type PrepopulateAuthor = (input: {
  location: PrepopulateLocationInput;
  maxBlocks: number;
}) => Promise<PrepopulateAuthorOutput>;

const AUTHOR_SYSTEM_PROMPT = `You author structured travel-destination content for a trip-planning corpus.
Return ONLY a JSON object (no markdown fences) shaped exactly like this:

{
  "locationProfile": {
    "location_id": "<given>",
    "name": "<given>",
    "location_type": "<given>",
    "country_code": "two-letter code or null",
    "timezone": "<given>",
    "zones": [
      {
        "zone_id": "z_slug",
        "name": "string",
        "name_local": "string or null",
        "centroid": [lat, lng] or null,
        "traversal": "walk" | "transit" | "drive" | "mixed",
        "terrain_note": "string or null",
        "adjacency": [ { "zone_id": "z_other", "minutes": number, "mode": "walk"|"transit"|"tram"|"metro"|"bus"|"drive"|"ferry"|"other" } ]
      }
    ],
    "season_windows": [ { "label": "peak", "months": [6,7,8], "crowd_factor": 1.0 } ],
    "local_rhythm": { "typical_dinner_start": "HH:MM or null", "midday_closure": "string or null", "market_mornings": ["saturday"], "common_closure_day": "monday" or null },
    "default_day_template_id": null
  },
  "blocks": [
    {
      "block_id": "blk_slug",
      "location_id": "<given>",
      "zone_id": "must match a zone_id above",
      "role": "anchor" | "supporting" | "filler" | "meal" | "rest" | "contingency",
      "category": "string, e.g. museum, hike, viewpoint, market",
      "title": "string",
      "name_local": "string or null",
      "name_script": "string or null",
      "copy": { "teaser": "one sentence", "body": "2-4 sentences", "insider_tip": "one concrete tip", "etiquette": "string or null", "priority_signal": "dont_skip" | "most_visitors_miss" | "optional" },
      "timing": { "optimal_arrival": "string or null", "hard_deadline": "string or null", "time_box": "string or null", "after_dark_value": boolean },
      "cost_band": { "currency": "USD", "low": number, "high": number, "note": "string or null" },
      "duration_minutes": { "typical": number, "min": number, "max": number },
      "energy_cost": integer 1-5,
      "interest_weights": { "outdoors": 1-10, "adventure": 1-10, "culture": 1-10, "food": 1-10, "nightlife": 1-10, "relaxing": 1-10, "photography": 1-10, "authentic_local": 1-10, "iconic_landmarks": 1-10 }
    }
  ]
}

Rules:
- Author one block per interest dimension the location can plausibly support before adding a second block in the same dimension — spanning coverage matters more than depth.
- Every block's zone_id must reference a zone you defined in locationProfile.zones.
- interest_weights must discriminate: give the block's strongest 2-3 dimensions high scores (7-10) and everything else low (1-3). Do not give every dimension a middling score.
- Never invent operating hours, prices, or availability you are not confident about — use round, clearly-approximate cost bands instead and omit anything you're unsure of.
- Do not include fields not listed above.`;

const buildAuthorUserPrompt = (location: PrepopulateLocationInput, maxBlocks: number): string => JSON.stringify({
  location_id: location.locationId,
  name: location.name,
  location_type: location.locationType,
  country_code: location.countryCode ?? null,
  timezone: location.timezone,
  max_blocks: maxBlocks,
});

/** The real author adapter: an LLM call gated by every standard admission-path chokepoint. */
export const defaultLlmPrepopulateAuthor: PrepopulateAuthor = async ({ location, maxBlocks }) => {
  const activeConfig = await getActiveAiProvider(PREPOPULATE_FEATURE_KEY);
  const apiKey = getConfiguredProviderApiKey(activeConfig.provider);
  if (!apiKey) {
    throw new Error(`No API key configured for provider=${activeConfig.provider} (feature=${PREPOPULATE_FEATURE_KEY})`);
  }
  const provider = await resolveProvider(PREPOPULATE_FEATURE_KEY, PREPOPULATE_CALLER);
  const model = activeConfig.model || provider.supportedModels[0];
  const ctx = createAiCallContext({
    featureKey: PREPOPULATE_FEATURE_KEY,
    userId: 'system',
    provider: provider.id,
    model,
    callerId: PREPOPULATE_CALLER,
  }) as AiCallContext & { apiKey?: string; usageAccountingEnabled?: boolean; usageWindowKey?: string | null };
  ctx.apiKey = apiKey;
  ctx.usageAccountingEnabled = false; // corpus authoring is platform work, not a per-user quota

  const response = await provider.chatCompletion(
    {
      model,
      messages: [
        { role: 'system', content: AUTHOR_SYSTEM_PROMPT },
        { role: 'user', content: buildAuthorUserPrompt(location, maxBlocks) },
      ],
      temperature: 0.4,
      max_tokens: 4000,
    },
    ctx
  );

  const responseText = response?.choices?.[0]?.message?.content ?? '';
  const cleaned = responseText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Author response was not valid JSON');
  }

  return {
    profile: parsed.locationProfile,
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
    promptTokens: response?.usage?.prompt_tokens ?? 0,
    completionTokens: response?.usage?.completion_tokens ?? 0,
    provider: provider.id,
    model,
  };
};

export type PrepopulateLocationResult = {
  locationId: string;
  status: 'authored' | 'skipped' | 'error';
  blocksAuthored: number;
  blocksRejected: number;
  profileAuthored: boolean;
  error?: string;
};

export type PrepopulateJobResult = {
  enabled: boolean;
  releaseId: string | null;
  results: PrepopulateLocationResult[];
};

/**
 * Forces every author-produced block into the shape the corpus is allowed to trust from an
 * unreviewed source, regardless of what the model claimed: draft provenance and no
 * verification date. Human/authoring-tool promotion (§11 `promote`) is what upgrades a block
 * past this, not the author call itself.
 */
const withDraftProvenance = (block: unknown): unknown => {
  if (!block || typeof block !== 'object') return block;
  return { ...(block as Record<string, unknown>), source: 'llm_draft', last_verified: null };
};

export const runItineraryCachePrepopulateJob = async (params: {
  locations: PrepopulateLocationInput[];
  maxLocations?: number;
  maxBlocksPerLocation?: number;
  author?: PrepopulateAuthor;
}): Promise<PrepopulateJobResult> => {
  const enabled = await isFeatureEnabled(PREPOPULATE_FEATURE_KEY).catch(() => false);
  if (!enabled) {
    return { enabled: false, releaseId: null, results: [] };
  }

  const releaseRow = await getAdminSetting('ACTIVE_CORPUS_RELEASE_ID');
  const releaseId = releaseRow?.value ? String(releaseRow.value).trim() : '';
  if (!releaseId) {
    logInfo('[itinerary-cache-prepopulate] no ACTIVE_CORPUS_RELEASE_ID configured; refusing to run');
    return { enabled: true, releaseId: null, results: [] };
  }

  const maxBlocks = Math.max(1, Math.min(MAX_BLOCKS_PER_LOCATION, Math.floor(params.maxBlocksPerLocation ?? MAX_BLOCKS_PER_LOCATION) || MAX_BLOCKS_PER_LOCATION));
  const manifest = buildPrepopulateManifest(params.locations, params.maxLocations ?? MAX_LOCATIONS_PER_RUN);
  const author = params.author ?? defaultLlmPrepopulateAuthor;
  const deadlineAt = Date.now() + JOB_WALL_CLOCK_DEADLINE_MS;
  const results: PrepopulateLocationResult[] = [];

  for (const location of manifest) {
    if (Date.now() > deadlineAt) {
      results.push({ locationId: location.locationId, status: 'skipped', blocksAuthored: 0, blocksRejected: 0, profileAuthored: false, error: 'deadline_exceeded' });
      continue;
    }

    try {
      await reserveApiUsageOrThrow({ provider: PREPOPULATE_STORAGE_PROVIDER, caller: PREPOPULATE_CALLER, units: 1, requireConfiguredLimit: true });
    } catch (err) {
      const message = err instanceof ApiLimitExceededError ? err.message : `usage-limit-check-failed: ${err instanceof Error ? err.message : String(err)}`;
      results.push({ locationId: location.locationId, status: 'skipped', blocksAuthored: 0, blocksRejected: 0, profileAuthored: false, error: message });
      continue;
    }

    try {
      const authored = await author({ location, maxBlocks });
      await recordProviderRequestCost({ provider: PREPOPULATE_STORAGE_PROVIDER, costPerRequestUsd: 0 });

      const profileResult = LocationProfileSchema.safeParse(authored.profile);
      let profileAuthored = false;
      if (profileResult.success) {
        await upsertItineraryCacheLocationProfile(profileResult.data, releaseId);
        profileAuthored = true;
      } else {
        logError(`[itinerary-cache-prepopulate] rejected LocationProfile for ${location.locationId}: ${profileResult.error.message}`);
      }

      const boundedBlocks = authored.blocks.slice(0, maxBlocks).map(withDraftProvenance);
      let blocksAuthored = 0;
      let blocksRejected = 0;
      for (const candidate of boundedBlocks) {
        const blockResult = ActivityBlockSchema.safeParse(candidate);
        if (!blockResult.success) {
          blocksRejected += 1;
          logError(`[itinerary-cache-prepopulate] rejected ActivityBlock for ${location.locationId}: ${blockResult.error.message}`);
          continue;
        }
        await upsertItineraryCacheBlock(blockResult.data, releaseId);
        blocksAuthored += 1;
      }

      results.push({
        locationId: location.locationId,
        status: blocksAuthored > 0 || profileAuthored ? 'authored' : 'error',
        blocksAuthored,
        blocksRejected,
        profileAuthored,
        ...(blocksAuthored === 0 && !profileAuthored ? { error: 'author returned nothing schema-valid' } : {}),
      });
    } catch (err) {
      logError(`[itinerary-cache-prepopulate] location ${location.locationId} failed`, err);
      results.push({
        locationId: location.locationId,
        status: 'error',
        blocksAuthored: 0,
        blocksRejected: 0,
        profileAuthored: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { enabled: true, releaseId, results };
};

// Exported for direct unit testing of request-shape validation without standing up the full job.
export const PrepopulateLocationInputSchema = z.object({
  locationId: z.string().min(1).max(160),
  name: z.string().min(1).max(160),
  locationType: z.enum(['city', 'hiking_region', 'national_park', 'coastal', 'beach', 'road_trip_corridor', 'multi_city_circuit']),
  countryCode: z.string().length(2).nullable().optional(),
  timezone: z.string().min(1).max(80),
  demandWeight: z.number().min(0).max(1_000_000).optional(),
});
