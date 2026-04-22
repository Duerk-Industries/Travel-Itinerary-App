import axios from 'axios';
import { reserveApiUsageOrThrow } from './usageLimiter';
import { recordUsage } from '../services/entitlementService';

type OpenAiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type OpenAiChatCompletionRequest = {
  model: string;
  messages: OpenAiMessage[];
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
  reserveApiUsageOrThrow({ provider: 'OPENAI', caller: params.caller });
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
  if (params.usageContext?.userId) {
    const windowKey = params.usageContext.windowKey ?? getMonthWindowKey();
    const baseMetadata = {
      windowKey,
      provider: 'OPENAI',
      caller: params.caller,
      model: params.payload.model,
      ...(params.usageContext.metadata ?? {}),
    };
    const usage = response.data?.usage;
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
  }
  return response.data;
};

