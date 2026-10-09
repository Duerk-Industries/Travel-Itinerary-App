/// <reference types="jest" />
/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import request from 'supertest';
import { app } from '../src/app';
import * as db from '../src/db';
import {
  closePool,
  initDb,
  listAnalyticsEventsForSubjects,
  listAnalyticsSubjectsForUser,
  listGroupsForUser,
  setFeatureFlag,
} from '../src/db';
import { flushServerEventsForTesting, recordServerEvent, tripRef } from '../src/analytics/ingestService';
import { ANALYTICS_LIMITS } from '../src/analytics/registry';
import { clearRolloutCacheForTesting, saveRolloutConfig } from '../src/analytics/rolloutService';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { savePrivacyChoice } from '../src/services/privacyConsentService';
import { clearErasureCacheForTesting, requestErasure } from '../src/services/privacyRightsService';
import { runPrivacyRetention } from '../src/services/privacyRetentionService';
import { cleanupTestUsersByEmail, futureDateString, futureDateStringPlusDays, registerAndLoginWebUser } from './helpers';

const repoRoot = path.resolve(__dirname, '..', '..');
const PASSWORD = 'analyticsingest1';
const emails: string[] = [];
let seq = 0;

const newUser = async (opts: { consent?: boolean } = {}) => {
  seq += 1;
  const email = `analytics-ingest-${Date.now()}-${seq}@example.com`;
  emails.push(email);
  const { token, userId } = await registerAndLoginWebUser({ firstName: 'Ana', lastName: 'Lytics', email, password: PASSWORD });
  if (opts.consent !== false) await savePrivacyChoice(userId, { revision: 0, productAnalytics: true, platform: 'web' } as any);
  return { token, userId };
};

const createTrip = async (token: string, userId: string) => {
  const groupId = (await listGroupsForUser(userId))[0].id as string;
  const res = await request(app).post('/api/trips').set('Authorization', `Bearer ${token}`)
    .send({ name: 'Analytics Trip', groupId, startDate: futureDateString(30), endDate: futureDateStringPlusDays(4, 30) })
    .expect(201);
  return (res.body.trip?.id ?? res.body.id) as string;
};

let eventSeq = 0;
const event = (overrides: Record<string, unknown> = {}) => ({
  event_id: `evt_${Date.now()}_${(eventSeq += 1)}`,
  schema_version: 1,
  event_name: 'feature_viewed',
  occurred_at: new Date().toISOString(),
  session_id: 'session_abcdefgh',
  platform: 'web',
  app_version: '1.4.0',
  device_timezone: 'America/New_York',
  properties: { feature: 'itinerary', entry_point: 'nav' },
  ...overrides,
});

const post = (token: string, events: unknown[], headers: Record<string, string> = {}) =>
  request(app).post('/api/analytics/events').set({ Authorization: `Bearer ${token}`, ...headers }).send({ events });

const storedFor = async (userId: string) => listAnalyticsEventsForSubjects(await listAnalyticsSubjectsForUser(userId));

