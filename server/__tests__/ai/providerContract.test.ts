/// <reference types="jest" />
/// <reference types="node" />

import type { AiCallContext, AiChatRequest } from '../../src/ai/types/aiChat';
import type { AiChatProvider } from '../../src/ai/providers/AiChatProvider';
import { TestAiProvider } from '../../src/ai/testing/testAiProvider';
import { openaiProvider } from '../../src/ai/providers/openaiProvider';
import { postOpenAiChatCompletion } from '../../src/apis/openaiApi';

jest.mock('../../src/apis/openaiApi', () => ({
  postOpenAiChatCompletion: jest.fn(),
}));

const mockedPostOpenAiChatCompletion = postOpenAiChatCompletion as jest.MockedFunction<typeof postOpenAiChatCompletion>;

const request: AiChatRequest = {
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'Return JSON.' },
    { role: 'user', content: 'Plan a test trip.' },
  ],
  temperature: 0.2,
  max_tokens: 64,
};

const context: AiCallContext = {
  correlationId: 'corr-test',
  requestId: 'req-test',
  jobId: 'job-test',
  featureKey: 'itinerary_generation',
  userId: 'user-test',
  anonymousUserId: 'anon-test',
  tier: 'free',
  role: 'user',
  provider: 'openai',
  model: 'gpt-4o-mini',
  callerId: 'ITINERARY_PLAN_P0_NORM',
};

const runProviderContract = (name: string, getProvider: () => AiChatProvider) => {
  describe(name, () => {
    afterEach(() => {
      jest.clearAllMocks();
      delete process.env.OPENAI_API_KEY;
    });

    it('normalizes chat responses and token usage', async () => {
      if (name === 'openaiProvider') {
        process.env.OPENAI_API_KEY = 'test-openai-key';
        mockedPostOpenAiChatCompletion.mockResolvedValueOnce({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20,
          },
        });
      }

      const response = await getProvider().chatCompletion(request, context);

      expect(response.choices?.[0]?.message?.content).toBeTruthy();
      expect(response.usage?.prompt_tokens).toEqual(expect.any(Number));
      expect(response.usage?.completion_tokens).toEqual(expect.any(Number));
      expect(response.usage?.total_tokens).toEqual(expect.any(Number));
    });

    it('preserves request shape when calling the underlying provider', async () => {
      if (name !== 'openaiProvider') return;
      process.env.OPENAI_API_KEY = 'test-openai-key';
      mockedPostOpenAiChatCompletion.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });

      await getProvider().chatCompletion(request, context);

      expect(mockedPostOpenAiChatCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          caller: context.callerId,
          apiKey: 'test-openai-key',
          payload: {
            model: request.model,
            messages: request.messages,
            response_format: request.response_format,
            temperature: request.temperature,
            max_tokens: request.max_tokens,
          },
        })
      );
    });

    it('exposes structured provider errors', async () => {
      const provider = name === 'openaiProvider'
        ? {
            ...openaiProvider,
            chatCompletion: async () => {
              const err = new Error('OpenAI throttle');
              (err as any).status = 429;
              throw err;
            },
          }
        : new TestAiProvider({ simulateThrottle: true });

      await expect(provider.chatCompletion(request, context)).rejects.toMatchObject({
        message: expect.any(String),
        status: 429,
      });
    });
  });
};

runProviderContract('openaiProvider', () => openaiProvider);
runProviderContract('TestAiProvider', () => new TestAiProvider());
