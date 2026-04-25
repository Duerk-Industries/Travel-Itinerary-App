import { parseDto, DtoValidationError } from '../src/utils/dtoParse';
import {
  createLodgingDto,
  updateLodgingDto,
  voteOrRatingDto,
} from '../src/routes/lodgingDtos';

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

describe('createLodgingDto', () => {
  it('accepts a minimal payload with just tripId', () => {
    const parsed = parseDto(createLodgingDto, { tripId: 'trip-1' });
    expect(parsed.tripId).toBe('trip-1');
    expect(parsed.paidBy).toEqual([]);
    expect(parsed.travelerIds).toEqual([]);
  });

  it('rejects a missing tripId', () => {
    expectValidationError(() => parseDto(createLodgingDto, {}), /tripId/);
  });

  it('rejects a whitespace-only tripId', () => {
    expectValidationError(() => parseDto(createLodgingDto, { tripId: '   ' }), /tripId is required/);
  });

  it('coerces id arrays with mixed number/string entries and strips blanks', () => {
    const parsed = parseDto(createLodgingDto, {
      tripId: 't',
      paidBy: ['u1', 42, '', '  u2  '],
      travelerIds: ['u3'],
    });
    expect(parsed.paidBy).toEqual(['u1', '42', 'u2']);
    expect(parsed.travelerIds).toEqual(['u3']);
  });

  it('passes rooms/costs through without coercion (handler normalizes)', () => {
    const parsed = parseDto(createLodgingDto, {
      tripId: 't',
      rooms: '2',
      totalCost: '250.50',
      costPerNight: 125,
    });
    expect(parsed.rooms).toBe('2');
    expect(parsed.totalCost).toBe('250.50');
    expect(parsed.costPerNight).toBe(125);
  });
});

describe('updateLodgingDto', () => {
  it('accepts an empty object (full partial update)', () => {
    const parsed = parseDto(updateLodgingDto, {});
    expect(Object.values(parsed).every((v) => v === undefined)).toBe(true);
  });

  it('preserves only the fields the caller provided', () => {
    const parsed = parseDto(updateLodgingDto, { name: 'Hotel Europa', rooms: 3 });
    expect(parsed.name).toBe('Hotel Europa');
    expect(parsed.rooms).toBe(3);
    expect(parsed.address).toBeUndefined();
    expect(parsed.paidBy).toBeUndefined();
  });

  it('rejects a number for a string-only field', () => {
    expectValidationError(() => parseDto(updateLodgingDto, { name: 42 }));
  });
});

describe('voteOrRatingDto', () => {
  it('accepts 1 and -1 as numbers and strings', () => {
    expect(parseDto(voteOrRatingDto, { value: 1 }).value).toBe(1);
    expect(parseDto(voteOrRatingDto, { value: -1 }).value).toBe(-1);
    expect(parseDto(voteOrRatingDto, { value: '1' }).value).toBe(1);
    expect(parseDto(voteOrRatingDto, { value: '-1' }).value).toBe(-1);
  });

  it('rejects 0 and 2', () => {
    expectValidationError(() => parseDto(voteOrRatingDto, { value: 0 }));
    expectValidationError(() => parseDto(voteOrRatingDto, { value: 2 }));
  });
});
