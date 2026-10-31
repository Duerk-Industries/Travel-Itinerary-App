import axios from 'axios';
import { getEnvValue } from '../env';
import { reserveApiUsageOrThrow } from './usageLimiter';

// A vision model looks at candidate pictures for a template stop and approves at most one.

const CALLER = 'TEMPLATE_PICTURE_REVIEW';
const API_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-5-5';

export const REVIEW_PROMPT = (stop: { name: string; description: string; country: string }): string => `You are checking pictures for a travel app. A traveler reads a sample itinerary and sees one picture next to the stop below, so the picture must clearly show that place or something unmistakably typical of it.

Stop: ${stop.name}
About it: ${stop.description}
Country: ${stop.country || '(the country itself)'}

The numbered pictures follow, each with its Wikimedia Commons file name. Choose the ONE picture that best represents the stop, or none.
Reject a picture that shows a different place, mainly people or a crowd, an indoor detail, food or objects (unless the stop is about food), a sign, map, logo, document or painting, a vehicle, plain sky or sea with nothing identifiable, or is blurry or dark.
When you cannot tell that the picture is of this stop, choose none. A missing picture is better than a wrong one.

Reply with only a JSON object: {"pick": <picture number or null>, "confidence": "high" or "low", "reason": "<one short sentence>"}`;

export type PictureReview = { pick: number | null; confidence: 'high' | 'low'; reason: string };

export const reviewPictures = async (
  stop: { name: string; description: string; country: string },
  pictures: Array<{ title: string; data: string; mediaType: string }>
): Promise<PictureReview> => {
  const apiKey = getEnvValue('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');
  await reserveApiUsageOrThrow({ provider: 'ANTHROPIC', caller: CALLER });
  const content: unknown[] = [{ type: 'text', text: REVIEW_PROMPT(stop) }];
  pictures.forEach((picture, index) => {
    content.push({ type: 'text', text: `Picture ${index + 1}: ${picture.title}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: picture.mediaType, data: picture.data } });
  });
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    { model: getEnvValue('PICTURE_REVIEW_MODEL') ?? DEFAULT_MODEL, max_tokens: 1200, thinking: { type: 'disabled' }, messages: [{ role: 'user', content }] },
    { timeout: 90_000, headers: { 'x-api-key': apiKey, 'anthropic-version': API_VERSION, 'Content-Type': 'application/json' } }
  );
  const answer = (Array.isArray(response.data?.content) ? response.data.content : []).map((block: any) => (block?.type === 'text' ? String(block.text ?? '') : '')).join('');
  const json = answer.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return { pick: null, confidence: 'low', reason: 'no answer' };
  try {
    const parsed = JSON.parse(json) as { pick?: unknown; confidence?: unknown; reason?: unknown };
    const pick = Number.isInteger(parsed.pick) && (parsed.pick as number) >= 1 && (parsed.pick as number) <= pictures.length ? (parsed.pick as number) : null;
    return { pick, confidence: parsed.confidence === 'high' ? 'high' : 'low', reason: String(parsed.reason ?? '').slice(0, 200) };
  } catch {
    return { pick: null, confidence: 'low', reason: 'unreadable answer' };
  }
};
