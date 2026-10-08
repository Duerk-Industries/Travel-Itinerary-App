import { randomUUID } from 'node:crypto';
import {
  findApiRequestPricingUsd,
  getApiBudgetProviderConfig,
  getApiLimitsConfig,
  normalizeApiLimitKeyPart,
} from '../config/apiLimits';
import {
  getApiCostCounter,
  incrementApiCostCounter,
  insertProviderCostLedgerEntry,
  listApiCostCounters,
  resetApiCostCounters as resetStoredApiCostCounters,
} from '../db';
import { logError, logInfo } from '../logger';
import { incrementMetric } from '../metrics';
import { getRequestContext } from '../requestContext';
import type { ProviderCostLedgerEntry } from '../types';

export { getApiRequestPricingUsd } from '../config/apiLimits';

const MICROS_PER_USD = 1_000_000;

const formatMonthWindowKey = (now = new Date()): string => {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const toUsdMicros = (usd: number): number => Math.round(usd * MICROS_PER_USD);
const TRACKED_OPENAI_MODELS = ['gpt-4o-mini', 'gpt-5.6-luna'] as const;

export const getApiBudgetWindowKey = (now = new Date()): string => formatMonthWindowKey(now);

export const estimateAiCostMicros = (params: {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}): number | null => {
  const providerConfig = getApiBudgetProviderConfig(params.provider);
  const modelPricing = providerConfig?.models?.[normalizeApiLimitKeyPart(params.model)];
  if (!modelPricing) return null;
  return Math.round(
    params.promptTokens * modelPricing.inputCostPer1MTokensUsd +
      params.completionTokens * modelPricing.outputCostPer1MTokensUsd
  );
};

export const estimateOpenAiCostMicros = (params: {
  model: string;
  promptTokens: number;
  completionTokens: number;
}): number | null =>
  estimateAiCostMicros({
    provider: 'OPENAI',
    ...params,
  });

export const recordApiCost = async (params: {
  provider: string;
  windowKey?: string;
  amountMicros: number;
}): Promise<number> => {
  const provider = normalizeApiLimitKeyPart(params.provider);
  const windowKey = params.windowKey ?? getApiBudgetWindowKey();
  const amountMicros = Math.max(0, Math.round(params.amountMicros));
  if (amountMicros <= 0) {
    return getApiCostCounter(provider, windowKey);
  }
  return incrementApiCostCounter(provider, windowKey, amountMicros);
};

// USD-per-request providers (SerpAPI, Wikimedia, Google Routes, etc.) have no token counts to
// price against, so cost is just the configured flat rate for that provider.
export const estimateRequestCostMicros = (costPerRequestUsd: number): number =>
  Math.round(Math.max(0, Number(costPerRequestUsd) || 0) * MICROS_PER_USD);

// ── Trusted settlement (analytics Phase 3) ──────────────────────────────────
// Every billable provider attempt is settled exactly once here: one
// provider_cost_ledger row per attempt ID (attribution, units, price version,
// cost status), then the monthly api_cost_counters budget row. A replayed
// attempt ID is ignored, so retries and duplicate code paths cannot double
// count. recordApiCost stays as the counter-only primitive for synthetic
// budget buckets (e.g. SHADOW_PARSE) whose spend is already in the ledger
// under the real provider.

export type ProviderAttemptAttribution = {
  /** Initiating account. Falls back to the request context; 'system'/'anonymous'/empty → system. */
  userId?: string | null;
  tripId?: string | null;
  featureKey?: string | null;
  caller?: string | null;
};

export type SettleProviderAttemptInput = ProviderAttemptAttribution & {
  provider: string;
  /** Stable ID such as the provider response ID; random when the provider gives none. */
  attemptId?: string | null;
  unitType: 'tokens' | 'request';
  model?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  requestUnits?: number;
  /** Per-request price override (USD); otherwise read from api-limits.yaml requestPricing. */
  costPerRequestUsd?: number | null;
  cacheStatus?: ProviderCostLedgerEntry['cacheStatus'];
  outcome?: ProviderCostLedgerEntry['outcome'];
  windowKey?: string;
};

export type SettleProviderAttemptResult = {
  attemptId: string;
  duplicate: boolean;
  costStatus: ProviderCostLedgerEntry['costStatus'];
  estimatedCostMicros: number | null;
  /** Budget counter total after this settlement, when a positive cost was counted. */
  counterTotalMicros?: number;
};

const NON_ACCOUNT_USER_IDS = new Set(['system', 'anonymous', 'unknown']);

const resolveAttributedUserId = (explicit: string | null | undefined): string | null => {
  const candidate = (explicit ?? getRequestContext()?.userId ?? '').trim();
  return candidate && !NON_ACCOUNT_USER_IDS.has(candidate) ? candidate : null;
};

const safeCount = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

const priceTokens = (provider: string, model: string | null, promptTokens: number, completionTokens: number) => {
  if (!model) return { micros: null, priceVersion: null };
  const pricing = getApiBudgetProviderConfig(provider)?.models?.[normalizeApiLimitKeyPart(model)];
  if (!pricing) return { micros: null, priceVersion: null };
  return {
    micros: Math.round(promptTokens * pricing.inputCostPer1MTokensUsd + completionTokens * pricing.outputCostPer1MTokensUsd),
    priceVersion: `${provider}/${model}@${pricing.inputCostPer1MTokensUsd}/${pricing.outputCostPer1MTokensUsd}`,
  };
};

export const settleProviderAttempt = async (input: SettleProviderAttemptInput): Promise<SettleProviderAttemptResult> => {
  const provider = normalizeApiLimitKeyPart(input.provider);
  const windowKey = input.windowKey ?? getApiBudgetWindowKey();
  const attemptId = input.attemptId?.trim() ? `${provider}:${input.attemptId.trim()}` : `${provider}:${randomUUID()}`;
  const outcome = input.outcome ?? 'success';
  const promptTokens = safeCount(input.promptTokens);
  const completionTokens = safeCount(input.completionTokens);
  const requestUnits = input.unitType === 'request' ? Math.max(1, safeCount(input.requestUnits ?? 1)) : 0;
  const model = input.model?.trim() || null;

  let estimatedCostMicros: number | null;
  let priceVersion: string | null = null;
  if (input.unitType === 'tokens') {
    if (outcome === 'failed' && promptTokens + completionTokens === 0) {
      estimatedCostMicros = 0; // no usage reported: providers do not bill these
    } else {
      const priced = priceTokens(provider, model, promptTokens, completionTokens);
      estimatedCostMicros = priced.micros;
      priceVersion = priced.priceVersion;
    }
  } else {
    const price = input.costPerRequestUsd ?? findApiRequestPricingUsd(provider);
    estimatedCostMicros = price == null ? null : estimateRequestCostMicros(price) * requestUnits;
    priceVersion = price == null ? null : `${provider}@${price}/request`;
  }
  const costStatus: ProviderCostLedgerEntry['costStatus'] =
    estimatedCostMicros == null ? 'unknown' : estimatedCostMicros > 0 ? 'estimated' : 'not_billable';

  const userId = resolveAttributedUserId(input.userId);
  const entry: ProviderCostLedgerEntry = {
    attemptId,
    occurredAt: new Date().toISOString(),
    windowKey,
    provider,
    model,
    caller: input.caller ?? null,
    featureKey: input.featureKey ?? input.caller ?? null,
    userId,
    tripId: userId ? input.tripId ?? null : null,
    attribution: userId ? 'user' : 'system',
    unitType: input.unitType,
    promptTokens,
    completionTokens,
    requestUnits,
    cacheStatus: input.cacheStatus ?? 'none',
    outcome,
    costStatus,
    estimatedCostMicros,
    priceVersion,
  };

  let inserted = true;
  try {
    inserted = await insertProviderCostLedgerEntry(entry);
  } catch (err) {
    // Never silently understate spend: keep counting the budget and surface the gap.
    incrementMetric('cost_ledger.settlement_failed', { provider });
    logError('[cost-ledger] failed to settle provider attempt', { provider, attemptId, error: err instanceof Error ? err.message : String(err) });
  }
  if (!inserted) {
    incrementMetric('cost_ledger.duplicate_attempt', { provider });
    return { attemptId, duplicate: true, costStatus, estimatedCostMicros };
  }
  incrementMetric('cost_ledger.settled', { provider, costStatus });
  if ((estimatedCostMicros ?? 0) > 0) {
    const counterTotalMicros = await recordApiCost({ provider, windowKey, amountMicros: estimatedCostMicros ?? 0 });
    return { attemptId, duplicate: false, costStatus, estimatedCostMicros, counterTotalMicros };
  }
  return { attemptId, duplicate: false, costStatus, estimatedCostMicros };
};

// Settles one request-priced call. Providers explicitly priced at $0 in api-limits.yaml are
// skipped entirely so free APIs (weather, airports, ...) add no ledger or counter writes;
// providers missing from requestPricing are recorded with an unknown cost, never as free.
export const recordProviderRequestCost = async (params: ProviderAttemptAttribution & {
  provider: string;
  costPerRequestUsd?: number;
  windowKey?: string;
}): Promise<number | undefined> => {
  const provider = normalizeApiLimitKeyPart(params.provider);
  const price = params.costPerRequestUsd ?? findApiRequestPricingUsd(provider);
  if (price === 0) return undefined;
  const result = await settleProviderAttempt({
    ...params,
    provider,
    unitType: 'request',
    requestUnits: 1,
    costPerRequestUsd: price,
  });
  return result.counterTotalMicros;
};

export const getCurrentApiBudgetStatus = async (provider: string): Promise<{
  provider: string;
  windowKey: string;
  monthlyBudgetUsd: number | null;
  alertThresholdPercent: number | null;
  estimatedSpendMicrosUsd: number;
  estimatedSpendUsd: number;
  budgetUsagePercent: number | null;
  isOverBudget: boolean;
}> => {
  const normalizedProvider = normalizeApiLimitKeyPart(provider);
  const providerConfig = getApiBudgetProviderConfig(normalizedProvider);
  const windowKey = getApiBudgetWindowKey();
  const estimatedSpendMicrosUsd = await getApiCostCounter(normalizedProvider, windowKey);
  const monthlyBudgetUsd = providerConfig?.monthlyBudgetUsd ?? null;
  const monthlyBudgetMicrosUsd = monthlyBudgetUsd == null ? null : toUsdMicros(monthlyBudgetUsd);
  const budgetUsagePercent =
    monthlyBudgetMicrosUsd && monthlyBudgetMicrosUsd > 0
      ? (estimatedSpendMicrosUsd / monthlyBudgetMicrosUsd) * 100
      : null;

  return {
    provider: normalizedProvider,
    windowKey,
    monthlyBudgetUsd,
    alertThresholdPercent: providerConfig?.alertThresholdPercent ?? null,
    estimatedSpendMicrosUsd,
    estimatedSpendUsd: estimatedSpendMicrosUsd / MICROS_PER_USD,
    budgetUsagePercent,
    isOverBudget: monthlyBudgetMicrosUsd != null && estimatedSpendMicrosUsd >= monthlyBudgetMicrosUsd,
  };
};

export const getApiBudgetSummary = async (): Promise<
  Array<{
    provider: string;
    windowKey: string;
    monthlyBudgetUsd: number | null;
    alertThresholdPercent: number | null;
    estimatedSpendMicrosUsd: number;
    estimatedSpendUsd: number;
    budgetUsagePercent: number | null;
    isOverBudget: boolean;
  }>
> => {
  const configProviders = Object.keys(getApiLimitsConfig().budgeting ?? {});
  const counters = await listApiCostCounters();
  const countersByProvider = new Map<string, Map<string, number>>();
  for (const counter of counters) {
    const byWindow = countersByProvider.get(counter.provider) ?? new Map<string, number>();
    byWindow.set(counter.windowKey, counter.amountMicros);
    countersByProvider.set(counter.provider, byWindow);
  }

  const windowKey = getApiBudgetWindowKey();
  return configProviders.map((provider) => {
    const providerConfig = getApiBudgetProviderConfig(provider);
    const estimatedSpendMicrosUsd = countersByProvider.get(provider)?.get(windowKey) ?? 0;
    const monthlyBudgetUsd = providerConfig?.monthlyBudgetUsd ?? null;
    const monthlyBudgetMicrosUsd = monthlyBudgetUsd == null ? null : toUsdMicros(monthlyBudgetUsd);
    const budgetUsagePercent =
      monthlyBudgetMicrosUsd && monthlyBudgetMicrosUsd > 0
        ? (estimatedSpendMicrosUsd / monthlyBudgetMicrosUsd) * 100
        : null;
    return {
      provider,
      windowKey,
      monthlyBudgetUsd,
      alertThresholdPercent: providerConfig?.alertThresholdPercent ?? null,
      estimatedSpendMicrosUsd,
      estimatedSpendUsd: estimatedSpendMicrosUsd / MICROS_PER_USD,
      budgetUsagePercent,
      isOverBudget: monthlyBudgetMicrosUsd != null && estimatedSpendMicrosUsd >= monthlyBudgetMicrosUsd,
    };
  });
};

export const resetApiBudgetSummaries = async (): Promise<void> => {
  await resetStoredApiCostCounters();
};

export const logMissingApiPricingConfigurationWarnings = (): void => {
  const openAiBudgeting = getApiBudgetProviderConfig('OPENAI');
  for (const model of TRACKED_OPENAI_MODELS) {
    const normalizedModel = normalizeApiLimitKeyPart(model);
    if (!openAiBudgeting?.models?.[normalizedModel]) {
      logInfo(
        `[startup] Warning: missing OPENAI pricing config for model=${normalizedModel} in api-limits.yaml budgeting.OPENAI.models`
      );
    }
  }

  for (const [provider, budgeting] of Object.entries(getApiLimitsConfig().budgeting ?? {})) {
    if (budgeting.monthlyBudgetUsd != null && Object.keys(budgeting.models ?? {}).length === 0) {
      logInfo(
        `[startup] Warning: provider=${provider} has a monthly budget configured but no model pricing entries in api-limits.yaml`
      );
    }
  }
};
