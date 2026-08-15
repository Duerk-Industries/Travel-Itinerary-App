/**
 * Real LLM-backed extractor for travel document ingestion.
 *
 * - Runs in local dev and production; skipped only in tests / in-memory-DB fixture runs
 *   (see `canHandle`), and further gated per-user by tier entitlements (`canRun`, passed
 *   in by the caller) and by whether an API key is configured for the active provider.
 * - Calls the active AI provider to extract structured travel fields
 * - When extraction succeeds, auto-generates regex patterns and stores them
 *   as a learned source parser for future use (parser learning)
 */

import { INGESTION_CONFIDENCE_REVIEW_READY } from '../config';
import type { ExtractionConfig, ExtractionResult, NormalizedDocument, ParsedItemCandidate, ParsedItemType } from '../contracts';
import type { ExtractionStrategy } from './index';
import { detectSource, detectItemType } from './sourceDetection';
import { upsertLearnedParser } from '../shared/repository';
import { createAiCallContext } from '../../ai/registry/correlation';
import { resolveProvider } from '../../ai/registry/aiProviderRegistry';
import type { AiCallContext } from '../../ai/types/aiChat';
import {
  getActiveAiProvider,
  getConfiguredProviderApiKey,
  getProviderApiKeyEnvVar,
} from '../../services/aiProviderConfigService';
import { getEnvFlag } from '../../env';
import { logInfo, logError } from '../../logger';
import { estimateAiCostMicros } from '../../apis/providerBudgeting';

const INGESTION_LLM_MAX_INPUT_CHARS = 6000;
const INGESTION_DEBUG_LLM_MAX_CHARS = 4000;
const INGESTION_LLM_CALLER = 'INGESTION_LLM_EXTRACT';
const INGESTION_LLM_FEATURE_KEY = 'ingestion_llm_extract';
const INGESTION_LLM_MODEL = 'gpt-4o-mini';
const debugSnippet = (value: string): string =>
  value.length <= INGESTION_DEBUG_LLM_MAX_CHARS
    ? value
    : `${value.slice(0, INGESTION_DEBUG_LLM_MAX_CHARS)}... [truncated ${value.length - INGESTION_DEBUG_LLM_MAX_CHARS} chars]`;
const SYSTEM_PROMPT = `You extract structured travel booking data from email/PDF text.
Return ONLY a JSON object (no markdown fences). Use null for missing values.

{
  "itemType": "flight" | "hotel" | "car_rental" | "tour_activity" | "restaurant_reservation" | "event_ticket" | "rail" | "ferry_bus_transfer" | "generic_note",
  "items": [
    {
      "providerVendor": "company or venue name",
      "confirmationNumber": "booking reference code",
      "travelers": ["name1", "name2"],
      "totalCost": number or null,
      "currency": "USD" | "EUR" | "GBP" | etc,

      "name": "property/venue/activity name",
      "guestName": "primary guest or booker name",
      "address": "full address or location",

      "checkInDate": "YYYY-MM-DD (hotels)",
      "checkOutDate": "YYYY-MM-DD (hotels)",
      "rooms": number or null,
      "breakfastIncluded": boolean or null,
      "freeCancelBy": "YYYY-MM-DD or null",
      "paid": boolean or null,

      "airline": "airline name (flights/rail)",
      "flightNumber": "e.g. B6187 (flights/rail)",
      "departureAirportCode": "IATA code (flights)",
      "arrivalAirportCode": "IATA code (flights)",
      "departureDate": "YYYY-MM-DD (flights/rail/ferry)",
      "departureTime": "HH:MM am/pm (flights/rail/ferry)",
      "arrivalTime": "HH:MM am/pm (flights/rail/ferry)",
      "duration": "e.g. 6h 27m",

      "pickupLocation": "car rental pickup",
      "dropoffLocation": "car rental dropoff",
      "vehicleType": "car type or class",

      "activityDate": "YYYY-MM-DD (activities/events/restaurants)",
      "activityTime": "HH:MM am/pm (activities/events/restaurants)",
      "eventVenue": "venue name (events)",
      "partySize": number or null,
      "mealType": "breakfast/lunch/dinner (restaurants)"
    }
  ]
}

Rules:
- Extract ALL flight legs or separate bookings as separate items in the array
- Dates must be YYYY-MM-DD format
- Cost should be a number without currency symbols
- Return the actual item type, not generic_note, when possible
- For activities/tours: use activityDate and activityTime for when it happens
- For restaurants: include partySize and mealType if available`;

