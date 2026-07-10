/// <reference types="jest" />
/// <reference types="node" />
import { parseDto, DtoValidationError } from '../src/utils/dtoParse';
import {
  createShareInvitesDto,
  createTripCommentDto,
  followTripDto,
  updateCoveredByDto,
  updateTripGroupDto,
} from '../src/routes/tripDtos';

const expectValidationError = (fn: () => unknown, messageRegex?: RegExp) => {
  try {
    fn();
    throw new Error('expected parseDto to throw DtoValidationError');
  } catch (err) {
    expect(err).toBeInstanceOf(DtoValidationError);
    if (messageRegex) {
      const details = (err as DtoValidationError).details;
      const joined = details.map((d) => `${d.path}: ${d.message}`).join(' | ');
      expect(joined).toMatch(messageRegex);
    }
  }
};

describe('tripDtos', () => {
  describe('followTripDto', () => {
    it('accepts { inviteCode } and normalizes whitespace', () => {
      const parsed = parseDto(followTripDto, { inviteCode: '  ABC123  ' });
      expect(parsed).toEqual({ inviteCode: 'ABC123' });
    });

    it('accepts the legacy { code } alias and maps it to inviteCode', () => {
      const parsed = parseDto(followTripDto, { code: 'ABC123' });
      expect(parsed).toEqual({ inviteCode: 'ABC123' });
    });

    it('prefers inviteCode over code when both are supplied', () => {
      const parsed = parseDto(followTripDto, { inviteCode: 'NEW', code: 'OLD' });
      expect(parsed).toEqual({ inviteCode: 'NEW' });
    });

    it('rejects empty / missing invite code', () => {
      expectValidationError(() => parseDto(followTripDto, {}), /inviteCode is required/);
      expectValidationError(() => parseDto(followTripDto, { inviteCode: '   ' }), /inviteCode is required/);
    });

    it('rejects non-string types', () => {
      expectValidationError(() => parseDto(followTripDto, { inviteCode: 123 }), /must be a string/);
    });
  });

  describe('createTripCommentDto', () => {
    it('accepts a non-empty body and trims surrounding whitespace', () => {
      const parsed = parseDto(createTripCommentDto, { body: '  Hello  ' });
      expect(parsed).toEqual({ body: 'Hello' });
    });

    it('rejects empty body', () => {
      expectValidationError(() => parseDto(createTripCommentDto, { body: '' }), /body is required/i);
      expectValidationError(() => parseDto(createTripCommentDto, { body: '   ' }), /body is required/i);
    });

    it('rejects a body longer than 4000 chars (post-trim)', () => {
      expectValidationError(
        () => parseDto(createTripCommentDto, { body: 'x'.repeat(4001) }),
        /too long/i,
      );
    });

    it('accepts exactly 4000 chars', () => {
      const parsed = parseDto(createTripCommentDto, { body: 'x'.repeat(4000) });
      expect(parsed.body.length).toBe(4000);
    });
  });

  describe('createShareInvitesDto', () => {
    it('accepts a valid invite array, lowercasing emails and coercing role', () => {
      const parsed = parseDto(createShareInvitesDto, {
        invites: [
          { email: '  Alice@Example.com ', role: 'member' },
          { email: 'bob@example.com', role: 'follower' },
        ],
      });
      expect(parsed.invites).toEqual([
        { email: 'alice@example.com', role: 'member' },
        { email: 'bob@example.com', role: 'follower' },
      ]);
    });

    it('rejects an empty invites array', () => {
      expectValidationError(
        () => parseDto(createShareInvitesDto, { invites: [] }),
        /non-empty array/i,
      );
    });

    it('rejects a missing invites property', () => {
      expectValidationError(() => parseDto(createShareInvitesDto, {}));
    });

    it('rejects an invalid email', () => {
      expectValidationError(
        () =>
          parseDto(createShareInvitesDto, {
            invites: [{ email: 'not-an-email', role: 'member' }],
          }),
        /Invalid email/i,
      );
    });

    it('rejects an invalid role', () => {
      expectValidationError(
        () =>
          parseDto(createShareInvitesDto, {
            invites: [{ email: 'a@b.co', role: 'owner' }],
          }),
        /member or follower/i,
      );
    });

    it('rejects duplicate (email, role) pairs', () => {
      expectValidationError(
        () =>
          parseDto(createShareInvitesDto, {
            invites: [
              { email: 'a@b.co', role: 'member' },
              { email: 'a@b.co', role: 'member' },
            ],
          }),
        /Duplicate invite/i,
      );
    });

    it('allows the same email across different roles (not a duplicate)', () => {
      const parsed = parseDto(createShareInvitesDto, {
        invites: [
          { email: 'a@b.co', role: 'member' },
          { email: 'a@b.co', role: 'follower' },
        ],
      });
      expect(parsed.invites).toHaveLength(2);
    });
  });

  describe('updateCoveredByDto', () => {
    it('accepts an empty map', () => {
      expect(parseDto(updateCoveredByDto, {})).toEqual({});
    });

    it('accepts a valid cover-map', () => {
      const parsed = parseDto(updateCoveredByDto, { 'traveler-1': 'traveler-2' });
      expect(parsed).toEqual({ 'traveler-1': 'traveler-2' });
    });

    it('rejects non-string values', () => {
      expectValidationError(() => parseDto(updateCoveredByDto, { 'a': 42 }));
    });
  });

  describe('updateTripGroupDto', () => {
    it('accepts a non-empty groupId', () => {
      const parsed = parseDto(updateTripGroupDto, { groupId: '  g-1  ' });
      expect(parsed).toEqual({ groupId: 'g-1' });
    });

    it('rejects empty / missing groupId', () => {
      // Missing → "must be a string"; whitespace-only → "is required".
      // Both are "groupId"-pathed rejections and both produce HTTP 400 via readDto.
      expectValidationError(() => parseDto(updateTripGroupDto, {}), /groupId/);
      expectValidationError(() => parseDto(updateTripGroupDto, { groupId: '   ' }), /groupId is required/);
    });
  });
});
