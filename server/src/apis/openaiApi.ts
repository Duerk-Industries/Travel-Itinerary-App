import axios from 'axios';
import { reserveApiUsageOrThrow } from './usageLimiter';

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
};

export const postOpenAiChatCompletion = async (params: {
  caller: string;
  apiKey: string;
  payload: OpenAiChatCompletionRequest;
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
  return response.data;
};

