import fs from 'fs';
import path from 'path';
import { parse, stringify } from 'yaml';
import { logError } from '../logger';

export type LimitWindow = 'hour' | 'day';

export type ProviderLimits = {
  window?: LimitWindow;
  windowHours?: number;
  overall?: number;
  callers: Record<string, number>;
};

export type ProviderModelPricing = {
  inputCostPer1MTokensUsd: number;
  outputCostPer1MTokensUsd: number;
};

export type ProviderBudgeting = {
  monthlyBudgetUsd?: number;
  alertThresholdPercent?: number;
  models: Record<string, ProviderModelPricing>;
};

export type ApiLimitsConfig = {
  providers: Record<string, ProviderLimits>;
  budgeting: Record<string, ProviderBudgeting>;
  caching: Record<string, Record<string, number>>;
};

type RawProviderLimits = {
  window?: unknown;
  windowHours?: unknown;
  overall?: unknown;
  callers?: Record<string, unknown>;
};

type RawProviderModelPricing = {
  inputCostPer1MTokensUsd?: unknown;
  outputCostPer1MTokensUsd?: unknown;
};

type RawProviderBudgeting = {
  monthlyBudgetUsd?: unknown;
  alertThresholdPercent?: unknown;
  models?: Record<string, RawProviderModelPricing>;
};

type RawApiLimitsConfig = {
  providers?: Record<string, RawProviderLimits>;
  budgeting?: Record<string, RawProviderBudgeting>;
  caching?: Record<string, Record<string, unknown>>;
};

const CONFIG_FILENAME = 'api-limits.yaml';

export const normalizeApiLimitKeyPart = (value: string): string =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const parsePositiveInt = (raw: unknown): number | undefined => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
};

const parsePositiveNumber = (raw: unknown): number | undefined => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
};

const normalizeWindow = (raw: unknown): LimitWindow | undefined => {
  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'hour' || normalized === 'day') return normalized;
  return undefined;
};

const normalizeProviderLimits = (raw: RawProviderLimits | undefined): ProviderLimits => {
  const normalizedCallers: Record<string, number> = {};
  const callers = raw?.callers ?? {};
  for (const [caller, limit] of Object.entries(callers)) {
    const parsed = parsePositiveInt(limit);
    if (parsed !== undefined) {
      normalizedCallers[normalizeApiLimitKeyPart(caller)] = parsed;
    }
  }
  return {
    window: normalizeWindow(raw?.window),
    windowHours: parsePositiveInt(raw?.windowHours),
    overall: parsePositiveInt(raw?.overall),
    callers: normalizedCallers,
  };
};

const normalizeProviderBudgeting = (raw: RawProviderBudgeting | undefined): ProviderBudgeting => {
  const models: Record<string, ProviderModelPricing> = {};
  for (const [model, pricing] of Object.entries(raw?.models ?? {})) {
    const inputCostPer1MTokensUsd = parsePositiveNumber(pricing?.inputCostPer1MTokensUsd);
    const outputCostPer1MTokensUsd = parsePositiveNumber(pricing?.outputCostPer1MTokensUsd);
    if (inputCostPer1MTokensUsd === undefined || outputCostPer1MTokensUsd === undefined) continue;
    models[normalizeApiLimitKeyPart(model)] = {
      inputCostPer1MTokensUsd,
      outputCostPer1MTokensUsd,
    };
  }
  return {
    monthlyBudgetUsd: parsePositiveNumber(raw?.monthlyBudgetUsd),
    alertThresholdPercent: parsePositiveNumber(raw?.alertThresholdPercent),
    models,
  };
};

const normalizeCaching = (
  raw: Record<string, Record<string, unknown>> | undefined
): Record<string, Record<string, number>> => {
  const out: Record<string, Record<string, number>> = {};
  for (const [groupName, groupValues] of Object.entries(raw ?? {})) {
    const normalizedGroupName = normalizeApiLimitKeyPart(groupName);
    const normalizedGroup: Record<string, number> = {};
    for (const [settingName, settingValue] of Object.entries(groupValues ?? {})) {
      const parsed = parsePositiveInt(settingValue);
      if (parsed !== undefined) {
        normalizedGroup[normalizeApiLimitKeyPart(settingName)] = parsed;
      }
    }
    out[normalizedGroupName] = normalizedGroup;
  }
  return out;
};

