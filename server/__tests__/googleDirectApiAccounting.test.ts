/// <reference types="jest" />

jest.mock('../src/apis/usageLimiter', () => ({
  reserveApiUsageOrThrow: jest.fn(async () => undefined),
  ApiLimitExceededError: class ApiLimitExceededError extends Error {},
}));

jest.mock('../src/apis/providerBudgeting', () => ({
  recordProviderRequestCost: jest.fn(async () => undefined),
  estimateAiCostMicros: jest.fn(() => 12_345),
  getApiBudgetWindowKey: jest.fn(() => '2026-07'),
  recordApiCost: jest.fn(async () => 12_345),
}));

const mockOpenAiCreate = jest.fn();
jest.mock('openai', () => ({
  OpenAI: jest.fn(() => ({ chat: { completions: { create: mockOpenAiCreate } } })),
}));

const mockedReserve = jest.requireMock('../src/apis/usageLimiter').reserveApiUsageOrThrow as jest.Mock;
const mockedRecordRequestCost = jest.requireMock('../src/apis/providerBudgeting').recordProviderRequestCost as jest.Mock;
const mockedRecordApiCost = jest.requireMock('../src/apis/providerBudgeting').recordApiCost as jest.Mock;

const response = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response);

describe('direct Google API accounting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    mockOpenAiCreate.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reserves Gmail profile, search, and message requests through the shared provider limiter', async () => {
    const { fetchGmailProfile, listCandidateGmailMessages, getGmailMessage } = require('../src/ingestion/intake/gmail') as typeof import('../src/ingestion/intake/gmail');
    const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.endsWith('/profile')) return response({ emailAddress: 'traveler@example.com' });
      if (url.includes('/messages?')) return response({ messages: [{ id: 'm1', threadId: 't1' }] });
      return response({ id: 'm1', threadId: 't1', payload: {} });
    });

    await fetchGmailProfile('token');
    await listCandidateGmailMessages('token', 7);
    await getGmailMessage('token', 'm1');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mockedReserve.mock.calls).toEqual([
      [{ provider: 'GMAIL', caller: 'GMAIL_PROFILE' }],
      [{ provider: 'GMAIL', caller: 'GMAIL_MESSAGE_SEARCH' }],
      [{ provider: 'GMAIL', caller: 'GMAIL_MESSAGE_READ' }],
    ]);
    expect(mockedRecordRequestCost).toHaveBeenCalledTimes(3);
    expect(mockedRecordRequestCost).toHaveBeenCalledWith({ provider: 'GMAIL' });
  });

  it('reserves direct Gemini flight parsing and records token-based cost', async () => {
    const { GeminiFlightParser } = require('../src/services/flightParserLLM/gemini') as typeof import('../src/services/flightParserLLM/gemini');
    jest.spyOn(globalThis, 'fetch' as any).mockResolvedValue(
      response({
        candidates: [{ content: { parts: [{ text: '{"primary":{"flightNumber":"DL123"},"bulk":[]}' }] } }],
        usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 12, totalTokenCount: 52 },
      })
    );

    const result = await new GeminiFlightParser().parse('flight confirmation');

    expect(result.primary.flightNumber).toBe('DL123');
    expect(mockedReserve).toHaveBeenCalledWith({ provider: 'GEMINI', caller: 'PARSE_FLIGHT_TEXT' });
    expect(mockedRecordApiCost).toHaveBeenCalledWith({
      provider: 'GEMINI',
      windowKey: '2026-07',
      amountMicros: 12_345,
    });
  });

  it('reserves direct OpenAI flight parsing and records token-based cost', async () => {
    const { OpenAIFlightParser } = require('../src/services/flightParserLLM/openai') as typeof import('../src/services/flightParserLLM/openai');
    mockOpenAiCreate.mockResolvedValue({
      choices: [{ message: { content: '{"primary":{"flightNumber":"UA456"},"bulk":[]}' } }],
      usage: { prompt_tokens: 25, completion_tokens: 8 },
    });

    const result = await new OpenAIFlightParser().parse('flight confirmation');

    expect(result.primary.flightNumber).toBe('UA456');
    expect(mockedReserve).toHaveBeenCalledWith({ provider: 'OPENAI', caller: 'PARSE_FLIGHT_TEXT' });
    expect(mockedRecordApiCost).toHaveBeenCalledWith({
      provider: 'OPENAI',
      windowKey: '2026-07',
      amountMicros: 12_345,
    });
  });
});
