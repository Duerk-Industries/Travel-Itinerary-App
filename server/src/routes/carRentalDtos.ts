import { z } from 'zod';

const optionalTrimmedString = z
  .preprocess(
    (value) => (value == null ? '' : value),
    z.string(),
  )
  .transform((value) => value.trim());

const optionalIdArray = z
  .preprocess(
    (items) => (Array.isArray(items) ? items : []),
    z.array(z.union([z.string(), z.number()])),
  )
  .transform((items) =>
    items.map((id) => String(id).trim()).filter(Boolean),
  );

const optionalCost = z
  .preprocess(
    (value) => (value == null ? 0 : value),
    z.union([z.string(), z.number()]),
  )
  .transform((value) => Number(value) || 0);

const trimmedNonEmpty = (label: string) =>
  z
    .string({ message: `${label} must be a string.` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: `${label} is required.` });

// ---------------------------------------------------------------------------
// POST /api/car-rentals
// ---------------------------------------------------------------------------

export const createCarRentalDto = z.object({
  tripId: trimmedNonEmpty('tripId'),
  /** Raw input — normalised against `ItineraryStatus` in the handler. */
  status: optionalTrimmedString,
  pickupLocation: optionalTrimmedString,
  pickupDate: optionalTrimmedString,
  dropoffLocation: optionalTrimmedString,
  dropoffDate: optionalTrimmedString,
  reference: optionalTrimmedString,
  vendor: optionalTrimmedString,
  prepaid: optionalTrimmedString,
  cost: optionalCost,
  model: optionalTrimmedString,
  notes: optionalTrimmedString,
  paidBy: optionalIdArray,
  travelerIds: optionalIdArray,
});
export type CreateCarRentalDto = z.infer<typeof createCarRentalDto>;

// ---------------------------------------------------------------------------
// PATCH /api/car-rentals/:id
// ---------------------------------------------------------------------------
//
// All fields optional: PATCH is a partial update. We intentionally keep the
// status coercion out of the DTO so the handler can apply
// `normalizeItineraryStatus` uniformly.

const patchField = <S extends z.ZodTypeAny>(schema: S) =>
  z
    .union([schema, z.null(), z.undefined()])
    .optional();

export const updateCarRentalDto = z.object({
  status: patchField(z.string()),
  pickupLocation: patchField(z.string()),
  pickupDate: patchField(z.string()),
  dropoffLocation: patchField(z.string()),
  dropoffDate: patchField(z.string()),
  reference: patchField(z.string()),
  vendor: patchField(z.string()),
  prepaid: patchField(z.string()),
  cost: patchField(z.union([z.string(), z.number()])),
  model: patchField(z.string()),
  notes: patchField(z.string()),
  paidBy: patchField(z.array(z.union([z.string(), z.number()]))),
  travelerIds: patchField(z.array(z.union([z.string(), z.number()]))),
});
export type UpdateCarRentalDto = z.infer<typeof updateCarRentalDto>;

// ---------------------------------------------------------------------------
// POST /api/car-rentals/:id/vote and /api/car-rentals/:id/rating
// ---------------------------------------------------------------------------

export const voteOrRatingDto = z.object({
  value: z
    .union([z.literal(1), z.literal(-1), z.literal('1'), z.literal('-1')])
    .transform((v) => (Number(v) === 1 ? 1 : -1) as 1 | -1),
});
export type VoteOrRatingDto = z.infer<typeof voteOrRatingDto>;
