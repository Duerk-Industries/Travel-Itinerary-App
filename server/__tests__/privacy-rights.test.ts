/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import * as db from '../src/db';
import {
  closePool,
  getErasureTombstone,
  getItineraryGenerationMetrics,
  getPrivacyPreferences,
  initDb,
  listProviderCostLedgerEntries,
  recordItineraryGenerationMetrics,
  updatePrivacyPreferences,
} from '../src/db';
import { settleProviderAttempt } from '../src/apis/providerBudgeting';
import {
  clearErasureCacheForTesting,
  computeRightsDueDate,
  processPendingErasureJobs,
  requestErasure,
  subjectHash,
} from '../src/services/privacyRightsService';
import { runPrivacyRetention } from '../src/services/privacyRetentionService';
import { cleanupTestUsersByEmail, makeAdminUser, registerAndLoginWebUser } from './helpers';

const PASSWORD = 'privacyrights1';
let seq = 0;
const newUser = async () => {
  seq += 1;
  const email = `privacy-rights-${Date.now()}-${seq}@example.com`;
  const { token, userId } = await registerAndLoginWebUser({ firstName: 'Priv', lastName: 'Acy', email, password: PASSWORD });
  return { token, userId, email };
};

const seedMetric = async (userId: string, tripId: string) => {
  const generationId = `gen-${seq}-${Math.random().toString(36).slice(2)}`;
  await recordItineraryGenerationMetrics({
    generationId,
    userId,
    tripId,
    provider: 'openai',
    model: 'gpt-4o-mini',
    outcome: 'success',
    tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    stageMetrics: [],
    evaluation: { requestedBy: { userId, tripId }, score: 0.9 },
  } as any);
  return generationId;
};

const grantDiagnostics = (userId: string) =>
  updatePrivacyPreferences(userId, {
    revision: 0,
    optionalDiagnostics: true,
    platform: 'web',
    productNoticeVersion: '2026-10-08',
    diagnosticsNoticeVersion: '2026-10-08',
  } as any);

