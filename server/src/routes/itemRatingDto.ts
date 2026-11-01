import { z } from 'zod';

// Builds released before star ratings send `{ value: 1 | -1 }`, so that shape stays accepted.
const starsBody = z.object({ stars: z.number().int().min(1).max(5) }).transform(({ stars }) => stars);
const legacyThumbBody = z
  .object({ value: z.union([z.literal(1), z.literal(-1), z.literal('1'), z.literal('-1')]) })
  .transform(({ value }) => (Number(value) === 1 ? 5 : 1));

export const itemRatingDto = z.union([starsBody, legacyThumbBody]);
