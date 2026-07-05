import axios from 'axios';
import { getEnvValue } from '../../env';
import type { AiCallContext, AiChatMessage, AiChatRequest, AiChatResponse } from '../types/aiChat';
import type { AiChatProvider } from './AiChatProvider';
import { normalizeProviderError } from './providerErrors';

const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-5';
const ANTHROPIC_API_VERSION = '2023-06-01';

type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const combineSystemMessages = (messages: AiChatMessage[], jsonMode: boolean): string | undefined => {
  const parts = messages.filter((message) => message.role === 'system').map((message) => message.content.trim()).filter(Boolean);
  if (jsonMode) parts.push('Return only a valid JSON object. Do not wrap it in Markdown.');
  return parts.length ? parts.join('\n\n') : undefined;
};

const toAnthropicMessages = (messages: AiChatMessage[]): AnthropicMessage[] =>
  messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    }));

const contentText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => part && typeof part === 'object' && (part as any).type === 'text' ? String((part as any).text ?? '') : '')
    .join('');
};

export const anthropicProvider: AiChatProvider = {
  id: 'anthropic',
  supportedModels: [ANTHROPIC_DEFAULT_MODEL],

  async chatCompletion(req: AiChatRequest, _ctx: AiCallContext): Promise<AiChatResponse> {
    const apiKey = getEnvValue('ANTHROPIC_API_KEY', { required: true });
    if (!apiKey) throw new Error('Missing required env var: ANTHROPIC_API_KEY');
    const jsonMode = req.response_format?.type === 'json_object';
    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: req.model,
          max_tokens: req.max_tokens ?? 1024,
          temperature: req.temperature,
          system: combineSystemMessages(req.messages, jsonMode),
          messages: toAnthropicMessages(req.messages),
        },
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
            'Content-Type': 'application/json',
          },
        }
      );
      const data = response.data ?? {};
      return {
        id: data.id,
        model: data.model ?? req.model,
        choices: [{
          message: { role: 'assistant', content: contentText(data.content) },
          finish_reason: data.stop_reason ?? null,
        }],
        usage: {
          prompt_tokens: data.usage?.input_tokens ?? 0,
          completion_tokens: data.usage?.output_tokens ?? 0,
          total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
        },
      };
    } catch (err) {
      throw normalizeProviderError('anthropic', err);
    }
  },
};
