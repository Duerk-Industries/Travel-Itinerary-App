import { createHash } from 'crypto';
import { atomicIncrementApiUsageIfUnderLimit } from '../db';
import { blogMediaRepository } from '../blog/repository';
import { createAiCallContext } from '../ai/registry/correlation';
import { resolveProvider } from '../ai/registry/aiProviderRegistry';
import { getActiveAiProvider } from './aiProviderConfigService';
import { getUserTierKey } from './entitlementService';
import type { UserRole } from '../types';
import { getApiCacheSetting } from '../config/apiLimits';

const CALLER = 'BLOG_CAPTION_SUGGEST';
const FEATURE = 'trip_blog_caption_ai';
const quotaLimit = (key: 'captionSuggestionsPerDayPerUser' | 'captionSuggestionsPerMonthPremium', fallback: number): number =>
  Math.max(1, Math.floor(Number(getApiCacheSetting('tripBlog', key) ?? fallback)));

const dayKey = (): string => new Date().toISOString().slice(0, 10);

const monthKey = (): string => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
};

const clean = (value: unknown, maxLength: number): string => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/["'<>]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength);

const parseSuggestion = (text: string): { caption: string; altText: string } => {
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* handled below */ }
  return {
    caption: clean(parsed?.caption ?? '', 500),
    altText: clean(parsed?.altText ?? parsed?.alt_text ?? '', 1000),
  };
};

export const suggestBlogMediaCaption = async (params: { userId: string; role: UserRole; tripId: string; assetId: string }): Promise<{ caption: string; altText: string; suggested: true }> => {
  const tier = await getUserTierKey(params.userId);
  if (params.role !== 'admin' && tier !== 'premium' && tier !== 'pro') throw new Error('AI caption suggestions require Premium or Pro');
  const context = await blogMediaRepository().getMediaAuthoringContext(params.userId, params.tripId, params.assetId);
  if (!context) throw new Error('Photo not found');
  const quotaCaller = createHash('sha256').update(params.userId).digest('hex').slice(0, 24);
  const dailyQuota = await atomicIncrementApiUsageIfUnderLimit({ provider: 'TRIP_BLOG_CAPTION_USER', caller: quotaCaller, scope: 'caller', windowKey: `day:${dayKey()}`, limit: quotaLimit('captionSuggestionsPerDayPerUser', 10) });
  if (!dailyQuota.allowed) throw new Error('Daily AI caption suggestion limit reached');
  const monthlyQuota = await atomicIncrementApiUsageIfUnderLimit({ provider: 'TRIP_BLOG_CAPTION_USER', caller: quotaCaller, scope: 'caller', windowKey: `month:${monthKey()}`, limit: quotaLimit('captionSuggestionsPerMonthPremium', 100) });
  if (!monthlyQuota.allowed) throw new Error('Monthly AI caption suggestion limit reached');

  const active = await getActiveAiProvider(FEATURE);
  const provider = await resolveProvider(FEATURE, CALLER);
  const ctx = createAiCallContext({ featureKey: FEATURE, userId: params.userId, tier, role: params.role, provider: provider.id || active.provider, model: active.model, callerId: CALLER });
  const safeDay = clean(context.dayHeadline || context.dayDate, 120);
  const safeCaption = clean(context.caption, 500);
  const response = await provider.chatCompletion({
    model: active.model,
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 180,
    messages: [
      { role: 'system', content: 'Suggest concise travel-photo caption and accessibility alt text. Use only supplied facts. Never invent people, landmarks, actions, appearance, weather, or location. Return JSON with caption and altText.' },
      { role: 'user', content: `Trip-day context: ${safeDay || 'unknown'}. Existing traveler caption: ${safeCaption || 'none'}. If the facts are insufficient, use a neutral description that explicitly avoids guessing.` },
    ],
  }, ctx);
  const suggestion = parseSuggestion(String(response.choices?.[0]?.message?.content ?? ''));
  if (!suggestion.caption && !suggestion.altText) throw new Error('The caption provider returned no usable suggestion');
  return { ...suggestion, suggested: true };
};
