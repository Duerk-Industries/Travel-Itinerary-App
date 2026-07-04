import { getApiBudgetProviderConfig, getApiLimitsConfig, normalizeApiLimitKeyPart } from '../config/apiLimits';
import {
  getApiCostCounter,
  incrementApiCostCounter,
  listApiCostCounters,
  resetApiCostCounters as resetStoredApiCostCounters,
} from '../db';
import { logInfo } from '../logger';

const MICROS_PER_USD = 1_000_000;

const formatMonthWindowKey = (now = new Date()): string => {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const toUsdMicros = (usd: number): number => Math.round(usd * MICROS_PER_USD);
const TRACKED_OPENAI_MODELS = ['gpt-4o-mini'] as const;

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
