/// <reference types="jest" />
/// <reference types="node" />
import { canRateItem, formatAverageRating, formatNetVotes, normalizeAverageRating, normalizeStarRating, shouldShowVoteButtons } from '../utils/votes';

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

  test('formats net vote count with positive sign', () => {
    expect(formatNetVotes(3)).toBe('+3');
    expect(formatNetVotes(0)).toBe('0');
    expect(formatNetVotes(-2)).toBe('-2');
  });
});
