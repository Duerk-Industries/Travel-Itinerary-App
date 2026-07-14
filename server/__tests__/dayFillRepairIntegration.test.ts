/// <reference types="jest" />
/// <reference types="node" />
// itinerary-improvements-coding-plan.md Phase 4B integration coverage: verifies the targeted
// repair call is wired into generateItineraryViaPromptPlan, fires at most once per generation
// even with multiple thin days, and degrades to the deterministic (possibly still-thin)
// itinerary on malformed JSON / provider timeout without throwing to the caller.
//
// dayFillRepairEnabled defaults to 0 in server/config/api-limits.yaml (cost-gated, same posture
// as escalationEnabled) so the large itinerary-prompt-plan.test.ts suite — which doesn't supply
// a userId/shortlist and therefore has no deterministic-fill candidates for its thin fixture
// days — is unaffected. This file points API_LIMITS_CONFIG_PATH at a temp copy of the real
// config with dayFillRepairEnabled turned on, so it must run in its own process (Jest isolates
// module state per test file already).
import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';

const realConfigPath = path.resolve(__dirname, '../config/api-limits.yaml');
const tempConfigPath = path.join(os.tmpdir(), `api-limits-dayfill-repair-${process.pid}-${Date.now()}.yaml`);
const realConfigText = fs.readFileSync(realConfigPath, 'utf8');
if (!realConfigText.includes('dayFillRepairEnabled: 0')) {
  throw new Error('Expected dayFillRepairEnabled: 0 default in api-limits.yaml — update this test fixture.');
}
fs.writeFileSync(tempConfigPath, realConfigText.replace('dayFillRepairEnabled: 0', 'dayFillRepairEnabled: 1'), 'utf8');
process.env.API_LIMITS_CONFIG_PATH = tempConfigPath;
// All three tests below intentionally reuse the same trip parameters (same destinations/dates/
// userId) to isolate the repair-call behavior under test. Without this, the itinerary plan cache
// (itineraryPlanCacheService) would serve a cache hit for the route/day stage on the 2nd/3rd test
// using the same in-memory DB, silently skipping mocked axios.post calls and desyncing the mock
// queue — unrelated to the Phase 4B behavior this file verifies.
process.env.ITINERARY_PLAN_CACHE_ENABLED = 'false';

import { generateItineraryViaPromptPlan } from '../src/services/itineraryPromptPlanService';
import * as attractionsCatalogService from '../src/services/attractionsCatalogService';
import { initDb } from '../src/db';
import { seedEntitlementDefaults } from '../src/services/entitlementService';
import {
  OPENAI_CALLER_ITINERARY_PLAN_P3B_REPAIR,
  runItineraryPromptStageViaOpenAi,
} from '../src/apis/openaiCallers';

jest.mock('axios');
jest.mock('../src/apis/openaiCallers', () => {
  const actual = jest.requireActual('../src/apis/openaiCallers');
  return {
    ...actual,
    runItineraryPromptStageViaOpenAi: jest.fn(async (params: { caller: string }) => {
      const axios = require('axios') as jest.Mocked<typeof import('axios')>;
      const response = await axios.post('/test-itinerary-prompt-stage', { caller: params.caller });
      return {
        text: response.data?.choices?.[0]?.message?.content ?? null,
        promptTokens: response.data?.usage?.prompt_tokens ?? 0,
        completionTokens: response.data?.usage?.completion_tokens ?? 0,
      };
    }),
  };
});
jest.mock('../src/ai/capture/itineraryCapture', () => ({
  captureItineraryInteraction: jest.fn(),
}));
jest.mock('../src/ai/experiments/experimentConfigService', () => ({
  getRunningExperiment: jest.fn(async () => null),
  clearExperimentConfigCache: jest.fn(),
}));
jest.mock('../src/services/aiProviderConfigService', () => ({
  getConfiguredProviderApiKey: jest.fn(() => 'test-key'),
  getConfiguredProviderModels: jest.fn((_providerId: string, fallbackModels: string[]) => fallbackModels),
  getProviderApiKeyEnvVar: jest.fn((providerId: string) => `${providerId.toUpperCase()}_API_KEY`),
  getProviderModelsEnvVar: jest.fn((providerId: string) => `${providerId.toUpperCase()}_MODELS`),
  getActiveAiProvider: jest.fn(async (featureKey: string) => ({
    featureKey,
    provider: 'openai',
    model: 'gpt-4o-mini',
    enabled: true,
    source: 'default',
    updatedBy: null,
    updatedAt: null,
  })),
  clearAiProviderConfigCache: jest.fn(),
}));
jest.mock('../src/services/attractionsCatalogService', () => {
  const actual = jest.requireActual('../src/services/attractionsCatalogService');
  return {
    ...actual,
    getAttractionPromptBlockForDestinations: jest.fn(async () => ({
      shortlistByDestination: {},
      promptBlock: 'none',
      // No pods supplied, so deterministic fill (Priority 1/2) can find nothing and the day(s)
      // stay thin — that's the scenario under test: only the repair call can resolve them.
      attractionPodsByDestination: {},
    })),
  };
});

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedPromptStage = runItineraryPromptStageViaOpenAi as jest.Mock;
const mockedAttractionsCatalogService = attractionsCatalogService as jest.Mocked<typeof attractionsCatalogService>;

