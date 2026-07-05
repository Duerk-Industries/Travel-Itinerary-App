import axios from 'axios';
import { getEnvValue } from '../../env';
import type { AiCallContext, AiChatMessage, AiChatRequest, AiChatResponse } from '../types/aiChat';
import type { AiChatProvider } from './AiChatProvider';
import { normalizeProviderError } from './providerErrors';

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

const roleForGemini = (role: AiChatMessage['role']): 'user' | 'model' =>
  role === 'assistant' ? 'model' : 'user';

const toContents = (messages: AiChatMessage[]) =>
  messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: roleForGemini(message.role),
      parts: [{ text: message.content }],
    }));

const systemInstruction = (messages: AiChatMessage[], jsonMode: boolean) => {
  const parts = messages.filter((message) => message.role === 'system').map((message) => message.content.trim()).filter(Boolean);
  if (jsonMode) parts.push('Return only a valid JSON object.');
  return parts.length ? { parts: parts.map((text) => ({ text })) } : undefined;
};

const candidateText = (candidate: any): string =>
  (candidate?.content?.parts ?? [])
    .map((part: any) => typeof part?.text === 'string' ? part.text : '')
    .join('');

export const geminiProvider: AiChatProvider = {
  id: 'gemini',
  supportedModels: [GEMINI_DEFAULT_MODEL],

  async chatCompletion(req: AiChatRequest, _ctx: AiCallContext): Promise<AiChatResponse> {
    const apiKey = getEnvValue('GEMINI_API_KEY', { required: true });
    if (!apiKey) throw new Error('Missing required env var: GEMINI_API_KEY');
    const jsonMode = req.response_format?.type === 'json_object';
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
        {
          systemInstruction: systemInstruction(req.messages, jsonMode),
          contents: toContents(req.messages),
          generationConfig: {
            temperature: req.temperature,
            maxOutputTokens: req.max_tokens,
            responseMimeType: jsonMode ? 'application/json' : undefined,
          },
        },
        {
          params: { key: apiKey },
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const data = response.data ?? {};
      const candidate = data.candidates?.[0] ?? {};
      return {
        model: req.model,
        choices: [{
          message: { role: 'assistant', content: candidateText(candidate) },
          finish_reason: candidate.finishReason ?? null,
        }],
        usage: {
          prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
          completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
          total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
        },
      };
    } catch (err) {
      throw normalizeProviderError('gemini', err);
    }
  },
};
