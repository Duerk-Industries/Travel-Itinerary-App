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
