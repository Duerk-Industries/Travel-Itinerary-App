import type { AiCallContext, AiChatRequest, AiChatResponse } from '../types/aiChat';
import type { AiChatProvider } from '../providers/AiChatProvider';

export type TestAiProviderOptions = {
  simulateLatency?: number;
  simulateMalformedJson?: boolean;
  simulateThrottle?: boolean;
  simulateTimeout?: boolean;
  responsesByInput?: Record<string, string>;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeInput = (req: AiChatRequest): string => req.messages.map((message) => `${message.role}:${message.content}`).join('\n');

const estimateTokens = (value: string): number => Math.max(1, Math.ceil(value.length / 4));

export class TestAiProvider implements AiChatProvider {
  readonly id = 'test';
  readonly supportedModels = ['test-model'];
  private readonly options: TestAiProviderOptions;

  constructor(options: TestAiProviderOptions = {}) {
    this.options = options;
  }

  async chatCompletion(req: AiChatRequest, _ctx: AiCallContext): Promise<AiChatResponse> {
    if (this.options.simulateLatency) {
      await sleep(this.options.simulateLatency);
    }

    if (this.options.simulateThrottle) {
      const err = new Error('Test AI provider throttle');
      (err as any).code = 'AI_PROVIDER_THROTTLED';
      (err as any).status = 429;
      throw err;
    }

    if (this.options.simulateTimeout) {
      const err = new Error('Test AI provider timeout');
      (err as any).code = 'AI_PROVIDER_TIMEOUT';
      throw err;
    }

    const input = normalizeInput(req);
    const content =
      this.options.responsesByInput?.[input] ??
      (this.options.simulateMalformedJson
        ? '{"malformed": true'
        : JSON.stringify({ provider: this.id, model: req.model, inputHash: estimateTokens(input) }));
    const promptTokens = estimateTokens(input);
    const completionTokens = estimateTokens(content);

    return {
      id: 'test-chat-completion',
      model: req.model,
      choices: [
        {
          message: {
            role: 'assistant',
            content,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  }
}
