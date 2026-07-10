import axios from 'axios';
import { getEnvValue } from '../../env';
import { getConfiguredProviderModels } from '../../services/aiProviderConfigService';
import type { AiCallContext, AiChatRequest, AiChatResponse } from '../types/aiChat';
import type { AiChatProvider } from './AiChatProvider';
import { normalizeProviderError } from './providerErrors';

const ZAI_DEFAULT_MODEL = 'glm-4.7';
const ZAI_SUPPORTED_MODELS = ['glm-4.7', 'glm-4.5-air', 'glm-4.5'];
const ZAI_DEFAULT_BASE_URL = 'https://api.z.ai/api/paas/v4';

const baseUrl = (): string =>
  (getEnvValue('ZAI_BASE_URL', { defaultValue: ZAI_DEFAULT_BASE_URL }) ?? ZAI_DEFAULT_BASE_URL).replace(/\/+$/, '');

export const zaiProvider: AiChatProvider = {
  id: 'zai',
  get supportedModels(): string[] {
    return getConfiguredProviderModels('zai', ZAI_SUPPORTED_MODELS);
  },

  async chatCompletion(req: AiChatRequest, _ctx: AiCallContext): Promise<AiChatResponse> {
    const apiKey = getEnvValue('ZAI_API_KEY', { required: true });
    if (!apiKey) throw new Error('Missing required env var: ZAI_API_KEY');
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
      throw normalizeProviderError('zai', err);
    }
  },
};
