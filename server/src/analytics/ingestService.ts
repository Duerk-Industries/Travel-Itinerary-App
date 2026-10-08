import { createHmac } from 'node:crypto';
import { z } from 'zod';
import {
  ensureUserInTrip,
  getOrCreateAnalyticsSubject,
  getTripById,
  insertAnalyticsEvents,
  isInternalCanaryAccount,
} from '../db';
import { getAuthSecret } from '../authConfig';
import { logError } from '../logger';
import { incrementMetric } from '../metrics';
import { getPrivacyStatus } from '../services/privacyConsentService';
import { getErasedAt } from '../services/privacyRightsService';
import type { AnalyticsEventRecord } from '../types';
import { classifyTripPhase } from '../utils/tripPhase';
import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_LIMITS,
  ANALYTICS_PLATFORMS,
  ANALYTICS_REGISTRY_VERSION,
  type AnalyticsEventName,
  type EventDefinition,
  type PropertySpec,
} from './registry';

/**
 * Product analytics admission (docs/implementation-plans/analytics-upgrade.md Phase 2).
 *
 * Every event must pass, in order: the collection flag, a fresh server-side consent
 * check (never a cached grant), erasure tombstones, strict registry validation (no
 * unknown fields, enum/boolean/bounded-int properties only), clock bounds, and trip
 * access. Identity, consent epoch and the trip pseudonym are derived here and can
 * never be asserted by a client. Only allowlisted, bounded data is stored.
 */

export class AnalyticsAdmissionError extends Error {
  constructor(public readonly code: 'ANALYTICS_COLLECTION_DISABLED' | 'ANALYTICS_CONSENT_REQUIRED' | 'ANALYTICS_INVALID_BATCH', message: string) {
    super(message);
    this.name = 'AnalyticsAdmissionError';
  }
}

export type RejectReason =
  | 'invalid' | 'unknown_event' | 'server_only_event' | 'clock_out_of_range'
  | 'trip_not_accessible' | 'not_trip_scoped' | 'erased';

export type IngestResult = {
  accepted: number;
  duplicates: number;
  rejected: Array<{ event_id: string | null; reason: RejectReason }>;
};

const RAW_EVENT_DAY_MS = 24 * 60 * 60 * 1000;
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

const specToZod = (spec: PropertySpec): z.ZodTypeAny => {
  if (spec.type === 'boolean') return z.boolean();
  if (spec.type === 'int') return z.number().int().min(spec.min).max(spec.max);
  return z.enum(spec.values as [string, ...string[]]);
};

/** Strict per-event property schemas built from the registry; every property is optional, none extra. */
const propertySchemas = new Map<string, z.ZodTypeAny>(
  ANALYTICS_EVENT_NAMES.map((name) => {
    const def: EventDefinition = ANALYTICS_EVENTS[name];
    const shape = Object.fromEntries(Object.entries(def.properties).map(([key, spec]) => [key, specToZod(spec).optional()]));
    return [name, z.object(shape).strict()];
  }),
);

const envelopeSchema = z.object({
  event_id: z.string().regex(SAFE_ID),
  schema_version: z.number().int().min(1).max(ANALYTICS_REGISTRY_VERSION),
  event_name: z.string().max(64),
  occurred_at: z.string().datetime({ offset: true }),
  session_id: z.string().regex(SAFE_ID),
  platform: z.enum(ANALYTICS_PLATFORMS),
  app_version: z.string().regex(/^[A-Za-z0-9._+-]{1,32}$/),
  device_timezone: z.string().regex(/^[A-Za-z0-9_+\-/]{1,64}$/).optional(),
  trip_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
}).strict();

const batchSchema = z.object({ events: z.array(z.unknown()).min(1).max(ANALYTICS_LIMITS.maxBatchEvents) }).strict();

/** Keyed pseudonym for a trip: stable for joins inside analytics, useless without the server secret. */
export const tripRef = (tripId: string): string =>
  createHmac('sha256', getAuthSecret()).update(`analytics-trip:${tripId}`).digest('hex').slice(0, 32);

const expiresAt = (receivedAt: Date, def: EventDefinition): string =>
  new Date(receivedAt.getTime() + def.retentionDays * RAW_EVENT_DAY_MS).toISOString();

type Admitted = {
  subjectId: string;
  epoch: number;
  analyticsErasedAt: number | null;
  excludedReason: string | null;
};