const norm = {
  data: {
    usage: { prompt_tokens: 100, completion_tokens: 100 },
    choices: [{
      message: {
        content: JSON.stringify({
          $: 'norm1', sd: '2026-08-01', ed: '2026-08-03', p: 'B', c: 'M', mob: 'M', car: 'P',
          w: { outdoors: 15, adventure: 10, culture: 15, food: 15, nightlife: 10, relax: 10, photography: 10, authentic_local: 8, iconic_landmarks: 7 },
          a: [], is: 'mixed',
        }),
      },
    }],
  },
};
const route = {
  data: {
    usage: { prompt_tokens: 100, completion_tokens: 100 },
    choices: [{
      message: {
        content: JSON.stringify({
          $: 'r1', eh: 'CDG', xh: 'CDG', b: [{ l: 'Paris', ci: '2026-08-01', co: '2026-08-04', dn: [] }],
          x: [], rc: null,
          w: { outdoors: 15, adventure: 10, culture: 15, food: 15, nightlife: 10, relax: 10, photography: 10, authentic_local: 8, iconic_landmarks: 7 },
          a: [],
        }),
      },
    }],
  },
};
// Two thin days (1 item each) with no deterministic-fill candidates available.
const thinDays = {
  data: {
    usage: { prompt_tokens: 200, completion_tokens: 200 },
    choices: [{
      message: {
        content: JSON.stringify({
          $: 'it1', eh: 'CDG', xh: 'CDG', b: [{ l: 'Paris', ci: '2026-08-01', co: '2026-08-04', dn: [] }],
          x: [], rc: null,
          dy: [
            { d: 1, dt: '2026-08-01', b: 'Paris', it: [['D', 'A', 'Solo Landmark One']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [], cf: 'H' },
            { d: 2, dt: '2026-08-02', b: 'Paris', it: [['D', 'A', 'Solo Landmark Two']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [], cf: 'H' },
          ],
          a: [], cf: 'H',
        }),
      },
    }],
  },
};
const render = { data: { usage: { prompt_tokens: 50, completion_tokens: 50 }, choices: [{ message: { content: '## Rendered' } }] } };

const baseInput = {
  apiKey: 'test-key',
  destinations: ['Paris'],
  days: 3,
  budgetMin: 1000,
  budgetMax: 5000,
  userId: 'user-1',
  promptTraits: {
    tt: {
      p: 'B' as const, c: 'M' as const, mob: 'M' as const, car: 'P' as const, is: 'mixed' as const,
      w: { outdoors: 15, adventure: 10, culture: 15, food: 15, nightlife: 10, relax: 10, photography: 10, authentic_local: 8, iconic_landmarks: 7 },
    },
    ut: { i: [] },
  },
  groupTraits: [],
};

describe('itinerary prompt plan — Phase 4B targeted repair integration', () => {
  beforeAll(async () => {
    await initDb();
    await seedEntitlementDefaults();
  });

  afterAll(() => {
    delete process.env.API_LIMITS_CONFIG_PATH;
    delete process.env.ITINERARY_PLAN_CACHE_ENABLED;
    fs.rmSync(tempConfigPath, { force: true });
  });

  beforeEach(() => {
    mockedPromptStage.mockClear();
    mockedAxios.post.mockReset();
    mockedAxios.get.mockReset();
    mockedAxios.get.mockResolvedValue({ status: 404, data: {} });
    mockedAttractionsCatalogService.getAttractionPromptBlockForDestinations.mockReset();
    mockedAttractionsCatalogService.getAttractionPromptBlockForDestinations.mockResolvedValue({
      shortlistByDestination: {},
      promptBlock: 'none',
      attractionPodsByDestination: {},
    } as any);
  });

  it('fires the repair call exactly once for a generation with multiple thin days, and applies its result', async () => {
    const repaired = {
      data: {
        usage: { prompt_tokens: 40, completion_tokens: 40 },
        choices: [{
          message: {
            content: JSON.stringify({
              dy: [
                { dt: '2026-08-01', it: [['D', 'A', 'Solo Landmark One'], ['E', 'A', 'Repaired Dinner Spot']] },
                { dt: '2026-08-02', it: [['D', 'A', 'Solo Landmark Two'], ['E', 'A', 'Repaired Evening Walk']] },
              ],
            }),
          },
        }],
      },
    };
    mockedAxios.post
      .mockResolvedValueOnce(norm)
      .mockResolvedValueOnce(route)
      .mockResolvedValueOnce(thinDays)
      .mockResolvedValueOnce(repaired)
      .mockResolvedValueOnce(render);

    const result = await generateItineraryViaPromptPlan(baseInput as any);

    const repairCalls = mockedPromptStage.mock.calls.filter(
      ([params]) => params.caller === OPENAI_CALLER_ITINERARY_PLAN_P3B_REPAIR
    );
    expect(repairCalls).toHaveLength(1);
    expect(result.planMarkdown).toContain('Rendered');

    const activityNames = result.generatedItems.activities.map((activity) => activity.name);
    expect(activityNames).toEqual(expect.arrayContaining(['Repaired Dinner Spot', 'Repaired Evening Walk']));
  });

  it('falls back to the deterministic (still-thin) itinerary without throwing when the repair call throws (provider timeout)', async () => {
    mockedAxios.post
      .mockResolvedValueOnce(norm)
      .mockResolvedValueOnce(route)
      .mockResolvedValueOnce(thinDays)
      .mockRejectedValueOnce(new Error('ETIMEDOUT: provider request timed out'))
      .mockResolvedValueOnce(render);

    const result = await generateItineraryViaPromptPlan(baseInput as any);

    const repairCalls = mockedPromptStage.mock.calls.filter(
      ([params]) => params.caller === OPENAI_CALLER_ITINERARY_PLAN_P3B_REPAIR
    );
    // Called once, threw, and generation still completed — no retry loop.
    expect(repairCalls).toHaveLength(1);
    expect(result.planMarkdown).toContain('Rendered');
    const activityNames = result.generatedItems.activities.map((activity) => activity.name);
    expect(activityNames).toEqual(expect.arrayContaining(['Solo Landmark One', 'Solo Landmark Two']));
  });

  it('falls back gracefully when the repair call returns malformed JSON', async () => {
    const malformed = { data: { usage: { prompt_tokens: 10, completion_tokens: 10 }, choices: [{ message: { content: 'not json at all' } }] } };
    mockedAxios.post
      .mockResolvedValueOnce(norm)
      .mockResolvedValueOnce(route)
      .mockResolvedValueOnce(thinDays)
      .mockResolvedValueOnce(malformed)
      .mockResolvedValueOnce(render);

    const result = await generateItineraryViaPromptPlan(baseInput as any);

    const repairCalls = mockedPromptStage.mock.calls.filter(
      ([params]) => params.caller === OPENAI_CALLER_ITINERARY_PLAN_P3B_REPAIR
    );
    expect(repairCalls).toHaveLength(1);
    expect(result.planMarkdown).toContain('Rendered');
  });
});
