/// <reference types="jest" />

import { isProviderCertified } from '../../src/ai/experiments/certification';
import { getAiProviderCertification } from '../../src/db';

jest.mock('../../src/db', () => ({
  getAiProviderCertification: jest.fn(),
}));

jest.mock('../../src/ai/registry/aiProviderRegistry', () => ({
  getRegisteredAiProviders: jest.fn(() => [
    { id: 'openai', supportedModels: ['gpt-4o-mini'] },
  ]),
}));

const mockedGetCertification = getAiProviderCertification as jest.MockedFunction<typeof getAiProviderCertification>;

describe('experiment provider certification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a registered provider until a certification row exists', async () => {
    mockedGetCertification.mockResolvedValueOnce(null);

    await expect(isProviderCertified('openai')).resolves.toBe(false);
  });

  it('accepts a registered provider with a certification row', async () => {
    mockedGetCertification.mockResolvedValueOnce({
      providerId: 'openai',
      certifiedAt: '2026-07-04T00:00:00.000Z',
      certifiedBy: 'admin-1',
      contractSuiteVersion: 'contract-suite-2026-07-04',
      notes: null,
    });

    await expect(isProviderCertified('openai')).resolves.toBe(true);
  });

  it('rejects unknown providers even if a certification row would exist', async () => {
    await expect(isProviderCertified('unknown')).resolves.toBe(false);
    expect(mockedGetCertification).not.toHaveBeenCalled();
  });
});
