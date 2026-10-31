/// <reference types="jest" />
/// <reference types="node" />
import { canRateItem, formatRating, formatStarMarks, normalizeRatingFields, normalizeStars, shouldShowVoteButtons } from '../utils/votes';

describe('votes utils', () => {
  test('never shows proposal vote buttons', () => {
    expect(shouldShowVoteButtons('Proposed', null)).toBe(false);
    expect(shouldShowVoteButtons('Proposed', 1)).toBe(false);
    expect(shouldShowVoteButtons('Booked', null)).toBe(false);
  });

  test('allows rating only on completed items', () => {
    expect(canRateItem('Completed')).toBe(true);
    expect(canRateItem('Proposed')).toBe(false);
    expect(canRateItem('Booked')).toBe(false);
  });

  test('accepts whole stars from 1 to 5', () => {
    expect(normalizeStars(1)).toBe(1);
    expect(normalizeStars(5)).toBe(5);
    expect(normalizeStars(0)).toBeNull();
    expect(normalizeStars(6)).toBeNull();
    expect(normalizeStars(4.5)).toBeNull();
    expect(normalizeStars(null)).toBeNull();
  });

  test('reads rating fields from a server item, tolerating an older server', () => {
    expect(normalizeRatingFields({ averageRating: 4.5, ratingCount: 2, userStars: 4 })).toEqual({ averageRating: 4.5, ratingCount: 2, userStars: 4 });
    expect(normalizeRatingFields({ netRating: 1, userRating: 1 })).toEqual({ averageRating: null, ratingCount: 0, userStars: null });
  });

  test('formats the group average with how many travelers rated', () => {
    expect(formatRating(4.5, 2)).toBe('4.5 (2)');
    expect(formatRating(5, 1)).toBe('5.0 (1)');
    expect(formatRating(null, 0)).toBe('No ratings');
  });

  test('writes a rating as star marks', () => {
    expect(formatStarMarks(4)).toBe('★★★★☆');
  });
});
