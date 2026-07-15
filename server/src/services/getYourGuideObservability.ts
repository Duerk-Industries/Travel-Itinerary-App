export type GetYourGuideCacheState = 'fresh' | 'stale' | 'negative' | 'miss';

type SnapshotState = {
  requests: number;
  successes: number;
  failures: number;
  retries: number;
  rateLimited: number;
  cacheHits: number;
  cacheStale: number;
  cacheNegative: number;
  cacheMisses: number;
  clicks: number;
  suppressionByReason: Record<string, number>;
  failuresByCode: Record<string, number>;
  durationsMs: number[];
  lastRequestAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
};

const MAX_DURATION_SAMPLES = 256;
const state: SnapshotState = {
  requests: 0,
  successes: 0,
  failures: 0,
  retries: 0,
  rateLimited: 0,
  cacheHits: 0,
  cacheStale: 0,
  cacheNegative: 0,
  cacheMisses: 0,
  clicks: 0,
  suppressionByReason: {},
  failuresByCode: {},
  durationsMs: [],
  lastRequestAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
};

const nowIso = (): string => new Date().toISOString();
const increment = (target: Record<string, number>, key: string): void => { target[key] = (target[key] ?? 0) + 1; };

export const recordGetYourGuideApiRequest = (params: { success: boolean; status?: number; code?: string; durationMs: number }): void => {
  const now = nowIso();
  state.requests += 1;
  state.lastRequestAt = now;
  if (params.success) {
    state.successes += 1;
    state.lastSuccessAt = now;
  } else {
    state.failures += 1;
    state.lastFailureAt = now;
    if (params.code) increment(state.failuresByCode, params.code);
    if (params.status === 429) state.rateLimited += 1;
  }
  state.durationsMs.push(Math.max(0, Math.round(params.durationMs)));
  if (state.durationsMs.length > MAX_DURATION_SAMPLES) state.durationsMs.splice(0, state.durationsMs.length - MAX_DURATION_SAMPLES);
};

export const recordGetYourGuideRetry = (): void => { state.retries += 1; };
export const recordGetYourGuideSuppression = (reason: string): void => increment(state.suppressionByReason, reason || 'unknown');
export const recordGetYourGuideCacheEvent = (stateName: GetYourGuideCacheState): void => {
  if (stateName === 'fresh') state.cacheHits += 1;
  else if (stateName === 'stale') state.cacheStale += 1;
  else if (stateName === 'negative') state.cacheNegative += 1;
  else state.cacheMisses += 1;
};
export const recordGetYourGuideClick = (): void => { state.clicks += 1; };

const percentile = (values: number[], p: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
};

export const getGetYourGuideObservabilitySnapshot = () => ({
  requests: state.requests,
  successes: state.successes,
  failures: state.failures,
  retries: state.retries,
  rateLimited: state.rateLimited,
  cache: {
    hits: state.cacheHits,
    stale: state.cacheStale,
    negative: state.cacheNegative,
    misses: state.cacheMisses,
    total: state.cacheHits + state.cacheStale + state.cacheNegative + state.cacheMisses,
  },
  clicks: state.clicks,
  suppressionByReason: { ...state.suppressionByReason },
  failuresByCode: { ...state.failuresByCode },
  latencyMs: {
    p50: percentile(state.durationsMs, 0.5),
    p95: percentile(state.durationsMs, 0.95),
    sampleCount: state.durationsMs.length,
  },
  lastRequestAt: state.lastRequestAt,
  lastSuccessAt: state.lastSuccessAt,
  lastFailureAt: state.lastFailureAt,
});

export const resetGetYourGuideObservabilityForTests = (): void => {
  state.requests = 0; state.successes = 0; state.failures = 0; state.retries = 0; state.rateLimited = 0;
  state.cacheHits = 0; state.cacheStale = 0; state.cacheNegative = 0; state.cacheMisses = 0; state.clicks = 0;
  state.suppressionByReason = {}; state.failuresByCode = {}; state.durationsMs = [];
  state.lastRequestAt = null; state.lastSuccessAt = null; state.lastFailureAt = null;
};
