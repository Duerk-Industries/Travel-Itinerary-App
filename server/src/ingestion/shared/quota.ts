import { atomicIncrementIfUnderLimit } from '../../db';
import { getUserTierKey } from '../../services/entitlementService';
import { INGESTION_TIER_RULES } from '../config';
import { IngestionError } from './userFailures';

const getMonthWindowKey = (date = new Date()): string => date.toISOString().slice(0, 7);

const getRetryAfterSecondsToNextMonth = (): number => {
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  return Math.max(60, Math.ceil((nextMonth.getTime() - now.getTime()) / 1000));
};

export const getTierIngestionRules = async (userId: string) => {
  const tierKey = await getUserTierKey(userId);
  const rules = INGESTION_TIER_RULES[tierKey as keyof typeof INGESTION_TIER_RULES] ?? INGESTION_TIER_RULES.free;
  return { tierKey, rules };
};

export const assertAndConsumeMonthlyQuota = async (params: {
  userId: string;
  usageKey: string;
  limit: number;
}): Promise<{ tierKey: string; newCount: number }> => {
  const { tierKey } = await getTierIngestionRules(params.userId);
  if (params.limit <= 0) {
    throw new IngestionError('quota_exceeded', 429, getRetryAfterSecondsToNextMonth());
  }
  const result = await atomicIncrementIfUnderLimit(params.userId, params.usageKey, getMonthWindowKey(), params.limit);
  if (!result.allowed) {
    throw new IngestionError('quota_exceeded', 429, getRetryAfterSecondsToNextMonth());
  }
  return { tierKey: String(tierKey), newCount: result.newCount };
};
