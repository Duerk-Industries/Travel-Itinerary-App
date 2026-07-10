/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import { closePool, initDb, resetDbAdapter } from '../src/db';
import { postOpenAiChatCompletion } from '../src/apis/openaiApi';
import { ApiBudgetExceededError } from '../src/apis/usageLimiter';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const originalDbProvider = process.env.DB_PROVIDER;
const originalUseInMemoryDb = process.env.USE_IN_MEMORY_DB;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalE2EMode = process.env.E2E_MODE;
const originalFirestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

describe('OpenAI provider budgeting', () => {
  const originalConfigPath = process.env.API_LIMITS_CONFIG_PATH;
  let tempDir = '';
  let configPath = '';

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openai-budgeting-'));
    configPath = path.join(tempDir, 'api-limits.yaml');
    fs.writeFileSync(
      configPath,
      [
        'providers:',
        '  OPENAI:',
        '    window: hour',
        '    windowHours: 24',
        '    overall: 1000',
        '    callers:',
        '      ITINERARY_PLAN_P0_NORM: 1000',
        'budgeting:',
        '  OPENAI:',
        '    monthlyBudgetUsd: 0.00002',
        '    alertThresholdPercent: 80',
        '    models:',
        '      GPT_4O_MINI:',
        '        inputCostPer1MTokensUsd: 1',
        '        outputCostPer1MTokensUsd: 1',
        'caching: {}',
      ].join('\n'),
      'utf8'
    );

    process.env.NODE_ENV = 'test';
    process.env.API_LIMITS_CONFIG_PATH = configPath;
    process.env.DB_PROVIDER = 'memory';
    process.env.USE_IN_MEMORY_DB = '1';
    process.env.DATABASE_URL = 'pg-mem://localhost/openai-budgeting';
    delete process.env.E2E_MODE;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    resetDbAdapter();
    await initDb();
  });

  afterAll(async () => {
    jest.clearAllMocks();
    await closePool();
    if (originalConfigPath === undefined) {
      delete process.env.API_LIMITS_CONFIG_PATH;
    } else {
      process.env.API_LIMITS_CONFIG_PATH = originalConfigPath;
    }
    if (originalDbProvider === undefined) delete process.env.DB_PROVIDER;
    else process.env.DB_PROVIDER = originalDbProvider;
    if (originalUseInMemoryDb === undefined) delete process.env.USE_IN_MEMORY_DB;
    else process.env.USE_IN_MEMORY_DB = originalUseInMemoryDb;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalE2EMode === undefined) delete process.env.E2E_MODE;
    else process.env.E2E_MODE = originalE2EMode;
    if (originalFirestoreEmulatorHost === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = originalFirestoreEmulatorHost;
    resetDbAdapter();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('blocks a new OpenAI call after the configured monthly budget is exhausted', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        choices: [{ message: { content: 'ok' } }],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20,
        },
      },
    } as any);

    await postOpenAiChatCompletion({
      caller: 'ITINERARY_PLAN_P0_NORM',
      apiKey: 'test-openai-key',
      payload: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Plan a trip' }],
      },
    });

    await expect(
      postOpenAiChatCompletion({
        caller: 'ITINERARY_PLAN_P0_NORM',
        apiKey: 'test-openai-key',
        payload: {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Plan another trip' }],
        },
      })
    ).rejects.toBeInstanceOf(ApiBudgetExceededError);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});
