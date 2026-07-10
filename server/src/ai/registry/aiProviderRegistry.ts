import type { AiChatProvider } from '../providers/AiChatProvider';
import { anthropicProvider } from '../providers/anthropicProvider';
import { geminiProvider } from '../providers/geminiProvider';
import { openaiCompatibleProvider } from '../providers/openaiCompatibleProvider';
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
import { recordUsage } from '../../services/entitlementService';
import { logError } from '../../logger';
import { withAiSpan } from '../tracing';
import { getRunningExperiment } from '../experiments/experimentConfigService';
import { resolveExperimentVariant } from '../experiments/assignment';
import { getOrCreateAiExperimentAssignment } from '../../db';
import { isExperimentVariantTripped, recordExperimentVariantOutcome } from '../experiments/circuitBreaker';
import type { AiExperiment } from '../../types';

const providers = new Map<string, AiChatProvider>([
  [openaiProvider.id, openaiProvider],
  [anthropicProvider.id, anthropicProvider],
  [geminiProvider.id, geminiProvider],
  [zaiProvider.id, zaiProvider],
  [openaiCompatibleProvider.id, openaiCompatibleProvider],
]);

type ExperimentOutcomeContext = {
  experimentId: string;
  variantId: string;
  controlVariantId: string;
};

type UsageAccountingContext = AiCallContext & {
  usageAccountingEnabled?: boolean;
  usageWindowKey?: string | null;
  usageMetadata?: Record<string, unknown>;
};

const recordTrafficSplitOutcome = async (experimentContext: ExperimentOutcomeContext, success: boolean): Promise<void> => {
  try {
    await recordExperimentVariantOutcome({ ...experimentContext, success });
  } catch (err) {
    logError('[aiProviderRegistry] failed to record traffic_split circuit-breaker outcome', err);
  }
};

const getMonthWindowKey = (): string => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
};

const recordNonOpenAiUsage = async (params: {
  providerKey: string;
  model: string;
  ctx: UsageAccountingContext;
  response: AiChatResponse;
  estimatedCostMicrosUsd: number | null;
}): Promise<void> => {
  if (!params.ctx.usageAccountingEnabled || !params.ctx.userId) return;
  const usageKeyPrefix = params.providerKey.toLowerCase();
  const usage = params.response.usage;
  const windowKey = params.ctx.usageWindowKey ?? getMonthWindowKey();
  const budgetWindowKey = getApiBudgetWindowKey();
  const baseMetadata = {
    windowKey,
    budgetWindowKey,
    provider: params.providerKey,
    caller: params.ctx.callerId,
    model: params.model,
    correlationId: params.ctx.correlationId,
    requestId: params.ctx.requestId,
    jobId: params.ctx.jobId ?? null,
    featureKey: params.ctx.featureKey,
    anonymousUserId: params.ctx.anonymousUserId,
    tier: params.ctx.tier,
    role: params.ctx.role,
    callerId: params.ctx.callerId,
    ...(params.ctx.usageMetadata ?? {}),
  };
  await recordUsage(params.ctx.userId, `api_calls_${usageKeyPrefix}`, 1, baseMetadata);
  if ((usage?.prompt_tokens ?? 0) > 0) {
    await recordUsage(params.ctx.userId, `${usageKeyPrefix}_prompt_tokens`, usage?.prompt_tokens ?? 0, baseMetadata);
  }
  if ((usage?.completion_tokens ?? 0) > 0) {
    await recordUsage(params.ctx.userId, `${usageKeyPrefix}_completion_tokens`, usage?.completion_tokens ?? 0, baseMetadata);
  }
  if ((usage?.total_tokens ?? 0) > 0) {
    await recordUsage(params.ctx.userId, `${usageKeyPrefix}_tokens`, usage?.total_tokens ?? 0, baseMetadata);
  }
  if ((params.estimatedCostMicrosUsd ?? 0) > 0) {
    await recordUsage(params.ctx.userId, `${usageKeyPrefix}_estimated_cost_micros_usd`, params.estimatedCostMicrosUsd ?? 0, {
      ...baseMetadata,
      estimatedCostMicrosUsd: params.estimatedCostMicrosUsd,
      estimatedCostUsd: (params.estimatedCostMicrosUsd ?? 0) / 1_000_000,
    });
  }
};

