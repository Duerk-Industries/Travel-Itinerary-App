import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createHash } from 'crypto';
import { atomicIncrementApiUsageIfUnderLimit } from '../db';
import { isLocalEnv } from '../env';
import { getApiCacheSetting } from '../config/apiLimits';

const PROVIDER = 'HTTP_RATE_LIMIT';

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

// Jest sets NODE_ENV=test; Playwright/local dev signal via E2E_MODE or
// isLocalEnv() instead (see env.ts) — both must bypass production limits or
// a handful of parallel e2e workers trips real rate limiting within seconds.
const testSafeDefault = (productionDefault: number): number =>
  process.env.NODE_ENV === 'test' || isLocalEnv() ? 100_000 : productionDefault;

export class HttpRateLimitExceededError extends Error {
  public readonly limit: number;
  public readonly used: number;
  public readonly retryAfterSeconds: number;

  constructor(params: { limit: number; used: number; retryAfterSeconds: number }) {
    super('Too many requests. Please try again later.');
    this.name = 'HttpRateLimitExceededError';
    this.limit = params.limit;
    this.used = params.used;
    this.retryAfterSeconds = params.retryAfterSeconds;
  }
}

export const formatRateLimitWindowKey = (windowMs: number, nowMs = Date.now()): string => {
  const safeWindowMs = Math.max(1, Math.floor(windowMs));
  return String(Math.floor(nowMs / safeWindowMs));
};

export const hashRateLimitIdentity = (identity: string): string =>
  createHash('sha256').update(identity).digest('hex').slice(0, 32);

const buildCaller = (name: string, identity: string): string =>
  `${name}:${hashRateLimitIdentity(identity)}`.slice(0, 200);

export const reserveHttpRateLimitOrThrow = async (params: {
  name: string;
  identity: string;
  limit: number;
  windowMs: number;
  nowMs?: number;
}): Promise<void> => {
  const windowMs = Math.max(1, Math.floor(params.windowMs));
  const limit = Math.max(1, Math.floor(params.limit));
  const nowMs = params.nowMs ?? Date.now();
  const windowKey = `${params.name}:${formatRateLimitWindowKey(windowMs, nowMs)}`;
  const result = await atomicIncrementApiUsageIfUnderLimit({
    provider: PROVIDER,
    caller: buildCaller(params.name, params.identity),
    scope: 'caller',
    windowKey,
    limit,
  });
  if (!result.allowed) {
    const currentWindowStartedAt = Math.floor(nowMs / windowMs) * windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((currentWindowStartedAt + windowMs - nowMs) / 1000));
    throw new HttpRateLimitExceededError({ limit, used: result.newCount, retryAfterSeconds });
  }
};

const clientIp = (req: Request): string => String(req.ip || req.socket.remoteAddress || 'unknown');

export const reserveRequestRateLimits = async (params: {
  name: string;
  identities: Array<string | null | undefined>;
  limit: number;
  windowMs: number;
}): Promise<void> => {
  const identities = Array.from(
    new Set(params.identities.map((identity) => String(identity ?? '').trim()).filter(Boolean)),
  );
  for (const identity of identities) {
    await reserveHttpRateLimitOrThrow({
      name: params.name,
      identity,
      limit: params.limit,
      windowMs: params.windowMs,
    });
  }
};

export const reserveItineraryGenerationRateLimit = async (
  userId: string,
  ip: string | null | undefined,
): Promise<void> => {
  await reserveRequestRateLimits({
    name: 'itinerary_generation',
    identities: [`user:${userId}`, ip ? `ip:${ip}` : null],
    limit: parsePositiveInt(process.env.ITINERARY_RATE_LIMIT_MAX, testSafeDefault(10)),
    windowMs: parsePositiveInt(process.env.ITINERARY_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000),
  });
};

// Per-user/IP burst guard for the Activities bulk-save endpoint. This is a secondary,
// identity-scoped layer alongside the ACTIVITIES_API aggregate cap in api-limits.yaml
// (reserveApiUsageOrThrow) — that cap protects the shared daily budget across all users,
// this one stops a single user/IP from exhausting it or hammering the endpoint.
export const reserveActivitiesBulkSaveRateLimit = async (
  userId: string,
  ip: string | null | undefined,
): Promise<void> => {
  await reserveRequestRateLimits({
    name: 'activities_bulk_save',
    identities: [`user:${userId}`, ip ? `ip:${ip}` : null],
    limit: parsePositiveInt(process.env.ACTIVITIES_BULK_RATE_LIMIT_MAX, testSafeDefault(20)),
    windowMs: parsePositiveInt(process.env.ACTIVITIES_BULK_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000),
  });
};

// Phase 3 of docs/trip-blog-social-implementation-plan.md — architecture §4 step 7 ("Actor/IP
// rate limit"), the one resolution step Phase 2's blogEngagementService.ts explicitly left for
// the route layer. Reads reactionsPerMinutePerUser from caching.tripBlog (server/config/api-limits.yaml),
// not a route-local constant, per the "route-local numeric constants are forbidden" convention.
export const reserveBlogReactionRateLimit = async (
  userId: string,
  ip: string | null | undefined,
): Promise<void> => {
  await reserveRequestRateLimits({
    name: 'blog_reaction',
    identities: [`user:${userId}`, ip ? `ip:${ip}` : null],
    limit: testSafeDefault(Number(getApiCacheSetting('tripBlog', 'reactionsPerMinutePerUser') ?? 60)),
    windowMs: 60_000,
  });
};

export const reserveDataTransferRateLimit = async (
  userId: string,
  ip: string | null | undefined,
): Promise<void> => {
  await reserveRequestRateLimits({
    name: 'activity_lodging_csv_import',
    identities: [`user:${userId}`, ip ? `ip:${ip}` : null],
    limit: parsePositiveInt(process.env.ACTIVITY_LODGING_IMPORT_RATE_LIMIT_MAX, testSafeDefault(10)),
    windowMs: parsePositiveInt(process.env.ACTIVITY_LODGING_IMPORT_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000),
  });
};

export const authLoginRateLimit: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const identifier = String(req.body?.identifier ?? req.body?.email ?? '').trim().toLowerCase();
  try {
    await reserveRequestRateLimits({
      name: 'auth_login',
      identities: [`ip:${clientIp(req)}`, identifier ? `identifier:${identifier}` : null],
      limit: parsePositiveInt(process.env.AUTH_LOGIN_RATE_LIMIT_MAX, testSafeDefault(10)),
      windowMs: parsePositiveInt(process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    });
    next();
  } catch (err) {
    if (err instanceof HttpRateLimitExceededError) {
      res.setHeader('Retry-After', String(err.retryAfterSeconds));
      res.status(429).json({ error: err.message });
      return;
    }
    next(err);
  }
};

export const accountPasswordRateLimit: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const userId = String((req as any).user?.userId ?? '').trim();
  try {
    await reserveRequestRateLimits({
      name: 'account_password',
      identities: [`ip:${clientIp(req)}`, userId ? `user:${userId}` : null],
      limit: parsePositiveInt(process.env.AUTH_PASSWORD_RATE_LIMIT_MAX, testSafeDefault(5)),
      windowMs: parsePositiveInt(process.env.AUTH_PASSWORD_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    });
    next();
  } catch (err) {
    if (err instanceof HttpRateLimitExceededError) {
      res.setHeader('Retry-After', String(err.retryAfterSeconds));
      res.status(429).json({ error: err.message });
      return;
    }
    next(err);
  }
};
