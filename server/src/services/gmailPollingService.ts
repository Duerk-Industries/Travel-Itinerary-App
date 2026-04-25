import { INGESTION_TIER_RULES, GMAIL_POLLING_TICK_INTERVAL_MS_DEFAULT } from '../ingestion/config';
import { buildGmailIngestionPayloads, fetchGmailProfile, refreshGmailAccessToken } from '../ingestion/intake/gmail';
import { enqueueIngestionPipelineJob } from '../ingestion/orchestrator';
import {
  listProviderConnectionsByProvider,
  mergeProviderConnectionMetadata,
  updateProviderConnectionStatus,
  upsertProviderConnection,
} from '../ingestion/shared/repository';
import type { ProviderConnectionRecord } from '../ingestion/contracts';
import { getCurrentUserTier } from '../db';
import { logError, logInfo } from '../logger';
import { getEnvFlag, getEnvValue } from '../env';

type TierKey = keyof typeof INGESTION_TIER_RULES;

export type GmailPollingSkipReason =
  | 'tier_not_eligible'
  | 'not_due'
  | 'auth_expired'
  | 'no_access_token';

export interface GmailPollingResult {
  connectionId: string;
  userId: string;
  tierKey: TierKey | 'unknown';
  skipped: boolean;
  reason?: GmailPollingSkipReason;
  payloadsEnqueued?: number;
  error?: string;
}

const GMAIL_LAST_POLLED_AT_KEY = 'lastPolledAt';

const resolveTierKey = async (userId: string): Promise<TierKey | 'unknown'> => {
  const tier = await getCurrentUserTier(userId);
  if (!tier?.tierKey) return 'free';
  if (tier.tierKey === 'free' || tier.tierKey === 'premium' || tier.tierKey === 'pro') return tier.tierKey;
  return 'unknown';
};

const hasElapsedSince = (since: string | null | undefined, intervalHours: number, now: Date): boolean => {
  if (!since) return true;
  const last = new Date(since);
  if (Number.isNaN(last.getTime())) return true;
  const elapsedMs = now.getTime() - last.getTime();
  return elapsedMs >= intervalHours * 60 * 60 * 1000;
};

/**
 * Refreshes the Gmail access token when the stored token is missing or near
 * expiry. Mirrors the inline refresh logic in `ingestionRoutes.ts` but kept
 * independent so the scheduler does not need a request context.
 *
 * Returns the (possibly refreshed) access token or `null` if refresh failed.
 */
const ensureFreshGmailAccessToken = async (
  connection: ProviderConnectionRecord,
): Promise<string | null> => {
  const expiresAt = connection.tokenExpiry ? new Date(connection.tokenExpiry).getTime() : null;
  const expired = expiresAt !== null && expiresAt <= Date.now() + 60_000;
  if (!expired && connection.accessToken) {
    return connection.accessToken;
  }
  if (!connection.refreshToken) {
    await updateProviderConnectionStatus({
      userId: connection.userId,
      provider: 'gmail',
      status: 'AUTH_EXPIRED',
      metadata: {
        ...connection.metadata,
        authExpiredAt: new Date().toISOString(),
        lastAuthError: 'refresh_token_missing',
      },
    }).catch(() => undefined);
    return null;
  }
  try {
    const refreshed = await refreshGmailAccessToken({ refreshToken: connection.refreshToken });
    const profile = await fetchGmailProfile(refreshed.accessToken).catch(() => null);
    await upsertProviderConnection({
      userId: connection.userId,
      provider: 'gmail',
      accessToken: refreshed.accessToken,
      refreshToken: connection.refreshToken,
      tokenExpiry: refreshed.tokenExpiry,
      scopes: refreshed.scope.length ? refreshed.scope : connection.scopes,
      metadata: {
        ...connection.metadata,
        emailAddress: profile?.emailAddress ?? connection.metadata?.emailAddress ?? null,
        messagesTotal: profile?.messagesTotal ?? null,
        threadsTotal: profile?.threadsTotal ?? null,
        refreshedAt: new Date().toISOString(),
      },
    });
    return refreshed.accessToken;
  } catch (err: any) {
    logError('[gmail-polling] token refresh failed', { userId: connection.userId, error: err?.message ?? String(err) });
    await updateProviderConnectionStatus({
      userId: connection.userId,
      provider: 'gmail',
      status: 'AUTH_EXPIRED',
      metadata: {
        ...connection.metadata,
        authExpiredAt: new Date().toISOString(),
        lastAuthError: 'refresh_failed',
      },
    }).catch(() => undefined);
    return null;
  }
};

