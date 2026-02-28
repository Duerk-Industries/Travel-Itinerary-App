import { formatNetVotes, shouldShowRatingButtons, shouldShowVoteButtons } from '../utils/votes';

describe('votes utils', () => {
  test('shows vote buttons only for proposed items with no user vote', () => {
    expect(shouldShowVoteButtons('Proposed', null)).toBe(true);
    expect(shouldShowVoteButtons('Proposed', 1)).toBe(false);
    expect(shouldShowVoteButtons('Booked', null)).toBe(false);
  });

  test('shows rating buttons only for completed items with no user rating', () => {
    expect(shouldShowRatingButtons('Completed', null)).toBe(true);
    expect(shouldShowRatingButtons('Completed', -1)).toBe(false);
    expect(shouldShowRatingButtons('Proposed', null)).toBe(false);
  });

  test('formats net vote count with positive sign', () => {
    expect(formatNetVotes(3)).toBe('+3');
    expect(formatNetVotes(0)).toBe('0');
    expect(formatNetVotes(-2)).toBe('-2');
  });
});
