// crypto.randomUUID isn't guaranteed on Hermes/older RN runtimes without a
// polyfill, so fall back to a timestamp + random-suffix key when it's
// unavailable. Collision odds are negligible either way for a
// per-request-attempt idempotency key.
export const createIdempotencyKey = (prefix: string): string => {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return `${prefix}_${cryptoApi.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};
