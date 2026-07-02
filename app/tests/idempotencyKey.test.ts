/// <reference types="jest" />
/// <reference types="node" />

import { createIdempotencyKey } from '../utils/idempotencyKey';

describe('createIdempotencyKey', () => {
  it('prefixes the key and uses crypto.randomUUID when available', () => {
    const key = createIdempotencyKey('ck');
    expect(key.startsWith('ck_')).toBe(true);
    // crypto.randomUUID output shape
    expect(key).toMatch(/^ck_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('produces distinct keys on successive calls', () => {
    const a = createIdempotencyKey('welcome_premium_monthly');
    const b = createIdempotencyKey('welcome_premium_monthly');
    expect(a).not.toBe(b);
  });

  it('falls back to a timestamp + random suffix when crypto.randomUUID is unavailable', () => {
    const original = globalThis.crypto;
    // @ts-expect-error simulate an environment without crypto.randomUUID
    globalThis.crypto = undefined;
    try {
      const key = createIdempotencyKey('wizard-trip1');
      expect(key.startsWith('wizard-trip1_')).toBe(true);
      expect(key).not.toContain('undefined');
    } finally {
      globalThis.crypto = original;
    }
  });
});
