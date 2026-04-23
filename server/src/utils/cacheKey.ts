import { createHash } from 'crypto';

export const normalizeCacheInput = (value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeCacheInput(entry))
      .filter((entry) => entry !== null && entry !== undefined);
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const entries: Array<[string, unknown]> = [];
    for (const rawKey of Object.keys(source).sort()) {
      const normalized = normalizeCacheInput(source[rawKey]);
      if (normalized === null || normalized === undefined) continue;
      entries.push([rawKey, normalized]);
    }
    return Object.fromEntries(entries);
  }
  return null;
};

export const stableStringify = (value: unknown): string => {
  const normalized = normalizeCacheInput(value);
  return JSON.stringify(normalized);
};

export type FingerprintOptions = {
  version?: string | number;
};

export const computeFingerprint = (input: unknown, options: FingerprintOptions = {}): string => {
  const payload = {
    v: String(options.version ?? '1'),
    d: normalizeCacheInput(input),
  };
  const serialized = JSON.stringify(payload);
  return createHash('sha256').update(serialized).digest('hex');
};

export const buildNamespacedKey = (namespace: string, ...parts: Array<string | number | null | undefined>): string => {
  const cleanNamespace = String(namespace ?? '').trim();
  const cleanParts = parts
    .filter((part) => part !== null && part !== undefined)
    .map((part) => String(part).trim().toLowerCase())
    .filter((part) => part.length > 0);
  return [cleanNamespace, ...cleanParts].join('::');
};