const admit = async (userId: string, role: string | undefined, privacySignalActive: boolean): Promise<Admitted> => {
  const status = await getPrivacyStatus(userId, privacySignalActive);
  if (!status.productCollectionEnabled) {
    throw new AnalyticsAdmissionError('ANALYTICS_COLLECTION_DISABLED', 'Product analytics collection is disabled');
  }
  if (!status.productAnalyticsAllowed) {
    throw new AnalyticsAdmissionError('ANALYTICS_CONSENT_REQUIRED', 'Product analytics consent is required');
  }
  if (await getErasedAt(userId, 'account')) {
    throw new AnalyticsAdmissionError('ANALYTICS_CONSENT_REQUIRED', 'Account has been erased');
  }
  const erasedAt = await getErasedAt(userId, 'analytics');
  const [subjectId, canary] = await Promise.all([
    getOrCreateAnalyticsSubject(userId, status.productEpoch),
    isInternalCanaryAccount(userId).catch(() => false),
  ]);
  return {
    subjectId,
    epoch: status.productEpoch,
    analyticsErasedAt: erasedAt ? new Date(erasedAt).getTime() : null,
    // Kept for pipeline checks but excluded from product reports.
    excludedReason: role === 'admin' ? 'admin' : canary ? 'internal_canary' : null,
  };
};

type TripContext = { accessible: boolean; startDate: string | null; endDate: string | null };

const loadTrip = async (userId: string, tripId: string, cache: Map<string, TripContext>): Promise<TripContext> => {
  const cached = cache.get(tripId);
  if (cached) return cached;
  let context: TripContext = { accessible: false, startDate: null, endDate: null };
  try {
    if (await ensureUserInTrip(tripId, userId)) {
      const trip = await getTripById(tripId);
      context = { accessible: true, startDate: trip?.startDate ?? null, endDate: trip?.endDate ?? null };
    }
  } catch {
    context = { accessible: false, startDate: null, endDate: null };
  }
  cache.set(tripId, context);
  return context;
};

export const ingestClientEvents = async (params: {
  userId: string;
  role?: string;
  body: unknown;
  privacySignalActive: boolean;
  now?: Date;
}): Promise<IngestResult> => {
  const batch = batchSchema.safeParse(params.body);
  if (!batch.success) throw new AnalyticsAdmissionError('ANALYTICS_INVALID_BATCH', `Expected { events: [1..${ANALYTICS_LIMITS.maxBatchEvents}] }`);
  const admitted = await admit(params.userId, params.role, params.privacySignalActive);

  const receivedAt = params.now ?? new Date();
  const rejected: IngestResult['rejected'] = [];
  const records: AnalyticsEventRecord[] = [];
  const trips = new Map<string, TripContext>();
  const reject = (eventId: unknown, reason: RejectReason) =>
    rejected.push({ event_id: typeof eventId === 'string' && SAFE_ID.test(eventId) ? eventId : null, reason });

  for (const raw of batch.data.events) {
    const parsed = envelopeSchema.safeParse(raw);
    if (!parsed.success) {
      reject((raw as { event_id?: unknown } | null)?.event_id, 'invalid');
      continue;
    }
    const event = parsed.data;
    const def = (ANALYTICS_EVENTS as Record<string, EventDefinition>)[event.event_name];
    if (!def) {
      reject(event.event_id, 'unknown_event');
      continue;
    }
    if (def.source !== 'client') {
      reject(event.event_id, 'server_only_event');
      continue;
    }
    const properties = propertySchemas.get(event.event_name)!.safeParse(event.properties);
    if (!properties.success) {
      reject(event.event_id, 'invalid');
      continue;
    }
    const occurred = new Date(event.occurred_at).getTime();
    if (occurred < receivedAt.getTime() - ANALYTICS_LIMITS.maxEventAgeMs || occurred > receivedAt.getTime() + ANALYTICS_LIMITS.maxFutureSkewMs) {
      reject(event.event_id, 'clock_out_of_range');
      continue;
    }
    // Events from before an analytics-data deletion were queued pre-erasure; never re-store them.
    if (admitted.analyticsErasedAt !== null && occurred <= admitted.analyticsErasedAt) {
      reject(event.event_id, 'erased');
      continue;
    }
    let ref: string | null = null;
    let phase = classifyTripPhase({ occurredAt: event.occurred_at });
    if (event.trip_id) {
      if (!def.tripScoped) {
        reject(event.event_id, 'not_trip_scoped');
        continue;
      }
      const trip = await loadTrip(params.userId, event.trip_id, trips);
      if (!trip.accessible) {
        reject(event.event_id, 'trip_not_accessible');
        continue;
      }
      ref = tripRef(event.trip_id);
      phase = classifyTripPhase({
        occurredAt: event.occurred_at,
        startDate: trip.startDate,
        endDate: trip.endDate,
        deviceTimezone: event.device_timezone,
      });
    }
    const props = properties.data as Record<string, string | number | boolean>;
    records.push({
      id: `${admitted.subjectId}:${admitted.epoch}:${event.event_id}`,
      eventId: event.event_id,
      subjectId: admitted.subjectId,
      purposeEpoch: admitted.epoch,
      eventName: event.event_name,
      family: def.family,
      source: 'client',
      feature: typeof props.feature === 'string' ? props.feature : null,
      platform: event.platform,
      appVersion: event.app_version,
      sessionId: event.session_id,
      tripRef: ref,
      tripPhase: phase.phase,
      timezoneSource: phase.timezoneSource,
      dateVersion: phase.dateVersion,
      properties: props,
      schemaVersion: event.schema_version,
      excludedReason: admitted.excludedReason,
      occurredAt: new Date(occurred).toISOString(),
      receivedAt: receivedAt.toISOString(),
      expiresAt: expiresAt(receivedAt, def),
    });
  }

  const inserted = records.length ? await insertAnalyticsEvents(records) : [];
  const result = { accepted: inserted.length, duplicates: records.length - inserted.length, rejected };
  incrementMetric('analytics.events_accepted', undefined, result.accepted);
  if (result.duplicates) incrementMetric('analytics.events_duplicate', undefined, result.duplicates);
  for (const r of rejected) incrementMetric('analytics.events_rejected', { reason: r.reason });
  return result;
};

