/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import * as db from '../src/db';
import { closePool, initDb, insertAnalyticsEvents } from '../src/db';
import { buildAll, cohort, MIN_COHORT, rate } from '../src/analytics/metrics';
import { clearAnalyticsReportCacheForTesting, renderReportCsv } from '../src/analytics/reportService';
import type { AnalyticsEventRecord } from '../src/types';
import { cleanupTestUsersByEmail, makeAdminUser, registerAndLoginWebUser } from './helpers';

let seq = 0;
const ev = (subject: string, overrides: Partial<AnalyticsEventRecord> = {}): AnalyticsEventRecord => {
  seq += 1;
  const occurredAt = overrides.occurredAt ?? new Date(Date.now() - 60_000).toISOString();
  return {
    id: `${subject}:0:evt_${seq}`,
    eventId: `evt_${seq}`,
    subjectId: subject,
    purposeEpoch: 0,
    eventName: 'feature_viewed',
    family: 'view',
    source: 'client',
    feature: 'lodging',
    platform: 'web',
    appVersion: '1.4.0',
    sessionId: `ses_${subject}`,
    tripRef: null,
    tripPhase: 'unknown',
    timezoneSource: 'none',
    dateVersion: null,
    properties: { feature: 'lodging' },
    schemaVersion: 1,
    excludedReason: null,
    occurredAt,
    receivedAt: occurredAt,
    expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    ...overrides,
  };
};
const subjects = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

