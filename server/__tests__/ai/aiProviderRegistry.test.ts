/// <reference types="jest" />
/// <reference types="node" />

import type { AiCallContext, AiChatRequest, AiChatResponse } from '../../src/ai/types/aiChat';
import type { AiChatProvider } from '../../src/ai/providers/AiChatProvider';

jest.mock('../../src/services/aiProviderConfigService', () => ({
  getActiveAiProvider: jest.fn(async (featureKey: string) => ({
    featureKey,
    provider: 'fake-anthropic',
    model: 'fake-model',
    enabled: true,
    source: 'default',
    updatedBy: null,
    updatedAt: null,
  })),
}));

jest.mock('../../src/services/entitlementService', () => ({
  recordUsage: jest.fn(async () => undefined),
  reserveGenerationUsage: jest.fn(),
  finalizeGenerationUsage: jest.fn(),
  failGenerationUsage: jest.fn(),
}));

jest.mock('../../src/services/aiInvocationGuard', () => {
  const actual = jest.requireActual('../../src/services/aiInvocationGuard');
  return {
    ...actual,
    authorizeAiCall: jest.fn(async () => ({ providerReserved: true })),
    finalizeAiCallAuthorization: jest.fn(async () => undefined),
    failAiCallAuthorization: jest.fn(async () => undefined),
  };
});

jest.mock('../../src/apis/providerBudgeting', () => ({
  estimateAiCostMicros: jest.fn(() => 45_000),
  getApiBudgetWindowKey: jest.fn(() => '2026-07'),
  recordApiCost: jest.fn(async () => 0),
}));

jest.mock('../../src/ai/experiments/experimentConfigService', () => ({
  getRunningExperiment: jest.fn(async () => null),
}));

jest.mock('../../src/db', () => ({
  getOrCreateAiExperimentAssignment: jest.fn(),
}));

jest.mock('../../src/ai/experiments/circuitBreaker', () => ({
  isExperimentVariantTripped: jest.fn(() => false),
  recordExperimentVariantOutcome: jest.fn(async () => ({ tripped: false, requestCount: 1, failureCount: 0 })),
}));

import { resolveProvider, registerAiProviderForTesting } from '../../src/ai/registry/aiProviderRegistry';
import * as providerBudgeting from '../../src/apis/providerBudgeting';
import * as aiProviderConfigService from '../../src/services/aiProviderConfigService';
import * as experimentConfigService from '../../src/ai/experiments/experimentConfigService';
import * as circuitBreaker from '../../src/ai/experiments/circuitBreaker';
import { recordUsage } from '../../src/services/entitlementService';
import { getOrCreateAiExperimentAssignment } from '../../src/db';
import type { AiExperiment } from '../../src/types';

const mockedRecordApiCost = providerBudgeting.recordApiCost as jest.MockedFunction<typeof providerBudgeting.recordApiCost>;
const mockedEstimate = providerBudgeting.estimateAiCostMicros as jest.MockedFunction<typeof providerBudgeting.estimateAiCostMicros>;
const mockedGetActiveAiProvider = aiProviderConfigService.getActiveAiProvider as jest.MockedFunction<
  typeof aiProviderConfigService.getActiveAiProvider
>;
const mockedGetRunningExperiment = experimentConfigService.getRunningExperiment as jest.MockedFunction<
  typeof experimentConfigService.getRunningExperiment
>;
const mockedGetOrCreateAssignment = getOrCreateAiExperimentAssignment as jest.MockedFunction<typeof getOrCreateAiExperimentAssignment>;
const mockedIsTripped = circuitBreaker.isExperimentVariantTripped as jest.MockedFunction<typeof circuitBreaker.isExperimentVariantTripped>;
const mockedRecordOutcome = circuitBreaker.recordExperimentVariantOutcome as jest.MockedFunction<typeof circuitBreaker.recordExperimentVariantOutcome>;
const mockedRecordUsage = recordUsage as jest.MockedFunction<typeof recordUsage>;

const request: AiChatRequest = {
  model: 'fake-model',
  messages: [{ role: 'user', content: 'hi' }],
};

const context: AiCallContext = {
  correlationId: 'corr-1',
  requestId: 'req-1',
  jobId: 'job-1',
  featureKey: 'mail_parsing',
  userId: 'user-1',
  anonymousUserId: 'anon-1',
  tier: 'free',
  role: 'user',
  provider: 'fake-anthropic',
  model: 'fake-model',
  callerId: 'INGESTION_LLM_EXTRACT',
};