describe('analytics ingest (Phase 2)', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    // Rollout targeting is covered by analytics-rollout.test.ts; here everyone is in the cohort.
    await saveRolloutConfig('product_analytics', { mode: 'all', percent: 0, excludeEurope: false }, null);
    await saveRolloutConfig('optional_diagnostics', { mode: 'all', percent: 0, excludeEurope: false }, null);
    clearRolloutCacheForTesting();
  });
  beforeEach(async () => {
    clearErasureCacheForTesting();
    await setFeatureFlag('analytics_collection_enabled', true, null);
    clearFeatureFlagCacheForTesting();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await setFeatureFlag('analytics_collection_enabled', false, null);
    clearFeatureFlagCacheForTesting();
    await cleanupTestUsersByEmail(emails);
    await closePool();
  });

  it('keeps the server registry mirror identical to packages/analytics', () => {
    expect(() => execFileSync(process.execPath, [path.join(repoRoot, 'scripts/sync-analytics-registry.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('stores nothing without consent, and nothing while collection is disabled', async () => {
    const noConsent = await newUser({ consent: false });
    const res = await post(noConsent.token, [event()]).expect(403);
    expect(res.body.code).toBe('ANALYTICS_CONSENT_REQUIRED');
    expect(await storedFor(noConsent.userId)).toEqual([]);

    const consented = await newUser();
    await setFeatureFlag('analytics_collection_enabled', false, null);
    clearFeatureFlagCacheForTesting();
    const off = await post(consented.token, [event()]).expect(403);
    expect(off.body.code).toBe('ANALYTICS_COLLECTION_DISABLED');
    expect(await storedFor(consented.userId)).toEqual([]);
  });

  it('honors Global Privacy Control and Do Not Track even after consent', async () => {
    const user = await newUser();
    expect((await post(user.token, [event()], { 'Sec-GPC': '1' }).expect(403)).body.code).toBe('ANALYTICS_CONSENT_REQUIRED');
    expect((await post(user.token, [event()], { DNT: '1' }).expect(403)).body.code).toBe('ANALYTICS_CONSENT_REQUIRED');
  });

  it('stops collecting immediately after withdrawal', async () => {
    const user = await newUser();
    await post(user.token, [event()]).expect(200);
    await savePrivacyChoice(user.userId, { revision: 1, productAnalytics: false, platform: 'web' } as any);
    await post(user.token, [event()]).expect(403);
    expect(await storedFor(user.userId)).toHaveLength(1);
  });

  it('accepts valid events, derives identity server-side, and is idempotent on retry', async () => {
    const user = await newUser();
    const tripId = await createTrip(user.token, user.userId);
    const e = event({ trip_id: tripId });
    const first = await post(user.token, [e]).expect(200);
    expect(first.body).toEqual({ accepted: 1, duplicates: 0, rejected: [] });
    const retry = await post(user.token, [e]).expect(200);
    expect(retry.body).toEqual({ accepted: 0, duplicates: 1, rejected: [] });

    const [stored] = await storedFor(user.userId);
    expect(stored).toMatchObject({ eventName: 'feature_viewed', feature: 'itinerary', platform: 'web', tripRef: tripRef(tripId), tripPhase: 'pre_trip', timezoneSource: 'device', excludedReason: null });
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(user.userId);
    expect(serialized).not.toContain(tripId);
  });

  it('classifies trip phase with the trip destination zone when one is known', async () => {
    const user = await newUser();
    const tripId = await createTrip(user.token, user.userId);
    await db.setTripTimezone(tripId, 'Asia/Tokyo');
    await post(user.token, [event({ trip_id: tripId, device_timezone: 'America/New_York' })]).expect(200);
    const [stored] = await storedFor(user.userId);
    expect(stored).toMatchObject({ timezoneSource: 'trip', tripPhase: 'pre_trip' });
  });

  it('rejects unknown fields, free text, unknown events, server-only events and spoofed identity', async () => {
    const user = await newUser();
    const res = await post(user.token, [
      event({ properties: { feature: 'itinerary', destination: 'Paris' } }), // property not in registry
      event({ properties: { feature: 'not-a-feature' } }), // enum violation
      event({ event_name: 'made_up_event', properties: {} }),
      event({ event_name: 'trip_created', properties: { via_wizard: true } }), // server-only
      event({ user_id: 'someone-else' }), // identity is never client-asserted
      event({ analytics_subject_id: 'forged' }),
      event({ properties: { feature: 'itinerary' } }), // valid
    ]).expect(200);
    expect(res.body.accepted).toBe(1);
    expect(res.body.rejected.map((r: any) => r.reason)).toEqual(['invalid', 'invalid', 'unknown_event', 'server_only_event', 'invalid', 'invalid']);
  });

  it('enforces batch size, payload size and clock bounds', async () => {
    const user = await newUser();
    const tooMany = Array.from({ length: ANALYTICS_LIMITS.maxBatchEvents + 1 }, () => event());
    expect((await post(user.token, tooMany).expect(400)).body.code).toBe('ANALYTICS_INVALID_BATCH');
    const huge = Array.from({ length: 5 }, () => ({ ...event(), padding: 'x'.repeat(8_000) }));
    expect((await post(user.token, huge).expect(413)).body.code).toBe('ANALYTICS_PAYLOAD_TOO_LARGE');
    const old = new Date(Date.now() - ANALYTICS_LIMITS.maxEventAgeMs - 60_000).toISOString();
    const future = new Date(Date.now() + ANALYTICS_LIMITS.maxFutureSkewMs + 60_000).toISOString();
    const res = await post(user.token, [event({ occurred_at: old }), event({ occurred_at: future })]).expect(200);
    expect(res.body.rejected.map((r: any) => r.reason)).toEqual(['clock_out_of_range', 'clock_out_of_range']);
  });

  it('rejects trip references the user cannot access, and trips on events that are not trip-scoped', async () => {
    const owner = await newUser();
    const stranger = await newUser();
    const tripId = await createTrip(owner.token, owner.userId);
    const res = await post(stranger.token, [
      event({ trip_id: tripId }),
      event({ event_name: 'session_started', properties: { resumed: false }, trip_id: tripId }),
    ]).expect(200);
    expect(res.body.rejected.map((r: any) => r.reason)).toEqual(['trip_not_accessible', 'not_trip_scoped']);
  });

  it('refuses events queued before an analytics-data deletion, but accepts later ones', async () => {
    const user = await newUser();
    const before = event({ occurred_at: new Date(Date.now() - 60_000).toISOString() });
    await requestErasure(user.userId, 'analytics', 'user');
    clearErasureCacheForTesting();
    const after = event({ occurred_at: new Date(Date.now() + 1_000).toISOString() });
    const res = await post(user.token, [before, after]).expect(200);
    expect(res.body.accepted).toBe(1);
    expect(res.body.rejected).toEqual([{ event_id: before.event_id, reason: 'erased' }]);
  });

  it('marks admin and internal canary traffic for exclusion from reports', async () => {
    const user = await newUser();
    jest.spyOn(db, 'isInternalCanaryAccount').mockResolvedValue(true);
    await post(user.token, [event()]).expect(200);
    expect((await storedFor(user.userId))[0].excludedReason).toBe('internal_canary');
  });

  it('records server outcome events asynchronously and only with consent', async () => {
    const consented = await newUser();
    const tripId = await createTrip(consented.token, consented.userId); // POST /api/trips emits trip_created
    const refused = await newUser({ consent: false });
    await createTrip(refused.token, refused.userId);
    recordServerEvent({ userId: consented.userId, eventName: 'item_saved', tripId, properties: { item_type: 'lodging', created: true } });
    recordServerEvent({ userId: consented.userId, eventName: 'item_saved', properties: { item_type: 'free text' } as any }); // invalid → dropped
    await flushServerEventsForTesting();

    const names = (await storedFor(consented.userId)).map((e) => [e.eventName, e.source]).sort();
    expect(names).toEqual([['item_saved', 'server'], ['trip_created', 'server']]);
    expect(await storedFor(refused.userId)).toEqual([]);
  });

  it('records item_saved for successful item creates and updates only', async () => {
    const user = await newUser();
    const tripId = await createTrip(user.token, user.userId);
    const lodging = await request(app).post('/api/lodgings').set('Authorization', `Bearer ${user.token}`)
      .send({ tripId, name: 'Analytics Hotel', checkInDate: futureDateString(30), checkOutDate: futureDateStringPlusDays(2, 30), rooms: 1, totalCost: 200, costPerNight: 100, paidBy: [] })
      .expect(201);
    const lodgingId = lodging.body.id ?? lodging.body.lodging?.id;
    await request(app).post('/api/lodgings').set('Authorization', `Bearer ${user.token}`).send({ tripId }).expect(400); // invalid → no event
    if (lodgingId) {
      await request(app).put(`/api/lodgings/${lodgingId}`).set('Authorization', `Bearer ${user.token}`)
        .send({ tripId, name: 'Analytics Hotel 2', checkInDate: futureDateString(30), checkOutDate: futureDateStringPlusDays(2, 30), rooms: 1, totalCost: 200, costPerNight: 100, paidBy: [] });
    }
    await flushServerEventsForTesting();
    const saved = (await storedFor(user.userId)).filter((e) => e.eventName === 'item_saved');
    expect(saved.length).toBeGreaterThanOrEqual(1);
    expect(saved[0]).toMatchObject({ source: 'server', tripRef: tripRef(tripId), properties: { item_type: 'lodging', created: true } });
    expect(saved.every((e) => e.properties.item_type === 'lodging')).toBe(true);
  });

  it('erases events with Delete analytics data, exports them, and expires them by retention', async () => {
    const user = await newUser();
    await post(user.token, [event(), event({ event_name: 'session_started', properties: { resumed: false } })]).expect(200);

    const exported = await request(app).get('/api/account/export').set('Authorization', `Bearer ${user.token}`).expect(200);
    expect(exported.body.analytics.productAnalytics.status).toBe('collected');
    expect(exported.body.analytics.productAnalytics.events).toHaveLength(2);
    expect(JSON.stringify(exported.body.analytics)).not.toMatch(/subjectId|tripRef/);

    const job = await request(app).delete('/api/account/analytics-data').set('Authorization', `Bearer ${user.token}`).expect(200);
    expect(job.body.steps.product_analytics_events).toMatchObject({ status: 'done', affected: 2 });
    expect(await listAnalyticsSubjectsForUser(user.userId)).toEqual([]);

    // Retention: anything past its 90-day expiry is purged.
    clearErasureCacheForTesting();
    await post(user.token, [event({ occurred_at: new Date(Date.now() + 2_000).toISOString() })]).expect(200);
    const result = await runPrivacyRetention(new Date(Date.now() + 91 * 86_400_000));
    if (!('results' in result)) throw new Error('lease unexpectedly held');
    expect(result.results.analyticsEventsExpired).toBeGreaterThanOrEqual(1);
    expect(await storedFor(user.userId)).toEqual([]);
  });
});
