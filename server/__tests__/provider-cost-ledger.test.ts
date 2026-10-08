/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import axios from 'axios';
import { postOpenAiChatCompletion } from '../src/apis/openaiApi';
import { app } from '../src/app';
import {
  closePool,
  delinkProviderCostLedgerBefore,
  delinkProviderCostLedgerUser,
  getApiCostCounter,
  initDb,
  listProviderCostLedgerEntries,
} from '../src/db';
import * as db from '../src/db';
import {
  estimateAiCostMicros,
  recordProviderRequestCost,
  settleProviderAttempt,
} from '../src/apis/providerBudgeting';
import { getMetricCounterSnapshot, resetMetricCountersForTests } from '../src/metrics';
import { runWithRequestContext } from '../src/requestContext';
import { buildCostLedgerReport } from '../src/services/costLedgerReportService';
import { cleanupTestUsersByEmail, makeAdminUser, registerAndLoginWebUser } from './helpers';

// Each test uses its own far-future month so ledger rows and budget counters never mix.
let monthSeq = 0;
const nextMonth = (): string => `2099-${String((monthSeq += 1)).padStart(2, '0')}`;

const ledger = (windowKey: string) => listProviderCostLedgerEntries(windowKey);

describe('provider cost ledger: settlement', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
  });
  beforeEach(() => resetMetricCountersForTests());
  afterEach(() => jest.restoreAllMocks());

  it('settles a priced token attempt once: one ledger row and the same amount on the budget counter', async () => {
    const windowKey = nextMonth();
    const expected = estimateAiCostMicros({ provider: 'OPENAI', model: 'gpt-4o-mini', promptTokens: 1000, completionTokens: 500 });
    expect(expected).toBeGreaterThan(0);

    const result = await settleProviderAttempt({
      provider: 'openai', attemptId: 'chatcmpl-1', unitType: 'tokens', model: 'gpt-4o-mini',
      promptTokens: 1000, completionTokens: 500, caller: 'ITINERARY', featureKey: 'itinerary', userId: 'user-a', tripId: 'trip-1', windowKey,
    });

    expect(result).toMatchObject({ attemptId: 'OPENAI:chatcmpl-1', duplicate: false, costStatus: 'estimated', estimatedCostMicros: expected });
    const rows = await ledger(windowKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'OPENAI', model: 'gpt-4o-mini', userId: 'user-a', tripId: 'trip-1', attribution: 'user',
      featureKey: 'itinerary', promptTokens: 1000, completionTokens: 500, estimatedCostMicros: expected,
    });
    expect(rows[0].priceVersion).toMatch(/^OPENAI\/gpt-4o-mini@/);
    expect(await getApiCostCounter('OPENAI', windowKey)).toBe(expected);
  });

  it('ignores a replayed attempt ID, so retries never double count spend', async () => {
    const windowKey = nextMonth();
    const input = { provider: 'OPENAI', attemptId: 'chatcmpl-dup', unitType: 'tokens' as const, model: 'gpt-4o-mini', promptTokens: 200, completionTokens: 100, windowKey };
    const first = await settleProviderAttempt(input);
    const second = await settleProviderAttempt(input);
    expect(second.duplicate).toBe(true);
    expect(await ledger(windowKey)).toHaveLength(1);
    expect(await getApiCostCounter('OPENAI', windowKey)).toBe(first.estimatedCostMicros);
    expect(getMetricCounterSnapshot().counters['cost_ledger.duplicate_attempt']).toBe(1);
  });

  it('records an unknown price as unknown (null), never as $0, and leaves the budget counter alone', async () => {
    const windowKey = nextMonth();
    const result = await settleProviderAttempt({ provider: 'OPENAI', unitType: 'tokens', model: 'no-such-model', promptTokens: 50, completionTokens: 50, windowKey });
    expect(result).toMatchObject({ costStatus: 'unknown', estimatedCostMicros: null });
    expect((await ledger(windowKey))[0]).toMatchObject({ costStatus: 'unknown', estimatedCostMicros: null, priceVersion: null });
    expect(await getApiCostCounter('OPENAI', windowKey)).toBe(0);
  });

  it('records a failed attempt with no usage as not billable', async () => {
    const windowKey = nextMonth();
    await settleProviderAttempt({ provider: 'GEMINI', unitType: 'tokens', model: 'gemini-2.5-flash', outcome: 'failed', windowKey });
    expect((await ledger(windowKey))[0]).toMatchObject({ outcome: 'failed', costStatus: 'not_billable', estimatedCostMicros: 0 });
  });

  it('attributes to the request-context user, and treats system/anonymous callers as system', async () => {
    const windowKey = nextMonth();
    await runWithRequestContext({ requestId: 'r1', userId: 'ctx-user' }, () =>
      settleProviderAttempt({ provider: 'OPENAI', unitType: 'tokens', model: 'gpt-4o-mini', promptTokens: 10, windowKey }));
    await settleProviderAttempt({ provider: 'OPENAI', unitType: 'tokens', model: 'gpt-4o-mini', promptTokens: 10, userId: 'system', tripId: 'trip-x', windowKey });
    const rows = await ledger(windowKey);
    expect(rows.map((r) => [r.attribution, r.userId, r.tripId])).toEqual([
      ['user', 'ctx-user', null],
      ['system', null, null],
    ]);
  });

  it('settles request-priced providers, skips explicitly free ones, and records unlisted ones as unknown', async () => {
    const windowKey = nextMonth();
    await recordProviderRequestCost({ provider: 'GOOGLE_STATIC_MAPS', windowKey }); // $0.002 in api-limits.yaml
    await recordProviderRequestCost({ provider: 'OPEN_METEO', windowKey }); // listed as $0: no row
    await recordProviderRequestCost({ provider: 'SOME_UNLISTED_API', windowKey });
    const rows = await ledger(windowKey);
    expect(rows.map((r) => [r.provider, r.costStatus, r.estimatedCostMicros, r.requestUnits])).toEqual([
      ['GOOGLE_STATIC_MAPS', 'estimated', 2000, 1],
      ['SOME_UNLISTED_API', 'unknown', null, 1],
    ]);
    expect(await getApiCostCounter('GOOGLE_STATIC_MAPS', windowKey)).toBe(2000);
  });

  it('keeps counting the budget and reports the gap when the ledger write fails', async () => {
    const windowKey = nextMonth();
    jest.spyOn(db, 'insertProviderCostLedgerEntry').mockRejectedValueOnce(new Error('firestore unavailable'));
    const result = await settleProviderAttempt({ provider: 'GOOGLE_STATIC_MAPS', unitType: 'request', costPerRequestUsd: 0.002, windowKey });
    expect(result.duplicate).toBe(false);
    expect(await getApiCostCounter('GOOGLE_STATIC_MAPS', windowKey)).toBe(2000);
    expect(getMetricCounterSnapshot().counters['cost_ledger.settlement_failed']).toBe(1);
  });

  it('de-links users on deletion and on retention without losing spend', async () => {
    const windowKey = nextMonth();
    await settleProviderAttempt({ provider: 'GOOGLE_STATIC_MAPS', unitType: 'request', costPerRequestUsd: 0.002, userId: 'delete-me', tripId: 't', windowKey });
    await settleProviderAttempt({ provider: 'GOOGLE_STATIC_MAPS', unitType: 'request', costPerRequestUsd: 0.002, userId: 'keep-me', windowKey });
    expect(await delinkProviderCostLedgerUser('delete-me')).toBe(1);
    let rows = await ledger(windowKey);
    expect(rows.map((r) => r.userId).sort()).toEqual(['keep-me', null].sort());
    expect(rows.every((r) => r.estimatedCostMicros === 2000)).toBe(true);
    await delinkProviderCostLedgerBefore('2100-01');
    rows = await ledger(windowKey);
    expect(rows.every((r) => r.userId === null && r.tripId === null)).toBe(true);
  });
});

