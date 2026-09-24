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
// POST /api/lodgings
// ---------------------------------------------------------------------------
//
// `tripId` is the only fully-required field; everything else has a sensible
// default in the handler. Status-aware "relaxed required fields" validation
// (skipped for Proposed status) stays in the handler since it depends on
// the normalized status.

export const createLodgingDto = z.object({
  tripId: trimmedNonEmpty('tripId'),
  status: optionalString,
  name: optionalString,
  checkInDate: optionalString,
  checkOutDate: optionalString,
  rooms: optionalNumberOrString,
  refundBy: optionalString,
  totalCost: optionalNumberOrString,
  costPerNight: optionalNumberOrString,
  address: optionalString,
  notes: optionalString,
  features: optionalIdArray,
  placeId: optionalString,
  paidBy: optionalIdArray,
  travelerIds: optionalIdArray,
});
export type CreateLodgingDto = z.infer<typeof createLodgingDto>;

// ---------------------------------------------------------------------------
// PUT / PATCH /api/lodgings/:id
// ---------------------------------------------------------------------------
//
// Both share the same DTO: the handler already treats PUT as a partial
// update. All fields are optional; handler branches on undefined-as-no-change.

export const updateLodgingDto = z.object({
  status: patchField(z.string()),
  name: patchField(z.string()),
  checkInDate: patchField(z.string()),
  checkOutDate: patchField(z.string()),
  rooms: patchField(z.union([z.string(), z.number()])),
  refundBy: patchField(z.string()),
  totalCost: patchField(z.union([z.string(), z.number()])),
  costPerNight: patchField(z.union([z.string(), z.number()])),
  address: patchField(z.string()),
  notes: patchField(z.string()),
  features: patchField(z.array(z.string())),
  placeId: patchField(z.string()),
  tripId: patchField(z.string()),
  paidBy: patchField(z.array(z.union([z.string(), z.number()]))),
  travelerIds: patchField(z.array(z.union([z.string(), z.number()]))),
});
export type UpdateLodgingDto = z.infer<typeof updateLodgingDto>;

export const importLodgingsDto = z.object({
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
  const allowed = new Set(['status', 'name', 'checkInDate', 'checkOutDate', 'rooms', 'refundBy', 'totalCost', 'costPerNight', 'address', 'notes', 'features', 'paidBy', 'travelerIds']);
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
export type ImportLodgingsDto = z.infer<typeof importLodgingsDto>;

// ---------------------------------------------------------------------------
// POST /api/lodgings/:id/vote and /api/lodgings/:id/rating
// ---------------------------------------------------------------------------

export const voteOrRatingDto = z.object({
  value: z
    .union([z.literal(1), z.literal(-1), z.literal('1'), z.literal('-1')])
    .transform((v) => (Number(v) === 1 ? 1 : -1) as 1 | -1),
});
export type VoteOrRatingDto = z.infer<typeof voteOrRatingDto>;
