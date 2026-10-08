import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import {
  ANALYTICS_EVENTS,
  ANALYTICS_LIMITS,
  ANALYTICS_REGISTRY_VERSION,
  type AnalyticsEventName,
  type AnalyticsFeature,
  type ClientAnalyticsEvent,
} from '../../../packages/analytics/src/registry';

/**
 * Client product-analytics tracker (docs/implementation-plans/analytics-upgrade.md Phase 2).
 *
 * - Does nothing unless configureAnalytics({ enabled: true }) — App passes the server's
 *   `productAnalyticsAllowed`, so there is no collection before consent, while the flag
 *   is off, or under a GPC/DNT signal. Turning it off purges everything queued.
 * - Memory only: at most ANALYTICS_LIMITS.maxQueuedEvents, each dropped after 24 h. Nothing
 *   is written to device storage, so there is no queue to clean up after withdrawal.
 * - Batches are frozen with stable event IDs, so a retried batch is deduplicated by the
 *   server. Network/5xx/429 retry with backoff; a 403 (consent withdrawn, collection
 *   disabled) stops collection instead of retrying.
 * - Sessions: a new session after 30 minutes without activity; no heartbeats, and API
 *   polling never counts as activity (only explicit track() calls do).
 */

type Properties = Record<string, string | number | boolean>;
type Fetcher = (url: string, init: RequestInit & { keepalive?: boolean }) => Promise<{ ok: boolean; status: number }>;

type State = {
  enabled: boolean;
  backendUrl: string;
  token: string | null;
  queue: ClientAnalyticsEvent[];
  inFlight: boolean;
  sessionId: string | null;
  lastActivityAt: number;
  backoffUntil: number;
  backoffMs: number;
  viewed: Set<string>;
  timer: ReturnType<typeof setInterval> | null;
};

const MAX_BACKOFF_MS = 5 * 60 * 1000;

const state: State = {
  enabled: false,
  backendUrl: '',
  token: null,
  queue: [],
  inFlight: false,
  sessionId: null,
  lastActivityAt: 0,
  backoffUntil: 0,
  backoffMs: 0,
  viewed: new Set(),
  timer: null,
};

let now = (): number => Date.now();
let fetcher: Fetcher = (url, init) => fetch(url, init);

const randomId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

const appVersion = (): string => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const version = require('expo-constants').default?.expoConfig?.version;
    return typeof version === 'string' && /^[A-Za-z0-9._+-]{1,32}$/.test(version) ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
};

const deviceTimezone = (): string | undefined => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && /^[A-Za-z0-9_+\-/]{1,64}$/.test(zone) ? zone : undefined;
  } catch {
    return undefined;
  }
};

const platform = (): ClientAnalyticsEvent['platform'] =>
  Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';

const purge = (): void => {
  state.queue = [];
  state.viewed.clear();
  state.sessionId = null;
  state.backoffMs = 0;
  state.backoffUntil = 0;
};

const enqueue = (eventName: AnalyticsEventName, properties: Properties, tripId?: string | null): void => {
  const at = now();
  state.queue = state.queue.filter((e) => at - new Date(e.occurred_at).getTime() < ANALYTICS_LIMITS.maxEventAgeMs);
  if (state.queue.length >= ANALYTICS_LIMITS.maxQueuedEvents) state.queue.shift(); // drop oldest
  state.queue.push({
    event_id: randomId('evt'),
    schema_version: ANALYTICS_REGISTRY_VERSION,
    event_name: eventName,
    occurred_at: new Date(at).toISOString(),
    session_id: state.sessionId!,
    platform: platform(),
    app_version: appVersion(),
    device_timezone: deviceTimezone(),
    ...(tripId && ANALYTICS_EVENTS[eventName].tripScoped ? { trip_id: tripId } : {}),
    properties,
  });
};

/** Starts a new session after 30 minutes without activity (or on first use). */
const touchSession = (): void => {
  const at = now();
  const idle = state.sessionId !== null && at - state.lastActivityAt > ANALYTICS_LIMITS.sessionIdleMs;
  if (state.sessionId === null || idle) {
    const resumed = state.sessionId !== null;
    state.sessionId = randomId('ses');
    state.viewed.clear();
    state.lastActivityAt = at;
    enqueue('session_started', { resumed });
  }
  state.lastActivityAt = at;
};

export const track = (eventName: AnalyticsEventName, properties: Properties = {}, options: { tripId?: string | null } = {}): void => {
  if (!state.enabled || !state.token) return;
  if (ANALYTICS_EVENTS[eventName].source !== 'client') return;
  touchSession();
  enqueue(eventName, properties, options.tripId);
  if (state.queue.length >= ANALYTICS_LIMITS.maxBatchEvents) void flushAnalytics();
};

