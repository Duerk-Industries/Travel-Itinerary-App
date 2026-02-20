import { postOpenAiChatCompletion } from './openaiApi';

const OPENAI_CALLER_ITINERARY_GENERATE = 'ITINERARY_GENERATE_PLAN';

export const generateItineraryPlanViaOpenAi = async (params: {
  apiKey: string;
  prompt: string;
}): Promise<string | null> => {
  const data = await postOpenAiChatCompletion({
    caller: OPENAI_CALLER_ITINERARY_GENERATE,
    apiKey: params.apiKey,
    payload: {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You write concise, actionable travel itineraries.' },
        { role: 'user', content: params.prompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
    },
  });

  return data?.choices?.[0]?.message?.content ?? null;
};

