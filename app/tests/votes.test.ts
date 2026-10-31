/// <reference types="jest" />
/// <reference types="node" />
import { canRateItem, formatAverageRating, formatRating, formatStarMarks, normalizeAverageRating, normalizeRatingFields, normalizeStarRating, shouldShowVoteButtons } from '../utils/votes';

describe('votes utils', () => {
  test('never shows proposal vote buttons', () => {
    expect(shouldShowVoteButtons('Proposed', null)).toBe(false);
    expect(shouldShowVoteButtons('Proposed', 1)).toBe(false);
    expect(shouldShowVoteButtons('Booked', null)).toBe(false);
  });

  test('lets only completed items be rated, and rated again', () => {
    expect(canRateItem('Completed')).toBe(true);
    expect(canRateItem('Booked')).toBe(false);
    expect(canRateItem('Proposed')).toBe(false);
    expect(canRateItem('Cancelled')).toBe(false);
  });

  test('keeps only whole 1-5 stars as the traveler\'s own rating', () => {
    expect([1, 5, '3'].map(normalizeStarRating)).toEqual([1, 5, 3]);
    expect([0, 6, 2.5, -1, null, undefined, 'x'].map(normalizeStarRating)).toEqual([null, null, null, null, null, null, null]);
  });

  test('keeps a positive average up to 5 and treats nobody-rated as null', () => {
    expect(normalizeAverageRating(4.333)).toBe(4.333);
    expect(normalizeAverageRating('3.5')).toBe(3.5);
    expect(normalizeAverageRating(9)).toBe(5);
    expect([0, null, undefined, '', 'x', -2].map(normalizeAverageRating)).toEqual([null, null, null, null, null, null]);
  });

  test('formats the average to one decimal, or a dash when unrated', () => {
    expect(formatAverageRating(4.333)).toBe('4.3');
    expect(formatAverageRating(5)).toBe('5.0');
    expect(formatAverageRating(null)).toBe('-');
  });

  test('reads rating fields from a server item, tolerating an older server', () => {
    expect(normalizeRatingFields({ averageRating: 4.5, ratingCount: 2, userStars: 4 })).toEqual({ averageRating: 4.5, ratingCount: 2, userStars: 4 });
    expect(normalizeRatingFields({ averageRating: 0, ratingCount: 0, userStars: 9 })).toEqual({ averageRating: null, ratingCount: 0, userStars: null });
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