/** Sends up to one batch. Safe to call often; concurrent calls are coalesced. */
export const flushAnalytics = async (options: { keepalive?: boolean } = {}): Promise<void> => {
  if (!state.enabled || !state.token || state.inFlight || !state.queue.length) return;
  if (now() < state.backoffUntil) return;
  const at = now();
  state.queue = state.queue.filter((e) => at - new Date(e.occurred_at).getTime() < ANALYTICS_LIMITS.maxEventAgeMs);
  const batch = state.queue.slice(0, ANALYTICS_LIMITS.maxBatchEvents);
  if (!batch.length) return;
  const token = state.token;
  state.inFlight = true;
  try {
    const response = await fetcher(`${state.backendUrl}/api/analytics/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: options.keepalive,
    });
    if (state.token !== token) return; // signed out or switched accounts mid-flight; queue already purged
    if (response.ok || response.status === 400 || response.status === 413) {
      // Accepted, or permanently malformed: never resend the same batch.
      const sent = new Set(batch.map((e) => e.event_id));
      state.queue = state.queue.filter((e) => !sent.has(e.event_id));
      state.backoffMs = 0;
      state.backoffUntil = 0;
    } else if (response.status === 401 || response.status === 403) {
      // Consent withdrawn, collection disabled, or session invalid: stop, don't retry.
      state.enabled = false;
      purge();
    } else {
      state.backoffMs = Math.min(MAX_BACKOFF_MS, state.backoffMs ? state.backoffMs * 2 : 5_000);
      state.backoffUntil = now() + state.backoffMs;
    }
  } catch {
    state.backoffMs = Math.min(MAX_BACKOFF_MS, state.backoffMs ? state.backoffMs * 2 : 5_000);
    state.backoffUntil = now() + state.backoffMs;
  } finally {
    state.inFlight = false;
  }
};

let lifecycleAttached = false;
const attachLifecycle = (): void => {
  if (lifecycleAttached) return;
  lifecycleAttached = true;
  AppState.addEventListener('change', (next) => {
    if (next === 'background' || next === 'inactive') void flushAnalytics({ keepalive: true });
  });
  const doc = (globalThis as { document?: { addEventListener?: (type: string, cb: () => void) => void; visibilityState?: string } }).document;
  doc?.addEventListener?.('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') void flushAnalytics({ keepalive: true });
  });
};

/**
 * Call whenever the account, backend or consent changes. `enabled` must be the server's
 * `productAnalyticsAllowed`. Disabling, signing out or switching accounts purges the queue.
 */
export const configureAnalytics = (config: { backendUrl: string; token: string | null; enabled: boolean }): void => {
  const accountChanged = config.token !== state.token;
  const enabled = config.enabled && Boolean(config.token);
  if (!enabled || accountChanged) purge();
  state.backendUrl = config.backendUrl;
  state.token = config.token;
  state.enabled = enabled;
  if (enabled) {
    attachLifecycle();
    if (!state.timer) {
      state.timer = setInterval(() => { void flushAnalytics(); }, ANALYTICS_LIMITS.flushIntervalMs);
      (state.timer as { unref?: () => void }).unref?.();
    }
  } else if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
};

/** Records one feature_viewed per feature, trip and session (safe under Strict Mode double effects). */
export const useTrackView = (
  feature: AnalyticsFeature | null,
  tripId: string | null,
  entryPoint: 'nav' | 'deep_link' | 'restore' | 'other' = 'nav',
): void => {
  useEffect(() => {
    if (!feature || !state.enabled) return;
    touchSession();
    const key = `${state.sessionId}:${feature}:${tripId ?? ''}`;
    if (state.viewed.has(key)) return;
    state.viewed.add(key);
    track('feature_viewed', { feature, entry_point: entryPoint }, { tripId });
  }, [feature, tripId, entryPoint]);
};

export const getAnalyticsQueueForTesting = (): readonly ClientAnalyticsEvent[] => state.queue;

export const __resetAnalyticsForTests = (overrides: { fetcher?: Fetcher; now?: () => number } = {}): void => {
  if (state.timer) clearInterval(state.timer);
  Object.assign(state, {
    enabled: false, backendUrl: '', token: null, queue: [], inFlight: false, sessionId: null,
    lastActivityAt: 0, backoffUntil: 0, backoffMs: 0, viewed: new Set<string>(), timer: null,
  });
  fetcher = overrides.fetcher ?? ((url, init) => fetch(url, init));
  now = overrides.now ?? (() => Date.now());
};
