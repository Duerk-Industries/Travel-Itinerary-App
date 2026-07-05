import type { AiChatProvider } from '../providers/AiChatProvider';
import { anthropicProvider } from '../providers/anthropicProvider';
import { geminiProvider } from '../providers/geminiProvider';
import { openaiProvider } from '../providers/openaiProvider';
import { zaiProvider } from '../providers/zaiProvider';
import type { AiCallContext, AiChatRequest, AiChatResponse } from '../types/aiChat';
import {
  authorizeAiCall,
  failAiCallAuthorization,
  finalizeAiCallAuthorization,
} from '../../services/aiInvocationGuard';
import { getActiveAiProvider } from '../../services/aiProviderConfigService';
import { withAiSpan } from '../tracing';

const providers = new Map<string, AiChatProvider>([
  [openaiProvider.id, openaiProvider],
  [anthropicProvider.id, anthropicProvider],
  [geminiProvider.id, geminiProvider],
  [zaiProvider.id, zaiProvider],
]);

const wrapWithRegistryGuards = (provider: AiChatProvider): AiChatProvider => ({
  ...provider,
  async chatCompletion(req: AiChatRequest, ctx: AiCallContext): Promise<AiChatResponse> {
    let authorization: Awaited<ReturnType<typeof authorizeAiCall>> | undefined;
    try {
      authorization = await authorizeAiCall(ctx);
      const response = await withAiSpan('ai.provider.chatCompletion', {
        correlationId: ctx.correlationId,
        jobId: ctx.jobId,
        featureKey: ctx.featureKey,
        provider: provider.id,
        model: req.model,
        callerId: ctx.callerId,
      }, () => provider.chatCompletion(req, ctx));
      await finalizeAiCallAuthorization(ctx, authorization, {
        provider: provider.id,
        model: req.model,
        responseId: response.id ?? null,
        usage: response.usage ?? null,
      });
      return response;
    } catch (err) {
      await failAiCallAuthorization(ctx, authorization, err);
      throw err;
    }
  },
});

export const registerAiProviderForTesting = (provider: AiChatProvider): void => {
  providers.set(provider.id, provider);
};

export const getRegisteredAiProviders = (): AiChatProvider[] =>
  Array.from(providers.values()).sort((a, b) => a.id.localeCompare(b.id));

export const resolveProvider = async (featureKey: string, _callerId: string): Promise<AiChatProvider> => {
  const active = await getActiveAiProvider(featureKey);
  return wrapWithRegistryGuards(providers.get(active.provider) ?? openaiProvider);
};
