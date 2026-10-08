import { isUserAgeVerified, recordUserAgeVerification, setUserDateOfBirth } from '../db';
import { isFeatureEnabled } from './entitlementService';
import { MINIMUM_ACCOUNT_AGE_YEARS, isOldEnoughToHoldAnAccount, parseDateOfBirth } from './registrationAgeGate';

/**
 * Account age verification (docs/implementation-plans/analytics-upgrade.md, open decision 10).
 *
 * Every account holder must declare a date of birth showing they are at least
 * MINIMUM_ACCOUNT_AGE_YEARS (registrationAgeGate.ts) old. OAuth sign-ups (Google/Apple) and older clients
 * never collected one, so the check runs after sign-in rather than only at
 * registration. Server-side blocking is behind the fail-closed
 * `age_gate_enforcement` flag so app builds without the prompt are not locked
 * out; the prompt itself ships regardless of the flag.
 *
 * On iOS 26+ the client first asks Apple's Declared Age Range API; when Apple
 * confirms 16+, the account is recorded as verified via Apple and no birthdate
 * is collected. Anything else falls back to the date-of-birth prompt.
 */
export const AGE_GATE_ENFORCEMENT_FLAG = 'age_gate_enforcement';

export const AGE_VERIFICATION_SOURCES = {
  selfDeclaredDob: 'self_declared_dob',
  appleDeclaredAgeRange: 'apple_declared_age_range',
} as const;

// A recorded verification is never cleared, so a positive result can be cached
// for the life of the process. Bounded so a long-lived instance cannot grow
// without limit; clearing only costs one extra lookup per user.
const VERIFIED_CACHE_MAX = 50_000;
const verifiedUserIds = new Set<string>();

const rememberVerified = (userId: string): void => {
  if (verifiedUserIds.size >= VERIFIED_CACHE_MAX) verifiedUserIds.clear();
  verifiedUserIds.add(userId);
};

export const isAgeVerificationRequired = async (userId: string): Promise<boolean> => {
  if (verifiedUserIds.has(userId)) return false;
  if (await isUserAgeVerified(userId)) {
    rememberVerified(userId);
    return false;
  }
  return true;
};

export const isAgeGateEnforced = (): Promise<boolean> => isFeatureEnabled(AGE_GATE_ENFORCEMENT_FLAG);

export type DeclareAgeResult =
  | { ok: true }
  | { ok: false; code: 'INVALID_DATE_OF_BIRTH' | 'UNDER_MINIMUM_AGE' };

/**
 * Records a declared date of birth. An under-age declaration is not stored
 * (data minimization); the account stays unverified and can only be deleted.
 */
export const declareDateOfBirth = async (userId: string, value: unknown): Promise<DeclareAgeResult> => {
  const dateOfBirth = parseDateOfBirth(value);
  if (!dateOfBirth) return { ok: false, code: 'INVALID_DATE_OF_BIRTH' };
  if (!isOldEnoughToHoldAnAccount(dateOfBirth)) return { ok: false, code: 'UNDER_MINIMUM_AGE' };
  await setUserDateOfBirth(userId, dateOfBirth);
  await recordUserAgeVerification(userId, AGE_VERIFICATION_SOURCES.selfDeclaredDob);
  rememberVerified(userId);
  return { ok: true };
};

/**
 * Records an Apple Declared Age Range result whose lower bound confirms the
 * minimum age. Only the fact "16+ via Apple" is stored, never a birthdate or
 * the range itself. Like the date-of-birth prompt this is a client assertion;
 * Apple provides no server-verifiable attestation for the range.
 */
export const recordAppleAgeRange = async (userId: string, lowerBound: unknown): Promise<boolean> => {
  if (typeof lowerBound !== 'number' || !Number.isInteger(lowerBound) || lowerBound < MINIMUM_ACCOUNT_AGE_YEARS) {
    return false;
  }
  await recordUserAgeVerification(userId, AGE_VERIFICATION_SOURCES.appleDeclaredAgeRange);
  rememberVerified(userId);
  return true;
};

export const clearAgeVerificationCacheForTesting = (): void => {
  if (process.env.NODE_ENV === 'test') verifiedUserIds.clear();
};
