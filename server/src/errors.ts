export type EntitlementErrorCode =
  | 'FEATURE_DISABLED'
  | 'FEATURE_NOT_ENTITLED'
  | 'TIER_LIMIT_REACHED';

export class EntitlementError extends Error {
  public readonly code: EntitlementErrorCode;
  public readonly limitKey?: string;
  public readonly featureKey?: string;

  constructor(code: EntitlementErrorCode, message: string, opts?: { limitKey?: string; featureKey?: string }) {
    super(message);
    this.name = 'EntitlementError';
    this.code = code;
    this.limitKey = opts?.limitKey;
    this.featureKey = opts?.featureKey;
  }
}
