/// <reference types="jest" />
/// <reference types="node" />
import { parseDto, DtoValidationError } from '../src/utils/dtoParse';
import {
  createActivityDto,
  updateActivityDto,
  bulkActivitiesDto,
  voteOrRatingDto,
} from '../src/routes/activityDtos';

const expectValidationError = (fn: () => unknown, regex?: RegExp) => {
  try {
    fn();
    throw new Error('expected DtoValidationError');
  } catch (err) {
    expect(err).toBeInstanceOf(DtoValidationError);
    if (regex) {
      const details = (err as DtoValidationError).details.map((d) => `${d.path}: ${d.message}`).join(' | ');
      expect(details).toMatch(regex);
    }
  }
};

describe('createActivityDto', () => {
  it('accepts a minimal payload with just tripId', () => {
    const parsed = parseDto(createActivityDto, { tripId: 'trip-1' });
    expect(parsed.tripId).toBe('trip-1');
    expect(parsed.paidBy).toEqual([]);
    expect(parsed.travelerIds).toEqual([]);
  });

  it('coerces id arrays (numeric + mixed) and strips blanks', () => {
    const parsed = parseDto(createActivityDto, {
      tripId: 't',
      paidBy: ['u1', 42, '', '  u2  '],
      travelerIds: ['u3'],
    });
    expect(parsed.paidBy).toEqual(['u1', '42', 'u2']);
    expect(parsed.travelerIds).toEqual(['u3']);
  });

  it('passes through status + activityType as raw strings (handler normalizes)', () => {
    const parsed = parseDto(createActivityDto, {
      tripId: 't',
      status: 'Proposed',
      activityType: 'Tour',
    });
    expect(parsed.status).toBe('Proposed');
    expect(parsed.activityType).toBe('Tour');
  });

  it('rejects a missing tripId', () => {
    expectValidationError(() => parseDto(createActivityDto, {}), /tripId/);
  });

  it('rejects a whitespace-only tripId', () => {
    expectValidationError(() => parseDto(createActivityDto, { tripId: '  ' }), /tripId is required/);
  });
});

describe('updateActivityDto', () => {
  it('accepts an empty object (full partial update)', () => {
    const parsed = parseDto(updateActivityDto, {});
    expect(Object.values(parsed).every((v) => v === undefined)).toBe(true);
  });

  it('preserves only the fields the caller provided', () => {
    const parsed = parseDto(updateActivityDto, { name: 'Hiking Tour', cost: 45 });
    expect(parsed.name).toBe('Hiking Tour');
    expect(parsed.cost).toBe(45);
    expect(parsed.status).toBeUndefined();
    expect(parsed.paidBy).toBeUndefined();
  });

  it('rejects a number in a string-only field', () => {
    expectValidationError(() => parseDto(updateActivityDto, { name: 42 }));
  });
});

describe('voteOrRatingDto', () => {
  it('accepts 1 and -1 as numbers and strings', () => {
    expect(parseDto(voteOrRatingDto, { value: 1 }).value).toBe(1);
    expect(parseDto(voteOrRatingDto, { value: -1 }).value).toBe(-1);
    expect(parseDto(voteOrRatingDto, { value: '1' }).value).toBe(1);
    expect(parseDto(voteOrRatingDto, { value: '-1' }).value).toBe(-1);
  });

  it('rejects 0, 2, and non-literal numbers', () => {
    expectValidationError(() => parseDto(voteOrRatingDto, { value: 0 }));
    expectValidationError(() => parseDto(voteOrRatingDto, { value: 2 }));
  });
});

describe('bulkActivitiesDto', () => {
  it('accepts mixed row updates and staged deletes', () => {
    const parsed = parseDto(bulkActivitiesDto, {
      updates: [{ id: 'activity-1', fields: { name: 'Museum', cost: 25 } }],
      deletes: ['activity-2'],
    });
    expect(parsed.updates[0].fields.name).toBe('Museum');
    expect(parsed.deletes).toEqual(['activity-2']);
  });

  it('caps a single bulk request at 50 row operations', () => {
    expectValidationError(() => parseDto(bulkActivitiesDto, { deletes: Array.from({ length: 51 }, (_, index) => `activity-${index}`) }), /at most 50/);
  });
});
