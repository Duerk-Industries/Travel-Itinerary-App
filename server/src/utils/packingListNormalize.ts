// Mirror of packages/domain/src/packingListNormalize.ts.
// Keep this inline because server tsconfig restricts cross-workspace imports.
// The domain-sync tests detect drift.
export const normalizePackingLabel = (value: string): string => {
  const normalized = String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
  if (!normalized) return '';
  return normalized
    .replace(/\((?:\s*(?:x|qty|quantity)\s*\d+\s*)\)/giu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
