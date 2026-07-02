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
  placeId: patchField(z.string()),
  tripId: patchField(z.string()),
  paidBy: patchField(z.array(z.union([z.string(), z.number()]))),
  travelerIds: patchField(z.array(z.union([z.string(), z.number()]))),
});
export type UpdateLodgingDto = z.infer<typeof updateLodgingDto>;

// ---------------------------------------------------------------------------
// POST /api/lodgings/:id/vote and /api/lodgings/:id/rating
// ---------------------------------------------------------------------------

export const voteOrRatingDto = z.object({
  value: z
    .union([z.literal(1), z.literal(-1), z.literal('1'), z.literal('-1')])
    .transform((v) => (Number(v) === 1 ? 1 : -1) as 1 | -1),
});
export type VoteOrRatingDto = z.infer<typeof voteOrRatingDto>;
