import { getFeatureFlag } from '../db';
import { getEnvFlag, getEnvValue } from '../env';

/** The seed flag is intentionally fail-closed for the optional affiliate feature. */
export const GETYOURGUIDE_FEATURE_FLAG = 'getyourguide_activity_suggestions';
export const GETYOURGUIDE_PARTNER_ID_ENV = 'GET_YOUR_GUIDE_AFFILIATE_PARTNER_ID';
export const GETYOURGUIDE_API_TOKEN_ENV = 'GETYOURGUIDE_API_TOKEN';
export const GETYOURGUIDE_API_KEY_FALLBACK_ENV = 'GETYOURGUIDE_API_KEY';
/** Exact Partner API endpoint supplied by the approved account contract. */
export const GETYOURGUIDE_API_BASE_URL_ENV = 'GETYOURGUIDE_API_BASE_URL';
/** Written permission to persist normalized partner responses is opt-in. */
export const GETYOURGUIDE_API_CACHE_PERMISSION_ENV = 'GETYOURGUIDE_API_CACHE_PERMISSION';
export const GETYOURGUIDE_API_CURRENCY_ENV = 'GETYOURGUIDE_API_CURRENCY';
export const GETYOURGUIDE_API_LANGUAGE_ENV = 'GETYOURGUIDE_API_LANGUAGE';
export const GETYOURGUIDE_DEEP_LINK_BASE_URL_ENV = 'GETYOURGUIDE_DEEP_LINK_BASE_URL';
export const GETYOURGUIDE_ALLOWED_HOSTS_ENV = 'GETYOURGUIDE_ALLOWED_HOSTS';
export const GETYOURGUIDE_ALLOWED_PATH_PREFIXES_ENV = 'GETYOURGUIDE_ALLOWED_PATH_PREFIXES';

export type GetYourGuidePartnerConfig = {
  partnerId?: string;
  hasApiToken: boolean;
  apiBaseUrl?: string;
  hasApiCachePermission: boolean;
};

const getApiToken = (): string | undefined =>
  getEnvValue(GETYOURGUIDE_API_TOKEN_ENV) ?? getEnvValue(GETYOURGUIDE_API_KEY_FALLBACK_ENV);

const getApiBaseUrl = (): string | undefined => {
  const raw = getEnvValue(GETYOURGUIDE_API_BASE_URL_ENV);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
};

/**
 * Reads only server-side configuration. The token itself is deliberately not
 * returned so callers cannot accidentally include it in logs or API payloads.
 */
export const getGetYourGuidePartnerConfig = (): GetYourGuidePartnerConfig => ({
  partnerId: getEnvValue(GETYOURGUIDE_PARTNER_ID_ENV),
  hasApiToken: Boolean(getApiToken()),
  apiBaseUrl: getApiBaseUrl(),
  hasApiCachePermission: getEnvFlag(GETYOURGUIDE_API_CACHE_PERMISSION_ENV, { defaultValue: false }),
});

export const hasGetYourGuidePartnerConfiguration = (): boolean =>
  Boolean(getGetYourGuidePartnerConfig().partnerId);

export const hasGetYourGuideApiConfiguration = (): boolean => {
  const config = getGetYourGuidePartnerConfig();
  return Boolean(config.hasApiToken && config.apiBaseUrl);
};

export const hasGetYourGuideApiCachePermission = (): boolean =>
  getGetYourGuidePartnerConfig().hasApiCachePermission;

export const getGetYourGuideApiLocale = (): { currency: string; language: string } | null => {
  const currency = getEnvValue(GETYOURGUIDE_API_CURRENCY_ENV)?.trim().toUpperCase();
  const language = getEnvValue(GETYOURGUIDE_API_LANGUAGE_ENV)?.trim();
  return currency && language ? { currency, language } : null;
};

/**
 * URL configuration is intentionally kept separate from the partner token.
 * The affiliate route still validates the resulting URL against an exact
 * allowlist before redirecting, so an accidentally broad environment value
 * cannot become an open redirect.
 */
export const getGetYourGuideAllowedHosts = (): string[] => {
  const configured = getEnvValue(GETYOURGUIDE_ALLOWED_HOSTS_ENV)
    ?.split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean) ?? [];
  return Array.from(new Set(configured.length ? configured : ['www.getyourguide.com', 'getyourguide.com']));
};

export const getGetYourGuideDeepLinkBaseUrl = (): string =>
  getEnvValue(GETYOURGUIDE_DEEP_LINK_BASE_URL_ENV) ?? 'https://www.getyourguide.com/';

export const getGetYourGuideAllowedPathPrefixes = (): string[] => {
  const configured = getEnvValue(GETYOURGUIDE_ALLOWED_PATH_PREFIXES_ENV)
    ?.split(',')
    .map((path) => path.trim())
    .filter((path) => path.startsWith('/') && !/[\u0000-\u001f\u007f]/.test(path)) ?? [];
  return Array.from(new Set(configured.length ? configured : ['/activities/', '/destinations/', '/tickets/', '/tours/']));
};

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
