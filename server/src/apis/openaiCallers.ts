import { createAiCallContext } from '../ai/registry/correlation';
import { resolveProvider } from '../ai/registry/aiProviderRegistry';
import type { AiCallContext } from '../ai/types/aiChat';
import { getActiveAiProvider } from '../services/aiProviderConfigService';

const OPENAI_CALLER_ITINERARY_GENERATE = 'ITINERARY_GENERATE_PLAN';
const OPENAI_PROVIDER_ID = 'openai';
const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
const AI_FEATURE_ITINERARY_GENERATION = 'itinerary_generation';
export const OPENAI_CALLER_ITINERARY_PLAN_P0_NORM = 'ITINERARY_PLAN_P0_NORM';
export const OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE = 'ITINERARY_PLAN_P1_ROUTE';
export const OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS = 'ITINERARY_PLAN_P2_DAYS';
export const OPENAI_CALLER_ITINERARY_PLAN_P3_VALIDATE = 'ITINERARY_PLAN_P3_VALIDATE';
// itinerary-improvements-coding-plan.md Phase 4B: single, batched targeted-repair call used only
// when deterministic thin-day fill (dayFillService.ts) can't raise a day to the minimum item
// count. Capped to one attempt per generation by the caller.
export const OPENAI_CALLER_ITINERARY_PLAN_P3B_REPAIR = 'ITINERARY_PLAN_P3B_REPAIR';
export const OPENAI_CALLER_ITINERARY_PLAN_P4_RENDER = 'ITINERARY_PLAN_P4_RENDER';

type TextCompletionResult = {
  text: string | null;
  promptTokens: number;
  completionTokens: number;
  provider: string;
  model: string;
};

type OpenAiCallerUsageContext = {
  userId: string;
  windowKey?: string | null;
  metadata?: Record<string, unknown>;
};

const runOpenAiTextCompletion = async (params: {
  apiKey?: string;
  caller: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  providerOverride?: string;
  modelOverride?: string;
  usageContext?: OpenAiCallerUsageContext;
}): Promise<TextCompletionResult> => {
  const activeConfig = await getActiveAiProvider(AI_FEATURE_ITINERARY_GENERATION);
  const providerId = params.providerOverride || activeConfig.provider || OPENAI_PROVIDER_ID;
  const model = params.modelOverride || activeConfig.model || OPENAI_DEFAULT_MODEL;
  const provider = await resolveProvider(AI_FEATURE_ITINERARY_GENERATION, params.caller, params.providerOverride);
  const ctx = createAiCallContext({
    featureKey: AI_FEATURE_ITINERARY_GENERATION,
    userId: params.usageContext?.userId ?? 'anonymous',
    provider: provider.id || providerId,
    model,
    callerId: params.caller,
  }) as AiCallContext & {
    apiKey?: string;
    usageAccountingEnabled?: boolean;
    usageWindowKey?: string | null;
    usageMetadata?: Record<string, unknown>;
  };
  if (params.apiKey) {
    ctx.apiKey = params.apiKey;
  }
  ctx.usageAccountingEnabled = Boolean(params.usageContext?.userId);
  ctx.usageWindowKey = params.usageContext?.windowKey;
  ctx.usageMetadata = params.usageContext?.metadata;

  const data = await provider.chatCompletion(
    {
      model,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
      temperature: typeof params.temperature === 'number' ? params.temperature : 0.2,
      max_tokens: typeof params.maxTokens === 'number' ? params.maxTokens : 900,
    },
    ctx
  );

  return {
    text: data?.choices?.[0]?.message?.content ?? null,
    promptTokens: data?.usage?.prompt_tokens ?? 0,
    completionTokens: data?.usage?.completion_tokens ?? 0,
    provider: provider.id || providerId,
    model,
  };
};

export const generateItineraryPlanViaOpenAi = async (params: {
  apiKey?: string;
  prompt: string;
  providerOverride?: string;
  modelOverride?: string;
  usageContext?: OpenAiCallerUsageContext;
}): Promise<string | null> => {
  const result = await runOpenAiTextCompletion({
    apiKey: params.apiKey,
    caller: OPENAI_CALLER_ITINERARY_GENERATE,
    systemPrompt: 'You write concise, actionable travel itineraries.',
    userPrompt: params.prompt,
    temperature: 0.7,
    maxTokens: 500,
    providerOverride: params.providerOverride,
    modelOverride: params.modelOverride,
    usageContext: params.usageContext,
  });
  return result.text;
};

export const runItineraryPromptStageViaOpenAi = async (params: {
  apiKey?: string;
  caller:
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P0_NORM
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P3_VALIDATE
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P3B_REPAIR
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P4_RENDER;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  providerOverride?: string;
  modelOverride?: string;
  usageContext?: OpenAiCallerUsageContext;
}): Promise<TextCompletionResult> => {
  return runOpenAiTextCompletion({
    apiKey: params.apiKey,
    caller: params.caller,
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    temperature: 0.2,
    maxTokens: params.maxTokens,
    providerOverride: params.providerOverride,
    modelOverride: params.modelOverride,
    usageContext: params.usageContext,
  });
};

