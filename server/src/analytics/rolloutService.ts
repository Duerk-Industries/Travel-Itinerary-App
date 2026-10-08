import { createHash } from 'node:crypto';
import { getAdminSetting, isInternalCanaryAccount, setAdminSetting } from '../db';

/**
 * Canary rollout for the optional purposes (docs/implementation-plans/analytics-upgrade.md
 * Phase 6). The feature flags `analytics_collection_enabled` /
 * `diagnostics_user_linked_enabled` stay the global kill switches; this decides *who*
 * is offered collection while a flag is on:
 *
 *   off         nobody
 *   internal    admins and internal canary accounts only (default when unset)
 *   percentage  internal accounts plus a stable hash-based share of everyone else
 *   all         everyone
 *
 * `excludeEurope` keeps collection off for devices whose time zone is in Europe until
 * counsel closes the EU/UK representative question (docs/legal/eu-uk-representative-assessment.md).
 * A time zone is a heuristic for location, so it deliberately over-excludes: an unknown
 * zone counts as excluded.
 */

export type RolloutPurpose = 'product_analytics' | 'optional_diagnostics';
export type RolloutMode = 'off' | 'internal' | 'percentage' | 'all';
export type RolloutConfig = { mode: RolloutMode; percent: number; excludeEurope: boolean };

export const DEFAULT_ROLLOUT: RolloutConfig = { mode: 'internal', percent: 0, excludeEurope: true };
const SETTING_KEY: Record<RolloutPurpose, string> = {
  product_analytics: 'ANALYTICS_ROLLOUT_PRODUCT',
  optional_diagnostics: 'ANALYTICS_ROLLOUT_DIAGNOSTICS',
};
const CACHE_TTL_MS = 60_000;
const cache = new Map<RolloutPurpose, { expiresAt: number; config: RolloutConfig }>();

const MODES: RolloutMode[] = ['off', 'internal', 'percentage', 'all'];

export const parseRolloutConfig = (raw: unknown): RolloutConfig | null => {
  const value = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  if (!value || typeof value !== 'object') return null;
  const { mode, percent, excludeEurope } = value as Record<string, unknown>;
  if (!MODES.includes(mode as RolloutMode)) return null;
  const pct = Number(percent ?? 0);
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) return null;
  if (typeof excludeEurope !== 'boolean') return null;
  return { mode: mode as RolloutMode, percent: pct, excludeEurope };
};

export const getRolloutConfig = async (purpose: RolloutPurpose): Promise<RolloutConfig> => {
  const cached = cache.get(purpose);
  if (cached && cached.expiresAt > Date.now()) return cached.config;
  const setting = await getAdminSetting(SETTING_KEY[purpose]).catch(() => null);
  const config = parseRolloutConfig(setting?.value) ?? DEFAULT_ROLLOUT;
  cache.set(purpose, { expiresAt: Date.now() + CACHE_TTL_MS, config });
  return config;
};

export const saveRolloutConfig = async (purpose: RolloutPurpose, config: RolloutConfig, updatedBy: string | null) => {
  const before = await getRolloutConfig(purpose);
  await setAdminSetting({ key: SETTING_KEY[purpose], value: JSON.stringify(config), updatedBy });
  cache.delete(purpose);
  return { before, after: config };
};

/** Stable bucket 0–99 per account and purpose; independent across purposes. */
export const rolloutBucket = (userId: string, purpose: RolloutPurpose): number =>
  parseInt(createHash('sha256').update(`${purpose}:${userId}`).digest('hex').slice(0, 8), 16) % 100;

export const isInRollout = async (userId: string, role: string | undefined, purpose: RolloutPurpose): Promise<boolean> => {
  const config = await getRolloutConfig(purpose);
  if (config.mode === 'off') return false;
  if (config.mode === 'all') return true;
  const internal = role === 'admin' || (await isInternalCanaryAccount(userId).catch(() => false));
  if (internal) return true;
  return config.mode === 'percentage' && rolloutBucket(userId, purpose) < config.percent;
};

// EU/EEA, UK and EFTA territories outside Europe/* zones.
const EUROPEAN_EXTRA_ZONES = new Set([
  'Atlantic/Azores', 'Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Faroe', 'Atlantic/Reykjavik',
  'Arctic/Longyearbyen', 'Asia/Nicosia', 'Asia/Famagusta', 'GB', 'GB-Eire', 'Eire', 'WET', 'CET', 'MET', 'EET',
]);

export const isEuropeanTimezone = (zone: string | null | undefined): boolean =>
  Boolean(zone && (zone.startsWith('Europe/') || EUROPEAN_EXTRA_ZONES.has(zone)));

/** True when collection must stay off for this device location under the current config. */
export const isRegionExcluded = (config: RolloutConfig, deviceTimezone: string | null | undefined): boolean =>
  config.excludeEurope && (!deviceTimezone || isEuropeanTimezone(deviceTimezone));

export const clearRolloutCacheForTesting = (): void => cache.clear();
