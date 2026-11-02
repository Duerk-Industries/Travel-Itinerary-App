import { getAdminSetting, setAdminSetting } from '../db';
import { EntitlementError } from '../errors';
import { isFeatureEnabled, getUserTierKey } from './entitlementService';
import { PREMIUM_TRIALS_FEATURE_FLAG } from '../config/premiumTrials';
import type { UserRole } from '../types';

/** Master switch for everything Premium: the trial popup, trials, checkout, and every premium-only option below. */
export const PREMIUM_FEATURE_FLAG = 'premium';

/**
 * Parsing features an admin can keep behind Premium. Each is "premium only" by default; turning an option off in the
 * admin Billing section opens it to every account (the master flag still has to be on).
 */
export const PREMIUM_PARSING_OPTIONS = ['pasteParsing', 'documentImport', 'fileUpload', 'emailForwarding', 'gmailImport', 'autoAssign'] as const;
export type PremiumParsingOption = (typeof PREMIUM_PARSING_OPTIONS)[number];
export type PremiumOptionStates = Record<PremiumParsingOption, boolean>;
export type ParsingAccess = Record<PremiumParsingOption, boolean>;

export const PREMIUM_OPTION_LABELS: Record<PremiumParsingOption, string> = {
  pasteParsing: 'Paste a confirmation to add a transfer',
  documentImport: 'Import an itinerary document',
  fileUpload: 'Upload confirmations for review (Imports)',
  emailForwarding: 'Email forwarding',
  gmailImport: 'Gmail import',
  autoAssign: 'Automatically add parsed bookings',
};

const settingKey = (option: PremiumParsingOption): string => `premium_only_${option}`;

const CACHE_TTL_MS = 30_000;
let optionCache: { states: PremiumOptionStates; expiresAt: number } | null = null;

export const clearPremiumOptionCacheForTesting = (): void => { optionCache = null; };

export const isPremiumTier = (tierKey: string | null | undefined): boolean => ['premium', 'pro'].includes(String(tierKey ?? '').toLowerCase());

export const isPremiumEnabled = (): Promise<boolean> => isFeatureEnabled(PREMIUM_FEATURE_FLAG);

/** Trial offers need Premium itself to be on, as well as the trials flag. */
export const arePremiumTrialsActive = async (): Promise<boolean> =>
  (await isPremiumEnabled()) && (await isFeatureEnabled(PREMIUM_TRIALS_FEATURE_FLAG));

/** Which options are premium only. A missing setting means premium only. */
export const getPremiumOptionStates = async (): Promise<PremiumOptionStates> => {
  if (optionCache && Date.now() < optionCache.expiresAt) return optionCache.states;
  const rows = await Promise.all(PREMIUM_PARSING_OPTIONS.map((option) => getAdminSetting(settingKey(option))));
  const states = {} as PremiumOptionStates;
  PREMIUM_PARSING_OPTIONS.forEach((option, index) => { states[option] = rows[index]?.value !== 'false'; });
  optionCache = { states, expiresAt: Date.now() + CACHE_TTL_MS };
  return states;
};

export const setPremiumOptionStates = async (changes: Partial<PremiumOptionStates>, updatedBy: string | null): Promise<PremiumOptionStates> => {
  for (const option of PREMIUM_PARSING_OPTIONS) {
    const value = changes[option];
    if (typeof value === 'boolean') await setAdminSetting({ key: settingKey(option), value: String(value), updatedBy });
  }
  optionCache = null;
  return getPremiumOptionStates();
};

/**
 * What this account may use. With Premium switched off nothing is available, to anyone (a feature flag has no admin
 * bypass). Otherwise Premium, Pro and admin accounts get everything and a free account gets the options that are not
 * premium only.
 */
export const getParsingAccess = async (userId: string, role?: UserRole | string | null): Promise<ParsingAccess> => {
  const none = Object.fromEntries(PREMIUM_PARSING_OPTIONS.map((option) => [option, false])) as ParsingAccess;
  if (!(await isPremiumEnabled())) return none;
  if (role === 'admin' || isPremiumTier(await getUserTierKey(userId))) {
    return Object.fromEntries(PREMIUM_PARSING_OPTIONS.map((option) => [option, true])) as ParsingAccess;
  }
  const states = await getPremiumOptionStates();
  return Object.fromEntries(PREMIUM_PARSING_OPTIONS.map((option) => [option, !states[option]])) as ParsingAccess;
};

export const canUseParsingOption = async (userId: string, option: PremiumParsingOption, role?: UserRole | string | null): Promise<boolean> =>
  (await getParsingAccess(userId, role))[option];

/** True when at least one of the review-queue sources (upload, forwarding, Gmail) is open to this account. */
export const canUseAnyImportSource = async (userId: string, role?: UserRole | string | null): Promise<boolean> => {
  const access = await getParsingAccess(userId, role);
  return access.fileUpload || access.emailForwarding || access.gmailImport;
};

export const assertCanUseParsingOption = async (userId: string, option: PremiumParsingOption, role?: UserRole | string | null): Promise<void> => {
  if (!(await isPremiumEnabled())) {
    throw new EntitlementError('FEATURE_DISABLED', 'Premium features are currently unavailable', { featureKey: PREMIUM_FEATURE_FLAG });
  }
  if (!(await canUseParsingOption(userId, option, role))) {
    throw new EntitlementError('FEATURE_NOT_ENTITLED', 'This feature is available for Premium and Pro users only.', { featureKey: option });
  }
};
