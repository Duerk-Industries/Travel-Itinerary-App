import { randomUUID } from 'crypto';
import * as db from '../src/db';
import { claimProviderSpend, releaseUndispatchedSpend, estimateRequestCostMicros, reserveProviderSpendBatch, settleProviderAttempt, withSpendScope } from '../src/apis/providerBudgeting';
import type { ApiSpendReservation } from '../src/types';
const windowKey = '2026-10';
const provider = () => `TEST_${randomUUID().replace(/-/g,'').toUpperCase()}`;
const request = (key: string, amount = 60): ApiSpendReservation => ({id:randomUUID(),provider:key,windowKey,amountMicros:amount,limitMicros:100});
beforeAll(async () => { await db.initDb(); });
it('admits only the capacity available across concurrent attempts', async () => {
  const key = provider();
  const results = await Promise.all(Array.from({length:8},() => db.reserveApiSpendBatch([request(key)])));
  expect(results.filter(Boolean)).toHaveLength(1); expect(await db.getApiCostCounter(key,windowKey)).toBe(60);
});
it('rejects an entire batch without charging its other provider', async () => {
  const a = provider(), b = provider(); await db.reserveApiSpendBatch([request(b,90)]);
  expect(await db.reserveApiSpendBatch([request(a,60),request(b,60)])).toBe(false);
  expect(await db.getApiCostCounter(a,windowKey)).toBe(0); expect(await db.getApiCostCounter(b,windowKey)).toBe(90);
});
it('reserves same-provider parallel calls as one aggregate and rejects overshoot', async () => {
  const key = provider(); expect(await db.reserveApiSpendBatch([request(key),request(key)])).toBe(false);
  expect(await db.getApiCostCounter(key,windowKey)).toBe(0);
});
it('settles once, releases the unused allowance and supports admission replay before dispatch', async () => {
  const row = request(provider()); expect(await db.reserveApiSpendBatch([row])).toBe(true);
  expect(await db.reserveApiSpendBatch([row])).toBe(true);
  expect(await db.getApiCostCounter(row.provider,windowKey)).toBe(60);
  expect(await db.settleApiSpendReservation(row.id,20)).toBe(20);
  expect(await db.settleApiSpendReservation(row.id,0)).toBe(20);
  await expect(db.reserveApiSpendBatch([row])).rejects.toThrow(/reused/);
});
it('retains uncertain spend and keeps settlement in its original month', async () => {
  const row = request(provider()); await db.reserveApiSpendBatch([row]);
  expect(await db.settleApiSpendReservation(row.id,null)).toBe(60);
  expect(await db.settleApiSpendReservation(row.id,0)).toBe(60);
  expect(await db.getApiCostCounter(row.provider,'2026-11')).toBe(0);
});
it('blocks zero caps, negative amounts and conflicting reservation reuse', async () => {
  expect(await db.reserveApiSpendBatch([{...request(provider()),amountMicros:1,limitMicros:0}])).toBe(false);
  await expect(db.reserveApiSpendBatch([{...request(provider()),amountMicros:-1}])).rejects.toThrow(/Invalid/);
  const row = request(provider()); await db.reserveApiSpendBatch([row]);
  await expect(db.reserveApiSpendBatch([{...row,amountMicros:40}])).rejects.toThrow(/reused/);
  await expect(db.settleApiSpendReservation(row.id,-1)).rejects.toThrow(/Invalid/);
});
it('reserves shared job/synthetic budgets atomically with provider budgets and reconciles both', async () => {
  const key = provider(), job = provider();
  await withSpendScope({provider:job,limitMicros:100},async () => {
    const [hold] = await reserveProviderSpendBatch([{provider:key,amountMicros:60,limitMicros:100,windowKey}]);
    await expect(reserveProviderSpendBatch([{provider:provider(),amountMicros:60,windowKey}])).rejects.toThrow(/budget/);
    await settleProviderAttempt({provider:key,reservation:hold,unitType:'request',costPerRequestUsd:0.00002});
    expect(await db.getApiCostCounter(key,windowKey)).toBe(20); expect(await db.getApiCostCounter(job,windowKey)).toBe(20);
  });
});
it('records actual overages rather than hiding them or releasing capacity', async () => {
  const row = request(provider()); await db.reserveApiSpendBatch([row]);
  expect(await db.settleApiSpendReservation(row.id,120)).toBe(120);
  expect(await db.reserveApiSpendBatch([request(row.provider,1)])).toBe(false);
});

it('claims each dispatch only once and never refunds a claimed attempt as undispatched', async () => {
  const row = request(provider()); await db.reserveApiSpendBatch([row]);
  const claims = await Promise.all([db.claimApiSpendReservation(row.id),db.claimApiSpendReservation(row.id)]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(await db.settleApiSpendReservation(row.id,0,true)).toBe(60);
  await expect(db.reserveApiSpendBatch([row])).rejects.toThrow(/reused/);
});

it('keeps every scope funded after a claimed dispatch and blocks reset while it is unsettled', async () => {
  const key = provider(), job = provider();
  await withSpendScope({provider:job,limitMicros:100,windowKey},async () => {
    const [hold] = await reserveProviderSpendBatch([{provider:key,amountMicros:60,windowKey}]);
    await claimProviderSpend(hold); await releaseUndispatchedSpend(hold);
    expect(await db.getApiCostCounter(key,windowKey)).toBe(60); expect(await db.getApiCostCounter(job,windowKey)).toBe(60);
    await expect(db.resetApiCostCounters()).rejects.toThrow(/unsettled/);
    await settleProviderAttempt({provider:key,reservation:hold,unitType:'request',usageKnown:false});
  });
});
it('rejects unknown pricing under a job cap even without a configured provider cap', async () => {
  await expect(withSpendScope({provider:provider(),limitMicros:100},() => reserveProviderSpendBatch([{provider:provider(),amountMicros:null}]))).rejects.toThrow(/bounded price/);
});

it('rounds positive fractional-micro request prices up so repeated small calls cannot become free', () => {
  expect(estimateRequestCostMicros(0.0000001)).toBe(1);
});
