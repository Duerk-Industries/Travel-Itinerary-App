const readFlag = (): string | undefined => {
  const fromEnv = process.env.EXPO_PUBLIC_PREMIUM_TRIALS_ENABLED;
  if (typeof fromEnv === 'string') return fromEnv;

  try {
    // Avoid a static Expo import so Jest tests that do not mock expo-constants
    // can still evaluate this helper in a plain Node environment.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const constantsModule = require('expo-constants');
    const constants = constantsModule.default ?? constantsModule;
    const extra = constants.expoConfig?.extra as Record<string, unknown> | undefined;
    const fromExtra = extra?.premiumTrialsEnabled;
    if (typeof fromExtra === 'boolean') return fromExtra ? 'true' : 'false';
    if (typeof fromExtra === 'string') return fromExtra;
  } catch {
    // Default-on fallback below.
  }
  return undefined;
};

export const arePremiumTrialsEnabled = (): boolean => {
  const raw = String(readFlag() ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
};