describe('provider cost ledger: OpenAI chat path', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
  });
  afterEach(() => jest.restoreAllMocks());

  const call = (userId: string) => postOpenAiChatCompletion({
    caller: 'ITINERARY_GENERATION',
    apiKey: 'test-key',
    skipApiUsageReservation: true,
    payload: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    attribution: { userId, featureKey: 'itinerary', tripId: 'trip-9' },
  });

  it('keys settlement on the OpenAI response ID and attributes it, even without usage accounting', async () => {
    const id = `chatcmpl-${Date.now()}`;
    jest.spyOn(axios, 'post').mockResolvedValue({ data: { id, usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 } } });
    await call('user-openai');
    await call('user-openai'); // same response replayed
    const month = new Date().toISOString().slice(0, 7);
    const rows = (await ledger(month)).filter((r) => r.attemptId === `OPENAI:${id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 'user-openai', featureKey: 'itinerary', tripId: 'trip-9', caller: 'ITINERARY_GENERATION', promptTokens: 120 });
  });

  it('settles a failed OpenAI call as a non-billable attempt and still throws', async () => {
    jest.spyOn(axios, 'post').mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 500, data: {} } }));
    const month = new Date().toISOString().slice(0, 7);
    const before = (await ledger(month)).filter((r) => r.outcome === 'failed' && r.userId === 'user-fail').length;
    await expect(call('user-fail')).rejects.toThrow();
    const after = (await ledger(month)).filter((r) => r.outcome === 'failed' && r.userId === 'user-fail');
    expect(after).toHaveLength(before + 1);
    expect(after[after.length - 1]).toMatchObject({ costStatus: 'not_billable', estimatedCostMicros: 0 });
  });
});

describe('provider cost ledger: monthly report', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
  });

  it('reconciles synthetic attempts exactly and keeps unknown, allocated and invoiced cost distinct', async () => {
    const windowKey = nextMonth();
    const req = (userId: string | null, featureKey: string) =>
      settleProviderAttempt({ provider: 'GOOGLE_STATIC_MAPS', unitType: 'request', costPerRequestUsd: 0.002, userId, featureKey, windowKey });
    await req('u1', 'trip_day_map');
    await req('u1', 'trip_day_map');
    await req('u2', 'lodging_preview');
    await req(null, 'blog_background');
    await settleProviderAttempt({ provider: 'MYSTERY', unitType: 'request', userId: 'u2', featureKey: 'imports', windowKey }); // unknown price

    await db.upsertProviderInvoiceRecord({
      provider: 'GOOGLE_STATIC_MAPS', windowKey, invoicedMicros: 9000, creditsMicros: 1000,
      currency: 'USD', fxRateToUsd: 1, notes: null, recordedBy: 'admin', recordedAt: new Date().toISOString(),
    });

    const report = await buildCostLedgerReport({ windowKey, sharedCostMicros: 10_000_000, activeAccounts: 4 });

    expect(report.totals).toEqual({ attempts: 5, estimatedMicros: 8000, unknownAttempts: 1, notBillableAttempts: 0, failedAttempts: 0 });
    expect(report.coverage.attributionRatio).toBeCloseTo(6000 / 8000);
    expect(report.coverage.pricingRatio).toBeCloseTo(4 / 5);
    expect(report.byFeature.find((f) => f.featureKey === 'trip_day_map')?.estimatedMicros).toBe(4000);
    expect(report.directCostPerUser).toEqual({ count: 2, medianMicros: 2000, p95Micros: 4000, maxMicros: 4000 });
    expect(report.allocation).toMatchObject({
      basis: 'allocation_v1',
      activeAccounts: 4,
      activeAccountsSource: 'provided',
      equalShareMicrosPerAccount: 2_500_000,
    });
    // Invoice net = 9000 - 1000 = 8000 = ledger estimate → exact reconciliation.
    expect(report.reconciliation).toEqual([
      expect.objectContaining({ provider: 'GOOGLE_STATIC_MAPS', invoicedNetUsdMicros: 8000, ledgerEstimatedMicros: 8000, varianceMicros: 0, withinTolerance: true }),
    ]);
    expect(JSON.stringify(report)).not.toMatch(/"u1"|"u2"/); // aggregate only: no user IDs
  });

  it('converts non-USD invoices with the recorded FX rate', async () => {
    const windowKey = nextMonth();
    await settleProviderAttempt({ provider: 'GOOGLE_STATIC_MAPS', unitType: 'request', costPerRequestUsd: 1, windowKey });
    await db.upsertProviderInvoiceRecord({
      provider: 'GOOGLE_STATIC_MAPS', windowKey, invoicedMicros: 1_000_000, creditsMicros: 0,
      currency: 'EUR', fxRateToUsd: 1.1, notes: null, recordedBy: null, recordedAt: new Date().toISOString(),
    });
    const [row] = (await buildCostLedgerReport({ windowKey })).reconciliation;
    expect(row).toMatchObject({ invoicedNetUsdMicros: 1_100_000, varianceMicros: 100_000, withinTolerance: false });
  });
});

describe('provider cost ledger: admin endpoints', () => {
  const ADMIN = { firstName: 'Cost', lastName: 'Admin', email: 'cost-ledger-admin@example.com', password: 'costadmin1' };
  const USER = { firstName: 'Cost', lastName: 'User', email: 'cost-ledger-user@example.com', password: 'costuser1' };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await cleanupTestUsersByEmail([ADMIN.email, USER.email]);
  });
  afterAll(async () => {
    await cleanupTestUsersByEmail([ADMIN.email, USER.email]);
    await closePool();
  });

  it('serves the report to admins only and validates the month', async () => {
    const { token: userToken } = await registerAndLoginWebUser(USER);
    const { token } = await makeAdminUser(ADMIN);
    await request(app).get('/api/admin/costs/ledger?month=2099-01').set('Authorization', `Bearer ${userToken}`).expect(403);
    await request(app).get('/api/admin/costs/ledger?month=2099-13').set('Authorization', `Bearer ${token}`).expect(400);
    await request(app).get('/api/admin/costs/ledger?month=2099-01&sharedCostUsd=-1').set('Authorization', `Bearer ${token}`).expect(400);
    const res = await request(app).get('/api/admin/costs/ledger?month=2099-01&sharedCostUsd=10').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.windowKey).toBe('2099-01');
    expect(res.body.allocation.sharedCostMicros).toBe(10_000_000);
  });

  it('records an invoice with an audit entry and rejects inconsistent input', async () => {
    const { token } = await makeAdminUser({ ...ADMIN, email: 'cost-ledger-admin2@example.com' });
    const url = '/api/admin/costs/invoices/google_static_maps/2099-02';
    await request(app).put(url).set('Authorization', `Bearer ${token}`).send({ invoicedAmount: 5 }).expect(400); // no reason
    await request(app).put(url).set('Authorization', `Bearer ${token}`).send({ invoicedAmount: 5, fxRateToUsd: 1.2, reason: 'October invoice' }).expect(400);
    const res = await request(app).put(url).set('Authorization', `Bearer ${token}`)
      .send({ invoicedAmount: 12.5, creditsAmount: 2.5, reason: 'October invoice', notes: 'GCP billing export' })
      .expect(200);
    expect(res.body).toMatchObject({ provider: 'GOOGLE_STATIC_MAPS', windowKey: '2099-02', invoicedMicros: 12_500_000, creditsMicros: 2_500_000, currency: 'USD' });
    const audits = await db.listAuditLog({ action: 'PROVIDER_INVOICE_RECORDED' } as any);
    expect(JSON.stringify(audits)).toMatch(/GOOGLE_STATIC_MAPS/);
    await cleanupTestUsersByEmail(['cost-ledger-admin2@example.com']);
  });
});
