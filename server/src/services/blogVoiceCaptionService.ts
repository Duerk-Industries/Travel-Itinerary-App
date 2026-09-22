import { createHash } from 'crypto';
import { atomicIncrementApiUsageIfUnderLimit } from '../db';
import { blogMediaRepository } from '../blog/repository';
import { createAiCallContext } from '../ai/registry/correlation';
import { resolveProvider } from '../ai/registry/aiProviderRegistry';
import { getActiveAiProvider } from './aiProviderConfigService';
import { getUserTierKey } from './entitlementService';
import { postOpenAiAudioTranscription } from '../apis/openaiApi';
import { getEnvValue } from '../env';
import type { UserRole } from '../types';
import { getApiCacheSetting } from '../config/apiLimits';

const CALLER = 'BLOG_VOICE_CAPTION';
const TRANSCRIBE_CALLER = 'BLOG_VOICE_CAPTION_TRANSCRIBE';
const FEATURE = 'trip_blog_audio_transcription';
const quotaLimit = (key: 'voiceCaptionsPerDayPerUser' | 'voiceCaptionsPerMonthPremium', fallback: number): number =>
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

export const transcribeAndCleanCaption = async (params: {
  userId: string;
  role: UserRole;
  tripId: string;
  assetId: string;
  audio: Buffer;
  mimeType: string;
}): Promise<{ caption: string }> => {
  const tier = await getUserTierKey(params.userId);
  if (params.role !== 'admin' && tier !== 'premium' && tier !== 'pro') throw new Error('Voice captions require Premium or Pro');
  const context = await blogMediaRepository().getMediaAuthoringContext(params.userId, params.tripId, params.assetId);
  if (!context) throw new Error('Photo not found');

  const quotaCaller = createHash('sha256').update(params.userId).digest('hex').slice(0, 24);
  const dailyQuota = await atomicIncrementApiUsageIfUnderLimit({ provider: 'TRIP_BLOG_VOICE_CAPTION_USER', caller: quotaCaller, scope: 'caller', windowKey: `day:${dayKey()}`, limit: quotaLimit('voiceCaptionsPerDayPerUser', 10) });
  if (!dailyQuota.allowed) throw new Error('Daily voice caption limit reached');
  const monthlyQuota = await atomicIncrementApiUsageIfUnderLimit({ provider: 'TRIP_BLOG_VOICE_CAPTION_USER', caller: quotaCaller, scope: 'caller', windowKey: `month:${monthKey()}`, limit: quotaLimit('voiceCaptionsPerMonthPremium', 100) });
  if (!monthlyQuota.allowed) throw new Error('Monthly voice caption limit reached');

  const transcription = await postOpenAiAudioTranscription({
    caller: TRANSCRIBE_CALLER,
    apiKey: getEnvValue('OPENAI_API_KEY', { required: true }) as string,
    audio: params.audio,
    mimeType: params.mimeType,
    filename: 'caption-recording.m4a',
  });
  const rawTranscript = clean(transcription.text, 2000);
  if (!rawTranscript) throw new Error('No speech was detected in the recording');

  const active = await getActiveAiProvider(FEATURE);
  const provider = await resolveProvider(FEATURE, CALLER);
  const ctx = createAiCallContext({ featureKey: FEATURE, userId: params.userId, tier, role: params.role, provider: provider.id || active.provider, model: active.model, callerId: CALLER });
  const response = await provider.chatCompletion({
    model: active.model,
    temperature: 0.2,
    max_tokens: 120,
    messages: [
      {
        role: 'system',
        content: 'Clean up a raw speech-to-text transcript of a traveler dictating a photo caption. Remove filler words ("um", "uh", "like", false starts) and turn it into a short, natural sentence. Use only what the traveler actually said — never add or invent details. Reply with the cleaned caption text only, no quotes or commentary.',
      },
      { role: 'user', content: rawTranscript },
    ],
  }, ctx);
  const caption = clean(response.choices?.[0]?.message?.content ?? '', 500);
  if (!caption) throw new Error('Unable to clean up the transcript');
  return { caption };
};
