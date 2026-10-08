/// <reference types="jest" />
/// <reference types="node" />
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
import { flushServerEventsForTesting, recordServerEvent } from '../src/analytics/ingestService';
import { clearAnalyticsReportCacheForTesting } from '../src/analytics/reportService';
import {
  clearRolloutCacheForTesting,
  DEFAULT_ROLLOUT,
  isEuropeanTimezone,
  isRegionExcluded,
  parseRolloutConfig,
  rolloutBucket,
  saveRolloutConfig,
} from '../src/analytics/rolloutService';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { clearErasureCacheForTesting } from '../src/services/privacyRightsService';
import { runPrivacyRetention } from '../src/services/privacyRetentionService';
import { cleanupTestUsersByEmail, futureDateString, futureDateStringPlusDays, makeAdminUser, registerAndLoginWebUser } from './helpers';

const emails: string[] = [];
let seq = 0;
const newUser = async () => {
  seq += 1;
  const email = `analytics-rollout-${Date.now()}-${seq}@example.com`;
  emails.push(email);
  return { email, ...(await registerAndLoginWebUser({ firstName: 'Roll', lastName: 'Out', email, password: 'rolloutpass1' })) };
};
const optIn = (token: string, zone = 'America/Denver') =>
  request(app).patch('/api/account/privacy-preferences').set({ Authorization: `Bearer ${token}`, 'X-Device-Timezone': zone })
    .send({ revision: 0, productAnalytics: true, platform: 'web' });
let eventSeq = 0;
const event = (overrides: Record<string, unknown> = {}) => ({
  event_id: `evt_rollout_${Date.now()}_${(eventSeq += 1)}`,
  schema_version: 1,
  event_name: 'feature_viewed',
  occurred_at: new Date().toISOString(),
  session_id: 'session_rollout_1',
  platform: 'web',
  app_version: '1.4.0',
  device_timezone: 'America/Denver',
  properties: { feature: 'lodging', entry_point: 'nav' },
  ...overrides,
});
const setRollout = async (mode: 'off' | 'internal' | 'percentage' | 'all', percent = 0, excludeEurope = false) => {
  await saveRolloutConfig('product_analytics', { mode, percent, excludeEurope }, null);
  clearRolloutCacheForTesting();
};
const stored = async (userId: string) => listAnalyticsEventsForSubjects(await listAnalyticsSubjectsForUser(userId));

describe('rollout configuration (Phase 6)', () => {
  it('validates configs and defaults to internal-only with Europe excluded', () => {
    expect(DEFAULT_ROLLOUT).toEqual({ mode: 'internal', percent: 0, excludeEurope: true });
    expect(parseRolloutConfig({ mode: 'percentage', percent: 25, excludeEurope: true })).toEqual({ mode: 'percentage', percent: 25, excludeEurope: true });
    expect(parseRolloutConfig('{"mode":"all","percent":0,"excludeEurope":false}')).toEqual({ mode: 'all', percent: 0, excludeEurope: false });
    for (const bad of [{ mode: 'everyone', percent: 0, excludeEurope: true }, { mode: 'percentage', percent: 101, excludeEurope: true }, { mode: 'all', percent: 0 }, 'not json']) {
      expect(parseRolloutConfig(bad)).toBeNull();
    }
  });

  it('assigns stable, independent, roughly uniform buckets', () => {
    expect(rolloutBucket('user-1', 'product_analytics')).toBe(rolloutBucket('user-1', 'product_analytics'));
    const buckets = Array.from({ length: 2_000 }, (_, i) => rolloutBucket(`user-${i}`, 'product_analytics'));
    const under25 = buckets.filter((b) => b < 25).length / buckets.length;
    expect(under25).toBeGreaterThan(0.2);
    expect(under25).toBeLessThan(0.3);
  });

  it('treats European and unknown time zones as excluded only when the rollout says so', () => {
    expect(isEuropeanTimezone('Europe/Paris')).toBe(true);
    expect(isEuropeanTimezone('Atlantic/Canary')).toBe(true);
    expect(isEuropeanTimezone('America/New_York')).toBe(false);
    const excluding = { mode: 'all' as const, percent: 0, excludeEurope: true };
    expect(isRegionExcluded(excluding, 'Europe/London')).toBe(true);
    expect(isRegionExcluded(excluding, null)).toBe(true); // unknown → excluded
    expect(isRegionExcluded(excluding, 'Asia/Tokyo')).toBe(false);
    expect(isRegionExcluded({ ...excluding, excludeEurope: false }, 'Europe/London')).toBe(false);
  });
});

