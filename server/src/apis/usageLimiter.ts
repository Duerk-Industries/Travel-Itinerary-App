import { randomUUID } from 'crypto';
import { logError, logInfo } from '../logger';
import { getApiLimitProviderConfig } from '../config/apiLimits';
import {
  atomicIncrementApiUsageIfUnderLimit,
  getApiUsageCount,
  listApiUsageCounters,
  resetApiUsageCounters as resetStoredApiUsageCounters,
  reserveCapacity,
  commitCapacity,
  releaseCapacity,
} from '../db';
import { getCurrentApiBudgetStatus } from './providerBudgeting';

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

/** Configuration is part of the safety boundary for newly metered work. */
export class ApiLimitConfigurationError extends Error {
  public readonly provider: string;
  public readonly caller: string;

  constructor(params: { provider: string; caller: string }) {
    super(`API limit configuration is missing or invalid for provider=${params.provider} caller=${params.caller}`);
    this.name = 'ApiLimitConfigurationError';
    this.provider = params.provider;
    this.caller = params.caller;
  }
}

export class ApiBudgetExceededError extends ApiLimitExceededError {
  public readonly monthlyBudgetUsd: number;
  public readonly estimatedSpendUsd: number;
  public readonly budgetWindowKey: string;

  constructor(params: {
    provider: string;
    monthlyBudgetUsd: number;
    estimatedSpendUsd: number;
    windowKey: string;
  }) {
    super({
      provider: params.provider,
      caller: '*',
      scope: 'overall',
      limit: Math.round(params.monthlyBudgetUsd * 1_000_000),
      used: Math.round(params.estimatedSpendUsd * 1_000_000),
    });
    this.name = 'ApiBudgetExceededError';
    this.message = `API budget reached for provider=${params.provider} window=${params.windowKey} ($${params.estimatedSpendUsd.toFixed(
      4
    )} / $${params.monthlyBudgetUsd.toFixed(2)})`;
    this.monthlyBudgetUsd = params.monthlyBudgetUsd;
    this.estimatedSpendUsd = params.estimatedSpendUsd;
    this.budgetWindowKey = params.windowKey;
  }
}

