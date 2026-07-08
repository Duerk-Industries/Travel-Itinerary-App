/// <reference types="jest" />
/// <reference types="node" />

import {
  clearAiProviderConfigCache,
  getActiveAiProvider,
  setAiProviderConfigWithAudit,
} from '../../src/services/aiProviderConfigService';
import {
  getAiProviderConfig,
  setAiProviderConfig,
  writeAuditLog,
} from '../../src/db';

jest.mock('../../src/db', () => ({
  getAiProviderConfig: jest.fn(),
  setAiProviderConfig: jest.fn(),
  writeAuditLog: jest.fn(),
}));

const mockedGetAiProviderConfig = getAiProviderConfig as jest.MockedFunction<typeof getAiProviderConfig>;
const mockedSetAiProviderConfig = setAiProviderConfig as jest.MockedFunction<typeof setAiProviderConfig>;
const mockedWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

describe('aiProviderConfigService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearAiProviderConfigCache();
    delete process.env.AI_ITINERARY_PROVIDER;
    delete process.env.AI_ITINERARY_MODEL;
    delete process.env.AI_INGESTION_LLM_PROVIDER;
    delete process.env.AI_INGESTION_LLM_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ZAI_API_KEY;
    delete process.env.OPENAI_COMPATIBLE_API_KEY;
    delete process.env.OPENAI_COMPATIBLE_MODELS;
  });

  it('falls open to the OpenAI default when no config row exists', async () => {
    mockedGetAiProviderConfig.mockResolvedValueOnce(null);

    await expect(getActiveAiProvider('itinerary_generation')).resolves.toMatchObject({
      featureKey: 'itinerary_generation',
      provider: 'openai',
      model: 'gpt-4o-mini',
      source: 'default',
    });
  });

  it('uses env-selected itinerary provider and model when no config row exists', async () => {
    process.env.AI_ITINERARY_PROVIDER = 'anthropic';
    process.env.AI_ITINERARY_MODEL = 'claude-sonnet-4-5';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    mockedGetAiProviderConfig.mockResolvedValueOnce(null);

    await expect(getActiveAiProvider('itinerary_generation')).resolves.toMatchObject({
      featureKey: 'itinerary_generation',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      source: 'env',
    });
  });

  it('falls back to the first configured provider key in env when no explicit provider is set', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    mockedGetAiProviderConfig.mockResolvedValueOnce(null);

    await expect(getActiveAiProvider('itinerary_generation')).resolves.toMatchObject({
      featureKey: 'itinerary_generation',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      source: 'env',
    });
  });

  it('uses the custom openai-compatible provider when selected in env', async () => {
    process.env.AI_ITINERARY_PROVIDER = 'openai_compatible';
    process.env.OPENAI_COMPATIBLE_API_KEY = 'test-compatible-key';
    process.env.OPENAI_COMPATIBLE_MODELS = 'qwen2.5-coder-32b-instruct,llama-3.1-8b';
    mockedGetAiProviderConfig.mockResolvedValueOnce(null);

    await expect(getActiveAiProvider('itinerary_generation')).resolves.toMatchObject({
      featureKey: 'itinerary_generation',
      provider: 'openai_compatible',
      model: 'qwen2.5-coder-32b-instruct',
      source: 'env',
    });
  });

  it('uses env-selected provider and model for ingestion llm extraction when no config row exists', async () => {
    process.env.AI_INGESTION_LLM_PROVIDER = 'gemini';
    process.env.AI_INGESTION_LLM_MODEL = 'gemini-2.5-pro';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    mockedGetAiProviderConfig.mockResolvedValueOnce(null);

    await expect(getActiveAiProvider('ingestion_llm_extract')).resolves.toMatchObject({
      featureKey: 'ingestion_llm_extract',
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      source: 'env',
    });
  });

  it('caches active config for the TTL window', async () => {
    mockedGetAiProviderConfig.mockResolvedValue({
      featureKey: 'itinerary_generation',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      enabled: true,
      updatedBy: 'admin-1',
      updatedAt: '2026-07-04T00:00:00.000Z',
    });

    await getActiveAiProvider('itinerary_generation');
    await getActiveAiProvider('itinerary_generation');

    expect(mockedGetAiProviderConfig).toHaveBeenCalledTimes(1);
  });

  it('writes config, audit log, and invalidates the active config cache', async () => {
    mockedGetAiProviderConfig
      .mockResolvedValueOnce({
        featureKey: 'itinerary_generation',
        provider: 'openai',
        model: 'gpt-4o-mini',
        enabled: true,
        updatedBy: null,
        updatedAt: '2026-07-04T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        featureKey: 'itinerary_generation',
        provider: 'openai',
        model: 'gpt-4.1-mini',
        enabled: true,
        updatedBy: 'admin-1',
        updatedAt: '2026-07-04T00:01:00.000Z',
      });
    mockedSetAiProviderConfig.mockResolvedValueOnce({
      featureKey: 'itinerary_generation',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      enabled: true,
      updatedBy: 'admin-1',
      updatedAt: '2026-07-04T00:01:00.000Z',
    });
    mockedWriteAuditLog.mockResolvedValueOnce({
      id: 'audit-1',
      action: 'AI_PROVIDER_CONFIG_UPDATED',
      createdAt: '2026-07-04T00:01:00.000Z',
    } as any);

    await setAiProviderConfigWithAudit({
      featureKey: 'itinerary_generation',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      enabled: true,
      actorUserId: 'admin-1',
      reason: 'Switch model',
    });

    expect(mockedSetAiProviderConfig).toHaveBeenCalledWith({
      featureKey: 'itinerary_generation',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      enabled: true,
      updatedBy: 'admin-1',
    });
    expect(mockedWriteAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'admin-1',
      action: 'AI_PROVIDER_CONFIG_UPDATED',
      reason: 'Switch model',
    }));

    await expect(getActiveAiProvider('itinerary_generation')).resolves.toMatchObject({
      model: 'gpt-4.1-mini',
      source: 'db',
    });
  });
});
