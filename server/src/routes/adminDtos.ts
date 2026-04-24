import { z } from 'zod';

const MAX_BULK_ADMIN_USER_IDS = 100;

const trimmedNonEmpty = (label: string) =>
  z
    .string({ message: `${label} must be a string.` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: `${label} is required.` });

const idArray = z
  .array(z.string({ message: 'Each id must be a string.' }))
  .transform((ids) => Array.from(new Set(ids.map((value) => String(value ?? '').trim()).filter(Boolean))))
  .refine((ids) => ids.length > 0, { message: 'ids must contain at least one non-empty id.' })
  .refine((ids) => ids.length <= MAX_BULK_ADMIN_USER_IDS, {
    message: `ids may contain at most ${MAX_BULK_ADMIN_USER_IDS} entries.`,
  });

const reasonField = z
  .string({ message: 'reason must be a string.' })
  .transform((value) => value.trim())
  .refine((value) => value.length >= 3, { message: 'reason (min 3 chars) is required' });

export const bulkSetUserTierDto = z.object({
  ids: idArray,
  tierKey: trimmedNonEmpty('tierKey'),
  reason: reasonField,
});
export type BulkSetUserTierDto = z.infer<typeof bulkSetUserTierDto>;

export const BULK_ADMIN_USER_ID_CAP = MAX_BULK_ADMIN_USER_IDS;
