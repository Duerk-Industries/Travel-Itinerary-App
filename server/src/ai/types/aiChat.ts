export type AiChatMessageRole = 'system' | 'user' | 'assistant';

export type AiChatMessage = {
  role: AiChatMessageRole;
  content: string;
};

export type AiChatJsonMode = {
  type: 'json_object';
};

export type AiChatRequest = {
  model: string;
  messages: AiChatMessage[];
  response_format?: AiChatJsonMode;
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
};

export type AiChatTokenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type AiChatResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      role?: AiChatMessageRole;
      content?: string;
    };
    finish_reason?: string | null;
  }>;
  usage?: AiChatTokenUsage;
};

export type AiCallContext = {
  correlationId: string;
  requestId: string;
  jobId?: string;
  featureKey: string;
  userId: string;
  anonymousUserId: string;
  tier: string;
  role: string;
  provider: string;
  model: string;
  callerId: string;
};
