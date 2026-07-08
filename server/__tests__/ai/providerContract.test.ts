/// <reference types="jest" />
/// <reference types="node" />

import type { AiCallContext, AiChatRequest } from '../../src/ai/types/aiChat';
import type { AiChatProvider } from '../../src/ai/providers/AiChatProvider';
import { TestAiProvider } from '../../src/ai/testing/testAiProvider';
import { openaiProvider } from '../../src/ai/providers/openaiProvider';
import { openaiCompatibleProvider } from '../../src/ai/providers/openaiCompatibleProvider';
import { anthropicProvider } from '../../src/ai/providers/anthropicProvider';
import { geminiProvider } from '../../src/ai/providers/geminiProvider';
import { zaiProvider } from '../../src/ai/providers/zaiProvider';
import { postOpenAiChatCompletion } from '../../src/apis/openaiApi';
import axios from 'axios';

jest.mock('../../src/apis/openaiApi', () => ({
  postOpenAiChatCompletion: jest.fn(),
}));
jest.mock('axios');

const mockedPostOpenAiChatCompletion = postOpenAiChatCompletion as jest.MockedFunction<typeof postOpenAiChatCompletion>;
const mockedAxios = axios as jest.Mocked<typeof axios>;

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
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.ZAI_API_KEY;
      delete process.env.ZAI_BASE_URL;
      delete process.env.OPENAI_COMPATIBLE_API_KEY;
      delete process.env.OPENAI_COMPATIBLE_BASE_URL;
      delete process.env.OPENAI_COMPATIBLE_MODELS;
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
      if (name === 'anthropicProvider') {
        process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
        mockedAxios.post.mockResolvedValueOnce({
          data: {
            id: 'msg-test',
            model: 'claude-sonnet-4-5',
            content: [{ type: 'text', text: '{"ok":true}' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 12, output_tokens: 8 },
          },
        });
      }
      if (name === 'geminiProvider') {
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        mockedAxios.post.mockResolvedValueOnce({
          data: {
            candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 },
          },
        });
      }
      if (name === 'zaiProvider') {
        process.env.ZAI_API_KEY = 'test-zai-key';
        mockedAxios.post.mockResolvedValueOnce({
          data: {
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
          },
        });
      }
      if (name === 'openaiCompatibleProvider') {
        process.env.OPENAI_COMPATIBLE_API_KEY = 'test-compatible-key';
        mockedAxios.post.mockResolvedValueOnce({
          data: {
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
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
      if (name === 'openaiProvider') {
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
        return;
      }
      if (name === 'anthropicProvider') {
        process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
        mockedAxios.post.mockResolvedValueOnce({ data: { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } } });
        await getProvider().chatCompletion({ ...request, response_format: { type: 'json_object' } }, context);
        expect(mockedAxios.post).toHaveBeenCalledWith(
          'https://api.anthropic.com/v1/messages',
          expect.objectContaining({
            model: request.model,
            system: expect.stringContaining('Return JSON.'),
            messages: [{ role: 'user', content: 'Plan a test trip.' }],
            max_tokens: request.max_tokens,
          }),
          expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'test-anthropic-key' }) })
        );
        return;
      }
      if (name === 'geminiProvider') {
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        mockedAxios.post.mockResolvedValueOnce({ data: { candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: {} } });
        await getProvider().chatCompletion({ ...request, response_format: { type: 'json_object' } }, context);
        expect(mockedAxios.post).toHaveBeenCalledWith(
          expect.stringContaining('/v1beta/models/gpt-4o-mini:generateContent'),
          expect.objectContaining({
            contents: [{ role: 'user', parts: [{ text: 'Plan a test trip.' }] }],
            generationConfig: expect.objectContaining({ responseMimeType: 'application/json' }),
          }),
          expect.objectContaining({ params: { key: 'test-gemini-key' } })
        );
        return;
      }
      if (name === 'zaiProvider') {
        process.env.ZAI_API_KEY = 'test-zai-key';
        mockedAxios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });
        await getProvider().chatCompletion(request, context);
        expect(mockedAxios.post).toHaveBeenCalledWith(
          'https://api.z.ai/api/paas/v4/chat/completions',
          expect.objectContaining({
            model: request.model,
            messages: request.messages,
          }),
          expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-zai-key' }) })
        );
        return;
      }
      if (name === 'openaiCompatibleProvider') {
        process.env.OPENAI_COMPATIBLE_API_KEY = 'test-compatible-key';
        process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:4321/v1';
        mockedAxios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });
        await getProvider().chatCompletion(request, context);
        expect(mockedAxios.post).toHaveBeenCalledWith(
          'http://localhost:4321/v1/chat/completions',
          expect.objectContaining({
            model: request.model,
            messages: request.messages,
          }),
          expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-compatible-key' }) })
        );
      }
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
        : name === 'TestAiProvider'
          ? new TestAiProvider({ simulateThrottle: true })
          : {
              ...getProvider(),
              chatCompletion: async () => {
                const err = new Error(`${name} throttle`);
                (err as any).status = 429;
                throw err;
              },
            };

      await expect(provider.chatCompletion(request, context)).rejects.toMatchObject({
        message: expect.any(String),
        status: 429,
      });
    });
  });
};

runProviderContract('openaiProvider', () => openaiProvider);
runProviderContract('openaiCompatibleProvider', () => openaiCompatibleProvider);
runProviderContract('anthropicProvider', () => anthropicProvider);
runProviderContract('geminiProvider', () => geminiProvider);
runProviderContract('zaiProvider', () => zaiProvider);
runProviderContract('TestAiProvider', () => new TestAiProvider());