const fakeResponse: AiChatResponse = {
  choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe('aiProviderRegistry cost recording', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedEstimate.mockReturnValue(45_000);
  });

  it('records cost for a non-openai provider using its provider-limit key', async () => {
    const fakeProvider: AiChatProvider = {
      id: 'fake-anthropic',
      supportedModels: ['fake-model'],
      chatCompletion: jest.fn(async () => fakeResponse),
    };
    registerAiProviderForTesting(fakeProvider);

    const provider = await resolveProvider('mail_parsing', 'INGESTION_LLM_EXTRACT');
    const response = await provider.chatCompletion(request, context);

    expect(response).toBe(fakeResponse);
    expect(mockedEstimate).toHaveBeenCalledWith({
      provider: 'FAKE_ANTHROPIC',
      model: 'fake-model',
      promptTokens: 10,
      completionTokens: 5,
    });
    expect(mockedRecordApiCost).toHaveBeenCalledWith({
      provider: 'FAKE_ANTHROPIC',
      windowKey: '2026-07',
      amountMicros: 45_000,
    });
  });

  it('records per-user usage for a non-openai provider when usage accounting is enabled', async () => {
    const fakeProvider: AiChatProvider = {
      id: 'fake-anthropic',
      supportedModels: ['fake-model'],
      chatCompletion: jest.fn(async () => fakeResponse),
    };
    registerAiProviderForTesting(fakeProvider);

    const provider = await resolveProvider('mail_parsing', 'INGESTION_LLM_EXTRACT');
    await provider.chatCompletion(request, {
      ...context,
      usageAccountingEnabled: true,
      usageWindowKey: '2026-07',
      usageMetadata: { pipeline: 'registry-test' },
    } as AiCallContext & { usageAccountingEnabled: boolean; usageWindowKey: string; usageMetadata: Record<string, unknown> });

    expect(mockedRecordUsage).toHaveBeenCalledWith(
      'user-1',
      'api_calls_fake_anthropic',
      1,
      expect.objectContaining({ provider: 'FAKE_ANTHROPIC', model: 'fake-model', pipeline: 'registry-test' }),
    );
    expect(mockedRecordUsage).toHaveBeenCalledWith(
      'user-1',
      'fake_anthropic_tokens',
      15,
      expect.objectContaining({ provider: 'FAKE_ANTHROPIC' }),
    );
    expect(mockedRecordUsage).toHaveBeenCalledWith(
      'user-1',
      'fake_anthropic_estimated_cost_micros_usd',
      45_000,
      expect.objectContaining({ estimatedCostUsd: 0.045 }),
    );
  });

  it('does not record cost twice for the openai provider (it records internally)', async () => {
    mockedGetActiveAiProvider.mockResolvedValueOnce({
      featureKey: 'mail_parsing',
      provider: 'openai',
      model: 'fake-model',
      enabled: true,
      source: 'default',
      updatedBy: null,
      updatedAt: null,
    });
    const fakeOpenaiProvider: AiChatProvider = {
      id: 'openai',
      supportedModels: ['fake-model'],
      chatCompletion: jest.fn(async () => fakeResponse),
    };
    registerAiProviderForTesting(fakeOpenaiProvider);

    const provider = await resolveProvider('mail_parsing', 'INGESTION_LLM_EXTRACT');
    await provider.chatCompletion(request, { ...context, provider: 'openai' });

    expect(mockedRecordApiCost).not.toHaveBeenCalled();
    expect(mockedRecordUsage).not.toHaveBeenCalled();
  });

  it('does not record cost when estimateAiCostMicros has no pricing for the model', async () => {
    mockedEstimate.mockReturnValueOnce(null);
    const fakeProvider: AiChatProvider = {
      id: 'fake-anthropic',
      supportedModels: ['fake-model'],
      chatCompletion: jest.fn(async () => fakeResponse),
    };
    registerAiProviderForTesting(fakeProvider);

    const provider = await resolveProvider('mail_parsing', 'INGESTION_LLM_EXTRACT');
    await provider.chatCompletion(request, context);

    expect(mockedRecordApiCost).not.toHaveBeenCalled();
  });
});

