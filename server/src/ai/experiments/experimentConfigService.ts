import { listAiExperiments } from '../../db';
import type { AiExperiment, AiExperimentKind } from '../../types';
import { logError } from '../../logger';

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: AiExperiment | null; expiresAt: number }>();

const cacheKey = (featureKey: string, experimentKind: AiExperimentKind) => `${featureKey}:${experimentKind}`;

export const getRunningExperiment = async (
  featureKey: string,
  experimentKind: AiExperimentKind,
): Promise<AiExperiment | null> => {
  const key = cacheKey(featureKey, experimentKind);
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  try {
    const [experiment] = await listAiExperiments({ featureKey, experimentKind, status: 'running', limit: 1 });
    const value = experiment ?? null;
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err) {
    logError('[ai-experiments] failed to resolve running experiment', err);
    cache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }
};

export const clearExperimentConfigCache = (): void => {
  cache.clear();
};
