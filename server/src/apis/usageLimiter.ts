import { logError, logInfo } from '../logger';
import { getApiLimitProviderConfig } from '../config/apiLimits';

type LimitScope = 'overall' | 'caller';
type LimitWindow = 'hour' | 'day';

type UsageBucket = {
  used: number;
  loggedThresholds: Set<number>;
  windowKey: string | null;
};

type BlockLogState = {
  nextLogAtMs: number;
  suppressedCount: number;
};

const THRESHOLDS = [50, 75, 90, 100] as const;
const usageBuckets = new Map<string, UsageBucket>();
const blockedLogStates = new Map<string, BlockLogState>();

const BLOCK_LOG_COOLDOWN_MS = (() => {
  const raw = Number(process.env.API_LIMIT_BLOCK_LOG_COOLDOWN_MS ?? '120000');
  if (!Number.isFinite(raw) || raw < 0) return 120000;
  return Math.floor(raw);
})();

const normalizeKeyPart = (value: string): string =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const getBucket = (key: string): UsageBucket => {
  const existing = usageBuckets.get(key);
  if (existing) return existing;
  const created: UsageBucket = { used: 0, loggedThresholds: new Set<number>(), windowKey: null };
  usageBuckets.set(key, created);
  return created;
};

const parseLimit = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
};

const logThreshold = (params: {
  provider: string;
  caller: string;
  scope: LimitScope;
  threshold: number;
  used: number;
  limit: number;
  window: LimitWindow;
  windowKey: string;
}): void => {
  logInfo(
    `[api-usage] provider=${params.provider} scope=${params.scope} caller=${params.caller} threshold=${params.threshold}% usage=${params.used}/${params.limit} window=${params.window} windowKey=${params.windowKey}`
  );
};

const resolveLimitWindow = (provider: string, configured?: LimitWindow): LimitWindow => {
  if (configured === 'hour' || configured === 'day') return configured;
  return provider === 'UNSPLASH' ? 'hour' : 'day';
};

const resolveHourWindowSize = (configured?: number): number => {
  const raw = Number(configured);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.floor(raw);
};

