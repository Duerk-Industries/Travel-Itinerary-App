import { applyLocalPrivacySignal, needsPrivacyChoice, type PrivacyStatus } from '../utils/privacyConsent';

const base: PrivacyStatus = {
  productAnalytics: null, optionalDiagnostics: null, productEpoch: 0, diagnosticsEpoch: 0,
  diagnosticPseudonym: null, revision: 0, noticeVersion: null,
  productNoticeVersion: null, diagnosticsNoticeVersion: null,
  productAnalyticsAllowed: false, optionalDiagnosticsAllowed: false,
  productCollectionEnabled: false, diagnosticsCollectionEnabled: false,
  productConsentCurrent: false, diagnosticsConsentCurrent: false, privacySignalActive: false,
};

describe('privacy-choice state', () => {
  it('does not prompt while collection is disabled or state is unknown', () => {
    expect(needsPrivacyChoice(null)).toBe(false);
    expect(needsPrivacyChoice(base)).toBe(false);
  });
  it('prompts only for newly available unanswered purposes', () => {
    expect(needsPrivacyChoice({ ...base, productCollectionEnabled: true })).toBe(true);
    expect(needsPrivacyChoice({ ...base, productCollectionEnabled: true, productAnalytics: false, productConsentCurrent: true })).toBe(false);
    expect(needsPrivacyChoice({ ...base, diagnosticsCollectionEnabled: true, productAnalytics: false, productConsentCurrent: true })).toBe(true);
    expect(needsPrivacyChoice({ ...base, productCollectionEnabled: true, privacySignalActive: true })).toBe(false);
  });
  it('does not alter native state when browser privacy signals are unavailable', () => {
    expect(applyLocalPrivacySignal(base)).toEqual(base);
  });
});
