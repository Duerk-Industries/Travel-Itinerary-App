import type { AiChatProvider } from '../providers/AiChatProvider';
import { openaiProvider } from '../providers/openaiProvider';

const providers = new Map<string, AiChatProvider>([[openaiProvider.id, openaiProvider]]);

export const registerAiProviderForTesting = (provider: AiChatProvider): void => {
  providers.set(provider.id, provider);
};

export const resolveProvider = (_featureKey: string, _callerId: string): AiChatProvider =>
  providers.get('openai') ?? openaiProvider;
