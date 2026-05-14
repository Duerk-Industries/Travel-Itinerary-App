import express from 'express';
import request from 'supertest';
import itineraryDataRoutes from '../src/routes/itineraryDataRoutes';
import * as auth from '../src/auth';
import * as db from '../src/db';
import * as entitlementService from '../src/services/entitlementService';

jest.mock('../src/auth');
jest.mock('../src/db');
jest.mock('../src/services/entitlementService');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/itineraries', itineraryDataRoutes);
  return app;
};

describe('Itinerary detail reaction routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth.authenticate as jest.Mock).mockImplementation((req, _res, next) => {
      (req as any).user = { userId: 'user-1' };
      next();
    });
    (entitlementService.isFeatureEnabled as jest.Mock).mockResolvedValue(true);
  });

  describe('POST /api/itineraries/details/:detailId/reactions', () => {
    test('allows a trip member to upvote and returns the updated summary', async () => {
      (db.getItineraryDetailContext as jest.Mock).mockResolvedValue({ tripId: 't1', itineraryId: 'i1' });
      (db.ensureUserInTrip as jest.Mock).mockResolvedValue({ groupId: 'g1' });
      (db.castItineraryDetailReaction as jest.Mock).mockResolvedValue(undefined);
      (db.getItineraryDetailReactionSummaries as jest.Mock).mockResolvedValue({
        d1: { score: 1, upCount: 1, downCount: 0, userValue: 1 },
      });

      const res = await request(buildApp())
        .post('/api/itineraries/details/d1/reactions')
        .send({ value: 1 })
        .expect(200);

      expect(db.castItineraryDetailReaction).toHaveBeenCalledWith('user-1', 't1', 'd1', 1);
      expect(res.body).toEqual({ score: 1, upCount: 1, downCount: 0, userValue: 1 });
    });

    test('flipping a vote re-uses the upsert and overwrites the previous value', async () => {
      (db.getItineraryDetailContext as jest.Mock).mockResolvedValue({ tripId: 't1', itineraryId: 'i1' });
      (db.ensureUserInTrip as jest.Mock).mockResolvedValue({ groupId: 'g1' });
      (db.castItineraryDetailReaction as jest.Mock).mockResolvedValue(undefined);
      (db.getItineraryDetailReactionSummaries as jest.Mock).mockResolvedValue({
        d1: { score: -1, upCount: 0, downCount: 1, userValue: -1 },
      });

      await request(buildApp()).post('/api/itineraries/details/d1/reactions').send({ value: -1 }).expect(200);

      expect(db.castItineraryDetailReaction).toHaveBeenCalledWith('user-1', 't1', 'd1', -1);
    });

    test('rejects invalid value', async () => {
      (db.getItineraryDetailContext as jest.Mock).mockResolvedValue({ tripId: 't1', itineraryId: 'i1' });
      (db.ensureUserInTrip as jest.Mock).mockResolvedValue({ groupId: 'g1' });

      await request(buildApp())
        .post('/api/itineraries/details/d1/reactions')
        .send({ value: 5 })
        .expect(400);
      expect(db.castItineraryDetailReaction).not.toHaveBeenCalled();
    });

    test('returns 404 when the detail does not exist', async () => {
      (db.getItineraryDetailContext as jest.Mock).mockResolvedValue(null);

      await request(buildApp())
        .post('/api/itineraries/details/missing/reactions')
        .send({ value: 1 })
        .expect(404);
      expect(db.castItineraryDetailReaction).not.toHaveBeenCalled();
    });

    test('blocks non-trip-members (followers) with 403', async () => {
      (db.getItineraryDetailContext as jest.Mock).mockResolvedValue({ tripId: 't1', itineraryId: 'i1' });
      (db.ensureUserInTrip as jest.Mock).mockResolvedValue(null);

      await request(buildApp())
        .post('/api/itineraries/details/d1/reactions')
        .send({ value: 1 })
        .expect(403);
      expect(db.castItineraryDetailReaction).not.toHaveBeenCalled();
    });

    test('returns 403 with FEATURE_DISABLED when the feature flag is off', async () => {
      (entitlementService.isFeatureEnabled as jest.Mock).mockResolvedValue(false);

      const res = await request(buildApp())
        .post('/api/itineraries/details/d1/reactions')
        .send({ value: 1 })
        .expect(403);

      expect(res.body.code).toBe('FEATURE_DISABLED');
      expect(db.castItineraryDetailReaction).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/itineraries/details/:detailId/reactions', () => {
    test('clears the user vote and returns an empty summary', async () => {
      (db.getItineraryDetailContext as jest.Mock).mockResolvedValue({ tripId: 't1', itineraryId: 'i1' });
      (db.ensureUserInTrip as jest.Mock).mockResolvedValue({ groupId: 'g1' });
      (db.clearItineraryDetailReaction as jest.Mock).mockResolvedValue(undefined);
      (db.getItineraryDetailReactionSummaries as jest.Mock).mockResolvedValue({
        d1: { score: 0, upCount: 0, downCount: 0, userValue: null },
      });

      const res = await request(buildApp())
        .delete('/api/itineraries/details/d1/reactions')
        .expect(200);

      expect(db.clearItineraryDetailReaction).toHaveBeenCalledWith('user-1', 'd1');
      expect(res.body).toEqual({ score: 0, upCount: 0, downCount: 0, userValue: null });
    });

    test('returns 403 when feature flag is off', async () => {
      (entitlementService.isFeatureEnabled as jest.Mock).mockResolvedValue(false);
      await request(buildApp()).delete('/api/itineraries/details/d1/reactions').expect(403);
      expect(db.clearItineraryDetailReaction).not.toHaveBeenCalled();
    });

    test('returns 403 for non-members', async () => {
      (db.getItineraryDetailContext as jest.Mock).mockResolvedValue({ tripId: 't1', itineraryId: 'i1' });
      (db.ensureUserInTrip as jest.Mock).mockResolvedValue(null);
      await request(buildApp()).delete('/api/itineraries/details/d1/reactions').expect(403);
      expect(db.clearItineraryDetailReaction).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/itineraries/details/:detailId/reactions', () => {
    test('returns summary for trip members', async () => {
      (db.getItineraryDetailContext as jest.Mock).mockResolvedValue({ tripId: 't1', itineraryId: 'i1' });
      (db.ensureUserCanReadTrip as jest.Mock).mockResolvedValue({ groupId: 'g1', access: 'member' });
      (db.getItineraryDetailReactionSummaries as jest.Mock).mockResolvedValue({
        d1: { score: 2, upCount: 3, downCount: 1, userValue: 1 },
      });

      const res = await request(buildApp()).get('/api/itineraries/details/d1/reactions').expect(200);
      expect(res.body).toEqual({ score: 2, upCount: 3, downCount: 1, userValue: 1 });
    });

    test('also returns summary for followers (read-only)', async () => {
      (db.getItineraryDetailContext as jest.Mock).mockResolvedValue({ tripId: 't1', itineraryId: 'i1' });
      (db.ensureUserCanReadTrip as jest.Mock).mockResolvedValue({ groupId: 'g1', access: 'follower' });
      (db.getItineraryDetailReactionSummaries as jest.Mock).mockResolvedValue({
        d1: { score: 1, upCount: 1, downCount: 0, userValue: null },
      });

      const res = await request(buildApp()).get('/api/itineraries/details/d1/reactions').expect(200);
      expect(res.body.userValue).toBeNull();
    });

    test('returns 403 for users with no access', async () => {
      (db.getItineraryDetailContext as jest.Mock).mockResolvedValue({ tripId: 't1', itineraryId: 'i1' });
      (db.ensureUserCanReadTrip as jest.Mock).mockResolvedValue(null);
      await request(buildApp()).get('/api/itineraries/details/d1/reactions').expect(403);
    });

    test('returns 404 when the detail is missing', async () => {
      (db.getItineraryDetailContext as jest.Mock).mockResolvedValue(null);
      await request(buildApp()).get('/api/itineraries/details/missing/reactions').expect(404);
    });
  });
});
