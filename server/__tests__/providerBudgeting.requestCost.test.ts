/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import os from 'os';
import path from 'path';
import type * as ProviderBudgetingModule from '../src/apis/providerBudgeting';

const originalConfigPath = process.env.API_LIMITS_CONFIG_PATH;
let tempDir = '';
let configPath = '';

const writeConfig = (requestPricingYaml: string): void => {
  fs.writeFileSync(
    configPath,
    ['providers: {}', 'budgeting: {}', 'caching: {}', 'requestPricing:', requestPricingYaml].join('\n'),
    'utf8'
  );
};

describe('providerBudgeting request-cost recording (Phase 1)', () => {
  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'request-cost-'));
    configPath = path.join(tempDir, 'api-limits.yaml');
    process.env.API_LIMITS_CONFIG_PATH = configPath;
  });

  afterAll(() => {
    if (originalConfigPath === undefined) delete process.env.API_LIMITS_CONFIG_PATH;
    else process.env.API_LIMITS_CONFIG_PATH = originalConfigPath;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.resetModules();
  });

  it('estimateRequestCostMicros converts a USD price to whole micros, floors negatives to 0', () => {
    const { estimateRequestCostMicros } = require('../src/apis/providerBudgeting') as typeof ProviderBudgetingModule;
    expect(estimateRequestCostMicros(0)).toBe(0);
    expect(estimateRequestCostMicros(0.001)).toBe(1000);
    expect(estimateRequestCostMicros(0.0035)).toBe(3500);
    expect(estimateRequestCostMicros(-5)).toBe(0);
  });

  it('recordProviderRequestCost no-ops (no DB write) when the price is 0', async () => {
    writeConfig('  SERPAPI: 0');
    jest.doMock('../src/db', () => ({
      getApiCostCounter: jest.fn(async () => 0),
      incrementApiCostCounter: jest.fn(async () => 0),
    }));
    const { recordProviderRequestCost } = require('../src/apis/providerBudgeting') as typeof ProviderBudgetingModule;
    const mockedDb = jest.requireMock('../src/db') as { incrementApiCostCounter: jest.Mock };

    const result = await recordProviderRequestCost({ provider: 'SERPAPI' });

    expect(result).toBeUndefined();
    expect(mockedDb.incrementApiCostCounter).not.toHaveBeenCalled();
  });

  it('recordProviderRequestCost records the correct micros amount when a price is configured', async () => {
    writeConfig('  SERPAPI: 0.01');
    jest.doMock('../src/db', () => ({
      getApiCostCounter: jest.fn(async () => 0),
      incrementApiCostCounter: jest.fn(async (_provider: string, _windowKey: string, amountMicros: number) => amountMicros),
    }));
    const { recordProviderRequestCost, getApiBudgetWindowKey } = require('../src/apis/providerBudgeting') as typeof ProviderBudgetingModule;
    const mockedDb = jest.requireMock('../src/db') as { incrementApiCostCounter: jest.Mock };

    await recordProviderRequestCost({ provider: 'SERPAPI' });

    expect(mockedDb.incrementApiCostCounter).toHaveBeenCalledWith('SERPAPI', getApiBudgetWindowKey(), 10000);
  });

  it('an explicit costPerRequestUsd override takes precedence over the configured price', async () => {
    writeConfig('  SERPAPI: 0');
    jest.doMock('../src/db', () => ({
      getApiCostCounter: jest.fn(async () => 0),
      incrementApiCostCounter: jest.fn(async (_provider: string, _windowKey: string, amountMicros: number) => amountMicros),
    }));
    const { recordProviderRequestCost } = require('../src/apis/providerBudgeting') as typeof ProviderBudgetingModule;
    const mockedDb = jest.requireMock('../src/db') as { incrementApiCostCounter: jest.Mock };

    await recordProviderRequestCost({ provider: 'SERPAPI', costPerRequestUsd: 0.02 });

    expect(mockedDb.incrementApiCostCounter).toHaveBeenCalledWith('SERPAPI', expect.any(String), 20000);
  });

  it('normalizes the provider key the same way the rest of the api-limits config does', async () => {
    writeConfig('  google_routes: 0.05');
    jest.doMock('../src/db', () => ({
      getApiCostCounter: jest.fn(async () => 0),
      incrementApiCostCounter: jest.fn(async (_provider: string, _windowKey: string, amountMicros: number) => amountMicros),
    }));
    const { recordProviderRequestCost } = require('../src/apis/providerBudgeting') as typeof ProviderBudgetingModule;
    const mockedDb = jest.requireMock('../src/db') as { incrementApiCostCounter: jest.Mock };

    await recordProviderRequestCost({ provider: 'Google Routes' });

    expect(mockedDb.incrementApiCostCounter).toHaveBeenCalledWith('GOOGLE_ROUTES', expect.any(String), 50000);
  });
});