describe('privacy rights (analytics Phase 4)', () => {
  const emails: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
  });
  beforeEach(() => clearErasureCacheForTesting());
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await cleanupTestUsersByEmail(emails);
    await closePool();
  });

  it('DELETE /api/account/analytics-data unlinks telemetry, rotates the diagnostics pseudonym and records a job', async () => {
    const user = await newUser();
    emails.push(user.email);
    const generationId = await seedMetric(user.userId, 'trip-1');
    await grantDiagnostics(user.userId);
    const pseudonymBefore = (await getPrivacyPreferences(user.userId)).diagnosticPseudonym;
    expect(pseudonymBefore).toBeTruthy();

    const res = await request(app).delete('/api/account/analytics-data').set('Authorization', `Bearer ${user.token}`).expect(200);
    expect(res.body).toMatchObject({ scope: 'analytics', status: 'completed' });
    expect(res.body.steps.itinerary_generation_metrics).toMatchObject({ status: 'done', affected: 1 });
    expect(res.body.steps.diagnostic_pseudonym).toMatchObject({ status: 'done', affected: 1 });
    expect(res.body.steps.ai_captures.status).toBe('not_applicable');
    expect(res.body.steps.cost_ledger).toBeUndefined(); // account scope only
    expect(JSON.stringify(res.body)).not.toContain(user.userId);

    const metric = await getItineraryGenerationMetrics(generationId);
    expect(JSON.stringify(metric)).not.toContain(user.userId);
    expect(JSON.stringify(metric)).not.toContain('trip-1');
    expect((await getPrivacyPreferences(user.userId)).diagnosticPseudonym).not.toBe(pseudonymBefore);
    expect(await getErasureTombstone(subjectHash(user.userId), 'analytics')).toBeTruthy();

    const list = await request(app).get('/api/account/erasure-requests').set('Authorization', `Bearer ${user.token}`).expect(200);
    expect(list.body.requests).toHaveLength(1);
    await request(app).get(`/api/account/erasure-requests/${res.body.id}`).set('Authorization', `Bearer ${user.token}`).expect(200);
  });

  it('does not let one user read another user\'s erasure job', async () => {
    const a = await newUser();
    const b = await newUser();
    emails.push(a.email, b.email);
    const job = await requestErasure(a.userId, 'analytics', 'user');
    await request(app).get(`/api/account/erasure-requests/${job.id}`).set('Authorization', `Bearer ${b.token}`).expect(404);
  });

  it('account deletion archives consent evidence, unlinks the cost ledger and blocks later re-linking', async () => {
    const user = await newUser();
    await grantDiagnostics(user.userId);
    const month = '2098-03';
    await settleProviderAttempt({ provider: 'GOOGLE_STATIC_MAPS', unitType: 'request', costPerRequestUsd: 0.002, userId: user.userId, windowKey: month });
    const archiveSpy = jest.spyOn(db, 'archivePrivacyChoiceEvidence');

    await request(app).delete('/api/account').set('Authorization', `Bearer ${user.token}`).expect(204);

    expect(archiveSpy).toHaveBeenCalledWith(user.userId, subjectHash(user.userId));
    expect(await archiveSpy.mock.results[0].value).toBeGreaterThan(0);
    expect((await listProviderCostLedgerEntries(month)).every((row) => row.userId === null)).toBe(true);
    expect(await getErasureTombstone(subjectHash(user.userId), 'account')).toBeTruthy();

    // An async job finishing after deletion must not attribute spend to the deleted account.
    await settleProviderAttempt({ provider: 'GOOGLE_STATIC_MAPS', unitType: 'request', costPerRequestUsd: 0.002, userId: user.userId, windowKey: month });
    const rows = await listProviderCostLedgerEntries(month);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.userId === null)).toBe(true);
    expect(rows[1].attribution).toBe('system');
  });

  it('retries a failed erasure step and clears the raw user ID only when complete', async () => {
    const user = await newUser();
    emails.push(user.email);
    jest.spyOn(db, 'delinkItineraryGenerationMetricsForUser').mockRejectedValueOnce(new Error('firestore timeout'));
    const first = await requestErasure(user.userId, 'analytics', 'user');
    expect(first.status).toBe('failed');
    expect(first.userId).toBe(user.userId);
    expect(first.steps.itinerary_generation_metrics.status).toBe('failed');
    expect(first.steps.diagnostic_pseudonym.status).toBe('done');

    const summary = await processPendingErasureJobs();
    expect(summary.completed).toBeGreaterThanOrEqual(1);
    const after = await db.getErasureJob(first.id);
    expect(after).toMatchObject({ status: 'completed', userId: null, attempts: 2 });
  });

  it('exports schema v2 with privacy, age verification, cost and diagnostics sections', async () => {
    const user = await newUser();
    emails.push(user.email);
    await grantDiagnostics(user.userId);
    await seedMetric(user.userId, 'trip-export');
    await settleProviderAttempt({ provider: 'GOOGLE_STATIC_MAPS', unitType: 'request', costPerRequestUsd: 0.002, userId: user.userId, windowKey: '2098-04' });

    const res = await request(app).get('/api/account/export').set('Authorization', `Bearer ${user.token}`).expect(200);
    expect(res.body.schemaVersion).toBe(2);
    expect(res.body.privacy.preferences).toMatchObject({ optionalDiagnostics: true });
    expect(res.body.privacy.preferences.diagnosticPseudonym).toBeUndefined();
    expect(res.body.privacy.choiceHistory.length).toBeGreaterThan(0);
    expect(res.body.ageVerification).toHaveProperty('source');
    expect(res.body.costLedger).toEqual([expect.objectContaining({ provider: 'GOOGLE_STATIC_MAPS', estimatedCostUsd: 0.002 })]);
    expect(res.body.diagnostics.itineraryGenerations).toEqual([expect.objectContaining({ tripId: 'trip-export', outcome: 'success' })]);
    expect(res.body.analytics.productAnalytics).toEqual({ status: 'none', events: [] });
  });

  it('computes statutory deadlines and one-time extensions per jurisdiction', () => {
    expect(computeRightsDueDate('GDPR', '2026-01-31T10:00:00.000Z', false)).toBe('2026-02-28T10:00:00.000Z');
    expect(computeRightsDueDate('UK_GDPR', '2026-03-15T00:00:00.000Z', false)).toBe('2026-04-15T00:00:00.000Z');
    expect(computeRightsDueDate('GDPR', '2026-03-15T00:00:00.000Z', true)).toBe('2026-06-15T00:00:00.000Z');
    expect(computeRightsDueDate('CCPA', '2026-03-01T00:00:00.000Z', false)).toBe('2026-04-15T00:00:00.000Z');
    expect(computeRightsDueDate('US_STATE', '2026-03-01T00:00:00.000Z', true)).toBe('2026-05-30T00:00:00.000Z');
    expect(computeRightsDueDate('OTHER', '2026-03-01T00:00:00.000Z', false)).toBe('2026-03-31T00:00:00.000Z');
  });

  it('tracks manual rights requests for admins with deadlines, overdue flags, one extension and audit entries', async () => {
    const adminEmail = `privacy-rights-admin-${Date.now()}@example.com`;
    emails.push(adminEmail);
    const user = await newUser();
    emails.push(user.email);
    const { token } = await makeAdminUser({ firstName: 'Rights', lastName: 'Admin', email: adminEmail, password: PASSWORD });
    const auth = { Authorization: `Bearer ${token}` };

    await request(app).post('/api/admin/privacy/rights-requests').set('Authorization', `Bearer ${user.token}`).send({}).expect(403);
    await request(app).post('/api/admin/privacy/rights-requests').set(auth).send({ requestType: 'erasure', jurisdiction: 'MARS', reason: 'email request' }).expect(400);

    const receivedAt = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const created = await request(app).post('/api/admin/privacy/rights-requests').set(auth)
      .send({ requestType: 'access', jurisdiction: 'GDPR', receivedAt, accountUserId: user.userId, notes: 'via support@', reason: 'email request' })
      .expect(201);
    expect(created.body).toMatchObject({ status: 'open', extended: false, overdue: true, subjectHash: subjectHash(user.userId) });
    expect(JSON.stringify(created.body)).not.toContain(user.userId);

    const extended = await request(app).patch(`/api/admin/privacy/rights-requests/${created.body.id}`).set(auth)
      .send({ extend: true, status: 'in_progress', reason: 'complex request, requester notified' }).expect(200);
    expect(extended.body).toMatchObject({ extended: true, status: 'in_progress', overdue: false });
    const again = await request(app).patch(`/api/admin/privacy/rights-requests/${created.body.id}`).set(auth)
      .send({ extend: true, reason: 'second extension attempt' }).expect(200);
    expect(again.body.dueAt).toBe(extended.body.dueAt); // only one extension

    const closed = await request(app).patch(`/api/admin/privacy/rights-requests/${created.body.id}`).set(auth)
      .send({ status: 'completed', reason: 'export sent' }).expect(200);
    expect(closed.body.closedAt).toBeTruthy();

    const list = await request(app).get('/api/admin/privacy/rights-requests').set(auth).expect(200);
    expect(list.body.requests.some((r: any) => r.id === created.body.id)).toBe(true);
    const audits = await db.listAuditLog({ action: 'PRIVACY_RIGHTS_REQUEST_UPDATED' });
    expect(audits.entries.length).toBeGreaterThanOrEqual(3);

    const jobs = await request(app).get('/api/admin/privacy/erasure-jobs').set(auth).expect(200);
    expect(jobs.body.jobs.every((job: any) => !('userId' in job))).toBe(true);
  });

  it('privacy retention unlinks linked data older than 13 months and purges consent evidence after 3 years', async () => {
    const user = await newUser();
    emails.push(user.email);
    await settleProviderAttempt({ provider: 'GOOGLE_STATIC_MAPS', unitType: 'request', costPerRequestUsd: 0.002, userId: user.userId, windowKey: '2020-01' });
    await grantDiagnostics(user.userId);
    expect(await db.archivePrivacyChoiceEvidence(user.userId, subjectHash(user.userId))).toBeGreaterThan(0);

    const result = await runPrivacyRetention(new Date('2031-01-01T00:00:00.000Z'));
    expect('results' in result && result.errors).toEqual([]);
    if (!('results' in result)) throw new Error('lease unexpectedly held');
    expect(result.results.costLedgerDelinked).toBeGreaterThanOrEqual(1);
    expect(result.results.consentEvidencePurged).toBeGreaterThanOrEqual(1);
    expect((await listProviderCostLedgerEntries('2020-01')).every((row) => row.userId === null)).toBe(true);
  });
});
