import { logError, logInfo } from '../logger';
import { getApiLimitProviderConfig } from '../config/apiLimits';

type LimitScope = 'overall' | 'caller';
type LimitWindow = 'hour' | 'day';

type UsageBucket = {
  used: number;
  loggedThresholds: Set<number>;
  windowKey: string | null;
};

const THRESHOLDS = [50, 75, 90, 100] as const;
const usageBuckets = new Map<string, UsageBucket>();

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
    logError('[api-usage] Blocking API call', err.message);
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
    logError('[api-usage] Blocking API call at limit', err.message);
    throw err;
  }
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
