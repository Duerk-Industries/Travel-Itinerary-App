/// <reference types="jest" />

import { assertCanarySideEffectAllowed, isInternalCanaryUser } from '../../src/middleware/canarySafeMode';

describe('canary safe mode', () => {
  it('detects internal canary users using either persisted field shape', () => {
    expect(isInternalCanaryUser({ is_internal_canary: true })).toBe(true);
    expect(isInternalCanaryUser({ isInternalCanary: true })).toBe(true);
    expect(isInternalCanaryUser({ is_internal_canary: false })).toBe(false);
  });

  it('blocks side effects for internal canary accounts', () => {
    expect(() => assertCanarySideEffectAllowed({ is_internal_canary: true }, 'stripe_charge'))
      .toThrow(/Canary safe mode blocked side effect/);
    expect(() => assertCanarySideEffectAllowed({ is_internal_canary: false }, 'stripe_charge'))
      .not.toThrow();
  });
});
