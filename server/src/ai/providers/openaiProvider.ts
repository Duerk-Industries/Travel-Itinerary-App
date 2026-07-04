import { postOpenAiChatCompletion } from '../../apis/openaiApi';
import { getEnvValue } from '../../env';
import type { AiCallContext, AiChatRequest, AiChatResponse } from '../types/aiChat';
import type { AiChatProvider } from './AiChatProvider';

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';

export const openaiProvider: AiChatProvider = {
  id: 'openai',
  supportedModels: [OPENAI_DEFAULT_MODEL],

  async chatCompletion(req: AiChatRequest, ctx: AiCallContext): Promise<AiChatResponse> {
    const compatibilityContext = ctx as AiCallContext & {
      apiKey?: string;
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
      usageContext: ctx.userId
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