// ── Server outcome events ────────────────────────────────────────────────────
// Emitted after a business transaction commits. Fire-and-forget through a bounded
// in-process queue: analytics can never slow down or fail the business action, and
// each event still passes the same fresh consent check before it is stored.

type ServerEventInput = {
  userId: string;
  role?: string;
  eventName: AnalyticsEventName;
  properties?: Record<string, string | number | boolean>;
  tripId?: string | null;
  occurredAt?: string;
};

const SERVER_QUEUE_MAX = 1_000;
const serverQueue: ServerEventInput[] = [];
let draining: Promise<void> | null = null;

const storeServerEvent = async (input: ServerEventInput): Promise<boolean> => {
  const def = (ANALYTICS_EVENTS as Record<string, EventDefinition>)[input.eventName];
  if (!def || def.source !== 'server') return false;
  const properties = propertySchemas.get(input.eventName)!.safeParse(input.properties ?? {});
  if (!properties.success) return false;
  let admitted: Admitted;
  try {
    admitted = await admit(input.userId, input.role, false);
  } catch (err) {
    if (err instanceof AnalyticsAdmissionError) return false; // no consent / disabled: silently not collected
    throw err;
  }
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const receivedAt = new Date();
  let phase = classifyTripPhase({ occurredAt });
  let ref: string | null = null;
  if (input.tripId && def.tripScoped) {
    const trip = await getTripById(input.tripId).catch(() => null);
    ref = tripRef(input.tripId);
    // Servers have no device zone; without a trip timezone the phase stays unknown.
    phase = classifyTripPhase({ occurredAt, startDate: trip?.startDate ?? null, endDate: trip?.endDate ?? null });
  }
  const eventId = `srv_${createHmac('sha256', getAuthSecret()).update(`${input.userId}:${input.eventName}:${occurredAt}:${Math.random()}`).digest('hex').slice(0, 24)}`;
  const props = properties.data as Record<string, string | number | boolean>;
  const inserted = await insertAnalyticsEvents([{
    id: `${admitted.subjectId}:${admitted.epoch}:${eventId}`,
    eventId,
    subjectId: admitted.subjectId,
    purposeEpoch: admitted.epoch,
    eventName: input.eventName,
    family: def.family,
    source: 'server',
    feature: typeof props.feature === 'string' ? props.feature : null,
    platform: 'server',
    appVersion: 'server',
    sessionId: null,
    tripRef: ref,
    tripPhase: phase.phase,
    timezoneSource: phase.timezoneSource,
    dateVersion: phase.dateVersion,
    properties: props,
    schemaVersion: ANALYTICS_REGISTRY_VERSION,
    excludedReason: admitted.excludedReason,
    occurredAt,
    receivedAt: receivedAt.toISOString(),
    expiresAt: expiresAt(receivedAt, def),
  }]);
  return inserted.length > 0;
};

const drain = async (): Promise<void> => {
  while (serverQueue.length) {
    const next = serverQueue.shift()!;
    try {
      await storeServerEvent(next);
    } catch (err) {
      incrementMetric('analytics.server_event_failed', { event: next.eventName });
      logError('[analytics] server event failed', { event: next.eventName, error: err instanceof Error ? err.message : String(err) });
    }
  }
};

/** Queue a server outcome event. Never throws and never awaits storage. */
export const recordServerEvent = (input: ServerEventInput): void => {
  if (serverQueue.length >= SERVER_QUEUE_MAX) {
    incrementMetric('analytics.server_event_dropped', { event: input.eventName });
    return;
  }
  serverQueue.push(input);
  if (!draining) {
    draining = new Promise<void>((resolve) => setImmediate(resolve))
      .then(drain)
      .finally(() => { draining = null; });
  }
};

/** Test helper: wait until queued server events are stored. */
export const flushServerEventsForTesting = async (): Promise<void> => {
  while (draining || serverQueue.length) {
    if (draining) await draining;
    else await drain();
  }
};
