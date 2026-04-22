import { getEnvValue, isLocalEnv } from './env';

export const DEFAULT_AUTH_SECRET = 'development-secret';
export const DEFAULT_AUTH_ISSUER = 'travel-itinerary-app';
export const DEFAULT_AUTH_AUDIENCE = 'travel-itinerary-app-clients';

export const getAuthSecret = (): string =>
  getEnvValue('AUTH_SECRET', { defaultValue: DEFAULT_AUTH_SECRET })!;

export const getAuthIssuer = (): string =>
  getEnvValue('AUTH_ISSUER', { defaultValue: DEFAULT_AUTH_ISSUER })!;

export const getAuthAudience = (): string =>
  getEnvValue('AUTH_AUDIENCE', { defaultValue: DEFAULT_AUTH_AUDIENCE })!;

export const isUnsafeAuthSecret = (value: string | undefined | null): boolean => {
  const normalized = String(value ?? '').trim();
  return normalized.length === 0 || normalized === DEFAULT_AUTH_SECRET;
};

export const assertSafeAuthSecretConfig = (): void => {
  if (isLocalEnv()) {
    return;
  }
  if (isUnsafeAuthSecret(getEnvValue('AUTH_SECRET'))) {
    throw new Error(
      'AUTH_SECRET must be set to a non-default value outside local development.'
    );
  }
};
