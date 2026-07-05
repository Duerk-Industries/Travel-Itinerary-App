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
import { getProviderLimitKey } from '../../services/aiInvocationGuard';
import { estimateAiCostMicros, getApiBudgetWindowKey, recordApiCost } from '../../apis/providerBudgeting';
import { logError } from '../../logger';
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
      // openaiProvider delegates to postOpenAiChatCompletion, which already
      // records its own cost against the OPENAI budget bucket — recording it
      // again here would double-count. Every other provider has no such
      // internal accounting, so this is the one place their budgeting.yaml
      // pricing blocks actually get used instead of being decorative.
      if (provider.id !== 'openai' && response.usage) {
        try {
          const providerKey = getProviderLimitKey(provider.id);
          const estimatedCostMicros = estimateAiCostMicros({
            provider: providerKey,
            model: req.model,
            promptTokens: response.usage.prompt_tokens ?? 0,
            completionTokens: response.usage.completion_tokens ?? 0,
          });
          if ((estimatedCostMicros ?? 0) > 0) {
            await recordApiCost({
              provider: providerKey,
              windowKey: getApiBudgetWindowKey(),
              amountMicros: estimatedCostMicros ?? 0,
            });
          }
        } catch (err) {
          logError(`[aiProviderRegistry] failed to record cost for provider=${provider.id}`, err);
        }
      }
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
