/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logMissingApiPricingConfigurationWarnings } from '../src/apis/providerBudgeting';

describe('provider budgeting startup warnings', () => {
  const originalConfigPath = process.env.API_LIMITS_CONFIG_PATH;
  let tempDir = '';
  let configPath = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-budgeting-warning-'));
    configPath = path.join(tempDir, 'api-limits.yaml');
  });

  afterEach(() => {
    if (originalConfigPath === undefined) {
      delete process.env.API_LIMITS_CONFIG_PATH;
    } else {
      process.env.API_LIMITS_CONFIG_PATH = originalConfigPath;
    }
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    jest.restoreAllMocks();
  });

  it('logs a startup warning when a tracked OpenAI model has no pricing config', () => {
    fs.writeFileSync(
      configPath,
      ['providers:', '  OPENAI:', '    window: hour', '    callers:', '      ITINERARY_PLAN_P0_NORM: 5', 'budgeting:', '  OPENAI:', '    models: {}', 'caching: {}'].join('\n'),
      'utf8'
    );
    process.env.API_LIMITS_CONFIG_PATH = configPath;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    logMissingApiPricingConfigurationWarnings();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing OPENAI pricing config for model=GPT_4O_MINI')
    );
  });
});