const formatWindowKey = (window: LimitWindow, hourWindowSize: number, now = new Date()): string => {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  if (window === 'hour') {
    const currentHour = now.getUTCHours();
    const bucketStartHour = Math.floor(currentHour / hourWindowSize) * hourWindowSize;
    const hour = String(bucketStartHour).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}+${hourWindowSize}h`;
  }
  return `${year}-${month}-${day}`;
};

const resetBucketForWindowIfNeeded = (bucket: UsageBucket, windowKey: string): void => {
  if (bucket.windowKey === windowKey) return;
  bucket.windowKey = windowKey;
  bucket.used = 0;
  bucket.loggedThresholds = new Set<number>();
};

const logBlockedCallWithCooldown = (params: {
  provider: string;
  caller: string;
  scope: LimitScope;
  windowKey: string;
  message: string;
  atLimit: boolean;
}): void => {
  const key = `${params.provider}:${params.scope}:${params.caller}:${params.windowKey}`;
  const nowMs = Date.now();
  const current = blockedLogStates.get(key);
  if (!current || nowMs >= current.nextLogAtMs) {
    const suppressedSuffix =
      current && current.suppressedCount > 0
        ? ` (suppressed ${current.suppressedCount} similar messages in last ${Math.round(
            BLOCK_LOG_COOLDOWN_MS / 1000
          )}s)`
        : '';
    logError(
      params.atLimit ? '[api-usage] Blocking API call at limit' : '[api-usage] Blocking API call',
      `${params.message}${suppressedSuffix}`
    );
    blockedLogStates.set(key, { nextLogAtMs: nowMs + BLOCK_LOG_COOLDOWN_MS, suppressedCount: 0 });
    return;
  }
  current.suppressedCount += 1;
  blockedLogStates.set(key, current);
};

export class ApiLimitExceededError extends Error {
  public readonly provider: string;
  public readonly caller: string;
  public readonly scope: LimitScope;
  public readonly limit: number;
  public readonly used: number;

  constructor(params: {
    provider: string;
    caller: string;
    scope: LimitScope;
    limit: number;
    used: number;
  }) {
    super(
      `API limit reached for provider=${params.provider} scope=${params.scope} caller=${params.caller} (${params.used}/${params.limit})`
    );
    this.name = 'ApiLimitExceededError';
    this.provider = params.provider;
    this.caller = params.caller;
    this.scope = params.scope;
    this.limit = params.limit;
    this.used = params.used;
  }
}

const reserveScopeUsageOrThrow = (params: {
  provider: string;
  caller: string;
  scope: LimitScope;
  key: string;
  limit: number;
  window: LimitWindow;
  windowKey: string;
}): void => {
  const bucket = getBucket(params.key);
  resetBucketForWindowIfNeeded(bucket, params.windowKey);

  // Block once a scope is already at limit.
  if (bucket.used >= params.limit) {
    if (!bucket.loggedThresholds.has(100)) {
      bucket.loggedThresholds.add(100);
      logThreshold({
        provider: params.provider,
        caller: params.caller,
        scope: params.scope,
        threshold: 100,
        used: bucket.used,
        limit: params.limit,
        window: params.window,
        windowKey: params.windowKey,
      });
    }
    const err = new ApiLimitExceededError({
      provider: params.provider,
      caller: params.caller,
      scope: params.scope,
      limit: params.limit,
      used: bucket.used,
    });
    logBlockedCallWithCooldown({
      provider: params.provider,
      caller: params.caller,
      scope: params.scope,
      windowKey: params.windowKey,
      message: err.message,
      atLimit: false,
    });
    throw err;
  }

  bucket.used += 1;
  const pct = (bucket.used / params.limit) * 100;
  for (const threshold of THRESHOLDS) {
    if (pct >= threshold && !bucket.loggedThresholds.has(threshold)) {
      bucket.loggedThresholds.add(threshold);
      logThreshold({
        provider: params.provider,
        caller: params.caller,
        scope: params.scope,
        threshold,
        used: bucket.used,
        limit: params.limit,
        window: params.window,
        windowKey: params.windowKey,
      });
    }
  }

  // Stop the call once it reaches 100%.
  if (bucket.used >= params.limit) {
    const err = new ApiLimitExceededError({
      provider: params.provider,
      caller: params.caller,
      scope: params.scope,
      limit: params.limit,
      used: bucket.used,
    });
    logBlockedCallWithCooldown({
      provider: params.provider,
      caller: params.caller,
      scope: params.scope,
      windowKey: params.windowKey,
      message: err.message,
      atLimit: true,
    });
    throw err;
  }
};

export type ApiUsageSummaryEntry = {
  provider: string;
  caller: string;
  scope: LimitScope;
  used: number;
  limit: number | null;
  windowKey: string | null;
};

export const getApiUsageSummary = (): ApiUsageSummaryEntry[] => {
  const entries: ApiUsageSummaryEntry[] = [];
  for (const [key, bucket] of usageBuckets.entries()) {
    const parts = key.split(':');
    const scope = parts[0] as LimitScope;
    const provider = parts[1] ?? '';
    const caller = parts[2] ?? '';
    const providerConfig = getApiLimitProviderConfig(provider);
    const limit = scope === 'overall'
      ? (providerConfig?.overall ?? null)
      : (providerConfig?.callers?.[caller] ?? null);
    entries.push({
      provider,
      caller: scope === 'overall' ? '*' : caller,
      scope,
      used: bucket.used,
      limit: limit ?? null,
      windowKey: bucket.windowKey,
    });
  }
  return entries;
};

export const resetApiUsageSummaries = (): void => {
  usageBuckets.clear();
  blockedLogStates.clear();
};

export const reserveApiUsageOrThrow = (params: { provider: string; caller: string }): void => {
  const provider = normalizeKeyPart(params.provider);
  const caller = normalizeKeyPart(params.caller);
  const providerConfig = getApiLimitProviderConfig(provider);
  const window = resolveLimitWindow(provider, providerConfig?.window);
  const hourWindowSize = resolveHourWindowSize(providerConfig?.windowHours);
  const windowKey = formatWindowKey(window, hourWindowSize);

  const overallLimit = parseLimit(providerConfig?.overall == null ? undefined : String(providerConfig.overall));
  const callerLimit = parseLimit(
    providerConfig?.callers?.[caller] == null ? undefined : String(providerConfig.callers[caller])
  );

  if (overallLimit !== null) {
    reserveScopeUsageOrThrow({
      provider,
      caller,
      scope: 'overall',
      key: `overall:${provider}`,
      limit: overallLimit,
      window,
      windowKey,
    });
  }

  if (callerLimit !== null) {
    reserveScopeUsageOrThrow({
      provider,
      caller,
      scope: 'caller',
      key: `caller:${provider}:${caller}`,
      limit: callerLimit,
      window,
      windowKey,
    });
  }
};
