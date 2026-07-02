/// <reference types="jest" />
/// <reference types="node" />
import axios from 'axios';
import { closePool, getApiCostCounter, getUsageCounter, initDb, resetDbAdapter } from '../src/db';
import { postOpenAiChatCompletion } from '../src/apis/openaiApi';
import { cleanupTestUsersByEmail, registerAndLoginWebUser } from './helpers';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const TS = Date.now();
const originalDbProvider = process.env.DB_PROVIDER;
const originalUseInMemoryDb = process.env.USE_IN_MEMORY_DB;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalE2EMode = process.env.E2E_MODE;
const originalFirestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

const getCurrentBudgetWindowKey = (): string => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
};

describe('OpenAI durable usage accounting', () => {
  let userId: string;
  const email = `openai-usage-test+${TS}@example.com`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'memory';
    process.env.USE_IN_MEMORY_DB = '1';
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'pg-mem://localhost/openai-usage-accounting';
    delete process.env.E2E_MODE;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    resetDbAdapter();
    await initDb();
    const result = await registerAndLoginWebUser({
      firstName: 'OpenAI',
      lastName: 'Usage',
      email,
      password: 'TestPass1!',
    });
    userId = result.userId;
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([email]);
    await closePool();
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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('stores durable request and token usage for successful OpenAI calls', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        choices: [{ message: { content: 'hello' } }],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 45,
          total_tokens: 165,
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
      usageContext: {
        userId,
        windowKey: '2026-04',
        metadata: { tripId: 'trip-123' },
      },
    });

    await expect(getUsageCounter(userId, 'api_calls_openai', '2026-04')).resolves.toBe(1);
    await expect(getUsageCounter(userId, 'api_calls_openai', 'all-time')).resolves.toBe(1);
    await expect(getUsageCounter(userId, 'openai_prompt_tokens', '2026-04')).resolves.toBe(120);
    await expect(getUsageCounter(userId, 'openai_completion_tokens', '2026-04')).resolves.toBe(45);
    await expect(getUsageCounter(userId, 'openai_tokens', '2026-04')).resolves.toBe(165);
    await expect(getUsageCounter(userId, 'openai_tokens', 'all-time')).resolves.toBe(165);
    await expect(getUsageCounter(userId, 'openai_estimated_cost_micros_usd', '2026-04')).resolves.toBe(45);
    await expect(getUsageCounter(userId, 'openai_estimated_cost_micros_usd', 'all-time')).resolves.toBe(45);
    await expect(getApiCostCounter('OPENAI', getCurrentBudgetWindowKey())).resolves.toBe(45);
  });
});
