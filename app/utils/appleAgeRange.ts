import { Platform } from 'react-native';

/**
 * Optional iOS shortcut for the account age gate (docs/implementation-plans/analytics-upgrade.md,
 * decision 10). Asks Apple's Declared Age Range API whether the signed-in Apple Account is at least
 * `minimumAge`. Only an explicit Apple confirmation counts; every other outcome (unsupported
 * platform or iOS version, build without the entitlement, user declined, under the minimum,
 * missing module, any error) returns `confirmed: false` and the caller shows the date-of-birth prompt.
 *
 * Guarding on iOS 26+ here is essential: expo-age-range resolves `lowerBound: 18` (an "adult")
 * on iOS < 26 and web, which would otherwise verify every older device without asking anyone.
 */

export type AppleAgeRangeResult =
  | { confirmed: true; lowerBound: number }
  | { confirmed: false; reason: 'unsupported' | 'declined' | 'below_minimum' | 'error' };

type AgeRangeModule = {
  requestAgeRangeAsync: (options: { threshold1: number }) => Promise<{ lowerBound?: number | null }>;
};

export type AppleAgeRangeEnv = {
  platformOS: string;
  platformVersion: string | number;
  enabled: boolean;
  loadModule: () => AgeRangeModule | null;
};

const MIN_IOS_MAJOR = 26;

const loadExpoAgeRange = (): AgeRangeModule | null => {
  try {
    // Lazy and guarded: the module is iOS-only in this app (excluded from Android autolinking)
    // and requireNativeModule throws at import time where it isn't linked.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-age-range') as AgeRangeModule;
  } catch {
    return null;
  }
};

// Set by expo.config.shared.cjs only for builds that carry the Declared Age Range entitlement.
const isEnabledInBuild = (): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require('expo-constants').default as { expoConfig?: { extra?: { appleDeclaredAgeRangeEnabled?: boolean } } };
    return Boolean(Constants.expoConfig?.extra?.appleDeclaredAgeRangeEnabled);
  } catch {
    return false;
  }
};

const defaultEnv = (): AppleAgeRangeEnv => ({
  platformOS: Platform.OS,
  platformVersion: Platform.Version,
  enabled: Platform.OS === 'ios' && isEnabledInBuild(),
  loadModule: loadExpoAgeRange,
});

export const isAppleAgeRangeSupported = (env: AppleAgeRangeEnv): boolean => {
  if (env.platformOS !== 'ios' || !env.enabled) return false;
  const major = Number.parseInt(String(env.platformVersion), 10);
  return Number.isFinite(major) && major >= MIN_IOS_MAJOR;
};

export const requestAppleAgeConfirmation = async (
  minimumAge: number,
  env: AppleAgeRangeEnv = defaultEnv()
): Promise<AppleAgeRangeResult> => {
  if (!isAppleAgeRangeSupported(env)) return { confirmed: false, reason: 'unsupported' };
  const ageRange = env.loadModule();
  if (!ageRange) return { confirmed: false, reason: 'unsupported' };
  try {
    // One gate at the minimum age: Apple answers "under minimumAge" (no lower bound) or "minimumAge+".
    const response = await ageRange.requestAgeRangeAsync({ threshold1: minimumAge });
    const lowerBound = response?.lowerBound;
    if (typeof lowerBound === 'number' && lowerBound >= minimumAge) {
      return { confirmed: true, lowerBound };
    }
    return { confirmed: false, reason: 'below_minimum' };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    return { confirmed: false, reason: code === 'ERR_AGE_RANGE_USER_DECLINED' ? 'declined' : 'error' };
  }
};
