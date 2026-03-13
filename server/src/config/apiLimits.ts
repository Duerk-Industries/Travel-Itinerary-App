import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';
import { logError } from '../logger';

type LimitWindow = 'hour' | 'day';

type ProviderLimits = {
  window?: LimitWindow;
  windowHours?: number;
  overall?: number;
  callers: Record<string, number>;
};

type ApiLimitsConfig = {
  providers: Record<string, ProviderLimits>;
  caching: Record<string, Record<string, number>>;
};

type RawProviderLimits = {
  window?: unknown;
  windowHours?: unknown;
  overall?: unknown;
  callers?: Record<string, unknown>;
};

type RawApiLimitsConfig = {
  providers?: Record<string, RawProviderLimits>;
  caching?: Record<string, Record<string, unknown>>;
};

const CONFIG_FILENAME = 'api-limits.yaml';

const normalizeKeyPart = (value: string): string =>
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
      normalizedCallers[normalizeKeyPart(caller)] = parsed;
    }
  }
  return {
    window: normalizeWindow(raw?.window),
    windowHours: parsePositiveInt(raw?.windowHours),
    overall: parsePositiveInt(raw?.overall),
    callers: normalizedCallers,
  };
};

const normalizeCaching = (
  raw: Record<string, Record<string, unknown>> | undefined
): Record<string, Record<string, number>> => {
  const out: Record<string, Record<string, number>> = {};
  for (const [groupName, groupValues] of Object.entries(raw ?? {})) {
    const normalizedGroupName = normalizeKeyPart(groupName);
    const normalizedGroup: Record<string, number> = {};
    for (const [settingName, settingValue] of Object.entries(groupValues ?? {})) {
      const parsed = parsePositiveInt(settingValue);
      if (parsed !== undefined) {
        normalizedGroup[normalizeKeyPart(settingName)] = parsed;
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

const loadConfigFromFile = (): ApiLimitsConfig => {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    return { providers: {}, caching: {} };
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
      providers[normalizeKeyPart(provider)] = normalizeProviderLimits(rawProvider);
    }
    const caching = normalizeCaching(parsed.caching);
    cachedConfig = { providers, caching };
    cachedPath = configPath;
    cachedMtimeMs = stat.mtimeMs;
    return cachedConfig;
  } catch (err) {
    logError(`[api-usage] Failed to load YAML config from ${configPath}`, err);
    return { providers: {}, caching: {} };
  }
};

export const getApiLimitProviderConfig = (provider: string): ProviderLimits | undefined => {
  const config = loadConfigFromFile();
  return config.providers[normalizeKeyPart(provider)];
};

export const getApiLimitsConfig = (): ApiLimitsConfig => loadConfigFromFile();

export const getApiCacheSetting = (group: string, setting: string): number | undefined => {
  const config = loadConfigFromFile();
  return config.caching[normalizeKeyPart(group)]?.[normalizeKeyPart(setting)];
};
