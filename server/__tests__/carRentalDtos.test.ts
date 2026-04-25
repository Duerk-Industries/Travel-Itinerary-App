import { parseDto, DtoValidationError } from '../src/utils/dtoParse';
import {
  createCarRentalDto,
  updateCarRentalDto,
  voteOrRatingDto,
} from '../src/routes/carRentalDtos';

const expectValidationError = (fn: () => unknown, regex?: RegExp) => {
  try {
    fn();
    throw new Error('expected DtoValidationError');
  } catch (err) {
    expect(err).toBeInstanceOf(DtoValidationError);
    if (regex) {
      const details = (err as DtoValidationError).details
        .map((d) => `${d.path}: ${d.message}`)
        .join(' | ');
      expect(details).toMatch(regex);
    }
  }
};

describe('createCarRentalDto', () => {
  it('accepts a minimal payload with just tripId and fills defaults', () => {
    const parsed = parseDto(createCarRentalDto, { tripId: 'trip-1' });
    expect(parsed).toMatchObject({
      tripId: 'trip-1',
      status: '',
      pickupLocation: '',
      cost: 0,
      paidBy: [],
      travelerIds: [],
    });
  });

  it('trims string fields and coerces cost', () => {
    const parsed = parseDto(createCarRentalDto, {
      tripId: '  trip-1  ',
      pickupLocation: '  LAX ',
      cost: '123.45',
    });
    expect(parsed.tripId).toBe('trip-1');
    expect(parsed.pickupLocation).toBe('LAX');
    expect(parsed.cost).toBe(123.45);
  });

  it('coerces mixed string/number ids in arrays and drops blanks', () => {
    const parsed = parseDto(createCarRentalDto, {
      tripId: 't',
      paidBy: ['u1', 42, '', '  u2  '],
      travelerIds: [' u3', null as any, 'u4'].filter((x) => x != null),
    });
    expect(parsed.paidBy).toEqual(['u1', '42', 'u2']);
    expect(parsed.travelerIds).toEqual(['u3', 'u4']);
  });

  it('rejects missing tripId', () => {
    expectValidationError(() => parseDto(createCarRentalDto, {}), /tripId/);
    expectValidationError(() => parseDto(createCarRentalDto, { tripId: '  ' }), /tripId is required/);
  });
});

describe('updateCarRentalDto', () => {
  it('accepts an empty object (all fields optional for partial update)', () => {
    const parsed = parseDto(updateCarRentalDto, {});
    expect(Object.values(parsed).every((v) => v === undefined)).toBe(true);
  });

  it('preserves only the fields the caller provided', () => {
    const parsed = parseDto(updateCarRentalDto, { pickupLocation: 'SFO', cost: 100 });
    expect(parsed.pickupLocation).toBe('SFO');
    expect(parsed.cost).toBe(100);
    expect(parsed.status).toBeUndefined();
    expect(parsed.paidBy).toBeUndefined();
  });

  it('rejects a non-string field in a PATCH update', () => {
    expectValidationError(() => parseDto(updateCarRentalDto, { vendor: 42 }));
  });
});

describe('voteOrRatingDto', () => {
  it('accepts 1 and -1 as numbers', () => {
    expect(parseDto(voteOrRatingDto, { value: 1 }).value).toBe(1);
    expect(parseDto(voteOrRatingDto, { value: -1 }).value).toBe(-1);
  });

  it('accepts "1" and "-1" as strings', () => {
    expect(parseDto(voteOrRatingDto, { value: '1' }).value).toBe(1);
    expect(parseDto(voteOrRatingDto, { value: '-1' }).value).toBe(-1);
  });

  it('rejects other numeric values', () => {
    expectValidationError(() => parseDto(voteOrRatingDto, { value: 0 }));
    expectValidationError(() => parseDto(voteOrRatingDto, { value: 2 }));
  });

  it('rejects a missing value field', () => {
    expectValidationError(() => parseDto(voteOrRatingDto, {}));
  });
});