describe('analytics metric definitions (Phase 5)', () => {
  it('suppresses distinct-account counts below the minimum cohort, but not zero', () => {
    expect(cohort(0)).toEqual({ value: 0, suppressed: false });
    expect(cohort(MIN_COHORT - 1)).toEqual({ value: null, suppressed: true });
    expect(cohort(MIN_COHORT)).toEqual({ value: MIN_COHORT, suppressed: false });
    expect(rate(cohort(5), cohort(20))).toBeNull(); // suppressed numerator → no rate
    expect(rate(cohort(10), cohort(0))).toBeNull();
    expect(rate(cohort(10), cohort(20))).toBe(0.5);
  });

  it('computes reach, meaningful adoption and repeat use over consenting active accounts', () => {
    const active = subjects(20, 's');
    const events = [
      ...active.map((s) => ev(s, { eventName: 'session_started', feature: null, properties: { resumed: false } })),
      ...active.slice(0, 12).map((s) => ev(s)), // 12 viewed lodging
      ...active.slice(0, 10).map((s) => ev(s, { occurredAt: new Date(Date.now() - 3 * 86_400_000).toISOString() })), // 10 viewed on another day
      ...active.slice(0, 11).map((s) => ev(s, { eventName: 'item_saved', source: 'server', feature: null, properties: { item_type: 'lodging', created: true } })),
      ...active.slice(0, 3).map((s) => ev(s, { feature: 'packing', properties: { feature: 'packing' } })), // tiny cohort
      ev('admin-1', { excludedReason: 'admin' }), // never counted
    ];
    const { adoption } = buildAll(events);
    expect(adoption.activeAccounts).toEqual({ value: 20, suppressed: false });
    const lodging = adoption.features.find((f) => f.feature === 'lodging')!;
    expect(lodging).toMatchObject({ reachAccounts: { value: 12 }, reach: 0.6, adoptedAccounts: { value: 11 }, meaningfulAdoption: 0.55, repeatAccounts: { value: 10 } });
    expect(lodging.repeatUse).toBeCloseTo(10 / 12);
    const packing = adoption.features.find((f) => f.feature === 'packing')!;
    expect(packing).toMatchObject({ reachAccounts: { value: null, suppressed: true }, reach: null });
  });

  it('reports task failure rates only for large enough cohorts', () => {
    const many = subjects(10, 't');
    const events = [
      ...many.map((s) => ev(s, { eventName: 'task_started', family: 'task', properties: { task: 'import', feature: 'imports' } })),
      ...many.slice(0, 2).map((s) => ev(s, { eventName: 'task_failed', family: 'task', properties: { task: 'import', feature: 'imports', failure: 'network' } })),
      ev('few-1', { eventName: 'task_started', family: 'task', properties: { task: 'invite', feature: 'collaboration' } }),
    ];
    const tasks = buildAll(events).adoption.tasks;
    expect(tasks.find((t) => t.task === 'import')).toMatchObject({ started: 10, failureRate: 0.2 });
    expect(tasks.find((t) => t.task === 'invite')).toMatchObject({ accounts: { suppressed: true }, started: null, failureRate: null });
  });

  it('splits platform cohorts into web-only, native-only and both', () => {
    const events = [
      ...subjects(10, 'w').map((s) => ev(s, { platform: 'web' })),
      ...subjects(10, 'n').map((s) => ev(s, { platform: 'ios' })),
      ...subjects(10, 'b').flatMap((s) => [ev(s, { platform: 'web' }), ev(s, { platform: 'android' })]),
    ];
    const { platform } = buildAll(events);
    expect(platform.cohorts).toEqual({ webOnly: { value: 10, suppressed: false }, nativeOnly: { value: 10, suppressed: false }, both: { value: 10, suppressed: false } });
    expect(platform.platforms.find((p) => p.platform === 'web')?.accounts.value).toBe(20);
  });

  it('measures during-trip engagement over traveler–trip pairs with classified activity', () => {
    const travelers = subjects(20, 'p');
    const events = [
      ...travelers.map((s) => ev(s, { tripRef: `trip-${s}`, tripPhase: 'pre_trip', timezoneSource: 'device' })),
      ...travelers.slice(0, 12).map((s) => ev(s, { tripRef: `trip-${s}`, tripPhase: 'during_trip', timezoneSource: 'device' })),
      ev('u-1', { tripRef: 'trip-u', tripPhase: 'unknown', timezoneSource: 'none' }), // excluded from denominator
    ];
    const { tripPhase } = buildAll(events);
    expect(tripPhase.travelerTripPairs.value).toBe(20);
    expect(tripPhase.duringTripPairs.value).toBe(12);
    expect(tripPhase.duringTripEngagement).toBe(0.6);
    expect(tripPhase.timezoneCoverage.device).toBeCloseTo(32 / 33);
  });

  it('exports CSV with definitions and blank suppressed cells', () => {
    const report = { ...buildAll([...subjects(10, 'c').map((s) => ev(s)), ...subjects(3, 'x').map((s) => ev(s, { feature: 'packing', properties: { feature: 'packing' } }))]),
      meta: { metricVersion: 'v1', windowDays: 30, from: 'a', to: 'b', timezone: 'UTC' as const, eventsScanned: 13, truncated: false, latestReceivedAt: null, generatedAt: 'now', minCohort: MIN_COHORT, definitions: require('../src/analytics/metrics').DEFINITIONS, notes: [] } };
    const csv = renderReportCsv('adoption', report);
    expect(csv).toMatch(/^# WanderBunnies analytics export: adoption/);
    expect(csv).toMatch(/# suppression: counts below 10 distinct accounts are blank/);
    expect(csv).toMatch(/\nlodging,10,0\.7692,/);
    expect(csv).toMatch(/\npacking,,,0,0\.0000,0,\n?/);
  });
});

describe('admin analytics endpoints (Phase 5)', () => {
  const emails = [`analytics-report-admin-${Date.now()}@example.com`, `analytics-report-user-${Date.now()}@example.com`];
  let adminToken = '';
  let userToken = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    adminToken = (await makeAdminUser({ firstName: 'Report', lastName: 'Admin', email: emails[0], password: 'reportadmin1' })).token;
    userToken = (await registerAndLoginWebUser({ firstName: 'Report', lastName: 'User', email: emails[1], password: 'reportuser1' })).token;
  });
  beforeEach(() => clearAnalyticsReportCacheForTesting());
  afterAll(async () => {
    await cleanupTestUsersByEmail(emails);
    await closePool();
  });

  it('is admin-only and accepts only the fixed windows', async () => {
    await request(app).get('/api/admin/analytics/report').set('Authorization', `Bearer ${userToken}`).expect(403);
    await request(app).get('/api/admin/analytics/report?days=14').set('Authorization', `Bearer ${adminToken}`).expect(400);
    await request(app).get('/api/admin/analytics/export.csv?days=30&view=raw').set('Authorization', `Bearer ${adminToken}`).expect(400);
  });

  it('serves suppressed aggregates with metadata, reliability, and an audited CSV export', async () => {
    await insertAnalyticsEvents([
      ...subjects(12, 'api').map((s) => ev(s)),
      ...subjects(2, 'tiny').map((s) => ev(s, { feature: 'blog', properties: { feature: 'blog' } })),
    ]);
    const res = await request(app).get('/api/admin/analytics/report?days=7').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.body.meta).toMatchObject({ metricVersion: 'v1', windowDays: 7, minCohort: 10, timezone: 'UTC' });
    expect(res.body.meta.notes.join(' ')).toMatch(/Consenting users only/);
    expect(res.body.adoption.features.find((f: any) => f.feature === 'lodging').reachAccounts.value).toBeGreaterThanOrEqual(12);
    expect(res.body.adoption.features.find((f: any) => f.feature === 'blog').reachAccounts).toEqual({ value: null, suppressed: true });
    expect(JSON.stringify(res.body)).not.toMatch(/api-0|subjectId|tripRef/);

    const reliability = await request(app).get('/api/admin/analytics/reliability?days=7').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(reliability.body.serverTimings.scope).toMatch(/this server instance/);
    expect(Array.isArray(reliability.body.providerAttempts.providers)).toBe(true);

    const csv = await request(app).get('/api/admin/analytics/export.csv?days=7&view=adoption').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toMatch(/^# WanderBunnies analytics export: adoption/);
    const audits = await db.listAuditLog({ action: 'ANALYTICS_REPORT_EXPORTED' });
    expect(audits.entries.length).toBeGreaterThanOrEqual(1);
  });
});