describe('rollout enforcement (Phase 6)', () => {
  let adminToken = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    const adminEmail = `analytics-rollout-admin-${Date.now()}@example.com`;
    emails.push(adminEmail);
    adminToken = (await makeAdminUser({ firstName: 'Roll', lastName: 'Admin', email: adminEmail, password: 'rolloutadmin1' })).token;
  });
  beforeEach(async () => {
    clearErasureCacheForTesting();
    clearAnalyticsReportCacheForTesting();
    await setFeatureFlag('analytics_collection_enabled', true, null);
    clearFeatureFlagCacheForTesting();
    await setRollout('internal', 0, false);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await setFeatureFlag('analytics_collection_enabled', false, null);
    await saveRolloutConfig('product_analytics', DEFAULT_ROLLOUT, null);
    clearFeatureFlagCacheForTesting();
    clearRolloutCacheForTesting();
    await cleanupTestUsersByEmail(emails);
    await closePool();
  });

  it('internal mode offers collection to internal accounts only', async () => {
    const user = await newUser();
    const status = await request(app).get('/api/account/privacy-preferences').set('Authorization', `Bearer ${user.token}`).expect(200);
    expect(status.body.productCollectionEnabled).toBe(false);
    expect((await optIn(user.token).expect(403)).body.code).toBe('PRIVACY_PURPOSE_UNAVAILABLE');

    jest.spyOn(db, 'isInternalCanaryAccount').mockResolvedValue(true);
    await optIn(user.token).expect(200);
    await request(app).post('/api/analytics/events').set('Authorization', `Bearer ${user.token}`).send({ events: [event()] }).expect(200);
    expect(await stored(user.userId)).toHaveLength(1);
  });

  it('percentage mode includes a stable share of everyone else', async () => {
    const user = await newUser();
    await setRollout('percentage', 100);
    await optIn(user.token).expect(200);
    await setRollout('percentage', 0);
    const res = await request(app).post('/api/analytics/events').set('Authorization', `Bearer ${user.token}`).send({ events: [event()] }).expect(403);
    expect(res.body.code).toBe('ANALYTICS_COLLECTION_DISABLED');
  });

  it('off mode and the global flag both stop collection for everyone, including admins', async () => {
    const user = await newUser();
    await setRollout('all');
    await optIn(user.token).expect(200);
    await setRollout('off');
    await request(app).post('/api/analytics/events').set('Authorization', `Bearer ${user.token}`).send({ events: [event()] }).expect(403);
    await setRollout('all');
    await setFeatureFlag('analytics_collection_enabled', false, null);
    clearFeatureFlagCacheForTesting();
    await request(app).post('/api/analytics/events').set('Authorization', `Bearer ${user.token}`).send({ events: [event()] }).expect(403);
  });

  it('Europe exclusion hides the choice, rejects European events, and drops server events for European or unknown devices', async () => {
    await setRollout('all', 0, true);
    const user = await newUser();
    const european = await request(app).get('/api/account/privacy-preferences').set({ Authorization: `Bearer ${user.token}`, 'X-Device-Timezone': 'Europe/Paris' }).expect(200);
    expect(european.body.productCollectionEnabled).toBe(false);
    expect((await optIn(user.token, 'Europe/Paris').expect(403)).body.code).toBe('PRIVACY_PURPOSE_UNAVAILABLE');

    await optIn(user.token, 'America/Denver').expect(200);
    // Server events before any client event: zone unknown → dropped.
    const groupId = (await listGroupsForUser(user.userId))[0].id as string;
    await request(app).post('/api/trips').set('Authorization', `Bearer ${user.token}`)
      .send({ name: 'Rollout Trip', groupId, startDate: futureDateString(20), endDate: futureDateStringPlusDays(3, 20) }).expect(201);
    await flushServerEventsForTesting();
    expect(await stored(user.userId)).toEqual([]);

    const res = await request(app).post('/api/analytics/events').set('Authorization', `Bearer ${user.token}`)
      .send({ events: [event({ device_timezone: 'Europe/Berlin' }), event({ device_timezone: undefined }), event()] }).expect(200);
    expect(res.body.rejected.map((r: any) => r.reason)).toEqual(['region_excluded', 'region_excluded']);
    expect(res.body.accepted).toBe(1);

    // Last seen zone is now America/Denver, so server events are collected.
    recordServerEvent({ userId: user.userId, eventName: 'invite_accepted', properties: { invite_type: 'group' } });
    await flushServerEventsForTesting();
    expect((await stored(user.userId)).map((e) => e.eventName).sort()).toEqual(['feature_viewed', 'invite_accepted']);
  });

  it('lets admins read and change rollout with a reason, audited', async () => {
    const user = await newUser();
    await request(app).put('/api/admin/analytics/rollout/product_analytics').set('Authorization', `Bearer ${user.token}`).send({}).expect(403);
    await request(app).put('/api/admin/analytics/rollout/product_analytics').set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'percentage', percent: 10, excludeEurope: true }).expect(400); // no reason
    await request(app).put('/api/admin/analytics/rollout/sales').set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'all', percent: 0, excludeEurope: true, reason: 'test' }).expect(400);
    const saved = await request(app).put('/api/admin/analytics/rollout/product_analytics').set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'percentage', percent: 10, excludeEurope: true, reason: 'Canary step 2' }).expect(200);
    expect(saved.body).toEqual({ purpose: 'product_analytics', mode: 'percentage', percent: 10, excludeEurope: true });
    const read = await request(app).get('/api/admin/analytics/rollout').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(read.body.product_analytics).toEqual({ flagEnabled: true, mode: 'percentage', percent: 10, excludeEurope: true });
    const audits = await db.listAuditLog({ action: 'ADMIN_SETTING_UPDATED' });
    expect(JSON.stringify(audits.entries)).toMatch(/Canary step 2/);
  });
});