describe('aiProviderRegistry traffic_split experiments', () => {
  const runningExperiment: AiExperiment = {
    experimentId: 'exp-1',
    featureKey: 'mail_parsing',
    experimentKind: 'traffic_split',
    name: 'test experiment',
    status: 'running',
    variants: [{ variantId: 'treatment', provider: 'fake-anthropic', model: 'fake-model', trafficPercent: 100 }],
    controlVariantId: null,
    minSampleSize: 200,
    maxDurationDays: 30,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedEstimate.mockReturnValue(45_000);
    const fakeProvider: AiChatProvider = {
      id: 'fake-anthropic',
      supportedModels: ['fake-model'],
      chatCompletion: jest.fn(async () => fakeResponse),
    };
    registerAiProviderForTesting(fakeProvider);
  });

  it('routes a traffic_split-resolved call through the same authorization/cost-tracking as any other call, and records the outcome for the circuit breaker', async () => {
    mockedGetRunningExperiment.mockResolvedValueOnce(runningExperiment);
    mockedGetOrCreateAssignment.mockResolvedValueOnce({
      assignmentKey: 'mail_parsing:INGESTION_LLM_EXTRACT',
      experimentId: 'exp-1',
      variantId: 'treatment',
      assignedAt: '2026-07-01T00:00:00.000Z',
    });

    const provider = await resolveProvider('mail_parsing', 'INGESTION_LLM_EXTRACT');
    const response = await provider.chatCompletion(request, context);

    expect(response).toBe(fakeResponse);
    // Same tracking every other provider call gets — a traffic_split
    // resolution must never bypass rate-limiting/cost-recording.
    expect(mockedRecordApiCost).toHaveBeenCalledWith({
      provider: 'FAKE_ANTHROPIC',
      windowKey: '2026-07',
      amountMicros: 45_000,
    });
    // And the circuit breaker actually gets fed an outcome — this is what
    // makes trip detection possible for traffic_split in the first place.
    expect(mockedRecordOutcome).toHaveBeenCalledWith({
      experimentId: 'exp-1',
      variantId: 'treatment',
      controlVariantId: 'treatment',
      success: true,
    });
  });

  it('falls through to the default provider (not the tripped variant) once the assigned variant has tripped the circuit breaker', async () => {
    mockedGetRunningExperiment.mockResolvedValueOnce(runningExperiment);
    mockedGetOrCreateAssignment.mockResolvedValueOnce({
      assignmentKey: 'mail_parsing:INGESTION_LLM_EXTRACT',
      experimentId: 'exp-1',
      variantId: 'treatment',
      assignedAt: '2026-07-01T00:00:00.000Z',
    });
    mockedIsTripped.mockReturnValueOnce(true);
    mockedGetActiveAiProvider.mockResolvedValueOnce({
      featureKey: 'mail_parsing',
      provider: 'fake-anthropic',
      model: 'fake-model',
      enabled: true,
      source: 'default',
      updatedBy: null,
      updatedAt: null,
    });

    await resolveProvider('mail_parsing', 'INGESTION_LLM_EXTRACT');

    // Never even attempts the tripped variant's chatCompletion path via the
    // experiment context — falls back to the normal ai_provider_config
    // resolution instead.
    expect(mockedGetActiveAiProvider).toHaveBeenCalledWith('mail_parsing');
  });

  it('falls through to the default provider when the stored assignment points at control (reassigned), not by re-deriving the original hash-based variant', async () => {
    mockedGetRunningExperiment.mockResolvedValueOnce(runningExperiment);
    // Simulates what the DB looks like *after* the circuit breaker already
    // reassigned this assignment to control — variantId no longer matches
    // any entry in runningExperiment.variants.
    mockedGetOrCreateAssignment.mockResolvedValueOnce({
      assignmentKey: 'mail_parsing:INGESTION_LLM_EXTRACT',
      experimentId: 'exp-1',
      variantId: 'treatment', // resolveExperimentVariant would recompute this same id fresh
      assignedAt: '2026-07-01T00:00:00.000Z',
    });
    // But this specific variant has already tripped — must not re-route to it.
    mockedIsTripped.mockReturnValueOnce(true);
    mockedGetActiveAiProvider.mockResolvedValueOnce({
      featureKey: 'mail_parsing',
      provider: 'fake-anthropic',
      model: 'fake-model',
      enabled: true,
      source: 'default',
      updatedBy: null,
      updatedAt: null,
    });

    const provider = await resolveProvider('mail_parsing', 'INGESTION_LLM_EXTRACT');
    await provider.chatCompletion(request, context);

    // The regression this test guards against: recordExperimentVariantOutcome
    // being called for a tripped variant would mean traffic kept flowing to
    // it. It must not be invoked via the experiment path once tripped.
    expect(mockedRecordOutcome).not.toHaveBeenCalled();
  });
});
