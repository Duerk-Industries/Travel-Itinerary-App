import { getFeatureFlag } from '../db';
import { getEnvValue } from '../env';

/** The seed flag is intentionally fail-closed for the optional affiliate feature. */
export const GETYOURGUIDE_FEATURE_FLAG = 'getyourguide_activity_suggestions';
export const GETYOURGUIDE_PARTNER_ID_ENV = 'GET_YOUR_GUIDE_AFFILIATE_PARTNER_ID';
export const GETYOURGUIDE_API_TOKEN_ENV = 'GETYOURGUIDE_API_TOKEN';
export const GETYOURGUIDE_API_KEY_FALLBACK_ENV = 'GETYOURGUIDE_API_KEY';

export type GetYourGuidePartnerConfig = {
  partnerId?: string;
  hasApiToken: boolean;
};

const getApiToken = (): string | undefined =>
  getEnvValue(GETYOURGUIDE_API_TOKEN_ENV) ?? getEnvValue(GETYOURGUIDE_API_KEY_FALLBACK_ENV);

/**
 * Reads only server-side configuration. The token itself is deliberately not
 * returned so callers cannot accidentally include it in logs or API payloads.
 */
export const getGetYourGuidePartnerConfig = (): GetYourGuidePartnerConfig => ({
  partnerId: getEnvValue(GETYOURGUIDE_PARTNER_ID_ENV),
  hasApiToken: Boolean(getApiToken()),
});

export const hasGetYourGuidePartnerConfiguration = (): boolean =>
  Boolean(getGetYourGuidePartnerConfig().partnerId);

/**
 * Unlike the generic feature helper (which is fail-open for legacy flags), an
 * optional affiliate integration is enabled only when both the DB flag and
 * server partner configuration are present.
 */
export const isGetYourGuideFeatureEnabled = async (): Promise<boolean> => {
  if (!hasGetYourGuidePartnerConfiguration()) return false;
  const flag = await getFeatureFlag(GETYOURGUIDE_FEATURE_FLAG);
  return flag?.enabled === true;
};
