/**
 * Removes account/trip identifiers from an arbitrary JSON value (any depth), for
 * erasure and retention de-linking of telemetry that embeds identity inside JSON.
 */
export const IDENTITY_KEYS = new Set(['userId', 'user_id', 'tripId', 'trip_id', 'anonymousUserId', 'email', 'userEmail']);

export const scrubIdentity = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map((item) => scrubIdentity(item)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (IDENTITY_KEYS.has(key)) continue;
      out[key] = scrubIdentity(child);
    }
    return out as T;
  }
  return value;
};