const resolveConfigPath = (): string => {
  const override = String(process.env.API_LIMITS_CONFIG_PATH ?? '').trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
  }
  const candidates = [
    path.resolve(process.cwd(), 'config', CONFIG_FILENAME),
    path.resolve(process.cwd(), 'server', 'config', CONFIG_FILENAME),
    path.resolve(__dirname, '../../config', CONFIG_FILENAME),
    path.resolve(__dirname, '../../../config', CONFIG_FILENAME),
  ];
  return candidates.find(p => fs.existsSync(p)) ?? candidates[0];
};

export const getResolvedApiLimitsConfigPath = (): string => resolveConfigPath();

export const doesApiLimitsConfigExist = (): boolean => fs.existsSync(resolveConfigPath());

let cachedConfig: ApiLimitsConfig | null = null;
let cachedPath: string | null = null;
let cachedMtimeMs = -1;

const invalidateConfigCache = (): void => {
  cachedConfig = null;
  cachedPath = null;
  cachedMtimeMs = -1;
};

const loadRawConfigFromFile = (): RawApiLimitsConfig => {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    return { providers: {}, budgeting: {}, caching: {} };
  }
  try {
    const rawText = fs.readFileSync(configPath, 'utf8');
    return (parse(rawText) ?? {}) as RawApiLimitsConfig;
  } catch (err) {
    logError(`[api-usage] Failed to load raw YAML config from ${configPath}`, err);
    return { providers: {}, budgeting: {}, caching: {} };
  }
};

const loadConfigFromFile = (): ApiLimitsConfig => {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    return { providers: {}, budgeting: {}, caching: {} };
  }
  const stat = fs.statSync(configPath);
  if (
    cachedConfig &&
    cachedPath === configPath &&
    Number.isFinite(cachedMtimeMs) &&
    cachedMtimeMs === stat.mtimeMs
  ) {
    return cachedConfig;
  }

  try {
    const rawText = fs.readFileSync(configPath, 'utf8');
    const parsed = (parse(rawText) ?? {}) as RawApiLimitsConfig;
    const providers: Record<string, ProviderLimits> = {};
    for (const [provider, rawProvider] of Object.entries(parsed.providers ?? {})) {
      providers[normalizeApiLimitKeyPart(provider)] = normalizeProviderLimits(rawProvider);
    }
    const budgeting: Record<string, ProviderBudgeting> = {};
    for (const [provider, rawBudgeting] of Object.entries(parsed.budgeting ?? {})) {
      budgeting[normalizeApiLimitKeyPart(provider)] = normalizeProviderBudgeting(rawBudgeting);
    }
    const caching = normalizeCaching(parsed.caching);
    cachedConfig = { providers, budgeting, caching };
    cachedPath = configPath;
    cachedMtimeMs = stat.mtimeMs;
    return cachedConfig;
  } catch (err) {
    logError(`[api-usage] Failed to load YAML config from ${configPath}`, err);
    return { providers: {}, budgeting: {}, caching: {} };
  }
};

export const getApiLimitProviderConfig = (provider: string): ProviderLimits | undefined => {
  const config = loadConfigFromFile();
  return config.providers[normalizeApiLimitKeyPart(provider)];
};

export const getApiBudgetProviderConfig = (provider: string): ProviderBudgeting | undefined => {
  const config = loadConfigFromFile();
  return config.budgeting[normalizeApiLimitKeyPart(provider)];
};

export const getApiLimitsConfig = (): ApiLimitsConfig => loadConfigFromFile();

export const getApiCacheSetting = (group: string, setting: string): number | undefined => {
  const config = loadConfigFromFile();
  return config.caching[normalizeApiLimitKeyPart(group)]?.[normalizeApiLimitKeyPart(setting)];
};