const estimatedCostUsd = (provider: string, model: string | null, promptTokens: number, completionTokens: number): number => {
  const micros = model ? estimateAiCostMicros({ provider, model, promptTokens, completionTokens }) : null;
  if (micros != null) return micros / 1_000_000;
  return promptTokens * 0.00000015 + completionTokens * 0.0000006;
};

const emptyResult = (config: ExtractionConfig, strategyName: string): ExtractionResult => ({
  parsedItems: [],
  usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'llm', modelName: null, estimatedCostUsd: 0 },
  metadata: { logicVersion: config.logicVersion, extractedAt: new Date().toISOString(), strategyName, status: 'skipped' },
});

const skippedResult = (
  config: ExtractionConfig,
  strategyName: string,
  skipReason: string,
  usageMetrics?: Partial<ExtractionResult['usageMetrics']>
): ExtractionResult => ({
  parsedItems: [],
  usageMetrics: {
    tokensIn: usageMetrics?.tokensIn ?? 0,
    tokensOut: usageMetrics?.tokensOut ?? 0,
    provider: usageMetrics?.provider ?? 'llm',
    modelName: usageMetrics?.modelName ?? null,
    estimatedCostUsd: usageMetrics?.estimatedCostUsd ?? 0,
  },
  metadata: {
    logicVersion: config.logicVersion,
    extractedAt: new Date().toISOString(),
    strategyName,
    status: 'skipped',
    skipReason,
  },
});

