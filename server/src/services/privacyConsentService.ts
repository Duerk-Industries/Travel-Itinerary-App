import { getPrivacyPreferences, updatePrivacyPreferences } from '../db';
import type { PrivacyPreferenceUpdate, PrivacyPreferences } from '../types';
import { isFeatureEnabled } from './entitlementService';
import { getRolloutConfig, isInRollout, isRegionExcluded } from '../analytics/rolloutService';

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

/**
 * Who is offered collection right now: the global kill-switch flag AND the user's canary
 * rollout membership (Phase 6) AND, when the rollout excludes Europe, a non-European device
 * time zone. Without a device time zone (server-side checks) only flag + membership apply;
 * the per-event region check happens at ingest.
 */
export type CollectionContext = { role?: string; deviceTimezone?: string | null };

const collectionFlags = async (userId: string, context?: CollectionContext) => {
  // Flags use the existing bounded 60-second cache. User grants are never
  // cached, and missing flag rows fail closed in entitlementService.
  const [productFlag, diagnosticsFlag, productConfig, diagnosticsConfig, productMember, diagnosticsMember] = await Promise.all([
    isFeatureEnabled('analytics_collection_enabled'),
    isFeatureEnabled('diagnostics_user_linked_enabled'),
    getRolloutConfig('product_analytics'),
    getRolloutConfig('optional_diagnostics'),
    isInRollout(userId, context?.role, 'product_analytics'),
    isInRollout(userId, context?.role, 'optional_diagnostics'),
  ]);
  const regionOk = (config: Awaited<ReturnType<typeof getRolloutConfig>>) =>
    context?.deviceTimezone === undefined || !isRegionExcluded(config, context.deviceTimezone);
  return {
    product: productFlag && productMember && regionOk(productConfig),
    diagnostics: diagnosticsFlag && diagnosticsMember && regionOk(diagnosticsConfig),
  };
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

export const getPrivacyStatus = async (userId: string, privacySignalActive = false, context?: CollectionContext): Promise<PrivacyStatus> => {
  const [preferences, flags] = await Promise.all([getPrivacyPreferences(userId), collectionFlags(userId, context)]);
  return toStatus(preferences, flags, privacySignalActive);
};

export const savePrivacyChoice = async (
  userId: string,
  update: Omit<PrivacyPreferenceUpdate, 'productNoticeVersion' | 'diagnosticsNoticeVersion'>,
  privacySignalActive = false,
  context?: CollectionContext,
): Promise<PrivacyStatus> => {
  const flags = await collectionFlags(userId, context);
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
