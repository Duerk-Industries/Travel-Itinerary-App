import axios from 'axios';
import { reserveApiUsageOrThrow } from './usageLimiter';
import { recordUsage } from '../services/entitlementService';
import { estimateOpenAiCostMicros, getApiBudgetWindowKey, recordApiCost } from './providerBudgeting';

type OpenAiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type OpenAiChatCompletionRequest = {
  model: string;
  messages: OpenAiMessage[];
  response_format?: {
    type: 'json_object';
  };
  temperature?: number;
  max_tokens?: number;
};

export type OpenAiChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type OpenAiUsageContext = {
  userId: string;
  windowKey?: string | null;
  metadata?: Record<string, unknown>;
};

const getMonthWindowKey = (): string => {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

export const postOpenAiChatCompletion = async (params: {
  caller: string;
  apiKey: string;
  payload: OpenAiChatCompletionRequest;
  usageContext?: OpenAiUsageContext;
}): Promise<OpenAiChatCompletionResponse> => {
  await reserveApiUsageOrThrow({ provider: 'OPENAI', caller: params.caller });
  const response = await axios.post<OpenAiChatCompletionResponse>(
    'https://api.openai.com/v1/chat/completions',
    params.payload,
    {
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );
  const usage = response.data?.usage;
  const estimatedCostMicrosUsd = estimateOpenAiCostMicros({
    model: params.payload.model,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
  });
  if ((estimatedCostMicrosUsd ?? 0) > 0) {
    await recordApiCost({
      provider: 'OPENAI',
      windowKey: getApiBudgetWindowKey(),
      amountMicros: estimatedCostMicrosUsd ?? 0,
    });
  }
  if (params.usageContext?.userId) {
    const windowKey = params.usageContext.windowKey ?? getMonthWindowKey();
    const budgetWindowKey = getApiBudgetWindowKey();
    const baseMetadata = {
      windowKey,
      budgetWindowKey,
      provider: 'OPENAI',
      caller: params.caller,
      model: params.payload.model,
      ...(params.usageContext.metadata ?? {}),
    };
    await recordUsage(params.usageContext.userId, 'api_calls_openai', 1, baseMetadata);
    if ((usage?.prompt_tokens ?? 0) > 0) {
      await recordUsage(params.usageContext.userId, 'openai_prompt_tokens', usage?.prompt_tokens ?? 0, baseMetadata);
    }
    if ((usage?.completion_tokens ?? 0) > 0) {
      await recordUsage(
        params.usageContext.userId,
        'openai_completion_tokens',
        usage?.completion_tokens ?? 0,
        baseMetadata
      );
    }
    if ((usage?.total_tokens ?? 0) > 0) {
      await recordUsage(params.usageContext.userId, 'openai_tokens', usage?.total_tokens ?? 0, baseMetadata);
    }
    if ((estimatedCostMicrosUsd ?? 0) > 0) {
      const costMetadata = {
        ...baseMetadata,
        estimatedCostMicrosUsd,
        estimatedCostUsd: estimatedCostMicrosUsd! / 1_000_000,
      };
      await recordUsage(
        params.usageContext.userId,
        'openai_estimated_cost_micros_usd',
        estimatedCostMicrosUsd ?? 0,
        costMetadata
      );
    }
  }
  return response.data;
};

