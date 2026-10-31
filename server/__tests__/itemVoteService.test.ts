import { applyVoteSummary, getItemRatingSummaries } from '../src/services/itemVoteService';
import * as db from '../src/db';

jest.mock('../src/db');

describe('applyVoteSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns legacy Needed records as Proposed without changing the saved item', async () => {
    (db.getItemVoteSummaries as jest.Mock).mockResolvedValue({});
    const saved = { id: 'legacy', status: 'Needed' };
    const [item] = await applyVoteSummary('user-1', 'trip-1', 'lodging', [saved]);
    expect(item.status).toBe('Proposed');
    expect(saved.status).toBe('Needed');
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
      averageRating: null,
      ratingCount: 0,
      userStars: null,
      netRating: 0,
      userRating: null,
    });
  });

  it('applies saved rating metadata through the same normalized lookup', async () => {
    (db.getItemVoteSummaries as jest.Mock)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': { netVotes: 0, userVote: null, upVoterIds: [], downVoterIds: [] },
      });
    (db.listItemRatings as jest.Mock).mockResolvedValue([{ itemId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', userId: 'user-1', stars: 2 }]);

    const [item] = await applyVoteSummary('user-1', 'trip-1', 'activity', [
      { id: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB', name: 'Museum' },
    ]);

    expect(item).toMatchObject({
      id: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB',
      netVotes: 0,
      userVote: null,
      averageRating: 2,
      ratingCount: 1,
      userStars: 2,
      netRating: -1,
      userRating: -1,
    });
  });
});

describe('getItemRatingSummaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('counts earlier thumbs as 5 stars up and 1 star down', async () => {
    (db.getItemVoteSummaries as jest.Mock).mockResolvedValue({ i1: { upVoterIds: ['a', 'b'], downVoterIds: ['c'] } });
    (db.listItemRatings as jest.Mock).mockResolvedValue([]);

    expect((await getItemRatingSummaries('a', 't1', 'activity', ['i1'])).i1).toEqual({
      averageRating: 3.7,
      ratingCount: 3,
      userStars: 5,
      netRating: 1,
      userRating: 1,
    });
  });

  it("uses a traveler's stars in place of their earlier thumb, without counting them twice", async () => {
    (db.getItemVoteSummaries as jest.Mock).mockResolvedValue({ i1: { upVoterIds: ['a'], downVoterIds: [] } });
    (db.listItemRatings as jest.Mock).mockResolvedValue([{ itemId: 'i1', userId: 'a', stars: 2 }]);

    expect((await getItemRatingSummaries('a', 't1', 'activity', ['i1'])).i1).toEqual({
      averageRating: 2,
      ratingCount: 1,
      userStars: 2,
      netRating: -1,
      userRating: -1,
    });
  });
});