describe('golden journey: consent → ingest → report → withdraw → erase → retention (Phase 6)', () => {
  const journeyEmails: string[] = [];
  let adminToken = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await setFeatureFlag('analytics_collection_enabled', true, null);
    clearFeatureFlagCacheForTesting();
    await setRollout('all');
    const adminEmail = `analytics-journey-admin-${Date.now()}@example.com`;
    journeyEmails.push(adminEmail);
    adminToken = (await makeAdminUser({ firstName: 'Journey', lastName: 'Admin', email: adminEmail, password: 'journeyadmin1' })).token;
  });
  afterAll(async () => {
    await setFeatureFlag('analytics_collection_enabled', false, null);
    await saveRolloutConfig('product_analytics', DEFAULT_ROLLOUT, null);
    clearFeatureFlagCacheForTesting();
    clearRolloutCacheForTesting();
    await cleanupTestUsersByEmail(journeyEmails);
  });

  it('measures ten consenting travelers, then removes one completely', async () => {
    const travelers = [];
    for (let i = 0; i < 10; i += 1) {
      const email = `analytics-journey-${Date.now()}-${i}@example.com`;
      journeyEmails.push(email);
      const user = await registerAndLoginWebUser({ firstName: 'Journey', lastName: `Traveler${i}`, email, password: 'journeypass1' });
      await optIn(user.token).expect(200);
      const groupId = (await listGroupsForUser(user.userId))[0].id as string;
      const trip = await request(app).post('/api/trips').set('Authorization', `Bearer ${user.token}`)
        .send({ name: `Journey ${i}`, groupId, startDate: futureDateString(10), endDate: futureDateStringPlusDays(5, 10) }).expect(201);
      const tripId = trip.body.trip?.id ?? trip.body.id;
      await request(app).post('/api/analytics/events').set('Authorization', `Bearer ${user.token}`)
        .send({ events: [event({ trip_id: tripId }), event({ event_name: 'session_started', properties: { resumed: false } })] }).expect(200);
      travelers.push({ ...user, tripId });
    }
    await flushServerEventsForTesting();
    clearAnalyticsReportCacheForTesting();

    const report = await request(app).get('/api/admin/analytics/report?days=7').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const lodging = report.body.adoption.features.find((f: any) => f.feature === 'lodging');
    expect(lodging.reachAccounts.value).toBeGreaterThanOrEqual(10);
    expect(report.body.adoption.features.find((f: any) => f.feature === 'create_trip').adoptedAccounts.value).toBeGreaterThanOrEqual(10);
    expect(report.body.tripPhase.phases.find((p: any) => p.phase === 'pre_trip').accounts.value).toBeGreaterThanOrEqual(10);

    // One traveler withdraws: further events are refused…
    const leaver = travelers[0];
    await request(app).patch('/api/account/privacy-preferences').set('Authorization', `Bearer ${leaver.token}`)
      .send({ revision: 1, productAnalytics: false, platform: 'web' }).expect(200);
    await request(app).post('/api/analytics/events').set('Authorization', `Bearer ${leaver.token}`).send({ events: [event()] }).expect(403);
    // …and deletes what was collected.
    await request(app).delete('/api/account/analytics-data').set('Authorization', `Bearer ${leaver.token}`).expect(200);
    expect(await listAnalyticsSubjectsForUser(leaver.userId)).toEqual([]);

    clearAnalyticsReportCacheForTesting();
    const after = await request(app).get('/api/admin/analytics/report?days=7').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const lodgingAfter = after.body.adoption.features.find((f: any) => f.feature === 'lodging').reachAccounts;
    expect(lodgingAfter.value === null || lodgingAfter.value === lodging.reachAccounts.value - 1).toBe(true);

    // Retention eventually removes everyone's raw events.
    const result = await runPrivacyRetention(new Date(Date.now() + 91 * 86_400_000));
    if (!('results' in result)) throw new Error('lease unexpectedly held');
    expect(await stored(travelers[1].userId)).toEqual([]);
  });
});