const getMonthWindowKey = (): string => {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

export class LlmExtractor implements ExtractionStrategy {
  constructor(
    readonly strategyName: string,
    readonly minConfidenceToSkipNext: number,
    private readonly canRun: (config: ExtractionConfig) => boolean
  ) {}

  canHandle(_doc: NormalizedDocument): boolean {
    // Runs in local dev and production alike; never during tests (test mocks interfere with
    // real provider calls, and the in-memory DB is only used for test/local fixture runs).
    // Tier/feature-flag gating happens via `canRun` (allowSmallLlm/allowLargeLlm from the
    // caller's entitlements) and the `ingestion_llm_extract` API-key/feature-flag check inside
    // `extract()`, so this is just an environment safety guard, not a production on/off switch.
    return process.env.NODE_ENV !== 'test' && process.env.USE_IN_MEMORY_DB !== '1';
  }

  async extract(doc: NormalizedDocument, config: ExtractionConfig): Promise<ExtractionResult> {
    if (!this.canRun(config)) return skippedResult(config, this.strategyName, 'disabled-by-config');

    const inputText = doc.normalizedText.slice(0, INGESTION_LLM_MAX_INPUT_CHARS);

    let responseText: string | null = null;
    let promptTokens = 0;
    let completionTokens = 0;
    let providerId = 'llm';
    let modelName = INGESTION_LLM_MODEL;

    try {
      const activeConfig = await getActiveAiProvider(INGESTION_LLM_FEATURE_KEY);
      const providerOverride = config.aiProvider?.provider;
      const modelOverride = config.aiProvider?.model;
      const selectedProvider = providerOverride || activeConfig.provider;
      const apiKey = getConfiguredProviderApiKey(selectedProvider);
      if (!apiKey) {
        logInfo(
          `[ingestion][llm] No ${getProviderApiKeyEnvVar(selectedProvider)} configured for provider=${selectedProvider}, skipping LLM extraction`
        );
        return skippedResult(config, this.strategyName, 'missing-api-key');
      }
      const provider = await resolveProvider(INGESTION_LLM_FEATURE_KEY, INGESTION_LLM_CALLER, providerOverride);
      providerId = provider.id;
      modelName = modelOverride || (providerOverride ? provider.supportedModels[0] : activeConfig.model) || provider.supportedModels[0] || INGESTION_LLM_MODEL;
      const ctx = createAiCallContext({
        correlationId: config.correlationId,
        jobId: config.importJobId,
        featureKey: INGESTION_LLM_FEATURE_KEY,
        userId: config.userId,
        provider: provider.id,
        model: modelName,
        callerId: INGESTION_LLM_CALLER,
      }) as AiCallContext & {
        apiKey?: string;
        usageAccountingEnabled?: boolean;
        usageWindowKey?: string | null;
        usageMetadata?: Record<string, unknown>;
      };
      ctx.apiKey = apiKey;
      ctx.usageAccountingEnabled = true;
      ctx.usageWindowKey = getMonthWindowKey();
      ctx.usageMetadata = {
        pipeline: 'ingestion_llm_extract',
        strategyName: this.strategyName,
      };
      const response = await provider.chatCompletion(
        {
          model: modelName,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: inputText },
          ],
          temperature: 0.1,
          max_tokens: 1200,
        },
        ctx
      );

      responseText = response?.choices?.[0]?.message?.content ?? null;
      promptTokens = response?.usage?.prompt_tokens ?? 0;
      completionTokens = response?.usage?.completion_tokens ?? 0;
    } catch (err: any) {
      logError(`[ingestion][llm] provider call failed: ${err.message ?? err}`);
      return skippedResult(config, this.strategyName, 'provider-call-failed', { provider: providerId, modelName });
    }

    if (!responseText) {
      return skippedResult(config, this.strategyName, 'empty-provider-response', {
        tokensIn: promptTokens,
        tokensOut: completionTokens,
        provider: providerId,
        modelName,
        estimatedCostUsd: estimatedCostUsd(providerId, modelName, promptTokens, completionTokens),
      });
    }
    if (getEnvFlag('INGESTION_DEBUG_LLM')) {
      logInfo(`[ingestion][debug][llm] raw response source=${detectSource(doc) ?? 'unknown'} itemType=${detectItemType(doc.normalizedText)} payload=${JSON.stringify(debugSnippet(responseText))}`);
    }

    // Parse the JSON response
    let parsed: any;
    try {
      // Strip markdown fences if present
      const cleaned = responseText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      parsed = JSON.parse(cleaned);
      if (getEnvFlag('INGESTION_DEBUG_LLM')) {
        logInfo(`[ingestion][debug][llm] parsed response source=${detectSource(doc) ?? 'unknown'} payload=${JSON.stringify(parsed)}`);
      }
    } catch {
      logError(`[ingestion][llm] Failed to parse LLM JSON response`);
      return skippedResult(config, this.strategyName, 'invalid-json-response', {
        tokensIn: promptTokens,
        tokensOut: completionTokens,
        provider: providerId,
        modelName,
        estimatedCostUsd: estimatedCostUsd(providerId, modelName, promptTokens, completionTokens),
      });
    }

    const llmItems: any[] = Array.isArray(parsed.items) ? parsed.items : [parsed];
    if (!llmItems.length) {
      return skippedResult(config, this.strategyName, 'empty-items-array', {
        tokensIn: promptTokens,
        tokensOut: completionTokens,
        provider: providerId,
        modelName,
        estimatedCostUsd: estimatedCostUsd(providerId, modelName, promptTokens, completionTokens),
      });
    }

    const itemType = (parsed.itemType ?? detectItemType(doc.normalizedText)) as ParsedItemType;

    // Lazy-import to avoid circular dependency
    const { createCandidateExported } = require('./index');

    const candidates: ParsedItemCandidate[] = [];
    for (const item of llmItems) {
      const extractedFields: Record<string, unknown> = { ...item, llmExtracted: true };

      // Compute per-item date overrides — covers all item types
      let startDate: string | undefined;
      let endDate: string | undefined;

      const tryDateIso = (v: any): string | undefined => {
        if (!v) return undefined;
        const d = new Date(`${v}T12:00:00Z`);
        return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
      };

      if (itemType === 'hotel') {
        startDate = tryDateIso(item.checkInDate);
        endDate = tryDateIso(item.checkOutDate);
      } else if (['flight', 'rail', 'ferry_bus_transfer'].includes(itemType)) {
        startDate = tryDateIso(item.departureDate);
      } else {
        // Activities, restaurants, events, car rentals, generic
        startDate = tryDateIso(item.activityDate ?? item.departureDate ?? item.checkInDate);
        endDate = tryDateIso(item.checkOutDate);
      }

      const travelers: string[] = Array.isArray(item.travelers) ? item.travelers : [];
      if (item.guestName && !travelers.length) travelers.push(item.guestName);

      // Compute confidence based on how many critical fields were extracted
      const criticalFieldsByType: Record<string, string[]> = {
        hotel: ['name', 'checkInDate', 'checkOutDate', 'totalCost'],
        flight: ['departureAirportCode', 'arrivalAirportCode', 'departureDate', 'flightNumber'],
        rail: ['departureDate', 'departureTime', 'providerVendor'],
        ferry_bus_transfer: ['departureDate', 'departureTime', 'providerVendor'],
        car_rental: ['providerVendor', 'pickupLocation', 'totalCost'],
        tour_activity: ['name', 'activityDate', 'totalCost'],
        restaurant_reservation: ['name', 'activityDate', 'partySize'],
        event_ticket: ['name', 'activityDate', 'eventVenue'],
        generic_note: ['name'],
      };
      const criticalFields = criticalFieldsByType[itemType] ?? ['name', 'totalCost'];
      const criticalMatched = criticalFields.filter((f) => item[f] != null).length;
      const confidence = Math.min(0.93, 0.65 + (criticalMatched / Math.max(criticalFields.length, 1)) * 0.28);

      candidates.push(
        await createCandidateExported({
          itemType,
          doc,
          providerVendor: item.providerVendor ?? item.airline ?? item.name ?? null,
          confirmationNumber: item.confirmationNumber ?? null,
          extractedFields,
          confidenceScore: confidence,
          startDateTimeUtcOverride: startDate,
          endDateTimeUtcOverride: endDate,
          travelerNamesOverride: travelers.length ? travelers : undefined,
          departureCodeOverride: item.departureAirportCode ?? undefined,
          arrivalCodeOverride: item.arrivalAirportCode ?? undefined,
        })
      );
    }

    const maxConfidence = Math.max(...candidates.map((c) => c.confidenceScore), 0);
    const estimatedCost = (promptTokens * 0.00000015 + completionTokens * 0.0000006);

    logInfo(`[ingestion][llm] extracted ${candidates.length} items, maxConfidence=${maxConfidence.toFixed(2)}, tokens=${promptTokens}+${completionTokens}, cost=$${estimatedCost.toFixed(4)}`);

    // When we reach the LLM fallback for a recognized source, always try to learn or
    // refresh a source-specific parser from the result. The learned parser is stored
    // separately and does not mutate the generic parser behavior.
    const sourceKey = detectSource(doc);
    if (sourceKey) {
      logInfo(`[ingestion][llm] fallback used for source=${sourceKey}, attempting parser update`);
      try {
        await learnParserFromLlmResult(sourceKey, itemType, llmItems[0], doc.normalizedText, maxConfidence);
      } catch (err: any) {
        logError(`[ingestion][llm] Parser learning failed: ${err.message ?? err}`);
      }
    }

    return {
      parsedItems: candidates,
      usageMetrics: {
        tokensIn: promptTokens,
        tokensOut: completionTokens,
        provider: providerId,
        modelName,
        estimatedCostUsd: estimatedCost,
      },
      metadata: {
        logicVersion: config.logicVersion,
        extractedAt: new Date().toISOString(),
        strategyName: this.strategyName,
        status: 'ok',
      },
    };
  }
}

