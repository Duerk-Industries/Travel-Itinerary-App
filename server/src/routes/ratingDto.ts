import { z } from 'zod';

/** A traveler's rating of an item: a whole number of stars, 1 to 5 (a numeric string is accepted too). */
export const starRatingDto = z.object({
  value: z.coerce.number().int().min(1).max(5),
});
export type StarRatingDto = z.infer<typeof starRatingDto>;
