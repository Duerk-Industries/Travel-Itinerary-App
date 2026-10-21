import { z } from 'zod';
import { getAdminSetting } from '../db';

// These surfaces pass authenticated ownership at both capability and use time.
export const COHORT_FEATURES = ['planning_web_map', 'planning_nearby', 'planning_day_order', 'planning_trip_inspiration',
  'planning_structured_import', 'planning_auto_assign', 'trip_bundle',
  'notifications_in_app', 'notifications_push', 'notifications_email'] as const;
export const cohortSettingKey = (key: string): string => `feature_cohort:${key}`;
export const cohortSchema = z.object({
  userIds: z.array(z.string().uuid()).max(1000),
  owner: z.string().trim().min(1).max(120),
  retireAfter: z.string().datetime(),
}).strict();
export type FeatureCohort = z.infer<typeof cohortSchema>;
const cache = new Map<string, { expiresAt: number; rule: FeatureCohort | null | false }>();
export const clearCohortCache = (): void => cache.clear();

/** Only shared configuration is cached. Membership is evaluated for each call.
 * Missing rule is unrestricted; malformed/expired rules deny rather than widen. */
export const isInFeatureCohort = async (key: string, userId?: string): Promise<boolean> => {
  if (!(COHORT_FEATURES as readonly string[]).includes(key)) return true;
  let entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    const saved = await getAdminSetting(cohortSettingKey(key));
    let rule: FeatureCohort | null | false = null;
    if (saved) {
      try { rule = saved.value === 'null' ? null : cohortSchema.parse(JSON.parse(saved.value)); }
      catch { rule = false; }
    }
    entry = { expiresAt: Date.now() + 60_000, rule }; cache.set(key, entry);
  }
  const rule = entry.rule;
  if (rule === null) return true;
  return rule !== false && Date.parse(rule.retireAfter) > Date.now()
    && Boolean(userId && rule.userIds.includes(userId));
};