// ── Parser Learning ─────────────────────────────────────────────────────────

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Given an LLM-extracted field value, find it in the normalized text and build
 * a regex pattern with a context anchor that captures the value.
 */
const buildPatternForField = (
  fieldName: string,
  fieldValue: string,
  normalizedText: string
): string | null => {
  if (!fieldValue || typeof fieldValue !== 'string') return null;

  const text = normalizedText;
  const idx = text.toLowerCase().indexOf(fieldValue.toLowerCase());
  if (idx < 0) return null;

  // Look for the nearest label/anchor before the value
  const before = text.slice(Math.max(0, idx - 80), idx);

  // Try to find a label-like anchor (e.g., "Check-in", "Guest name", "Location", "Total Price")
  const labelMatch = before.match(/([\w][\w\s-]{1,30}?)\s*[:=-]?\s*$/);
  if (labelMatch) {
    const anchor = escapeRegex(labelMatch[1].trim());
    // Use a capture pattern that grabs until end of line
    return `${anchor}\\s*[:=-]?\\s*([^\\n]+)`;
  }

  // Try line-start anchor (value appears at start of a line or after newline)
  const lineStart = before.match(/\n\s*$/);
  if (lineStart) {
    // Value is on its own line — use a broader field-name based pattern
    return null; // Can't anchor safely
  }

  return null;
};