export const updateApiLimitProviderConfig = (
  provider: string,
  nextProvider: {
    window: LimitWindow;
    windowHours: number;
    overall: number | null;
    callers: Record<string, number>;
  }
): ApiLimitsConfig => {
  const configPath = resolveConfigPath();
  const rawConfig = loadRawConfigFromFile();
  const normalizedProvider = normalizeApiLimitKeyPart(provider);
  const rawProviders = { ...(rawConfig.providers ?? {}) };
  const nextRawProvider: RawProviderLimits = {
    window: nextProvider.window,
    windowHours: nextProvider.windowHours,
    callers: Object.fromEntries(
      Object.entries(nextProvider.callers)
        .map(([caller, limit]) => [normalizeApiLimitKeyPart(caller), limit])
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
    ),
  };
  if (nextProvider.overall !== null) {
    nextRawProvider.overall = nextProvider.overall;
  }

  rawProviders[normalizedProvider] = nextRawProvider;
  const nextRawConfig: RawApiLimitsConfig = {
    providers: Object.fromEntries(Object.entries(rawProviders).sort(([a], [b]) => String(a).localeCompare(String(b)))),
    budgeting: rawConfig.budgeting ?? {},
    caching: rawConfig.caching ?? {},
  };

  fs.writeFileSync(configPath, stringify(nextRawConfig), 'utf8');
  invalidateConfigCache();
  return loadConfigFromFile();
};

export const updateApiCachingConfig = (
  group: string,
  nextGroupValues: Record<string, number>
): ApiLimitsConfig => {
  const configPath = resolveConfigPath();
  const rawConfig = loadRawConfigFromFile();
  const normalizedGroup = normalizeApiLimitKeyPart(group);
  const rawCaching = { ...(rawConfig.caching ?? {}) };
  rawCaching[normalizedGroup] = Object.fromEntries(
    Object.entries(nextGroupValues)
      .map(([key, value]) => [normalizeApiLimitKeyPart(key), Math.floor(value)])
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
  );
  const nextRawConfig: RawApiLimitsConfig = {
    providers: rawConfig.providers ?? {},
    budgeting: rawConfig.budgeting ?? {},
    caching: Object.fromEntries(Object.entries(rawCaching).sort(([a], [b]) => String(a).localeCompare(String(b)))),
  };

  fs.writeFileSync(configPath, stringify(nextRawConfig), 'utf8');
  invalidateConfigCache();
  return loadConfigFromFile();
};

export const updateApiBudgetProviderConfig = (
  provider: string,
  nextBudgeting: {
    monthlyBudgetUsd: number | null;
    alertThresholdPercent: number | null;
    models: Record<
      string,
      {
        inputCostPer1MTokensUsd: number;
        outputCostPer1MTokensUsd: number;
      }
    >;
  }
): ApiLimitsConfig => {
  const configPath = resolveConfigPath();
  const rawConfig = loadRawConfigFromFile();
  const normalizedProvider = normalizeApiLimitKeyPart(provider);
  const rawBudgeting = { ...(rawConfig.budgeting ?? {}) };
  const nextRawBudgeting: RawProviderBudgeting = {
    models: Object.fromEntries(
      Object.entries(nextBudgeting.models)
        .map(([model, pricing]) => [
          normalizeApiLimitKeyPart(model),
          {
            inputCostPer1MTokensUsd: pricing.inputCostPer1MTokensUsd,
            outputCostPer1MTokensUsd: pricing.outputCostPer1MTokensUsd,
          },
        ])
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
    ),
  };
  if (nextBudgeting.monthlyBudgetUsd !== null) {
    nextRawBudgeting.monthlyBudgetUsd = nextBudgeting.monthlyBudgetUsd;
  }
  if (nextBudgeting.alertThresholdPercent !== null) {
    nextRawBudgeting.alertThresholdPercent = nextBudgeting.alertThresholdPercent;
  }

  rawBudgeting[normalizedProvider] = nextRawBudgeting;
  const nextRawConfig: RawApiLimitsConfig = {
    providers: rawConfig.providers ?? {},
    budgeting: Object.fromEntries(Object.entries(rawBudgeting).sort(([a], [b]) => String(a).localeCompare(String(b)))),
    caching: rawConfig.caching ?? {},
  };

  fs.writeFileSync(configPath, stringify(nextRawConfig), 'utf8');
  invalidateConfigCache();
  return loadConfigFromFile();
};
