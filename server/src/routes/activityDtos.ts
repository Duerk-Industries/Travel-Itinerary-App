import { z } from 'zod';

const optionalString = z.union([z.string(), z.null(), z.undefined()]).optional();
const optionalNumberOrString = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .optional();

const trimmedNonEmpty = (label: string) =>
  z
    .string({ message: `${label} must be a string.` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: `${label} is required.` });

const optionalIdArray = z
  .preprocess(
    (items) => (Array.isArray(items) ? items : []),
    z.array(z.union([z.string(), z.number()])),
  )
  .transform((items) =>
    items.map((id) => String(id).trim()).filter(Boolean),
  );

const patchField = <S extends z.ZodTypeAny>(schema: S) =>
  z.union([schema, z.null(), z.undefined()]).optional();

// ---------------------------------------------------------------------------
// POST /api/activities
// ---------------------------------------------------------------------------
//
// Legacy behavior preserved: `tripId` required, everything else optional with
// sensible defaults. Status + activityType are kept as raw strings here; the
// handler normalizes them with `normalizeItineraryStatus` /
// `normalizeActivityType` so the "relaxed required fields" logic still works.

export const createActivityDto = z.object({
  tripId: trimmedNonEmpty('tripId'),
  status: optionalString,
  activityType: optionalString,
  date: optionalString,
  name: optionalString,
  startLocation: optionalString,
  startTime: optionalString,
  duration: optionalString,
  cost: optionalNumberOrString,
  freeCancelBy: optionalString,
  bookedOn: optionalString,
  reference: optionalString,
  notes: optionalString,
  paidBy: optionalIdArray,
  travelerIds: optionalIdArray,
});
export type CreateActivityDto = z.infer<typeof createActivityDto>;

// ---------------------------------------------------------------------------
// PUT / PATCH /api/activities/:id
// ---------------------------------------------------------------------------
//
// PUT and PATCH share the same DTO: both accept partial updates, and the
// handler decides whether a missing field means "no change" (PATCH) or
// "leave at default" (PUT). This mirrors the pre-existing handler logic
// which already treated PUT as a lenient partial update.

export const updateActivityDto = z.object({
  status: patchField(z.string()),
  activityType: patchField(z.string()),
  date: patchField(z.string()),
  name: patchField(z.string()),
  startLocation: patchField(z.string()),
  startTime: patchField(z.string()),
  duration: patchField(z.string()),
  cost: patchField(z.union([z.string(), z.number()])),
  freeCancelBy: patchField(z.string()),
  bookedOn: patchField(z.string()),
  reference: patchField(z.string()),
  notes: patchField(z.string()),
  paidBy: patchField(z.array(z.union([z.string(), z.number()]))),
  travelerIds: patchField(z.array(z.union([z.string(), z.number()]))),
});
export type UpdateActivityDto = z.infer<typeof updateActivityDto>;

const bulkActivityUpdateDto = z.object({
  id: trimmedNonEmpty('activity id'),
  fields: updateActivityDto,
});

export const bulkActivitiesDto = z
  .object({
    updates: z.array(bulkActivityUpdateDto).default([]),
    deletes: z.array(trimmedNonEmpty('activity id')).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.updates.length + value.deletes.length > 50) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: 50,
        origin: 'array',
        inclusive: true,
        message: 'A bulk activity save may contain at most 50 row operations.',
        path: ['updates'],
      });
    }
  });
export type BulkActivitiesDto = z.infer<typeof bulkActivitiesDto>;

export const importActivitiesDto = z.object({
  tripId: z.uuid('tripId must be a UUID.'),
  importId: z.uuid('importId must be a UUID.'),
  rows: z.array(z.object({
    sourceRow: z.number().int().positive(),
    action: z.enum(['create', 'update']),
    existingId: z.string().trim().optional(),
    expectedFingerprint: z.string().optional(),
    fields: z.record(z.string(), z.unknown()),
  }).strict()).min(1).max(150),
}).strict().superRefine((value, ctx) => {
  const allowed = new Set(['status', 'activityType', 'date', 'name', 'startLocation', 'startTime', 'duration', 'cost', 'freeCancelBy', 'bookedOn', 'reference', 'notes', 'paidBy', 'travelerIds']);
  const sourceRows = new Set<number>();
  const updateIds = new Set<string>();
  value.rows.forEach((row, index) => {
    if (sourceRows.has(row.sourceRow)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rows', index, 'sourceRow'], message: 'sourceRow values must be unique.' });
    sourceRows.add(row.sourceRow);
    if (row.action === 'update' && row.existingId) {
      if (updateIds.has(row.existingId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rows', index, 'existingId'], message: 'An update target may appear only once.' });
      updateIds.add(row.existingId);
    }
    Object.keys(row.fields).forEach((key) => {
      if (!allowed.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rows', index, 'fields', key], message: `Unknown import field: ${key}.` });
    });
  });
});
export type ImportActivitiesDto = z.infer<typeof importActivitiesDto>;

// ---------------------------------------------------------------------------
// POST /api/activities/:id/vote and /api/activities/:id/rating
// ---------------------------------------------------------------------------

export const voteOrRatingDto = z.object({
  value: z
    .union([z.literal(1), z.literal(-1), z.literal('1'), z.literal('-1')])
    .transform((v) => (Number(v) === 1 ? 1 : -1) as 1 | -1),
});
export type VoteOrRatingDto = z.infer<typeof voteOrRatingDto>;