/**
 * Runs a single Gmail polling tick: discovers all Gmail provider connections
 * across users, filters by tier cadence + last-polled watermark, refreshes
 * access tokens as needed, enqueues travel-relevant messages, and advances
 * the `lastPolledAt` watermark per connection.
 *
 * Returns a per-connection result array so callers (tests, admin surfaces)
 * can inspect what happened. Errors on a single connection never abort the
 * tick — they are reported in the result entry as `error`.
 */
export const runGmailPollingTick = async (opts: { now?: Date } = {}): Promise<GmailPollingResult[]> => {
  const now = opts.now ?? new Date();
  const connections = await listProviderConnectionsByProvider('gmail');
  const results: GmailPollingResult[] = [];

  for (const connection of connections) {
    const tierKey = await resolveTierKey(connection.userId);
    const rules = tierKey !== 'unknown' ? INGESTION_TIER_RULES[tierKey] : null;
    const intervalHours = rules?.gmailPollIntervalHours ?? null;
    if (!intervalHours) {
      results.push({
        connectionId: connection.id,
        userId: connection.userId,
        tierKey,
        skipped: true,
        reason: 'tier_not_eligible',
      });
      continue;
    }

    const lastPolledAt = (connection.metadata?.[GMAIL_LAST_POLLED_AT_KEY] as string | undefined) ?? null;
    if (!hasElapsedSince(lastPolledAt, intervalHours, now)) {
      results.push({
        connectionId: connection.id,
        userId: connection.userId,
        tierKey,
        skipped: true,
        reason: 'not_due',
      });
      continue;
    }

    if (connection.status === 'AUTH_EXPIRED') {
      results.push({
        connectionId: connection.id,
        userId: connection.userId,
        tierKey,
        skipped: true,
        reason: 'auth_expired',
      });
      continue;
    }

    const accessToken = await ensureFreshGmailAccessToken(connection);
    if (!accessToken) {
      results.push({
        connectionId: connection.id,
        userId: connection.userId,
        tierKey,
        skipped: true,
        reason: 'no_access_token',
      });
      continue;
    }

    try {
      const payloads = await buildGmailIngestionPayloads({
        accessToken,
        userId: connection.userId,
        lookbackDays: rules!.gmailLookbackDays,
      });
      for (const payload of payloads) {
        await enqueueIngestionPipelineJob(
          payload,
          rules!.llmEscalations === 'LARGE_ALLOWED',
          rules!.llmEscalations !== 'NONE',
        );
      }
      await mergeProviderConnectionMetadata(connection.id, {
        [GMAIL_LAST_POLLED_AT_KEY]: now.toISOString(),
        lastPollPayloads: payloads.length,
      });
      results.push({
        connectionId: connection.id,
        userId: connection.userId,
        tierKey,
        skipped: false,
        payloadsEnqueued: payloads.length,
      });
    } catch (err: any) {
      const reason = String(err?.message ?? err ?? 'unknown error');
      logError('[gmail-polling] tick failed for connection', { connectionId: connection.id, userId: connection.userId, reason });
      await mergeProviderConnectionMetadata(connection.id, {
        [GMAIL_LAST_POLLED_AT_KEY]: now.toISOString(),
        lastPollError: reason.slice(0, 500),
      }).catch(() => undefined);
      results.push({
        connectionId: connection.id,
        userId: connection.userId,
        tierKey,
        skipped: false,
        error: reason,
      });
    }
  }

  return results;
};

let pollerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the in-process Gmail polling scheduler unless disabled via env. The
 * scheduler fires on a fixed interval (default 15 min) and the per-tier
 * cadence is enforced inside `runGmailPollingTick` via `lastPolledAt`.
 *
 * Idempotent — calling twice without stopping keeps the original handle.
 */
export const startGmailPollingScheduler = (): boolean => {
  if (pollerHandle) return false;
  if (!getEnvFlag('GMAIL_POLLING_ENABLED', { defaultValue: true })) {
    logInfo('[gmail-polling] scheduler disabled by GMAIL_POLLING_ENABLED=false');
    return false;
  }
  if (process.env.NODE_ENV === 'test') {
    return false;
  }
  const intervalMsRaw = getEnvValue('GMAIL_POLLING_TICK_MS');
  const intervalMs = intervalMsRaw && Number.isFinite(Number(intervalMsRaw))
    ? Math.max(60_000, Number(intervalMsRaw))
    : GMAIL_POLLING_TICK_INTERVAL_MS_DEFAULT;
  logInfo(`[gmail-polling] starting scheduler (tick=${intervalMs}ms)`);
  pollerHandle = setInterval(() => {
    runGmailPollingTick().catch((err) => logError('[gmail-polling] tick error', err));
  }, intervalMs);
  // Don't block process shutdown.
  pollerHandle.unref();
  return true;
};

export const stopGmailPollingScheduler = (): void => {
  if (pollerHandle) {
    clearInterval(pollerHandle);
    pollerHandle = null;
  }
};
