/**
 * Canonical packing-list label identity. Keep this dependency-free because it
 * is used by both the server and the React Native client.
 */
export const normalizePackingLabel = (value: string): string => {
  const normalized = String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
  if (!normalized) return '';
  return normalized
    .replace(/\((?:\s*(?:x|qty|quantity)\s*\d+\s*)\)/giu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
