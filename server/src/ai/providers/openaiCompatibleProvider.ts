import axios from 'axios';
import { getEnvValue } from '../../env';
import { getConfiguredProviderModels } from '../../services/aiProviderConfigService';
import type { AiCallContext, AiChatRequest, AiChatResponse } from '../types/aiChat';
import type { AiChatProvider } from './AiChatProvider';
import { normalizeProviderError } from './providerErrors';

const OPENAI_COMPATIBLE_DEFAULT_MODEL = 'gpt-4o-mini';
const OPENAI_COMPATIBLE_DEFAULT_BASE_URL = 'http://localhost:1234/v1';

const baseUrl = (): string =>
  (getEnvValue('OPENAI_COMPATIBLE_BASE_URL', { defaultValue: OPENAI_COMPATIBLE_DEFAULT_BASE_URL }) ??
    OPENAI_COMPATIBLE_DEFAULT_BASE_URL).replace(/\/+$/, '');

export const openaiCompatibleProvider: AiChatProvider = {
  id: 'openai_compatible',
  get supportedModels(): string[] {
    return getConfiguredProviderModels('openai_compatible', [OPENAI_COMPATIBLE_DEFAULT_MODEL]);
  },

  async chatCompletion(req: AiChatRequest, _ctx: AiCallContext): Promise<AiChatResponse> {
    const apiKey = getEnvValue('OPENAI_COMPATIBLE_API_KEY', { required: true });
    if (!apiKey) throw new Error('Missing required env var: OPENAI_COMPATIBLE_API_KEY');
    try {
      const response = await axios.post<AiChatResponse>(
        `${baseUrl()}/chat/completions`,
        {
          model: req.model,
          messages: req.messages,
          response_format: req.response_format,
          temperature: req.temperature,
          max_tokens: req.max_tokens,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );
      return response.data;
    } catch (err) {
      throw normalizeProviderError('openai_compatible', err);
    }
  },
};
