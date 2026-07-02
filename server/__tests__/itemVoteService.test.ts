import { applyVoteSummary } from '../src/services/itemVoteService';
import * as db from '../src/db';

jest.mock('../src/db');

describe('applyVoteSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies saved vote metadata even when the adapter normalizes item id casing', async () => {
    (db.getItemVoteSummaries as jest.Mock)
      .mockResolvedValueOnce({
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': { netVotes: 1, userVote: 1 },
      })
      .mockResolvedValueOnce({});

    const [item] = await applyVoteSummary('user-1', 'trip-1', 'flight', [
      { id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', carrier: 'Test Air' },
    ]);

    expect(item).toMatchObject({
      id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',
      netVotes: 1,
      userVote: 1,
      netRating: 0,
      userRating: null,
    });
  });

  it('applies saved rating metadata through the same normalized lookup', async () => {
    (db.getItemVoteSummaries as jest.Mock)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': { netVotes: -1, userVote: -1 },
      });

    const [item] = await applyVoteSummary('user-1', 'trip-1', 'activity', [
      { id: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB', name: 'Museum' },
    ]);

    expect(item).toMatchObject({
      id: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB',
      netVotes: 0,
      userVote: null,
      netRating: -1,
      userRating: -1,
    });
  });
});
