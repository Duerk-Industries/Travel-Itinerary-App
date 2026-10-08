import { getPrivacyPreferences, updatePrivacyPreferences } from '../db';
import type { PrivacyPreferenceUpdate, PrivacyPreferences } from '../types';
import { isFeatureEnabled } from './entitlementService';

/** Increment when a material change to the analytics notice is published. */
export const PRODUCT_NOTICE_VERSION = 'analytics-v1';
export const DIAGNOSTICS_NOTICE_VERSION = 'diagnostics-v1';

export type PrivacyStatus = Omit<PrivacyPreferences, 'userId'> & {
  productAnalyticsAllowed: boolean;
  optionalDiagnosticsAllowed: boolean;
  productCollectionEnabled: boolean;
  diagnosticsCollectionEnabled: boolean;
  productConsentCurrent: boolean;
  diagnosticsConsentCurrent: boolean;
  privacySignalActive: boolean;
};

const collectionFlags = async () => {
  // Flags use the existing bounded 60-second cache. User grants are never
  // cached, and missing flag rows fail closed in entitlementService.
  const [product, diagnostics] = await Promise.all([
    isFeatureEnabled('analytics_collection_enabled'),
    isFeatureEnabled('diagnostics_user_linked_enabled'),
  ]);
  return { product, diagnostics };
};

const toStatus = (
  preferences: PrivacyPreferences,
  flags: { product: boolean; diagnostics: boolean },
  privacySignalActive: boolean,
): PrivacyStatus => ({
  productAnalytics: preferences.productAnalytics,
  optionalDiagnostics: preferences.optionalDiagnostics,
  productEpoch: preferences.productEpoch,
  diagnosticsEpoch: preferences.diagnosticsEpoch,
  diagnosticPseudonym: preferences.optionalDiagnostics && flags.diagnostics
    ? preferences.diagnosticPseudonym : null,
  revision: preferences.revision,
  noticeVersion: preferences.noticeVersion,
  productNoticeVersion: preferences.productNoticeVersion,
  diagnosticsNoticeVersion: preferences.diagnosticsNoticeVersion,
  updatedAt: preferences.updatedAt,
  productAnalyticsAllowed: preferences.productAnalytics === true && flags.product && !privacySignalActive &&
    preferences.productNoticeVersion === PRODUCT_NOTICE_VERSION,
  optionalDiagnosticsAllowed: preferences.optionalDiagnostics === true && flags.diagnostics &&
    preferences.diagnosticsNoticeVersion === DIAGNOSTICS_NOTICE_VERSION,
  productCollectionEnabled: flags.product,
  diagnosticsCollectionEnabled: flags.diagnostics,
  productConsentCurrent: preferences.productNoticeVersion === PRODUCT_NOTICE_VERSION,
  diagnosticsConsentCurrent: preferences.diagnosticsNoticeVersion === DIAGNOSTICS_NOTICE_VERSION,
  privacySignalActive,
});

export const getPrivacyStatus = async (userId: string, privacySignalActive = false): Promise<PrivacyStatus> => {
  const [preferences, flags] = await Promise.all([getPrivacyPreferences(userId), collectionFlags()]);
  return toStatus(preferences, flags, privacySignalActive);
};

export const savePrivacyChoice = async (
  userId: string,
  update: Omit<PrivacyPreferenceUpdate, 'productNoticeVersion' | 'diagnosticsNoticeVersion'>,
  privacySignalActive = false,
): Promise<PrivacyStatus> => {
  const flags = await collectionFlags();
  if ((update.productAnalytics === true && (!flags.product || privacySignalActive)) ||
      (update.optionalDiagnostics === true && !flags.diagnostics)) {
    const error = new Error('This optional purpose is unavailable');
    (error as Error & { code?: string }).code = 'PRIVACY_PURPOSE_UNAVAILABLE';
    throw error;
  }
  const preferences = await updatePrivacyPreferences(userId, {
    ...update, productNoticeVersion: PRODUCT_NOTICE_VERSION,
    diagnosticsNoticeVersion: DIAGNOSTICS_NOTICE_VERSION,
  });
  return toStatus(preferences, flags, privacySignalActive);
};

/** Future event admission must use this fresh, server-side check and serialize
 * epoch validation with the write in each adapter. No product event ingest
 * exists in Phase 1, so nothing can currently bypass it. */
export const isOptionalPurposeAllowed = async (
  userId: string,
  purpose: 'product_analytics' | 'optional_diagnostics',
  privacySignalActive = false,
): Promise<boolean> => {
  const status = await getPrivacyStatus(userId, privacySignalActive);
  return purpose === 'product_analytics' ? status.productAnalyticsAllowed : status.optionalDiagnosticsAllowed;
};
