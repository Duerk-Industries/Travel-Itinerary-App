import { z } from 'zod';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const trimmedNonEmpty = (label: string) =>
  z
    .string({ message: `${label} must be a string.` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: `${label} is required.` });

const normalizedEmail = z
  .string({ message: 'email must be a string.' })
  .transform((value) => value.trim().toLowerCase())
  .refine((value) => value.length > 0 && EMAIL_REGEX.test(value), { message: 'Invalid email address.' });

/**
 * `POST /api/trips/follow` — accepts either `inviteCode` or the legacy `code`
 * alias and normalizes to `inviteCode`. At least one must be a non-empty
 * string after trim.
 */
export const followTripDto = z
  .object({
    inviteCode: z.string({ message: 'inviteCode must be a string.' }).optional(),
    code: z.string({ message: 'code must be a string.' }).optional(),
  })
  .transform((input) => {
    const resolved = String(input.inviteCode ?? input.code ?? '').trim();
    return { inviteCode: resolved };
  })
  .refine((data) => data.inviteCode.length > 0, {
    message: 'inviteCode is required',
    path: ['inviteCode'],
  });
export type FollowTripDto = z.infer<typeof followTripDto>;

/**
 * `POST /api/trips/:id/share/invites` — creates one or more invites. Each
 * entry must have a valid email and a role of `member` or `follower`.
 * Duplicate (email, role) pairs in a single request are rejected.
 */
const shareInviteEntry = z.object({
  email: normalizedEmail,
  role: z.enum(['member', 'follower'], {
    message: 'Each invite role must be either member or follower',
  }),
});

export const createShareInvitesDto = z
  .object({
    invites: z
      .array(shareInviteEntry, { message: 'invites must be an array.' })
      .min(1, { message: 'invites is required and must be a non-empty array' }),
  })
  .refine(
    (data) => {
      const seen = new Set<string>();
      for (const invite of data.invites) {
        const key = `${invite.email}|${invite.role}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
    { message: 'Duplicate invite in payload', path: ['invites'] },
  );
export type CreateShareInvitesDto = z.infer<typeof createShareInvitesDto>;

/**
 * `POST /api/trips/:id/comments` — single comment body, 1..4000 chars after
 * trimming. The server preserves the trimmed value.
 */
export const createTripCommentDto = z.object({
  body: z
    .string({ message: 'Comment body is required' })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: 'Comment body is required' })
    .refine((value) => value.length <= 4000, {
      message: 'Comment is too long (max 4000 chars)',
    }),
});
export type CreateTripCommentDto = z.infer<typeof createTripCommentDto>;

/**
 * `PUT /api/trips/:id/covered-by` — free-form map from covered traveler id
 * to covering traveler id. Empty object is allowed (clears all rules). Keys
 * and values are required strings.
 */
export const updateCoveredByDto = z.record(z.string(), z.string());
export type UpdateCoveredByDto = z.infer<typeof updateCoveredByDto>;

/**
 * `PATCH /api/trips/:id/group` — move a trip into a different group.
 */
export const updateTripGroupDto = z.object({
  groupId: trimmedNonEmpty('groupId'),
});
export type UpdateTripGroupDto = z.infer<typeof updateTripGroupDto>;

/**
 * `POST /api/trips/:id/share/invites/bulk-delete` — revoke multiple pending
 * share invites in one request. 100-id cap, dedupe, empty-array rejection,
 * matching the ingestion bulk-action pattern.
 */
const MAX_BULK_SHARE_INVITE_IDS = 100;
const shareInviteIdArray = z
  .array(z.string({ message: 'Each invite id must be a string.' }))
  .transform((ids) => Array.from(new Set(ids.map((v) => String(v ?? '').trim()).filter(Boolean))))
  .refine((ids) => ids.length > 0, { message: 'ids must contain at least one non-empty id.' })
  .refine((ids) => ids.length <= MAX_BULK_SHARE_INVITE_IDS, {
    message: `ids may contain at most ${MAX_BULK_SHARE_INVITE_IDS} entries.`,
  });

export const bulkDeleteShareInvitesDto = z.object({
  ids: shareInviteIdArray,
});
export type BulkDeleteShareInvitesDto = z.infer<typeof bulkDeleteShareInvitesDto>;
