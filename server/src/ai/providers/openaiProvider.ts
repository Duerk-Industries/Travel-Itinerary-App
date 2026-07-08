import { postOpenAiChatCompletion } from '../../apis/openaiApi';
import { getEnvValue } from '../../env';
import { getConfiguredProviderModels } from '../../services/aiProviderConfigService';
import type { AiCallContext, AiChatRequest, AiChatResponse } from '../types/aiChat';
import type { AiChatProvider } from './AiChatProvider';

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
const OPENAI_SUPPORTED_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'];

export const openaiProvider: AiChatProvider = {
  id: 'openai',
  get supportedModels(): string[] {
    return getConfiguredProviderModels('openai', OPENAI_SUPPORTED_MODELS);
  },

  async chatCompletion(req: AiChatRequest, ctx: AiCallContext): Promise<AiChatResponse> {
    const compatibilityContext = ctx as AiCallContext & {
      apiKey?: string;
      usageAccountingEnabled?: boolean;
      usageWindowKey?: string | null;
      usageMetadata?: Record<string, unknown>;
    };
    const apiKey = compatibilityContext.apiKey ?? getEnvValue('OPENAI_API_KEY', { required: true });
    if (!apiKey) {
      throw new Error('Missing required env var: OPENAI_API_KEY');
    }
    return postOpenAiChatCompletion({
      caller: ctx.callerId,
      apiKey,
      payload: {
        model: req.model,
        messages: req.messages,
        response_format: req.response_format,
        temperature: req.temperature,
        max_tokens: req.max_tokens,
      },
      skipApiUsageReservation: true,
      usageContext: compatibilityContext.usageAccountingEnabled
        ? {
            userId: ctx.userId,
            windowKey: compatibilityContext.usageWindowKey,
            metadata: {
              correlationId: ctx.correlationId,
              requestId: ctx.requestId,
              jobId: ctx.jobId ?? null,
              featureKey: ctx.featureKey,
              anonymousUserId: ctx.anonymousUserId,
              tier: ctx.tier,
              role: ctx.role,
              provider: ctx.provider,
              model: ctx.model,
              callerId: ctx.callerId,
              ...(compatibilityContext.usageMetadata ?? {}),
            },
          }
        : undefined,
    });
  },
};