const reserveScopeUsageOrThrow = async (params: {
  provider: string;
  caller: string;
  scope: LimitScope;
  limit: number;
  window: LimitWindow;
  windowKey: string;
  units: number;
}): Promise<void> => {
  const bucketKey =
    params.scope === 'overall' ? `overall:${params.provider}` : `caller:${params.provider}:${params.caller}`;
  const bucket = getBucket(bucketKey);
  resetBucketForWindowIfNeeded(bucket, params.windowKey);

  const result = await atomicIncrementApiUsageIfUnderLimit({
    provider: params.provider,
    caller: params.scope === 'overall' ? '*' : params.caller,
    scope: params.scope,
    windowKey: params.windowKey,
    limit: params.limit,
    units: params.units,
  });

  const storedCount = result.newCount;

  bucket.used = storedCount;
  const pct = (storedCount / params.limit) * 100;
  for (const threshold of THRESHOLDS) {
    if (pct >= threshold && !bucket.loggedThresholds.has(threshold)) {
      bucket.loggedThresholds.add(threshold);
      logThreshold({
        provider: params.provider,
        caller: params.caller,
        scope: params.scope,
        threshold,
        used: storedCount,
        limit: params.limit,
        window: params.window,
        windowKey: params.windowKey,
      });
    }
  }

  if (!result.allowed) {
    const err = new ApiLimitExceededError({
      provider: params.provider,
      caller: params.caller,
      scope: params.scope,
      limit: params.limit,
      used: storedCount,
    });
    logBlockedCallWithCooldown({
      provider: params.provider,
      caller: params.caller,
      scope: params.scope,
      windowKey: params.windowKey,
      message: err.message,
      atLimit: storedCount >= params.limit,
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

export const getApiUsageSummary = async (): Promise<ApiUsageSummaryEntry[]> => {
  const counters = await listApiUsageCounters();
  const entries: ApiUsageSummaryEntry[] = [];
  for (const counter of counters) {
    const providerConfig = getApiLimitProviderConfig(counter.provider);
    const window = resolveLimitWindow(counter.provider, providerConfig?.window);
    const hourWindowSize = resolveHourWindowSize(providerConfig?.windowHours);
    const currentWindowKey = formatWindowKey(window, hourWindowSize);
    if (counter.windowKey !== currentWindowKey) continue;
    const limit =
      counter.scope === 'overall' ? (providerConfig?.overall ?? null) : (providerConfig?.callers?.[counter.caller] ?? null);
    entries.push({
      provider: counter.provider,
      caller: counter.scope === 'overall' ? '*' : counter.caller,
      scope: counter.scope,
      used: counter.count,
      limit: limit ?? null,
      windowKey: counter.windowKey,
    });
  }
  return entries;
};

export const resetApiUsageSummaries = async (): Promise<void> => {
  await resetStoredApiUsageCounters();
  usageBuckets.clear();
  blockedLogStates.clear();
};

/**
 * Test-only: simulate a process restart by dropping the in-memory caches
 * without touching the durable DB counters. Used to verify that reservations
 * survive process restart by re-reading from the stored counter table.
 */
export const __resetInProcessUsageCachesForTests = (): void => {
  usageBuckets.clear();
  blockedLogStates.clear();
};

export const reserveApiUsageOrThrow = async (params: {
  provider: string;
  caller: string;
  units?: number;
  requireConfiguredLimit?: boolean;
}): Promise<void> => {
  const provider = normalizeKeyPart(params.provider);
  const caller = normalizeKeyPart(params.caller);
  const units = Math.max(1, Math.floor(Number(params.units ?? 1)));
  if (!Number.isFinite(units)) {
    throw new Error(`Invalid usage units: ${params.units}`);
  }

  const budgetStatus = await getCurrentApiBudgetStatus(provider);
  if (budgetStatus.monthlyBudgetUsd != null && budgetStatus.isOverBudget) {
    throw new ApiBudgetExceededError({
      provider,
      monthlyBudgetUsd: budgetStatus.monthlyBudgetUsd,
      estimatedSpendUsd: budgetStatus.estimatedSpendUsd,
      windowKey: budgetStatus.windowKey,
    });
  }
  const providerConfig = getApiLimitProviderConfig(provider);
  const window = resolveLimitWindow(provider, providerConfig?.window);
  const hourWindowSize = resolveHourWindowSize(providerConfig?.windowHours);
  const windowKey = formatWindowKey(window, hourWindowSize);

  const overallLimit = parseLimit(providerConfig?.overall == null ? undefined : String(providerConfig.overall));
  const callerLimit = parseLimit(
    providerConfig?.callers?.[caller] == null ? undefined : String(providerConfig.callers[caller])
  );

  if (params.requireConfiguredLimit && (overallLimit === null || callerLimit === null)) {
    throw new ApiLimitConfigurationError({ provider, caller });
  }

  if (overallLimit !== null) {
    await reserveScopeUsageOrThrow({
      provider,
      caller,
      scope: 'overall',
      limit: overallLimit,
      window,
      windowKey,
      units,
    });
  }

  if (callerLimit !== null) {
    await reserveScopeUsageOrThrow({
      provider,
      caller,
      scope: 'caller',
      limit: callerLimit,
      window,
      windowKey,
      units,
    });
  }
};

/**
 * Capacity-based (gauge) resource reservation (§17.1).
 * Used for byte counts or item counts that persist beyond the request.
 */
export const reserveCapacityOrThrow = async (params: {
  provider: string;
  caller: string;
  units: number;
  idempotencyKey?: string;
  ttlSeconds?: number;
}): Promise<string> => {
  const provider = normalizeKeyPart(params.provider);
  const caller = normalizeKeyPart(params.caller);
  const providerConfig = getApiLimitProviderConfig(provider);
  const limit = parseLimit(providerConfig?.overall == null ? undefined : String(providerConfig.overall));

  if (limit === null) {
    throw new ApiLimitConfigurationError({ provider, caller });
  }

  const reservationId = params.idempotencyKey || randomUUID();
  const expiresAt = new Date(Date.now() + (params.ttlSeconds ?? 3600) * 1000).toISOString();

  const result = await reserveCapacity({
    id: reservationId,
    provider,
    caller,
    units: params.units,
    limit,
    expiresAt,
  });

  if (!result.allowed) {
    throw new ApiLimitExceededError({
      provider,
      caller,
      scope: 'overall',
      limit,
      used: result.current,
    });
  }

  return reservationId;
};

export const commitCapacityReservation = async (reservationId: string, actualUnits?: number): Promise<void> => {
  await commitCapacity(reservationId, actualUnits);
};

export const releaseCapacityReservation = async (reservationId: string): Promise<void> => {
  await releaseCapacity(reservationId);
};
