import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import * as db from '../src/db';
import { postOpenAiChatCompletion } from '../src/apis/openaiApi';
import { AdvanceSpendError, getApiBudgetWindowKey, quoteAiSpend, recordApiCost, reserveAiSpend } from '../src/apis/providerBudgeting';
import { waitFor } from './helpers';
jest.mock('axios');
const post = axios.post as jest.Mock;
const previous = process.env.API_LIMITS_CONFIG_PATH;
let dir: string;
const payload = {model:'gpt-4o-mini',messages:[{role:'user' as const,content:'Trip'}]};
const call = (extra = {}) => postOpenAiChatCompletion({caller:'SPEND_TEST',apiKey:'test-key',payload,...extra});
const usage = {prompt_tokens:12,completion_tokens:8,total_tokens:20};
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(),'spend-dispatch-'));
  process.env.API_LIMITS_CONFIG_PATH = path.join(dir,'api-limits.yaml');
  fs.writeFileSync(process.env.API_LIMITS_CONFIG_PATH,`providers: {}
budgeting:
  OPENAI:
    monthlyBudgetUsd: 0.005
    models:
      GPT_4O_MINI:
        inputCostPer1MTokensUsd: 1
        outputCostPer1MTokensUsd: 1
requestPricing: {}
caching: {}
`);
  await db.initDb();
});
beforeEach(async () => { post.mockReset(); await db.resetApiCostCounters(); });
afterAll(() => { if(previous === undefined) delete process.env.API_LIMITS_CONFIG_PATH; else process.env.API_LIMITS_CONFIG_PATH=previous; fs.rmSync(dir,{recursive:true,force:true}); });
it('reserves before dispatch so a parallel request cannot overshoot, then releases unused allowance', async () => {
  let finish!: (value: unknown) => void;
  post.mockReturnValueOnce(new Promise(resolve => {finish=resolve;}));
  const pending = call(); await waitFor(async () => post.mock.calls.length === 1);
  try { await expect(call()).rejects.toBeInstanceOf(AdvanceSpendError); expect(post).toHaveBeenCalledTimes(1); }
  finally { finish({data:{id:'one',usage}}); await pending; }
  expect(await db.getApiCostCounter('OPENAI',getApiBudgetWindowKey())).toBe(20);
  post.mockResolvedValueOnce({data:{id:'two',usage}}); await call();
  expect(await db.getApiCostCounter('OPENAI',getApiBudgetWindowKey())).toBe(40);
  expect(post.mock.calls[0][1].max_tokens).toBe(2048);
});
it('holds missing usage instead of assuming the successful request was free', async () => {
  post.mockResolvedValueOnce({data:{id:'missing',choices:[]}}); await call();
  expect(await db.getApiCostCounter('OPENAI',getApiBudgetWindowKey())).toBe(quoteAiSpend('OPENAI',payload));
  await expect(call()).rejects.toBeInstanceOf(AdvanceSpendError); expect(post).toHaveBeenCalledTimes(1);
});
it('retains a timeout allowance and rejects a retry when the remainder cannot cover it', async () => {
  post.mockRejectedValueOnce(new Error('timeout')); await expect(call()).rejects.toThrow('timeout');
  expect(await db.getApiCostCounter('OPENAI',getApiBudgetWindowKey())).toBe(quoteAiSpend('OPENAI',payload));
  await expect(call()).rejects.toBeInstanceOf(AdvanceSpendError); expect(post).toHaveBeenCalledTimes(1);
});
it('rejects unpriced capped models before dispatch and prohibits reusing a completed reservation', async () => {
  await expect(call({payload:{...payload,model:'unpriced'}})).rejects.toBeInstanceOf(AdvanceSpendError); expect(post).not.toHaveBeenCalled();
  const hold = await reserveAiSpend('OPENAI',payload);
  post.mockResolvedValueOnce({data:{id:'held',usage}}); await call({spendReservation:hold});
  await expect(call({spendReservation:hold})).rejects.toBeInstanceOf(AdvanceSpendError); expect(post).toHaveBeenCalledTimes(1);
});

it('can dispatch already-funded work when its reservation fills the budget', async () => {
  const hold = await reserveAiSpend('OPENAI',payload);
  await recordApiCost({provider:'OPENAI',amountMicros:5000-hold!.amountMicros});
  post.mockResolvedValueOnce({data:{id:'funded',usage}});
  await call({spendReservation:hold}); expect(post).toHaveBeenCalledTimes(1);
});

it.each([-1,NaN])('retains the allowance for invalid token usage %s', async invalid => {
  post.mockResolvedValueOnce({data:{id:'invalid',usage:{...usage,prompt_tokens:invalid}}}); await call();
  expect(await db.getApiCostCounter('OPENAI',getApiBudgetWindowKey())).toBe(quoteAiSpend('OPENAI',payload));
});
