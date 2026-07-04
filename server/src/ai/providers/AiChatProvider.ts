import type { AiCallContext, AiChatRequest, AiChatResponse } from '../types/aiChat';

export type AiChatProvider = {
  id: string;
  supportedModels: string[];
  chatCompletion(req: AiChatRequest, ctx: AiCallContext): Promise<AiChatResponse>;
};