/**
 * After a successful LLM extraction, generate regex patterns from the extracted
 * field values and store them as a learned source parser.
 */
const learnParserFromLlmResult = async (
  sourceKey: string,
  itemType: string,
  llmItem: Record<string, any>,
  normalizedText: string,
  confidence: number
): Promise<void> => {
  // Skip internal/metadata fields that shouldn't become regex patterns
  const SKIP_FIELDS = new Set([
    'itemType', 'travelers', 'llmExtracted', 'breakfastIncluded', 'paid',
    'learnedSourceKey', 'currency',
  ]);

  const patterns: Record<string, string> = {};

  // Learn patterns for every non-null string/number field the LLM returned
  for (const [fieldName, value] of Object.entries(llmItem)) {
    if (value == null) continue;
    if (SKIP_FIELDS.has(fieldName)) continue;
    // Only learn from string or number values (not booleans or arrays)
    if (typeof value !== 'string' && typeof value !== 'number') continue;

    const pattern = buildPatternForField(fieldName, String(value), normalizedText);
    if (pattern) {
      // Validate the pattern compiles and actually captures the expected value
      try {
        const regex = new RegExp(pattern, 'i');
        const testMatch = normalizedText.match(regex);
        if (testMatch?.[1]?.trim()) {
          patterns[fieldName] = pattern;
        }
      } catch {
        // Invalid regex — skip
      }
    }
  }

  const learnedCount = Object.keys(patterns).length;
  if (learnedCount < 2) {
    logInfo(`[ingestion][learn] Only ${learnedCount} patterns learned for ${sourceKey}/${itemType}, skipping save`);
    if (getEnvFlag('INGESTION_DEBUG_LLM')) {
      logInfo(`[ingestion][debug][learn] source=${sourceKey} itemType=${itemType} candidate_patterns=${JSON.stringify(patterns)}`);
    }
    return;
  }

  logInfo(`[ingestion][learn] Saving ${learnedCount} patterns for ${sourceKey}/${itemType}`);
  if (getEnvFlag('INGESTION_DEBUG_LLM')) {
    logInfo(`[ingestion][debug][learn] source=${sourceKey} itemType=${itemType} patterns=${JSON.stringify(patterns)}`);
  }
  await upsertLearnedParser(sourceKey, itemType, patterns, confidence);
};
