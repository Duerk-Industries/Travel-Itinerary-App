import { applyVoteSummary } from '../src/services/itemVoteService';
import * as db from '../src/db';

jest.mock('../src/db');

describe('applyVoteSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.getStarRatingSummaries as jest.Mock).mockResolvedValue({});
  });

  it('returns legacy Needed records as Proposed without changing the saved item', async () => {
    (db.getItemVoteSummaries as jest.Mock).mockResolvedValue({});
    const saved = { id: 'legacy', status: 'Needed' };
    const [item] = await applyVoteSummary('user-1', 'trip-1', 'lodging', [saved]);
    expect(item.status).toBe('Proposed');
    expect(saved.status).toBe('Needed');
  });

  it('applies saved vote metadata even when the adapter normalizes item id casing', async () => {
    (db.getItemVoteSummaries as jest.Mock).mockResolvedValue({
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': { netVotes: 1, userVote: 1 },
    });
    (db.getStarRatingSummaries as jest.Mock).mockResolvedValue({});

    const [item] = await applyVoteSummary('user-1', 'trip-1', 'flight', [
      { id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', carrier: 'Test Air' },
    ]);

    expect(item).toMatchObject({
      id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',
      netVotes: 1,
      userVote: 1,
      averageRating: null,
      userRating: null,
    });
  });

  it('adds the provider average and the traveler\'s own stars, rounded, without the count behind them', async () => {
    (db.getItemVoteSummaries as jest.Mock).mockResolvedValue({});
    (db.getStarRatingSummaries as jest.Mock).mockResolvedValue({
      'act-1': { average: 4.3333333, count: 3, userStars: 5 },
      'act-2': { average: null, count: 0, userStars: null },
    });

    const [rated, unrated] = await applyVoteSummary('user-1', 'trip-1', 'activity', [
      { id: 'act-1', name: 'Museum', catalogId: 'Louvre' },
      { id: 'act-2', name: 'Walk' },
    ]);

    expect(rated).toMatchObject({ averageRating: 4.33, userRating: 5 });
    expect(unrated).toMatchObject({ averageRating: null, userRating: null });
    expect(rated).not.toHaveProperty('ratingCount');
    expect(db.getStarRatingSummaries).toHaveBeenCalledWith('user-1', 'activity', [
      { itemId: 'act-1', providerKey: 'catalog:louvre' },
      { itemId: 'act-2', providerKey: 'name:walk' },
    ]);
  });
});
