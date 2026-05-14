import { z } from 'zod';

// ---------------------------------------------------------------------------
// POST /api/itineraries/details/:detailId/reactions
// ---------------------------------------------------------------------------

export const reactionVoteValueDto = z
  .union([z.literal(1), z.literal(-1), z.literal('1'), z.literal('-1')])
  .transform((value) => (Number(value) === 1 ? 1 : -1) as 1 | -1);

export const castReactionDto = z.object({
  value: reactionVoteValueDto,
});

export type CastReactionInput = z.infer<typeof castReactionDto>;
