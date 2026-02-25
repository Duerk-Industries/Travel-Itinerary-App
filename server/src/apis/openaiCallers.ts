import { postOpenAiChatCompletion } from './openaiApi';

const OPENAI_CALLER_ITINERARY_GENERATE = 'ITINERARY_GENERATE_PLAN';
export const OPENAI_CALLER_ITINERARY_PLAN_P0_NORM = 'ITINERARY_PLAN_P0_NORM';
export const OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE = 'ITINERARY_PLAN_P1_ROUTE';
export const OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS = 'ITINERARY_PLAN_P2_DAYS';
export const OPENAI_CALLER_ITINERARY_PLAN_P3_VALIDATE = 'ITINERARY_PLAN_P3_VALIDATE';
export const OPENAI_CALLER_ITINERARY_PLAN_P4_RENDER = 'ITINERARY_PLAN_P4_RENDER';

const runOpenAiTextCompletion = async (params: {
  apiKey: string;
  caller: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string | null> => {
  const data = await postOpenAiChatCompletion({
    caller: params.caller,
    apiKey: params.apiKey,
    payload: {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
      temperature: typeof params.temperature === 'number' ? params.temperature : 0.2,
      max_tokens: typeof params.maxTokens === 'number' ? params.maxTokens : 900,
    },
  });

  return data?.choices?.[0]?.message?.content ?? null;
};

export const generateItineraryPlanViaOpenAi = async (params: {
  apiKey: string;
  prompt: string;
}): Promise<string | null> => {
  return runOpenAiTextCompletion({
    apiKey: params.apiKey,
    caller: OPENAI_CALLER_ITINERARY_GENERATE,
    systemPrompt: 'You write concise, actionable travel itineraries.',
    userPrompt: params.prompt,
    temperature: 0.7,
    maxTokens: 500,
  });
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
}): Promise<string | null> => {
  return runOpenAiTextCompletion({
    apiKey: params.apiKey,
    caller: params.caller,
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    temperature: 0.2,
    maxTokens: params.maxTokens,
  });
};

