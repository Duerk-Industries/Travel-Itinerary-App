import { z } from 'zod';

const MAX_BULK_REVIEW_ITEMS = 100;

const trimmedNonEmpty = (label: string) =>
  z
    .string({ message: `${label} must be a string.` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: `${label} is required.` });

const idArray = z
  .array(z.string({ message: 'Each id must be a string.' }))
  .transform((ids) => Array.from(new Set(ids.map((value) => String(value ?? '').trim()).filter(Boolean))))
  .refine((ids) => ids.length > 0, { message: 'ids must contain at least one non-empty id.' })
  .refine((ids) => ids.length <= MAX_BULK_REVIEW_ITEMS, {
    message: `ids may contain at most ${MAX_BULK_REVIEW_ITEMS} entries.`,
  });

export const editedFieldsSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .default({});

export const assignReviewItemDto = z.object({
  tripId: trimmedNonEmpty('tripId'),
  editedFields: editedFieldsSchema,
});
export type AssignReviewItemDto = z.infer<typeof assignReviewItemDto>;

export const updateReviewItemDto = z.object({
  editedFields: editedFieldsSchema,
});
export type UpdateReviewItemDto = z.infer<typeof updateReviewItemDto>;

export const bulkDeleteReviewItemsDto = z.object({
  ids: idArray,
});
export type BulkDeleteReviewItemsDto = z.infer<typeof bulkDeleteReviewItemsDto>;

export const bulkAssignReviewItemsDto = z.object({
  ids: idArray,
  tripId: trimmedNonEmpty('tripId'),
});
export type BulkAssignReviewItemsDto = z.infer<typeof bulkAssignReviewItemsDto>;