const wrapWithRegistryGuards = (provider: AiChatProvider, experimentContext?: ExperimentOutcomeContext): AiChatProvider => ({
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
      let estimatedCostMicros: number | null = null;
      if (provider.id !== 'openai' && response.usage) {
        try {
          const providerKey = getProviderLimitKey(provider.id);
          estimatedCostMicros = estimateAiCostMicros({
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
      if (provider.id !== 'openai') {
        try {
          await recordNonOpenAiUsage({
            providerKey: getProviderLimitKey(provider.id),
            model: req.model,
            ctx: ctx as UsageAccountingContext,
            response,
            estimatedCostMicrosUsd: estimatedCostMicros,
          });
        } catch (err) {
          logError(`[aiProviderRegistry] failed to record usage for provider=${provider.id}`, err);
        }
      }
      await finalizeAiCallAuthorization(ctx, authorization, {
        provider: provider.id,
        model: req.model,
        responseId: response.id ?? null,
        usage: response.usage ?? null,
      });
      if (experimentContext) await recordTrafficSplitOutcome(experimentContext, true);
      return response;
    } catch (err) {
      await failAiCallAuthorization(ctx, authorization, err);
      if (experimentContext) await recordTrafficSplitOutcome(experimentContext, false);
      throw err;
    }
  },
});

export const registerAiProviderForTesting = (provider: AiChatProvider): void => {
  providers.set(provider.id, provider);
};

export const getRegisteredAiProviders = (): AiChatProvider[] =>
  Array.from(providers.values()).sort((a, b) => a.id.localeCompare(b.id));

const resolveTrafficSplitVariant = async (
  featureKey: string,
  callerId: string,
  trafficSplit: AiExperiment,
): Promise<AiChatProvider | null> => {
  const assignmentKey = `${featureKey}:${callerId}`;
  const resolved = resolveExperimentVariant(assignmentKey, trafficSplit);
  const assignment = await getOrCreateAiExperimentAssignment({
    assignmentKey,
    experimentId: trafficSplit.experimentId,
    variantId: resolved.variantId,
  });
  // `assignment.variantId` is the source of truth, not `resolved` — it may
  // point at a still-live treatment variant, OR it may have been rewritten
  // to `controlVariantId` by the circuit breaker (circuitBreaker.ts) after
  // this exact variant tripped. `resolved` is always a *fresh* recomputation
  // of the original hash-based assignment and knows nothing about that
  // rewrite. Falling back to `resolved` when the stored variant isn't found
  // among `variants[]` (which happens whenever the assignment now points at
  // control, since control is not itself a member of that list) would
  // silently re-derive and re-route to the very variant that was just
  // disabled — defeating the circuit breaker entirely for this experiment
  // kind. If the stored assignment isn't a live treatment variant, this
  // request is on control: fall through to the normal `ai_provider_config`
  // path below, not back to `resolved`.
  const assignedVariant = trafficSplit.variants.find((variant) => variant.variantId === assignment.variantId);
  if (!assignedVariant) return null;
  if (isExperimentVariantTripped(trafficSplit.experimentId, assignedVariant.variantId)) return null;
  if (!assignedVariant.provider || !providers.has(assignedVariant.provider)) return null;
  const controlVariantId = trafficSplit.controlVariantId ?? trafficSplit.variants[0]?.variantId ?? assignedVariant.variantId;
  return wrapWithRegistryGuards(providers.get(assignedVariant.provider) ?? openaiProvider, {
    experimentId: trafficSplit.experimentId,
    variantId: assignedVariant.variantId,
    controlVariantId,
  });
};

export const resolveProvider = async (featureKey: string, _callerId: string, providerOverride?: string): Promise<AiChatProvider> => {
  if (providerOverride) {
    return wrapWithRegistryGuards(providers.get(providerOverride) ?? openaiProvider);
  }
  const trafficSplit = await getRunningExperiment(featureKey, 'traffic_split');
  if (trafficSplit) {
    const resolvedProvider = await resolveTrafficSplitVariant(featureKey, _callerId, trafficSplit);
    if (resolvedProvider) return resolvedProvider;
  }
  const active = await getActiveAiProvider(featureKey);
  return wrapWithRegistryGuards(providers.get(active.provider) ?? openaiProvider);
};
