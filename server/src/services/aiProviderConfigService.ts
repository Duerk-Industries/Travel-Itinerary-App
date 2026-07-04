import { getAiProviderConfig, setAiProviderConfig, writeAuditLog } from '../db';
import type { AiProviderConfig } from '../types';

export type ActiveAiProviderConfig = {
  featureKey: string;
  provider: string;
  model: string;
  enabled: boolean;
  source: 'db' | 'default';
  updatedBy: string | null;
  updatedAt: string | null;
};

const DEFAULT_PROVIDER = 'openai';
const DEFAULT_MODEL = 'gpt-4o-mini';
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: ActiveAiProviderConfig; expiresAt: number }>();

const toActiveConfig = (featureKey: string, row: AiProviderConfig | null): ActiveAiProviderConfig => {
  if (!row || !row.enabled) {
    return {
      featureKey,
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      enabled: true,
      source: 'default',
      updatedBy: null,
      updatedAt: null,
    };
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
  const active = toActiveConfig(featureKey, await getAiProviderConfig(featureKey));
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
