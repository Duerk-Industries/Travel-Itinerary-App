import { Platform } from 'react-native';

export interface PrivacyStatus {
  productAnalytics: boolean | null;
  optionalDiagnostics: boolean | null;
  productEpoch: number;
  diagnosticsEpoch: number;
  diagnosticPseudonym: string | null;
  revision: number;
  noticeVersion: string | null;
  productNoticeVersion: string | null;
  diagnosticsNoticeVersion: string | null;
  productAnalyticsAllowed: boolean;
  optionalDiagnosticsAllowed: boolean;
  productCollectionEnabled: boolean;
  diagnosticsCollectionEnabled: boolean;
  productConsentCurrent: boolean;
  diagnosticsConsentCurrent: boolean;
  privacySignalActive: boolean;
}

export type PrivacyChoice = { productAnalytics?: boolean; optionalDiagnostics?: boolean };

export const localPrivacySignalActive = (): boolean => {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const browser = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null };
  return browser.globalPrivacyControl === true || browser.doNotTrack === '1';
};

export const applyLocalPrivacySignal = (status: PrivacyStatus): PrivacyStatus => {
  if (!localPrivacySignalActive()) return status;
  return { ...status, privacySignalActive: true, productAnalyticsAllowed: false };
};

export const needsPrivacyChoice = (status: PrivacyStatus | null): boolean => Boolean(status && (
  (status.productCollectionEnabled && !status.privacySignalActive && !status.productConsentCurrent) ||
  (status.diagnosticsCollectionEnabled && !status.diagnosticsConsentCurrent)
));

export const privacyPlatform = (): 'web' | 'ios' | 'android' =>
  Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
