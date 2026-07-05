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

import { resolveProvider, registerAiProviderForTesting } from '../../src/ai/registry/aiProviderRegistry';
import * as providerBudgeting from '../../src/apis/providerBudgeting';
import * as aiProviderConfigService from '../../src/services/aiProviderConfigService';

const mockedRecordApiCost = providerBudgeting.recordApiCost as jest.MockedFunction<typeof providerBudgeting.recordApiCost>;
const mockedEstimate = providerBudgeting.estimateAiCostMicros as jest.MockedFunction<typeof providerBudgeting.estimateAiCostMicros>;
const mockedGetActiveAiProvider = aiProviderConfigService.getActiveAiProvider as jest.MockedFunction<
  typeof aiProviderConfigService.getActiveAiProvider
>;

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
