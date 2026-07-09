import { getAiProviderConfig, setAiProviderConfig, writeAuditLog } from '../db';
import { getEnvValue } from '../env';
import { logError } from '../logger';
import type { AiProviderConfig } from '../types';

export type ActiveAiProviderConfig = {
  featureKey: string;
  provider: string;
  model: string;
  enabled: boolean;
  source: 'db' | 'env' | 'default';
  updatedBy: string | null;
  updatedAt: string | null;
};

const DEFAULT_PROVIDER = 'openai';
const DEFAULT_MODEL = 'gpt-4o-mini';
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: ActiveAiProviderConfig; expiresAt: number }>();

const FEATURE_PROVIDER_ENV_KEYS: Record<string, string> = {
  itinerary_generation: 'AI_ITINERARY_PROVIDER',
  ingestion_llm_extract: 'AI_INGESTION_LLM_PROVIDER',
};

const FEATURE_MODEL_ENV_KEYS: Record<string, string> = {
  itinerary_generation: 'AI_ITINERARY_MODEL',
  ingestion_llm_extract: 'AI_INGESTION_LLM_MODEL',
};

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-5',
  gemini: 'gemini-2.5-flash',
  zai: 'glm-4.7',
  openai_compatible: 'gpt-4o-mini',
};

const DEFAULT_PROVIDER_PRIORITY = ['openai', 'anthropic', 'gemini', 'zai', 'openai_compatible'];

const normalizeProviderId = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const getProviderApiKeyEnvVar = (providerId: string): string => {
  const normalized = normalizeProviderId(providerId);
  const explicit = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
    zai: 'ZAI_API_KEY',
    openai_compatible: 'OPENAI_COMPATIBLE_API_KEY',
  }[normalized];
  return explicit ?? `${normalized.toUpperCase()}_API_KEY`;
};

export const getProviderModelsEnvVar = (providerId: string): string => {
  const normalized = normalizeProviderId(providerId);
  const explicit = {
    openai: 'OPENAI_MODELS',
    anthropic: 'ANTHROPIC_MODELS',
    gemini: 'GEMINI_MODELS',
    zai: 'ZAI_MODELS',
    openai_compatible: 'OPENAI_COMPATIBLE_MODELS',
  }[normalized];
  return explicit ?? `${normalized.toUpperCase()}_MODELS`;
};

export const getConfiguredProviderApiKey = (providerId: string): string | undefined =>
  getEnvValue(getProviderApiKeyEnvVar(providerId));

export const getConfiguredProviderModels = (providerId: string, fallbackModels: string[]): string[] => {
  const raw = getEnvValue(getProviderModelsEnvVar(providerId));
  if (!raw) return fallbackModels;
  const parsed = raw
    .split(/[,\n;]/)
    .map((value) => value.trim())
    .filter(Boolean);
  return parsed.length > 0 ? Array.from(new Set(parsed)) : fallbackModels;
};

const getFirstConfiguredProvider = (): string | null => {
  for (const providerId of DEFAULT_PROVIDER_PRIORITY) {
    if (getConfiguredProviderApiKey(providerId)) return providerId;
  }
  return null;
};

const getEnvDefaultConfig = (featureKey: string): ActiveAiProviderConfig => {
  const configuredProvider = getFirstConfiguredProvider();
  const selectedProviderRaw = getEnvValue(FEATURE_PROVIDER_ENV_KEYS[featureKey] ?? '');
  const selectedProvider = selectedProviderRaw ? normalizeProviderId(selectedProviderRaw) : null;
  const provider = selectedProvider || configuredProvider || DEFAULT_PROVIDER;
  const supportedModels = getConfiguredProviderModels(
    provider,
    PROVIDER_DEFAULT_MODELS[provider] ? [PROVIDER_DEFAULT_MODELS[provider]] : [DEFAULT_MODEL],
  );
  const model =
    getEnvValue(FEATURE_MODEL_ENV_KEYS[featureKey] ?? '') ??
    supportedModels[0] ??
    PROVIDER_DEFAULT_MODELS[provider] ??
    DEFAULT_MODEL;

  return {
    featureKey,
    provider,
    model,
    enabled: true,
    source: selectedProviderRaw || configuredProvider ? 'env' : 'default',
    updatedBy: null,
    updatedAt: null,
  };
};

const toActiveConfig = (featureKey: string, row: AiProviderConfig | null): ActiveAiProviderConfig => {
  if (!row || !row.enabled) {
    return getEnvDefaultConfig(featureKey);
  }
  return {
    featureKey,
    provider: row.provider,
    model: row.model,
    enabled: row.enabled,
    source: 'db',
    updatedBy: row.updatedBy ?? null,
    updatedAt: row.updatedAt,
  };
};

export const getActiveAiProvider = async (featureKey: string): Promise<ActiveAiProviderConfig> => {
  const cached = cache.get(featureKey);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  // Fail-open: a missing row already resolves to the default provider via
  // toActiveConfig, but a thrown error (DB outage, un-migrated table, etc.)
  // must not be allowed to take down itinerary generation or mail parsing —
  // every other AI call sits behind this lookup. Same fail-open posture as
  // entitlementService's isFeatureEnabled for feature flags.
  let row: AiProviderConfig | null = null;
  try {
    row = await getAiProviderConfig(featureKey);
  } catch (err) {
    logError('[aiProviderConfigService] getAiProviderConfig failed, falling back to default provider', err);
  }

  const active = toActiveConfig(featureKey, row);
  cache.set(featureKey, { value: active, expiresAt: Date.now() + CACHE_TTL_MS });
  return active;
};

export const clearAiProviderConfigCache = (featureKey?: string): void => {
  if (featureKey) cache.delete(featureKey);
  else cache.clear();
};

export const setAiProviderConfigWithAudit = async (params: {
  featureKey: string;
  provider: string;
  model: string;
  enabled: boolean;
  actorUserId: string;
  reason: string;
}): Promise<AiProviderConfig> => {
  const before = await getAiProviderConfig(params.featureKey);
  const after = await setAiProviderConfig({
    featureKey: params.featureKey,
    provider: params.provider,
    model: params.model,
    enabled: params.enabled,
    updatedBy: params.actorUserId,
  });
  clearAiProviderConfigCache(params.featureKey);
  await writeAuditLog({
    actorUserId: params.actorUserId,
    action: 'AI_PROVIDER_CONFIG_UPDATED',
    beforeState: before ? { ...before } : null,
    afterState: { ...after },
    reason: params.reason,
  });
  return after;
};
