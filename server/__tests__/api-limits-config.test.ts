/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getApiBudgetProviderConfig,
  getApiCacheSetting,
  getApiLimitProviderConfig,
  updateApiCachingConfig,
} from '../src/config/apiLimits';

describe('api-limits yaml config', () => {
  const originalConfigPath = process.env.API_LIMITS_CONFIG_PATH;
  let tempDir = '';
  let configPath = '';

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-limits-test-'));
    configPath = path.join(tempDir, 'api-limits.yaml');
    fs.writeFileSync(
      configPath,
      [
        'providers:',
        '  OPENAI:',
        '    window: hour',
        '    overall: 10',
        '    callers:',
        '      ITINERARY_PLAN_P0_NORM: 5',
        'budgeting:',
        '  OPENAI:',
        '    monthlyBudgetUsd: 25',
        '    alertThresholdPercent: 80',
        '    models:',
        '      GPT_4O_MINI:',
        '        inputCostPer1MTokensUsd: 0.15',
        '        outputCostPer1MTokensUsd: 0.60',
        'caching:',
        '  attractions:',
        '    refreshDays: 365',
        '  images:',
        '    cacheTtlMs: 12345',
        '  getYourGuide:',
        '    redirectTokenTtlMinutes: 10',
        '    maxAffiliateLinksPerItinerary: 4',
      ].join('\n'),
      'utf8'
    );
    process.env.API_LIMITS_CONFIG_PATH = configPath;
  });

  afterAll(() => {
    if (originalConfigPath === undefined) {
      delete process.env.API_LIMITS_CONFIG_PATH;
    } else {
      process.env.API_LIMITS_CONFIG_PATH = originalConfigPath;
    }
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads providers and caching settings', () => {
    const openai = getApiLimitProviderConfig('OPENAI');
    const budget = getApiBudgetProviderConfig('OPENAI');
    expect(openai?.overall).toBe(10);
    expect(openai?.callers?.ITINERARY_PLAN_P0_NORM).toBe(5);
    expect(budget?.monthlyBudgetUsd).toBe(25);
    expect(budget?.models?.GPT_4O_MINI?.inputCostPer1MTokensUsd).toBe(0.15);
    expect(budget?.models?.GPT_4O_MINI?.outputCostPer1MTokensUsd).toBe(0.6);
    expect(getApiCacheSetting('attractions', 'refreshDays')).toBe(365);
    expect(getApiCacheSetting('images', 'cacheTtlMs')).toBe(12345);
    expect(getApiCacheSetting('getYourGuide', 'redirectTokenTtlMinutes')).toBe(10);
    expect(getApiCacheSetting('getYourGuide', 'maxAffiliateLinksPerItinerary')).toBe(4);
  });

  it('preserves zero-valued cache budgets as an explicit kill switch', () => {
    const tempConfig = fs.readFileSync(configPath, 'utf8');
    fs.writeFileSync(configPath, `${tempConfig}\n    maxPartnerApiLookupsPerGeneration: 0\n`, 'utf8');
    expect(getApiCacheSetting('getYourGuide', 'maxPartnerApiLookupsPerGeneration')).toBe(0);
  });

  it('updates a caching group and round-trips the new value', () => {
    const updated = updateApiCachingConfig('attractions', { refreshDays: 365, durationMetadataRefreshDays: 60 });
    expect(updated.caching.ATTRACTIONS.DURATIONMETADATAREFRESHDAYS).toBe(60);
    expect(getApiCacheSetting('attractions', 'durationMetadataRefreshDays')).toBe(60);
    expect(getApiCacheSetting('images', 'cacheTtlMs')).toBe(12345);
  });
});
