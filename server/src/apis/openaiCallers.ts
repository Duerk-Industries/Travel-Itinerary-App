import { createAiCallContext } from '../ai/registry/correlation';
import { resolveProvider } from '../ai/registry/aiProviderRegistry';
import type { AiCallContext } from '../ai/types/aiChat';

const OPENAI_CALLER_ITINERARY_GENERATE = 'ITINERARY_GENERATE_PLAN';
const OPENAI_PROVIDER_ID = 'openai';
const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
const AI_FEATURE_ITINERARY_GENERATION = 'itinerary_generation';
export const OPENAI_CALLER_ITINERARY_PLAN_P0_NORM = 'ITINERARY_PLAN_P0_NORM';
export const OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE = 'ITINERARY_PLAN_P1_ROUTE';
export const OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS = 'ITINERARY_PLAN_P2_DAYS';
export const OPENAI_CALLER_ITINERARY_PLAN_P3_VALIDATE = 'ITINERARY_PLAN_P3_VALIDATE';
export const OPENAI_CALLER_ITINERARY_PLAN_P4_RENDER = 'ITINERARY_PLAN_P4_RENDER';

type TextCompletionResult = {
  text: string | null;
  promptTokens: number;
  completionTokens: number;
};

type OpenAiCallerUsageContext = {
  userId: string;
  windowKey?: string | null;
  metadata?: Record<string, unknown>;
};

const runOpenAiTextCompletion = async (params: {
  apiKey: string;
  caller: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  usageContext?: OpenAiCallerUsageContext;
}): Promise<TextCompletionResult> => {
  const provider = resolveProvider(AI_FEATURE_ITINERARY_GENERATION, params.caller);
  const ctx = createAiCallContext({
    featureKey: AI_FEATURE_ITINERARY_GENERATION,
    userId: params.usageContext?.userId ?? 'anonymous',
    provider: provider.id || OPENAI_PROVIDER_ID,
    model: OPENAI_DEFAULT_MODEL,
    callerId: params.caller,
  }) as AiCallContext & {
    apiKey?: string;
    usageWindowKey?: string | null;
    usageMetadata?: Record<string, unknown>;
  };
  ctx.apiKey = params.apiKey;
  ctx.usageWindowKey = params.usageContext?.windowKey;
  ctx.usageMetadata = params.usageContext?.metadata;

  const data = await provider.chatCompletion(
    {
      model: OPENAI_DEFAULT_MODEL,
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
  };
};

export const generateItineraryPlanViaOpenAi = async (params: {
  apiKey: string;
  prompt: string;
  usageContext?: OpenAiCallerUsageContext;
}): Promise<string | null> => {
  const result = await runOpenAiTextCompletion({
    apiKey: params.apiKey,
    caller: OPENAI_CALLER_ITINERARY_GENERATE,
    systemPrompt: 'You write concise, actionable travel itineraries.',
    userPrompt: params.prompt,
    temperature: 0.7,
    maxTokens: 500,
    usageContext: params.usageContext,
  });
  return result.text;
};

export const runItineraryPromptStageViaOpenAi = async (params: {
  apiKey: string;
  caller:
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P0_NORM
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P3_VALIDATE
    | typeof OPENAI_CALLER_ITINERARY_PLAN_P4_RENDER;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  usageContext?: OpenAiCallerUsageContext;
}): Promise<TextCompletionResult> => {
  return runOpenAiTextCompletion({
    apiKey: params.apiKey,
    caller: params.caller,
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    temperature: 0.2,
    maxTokens: params.maxTokens,
    usageContext: params.usageContext,
  });
};

