export const TRANSFER_TYPES = ['Flight', 'Public Transit', 'Private Transfer', 'Other'] as const;
export type CanonicalTransferType = (typeof TRANSFER_TYPES)[number];

/** Old records remain readable and are saved using the consolidated names when edited. */
export function normalizeTransferType(value: unknown): CanonicalTransferType {
  const text = String(value ?? '').trim();
  if (['Train', 'Bus', 'Ferry', 'Public Transit'].includes(text)) return 'Public Transit';
  if (text === 'Private' || text === 'Private Transfer') return 'Private Transfer';
  return text === 'Other' ? 'Other' : 'Flight';
}
