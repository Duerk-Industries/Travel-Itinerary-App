/// <reference types="jest" />
/// <reference types="node" />
import express from 'express';
import request from 'supertest';
import itineraryDataRoutes from '../src/routes/itineraryDataRoutes';
import * as auth from '../src/auth';
import * as db from '../src/db';

jest.mock('../src/auth');
jest.mock('../src/db');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/itineraries', itineraryDataRoutes);
  return app;
};

describe('GET /api/itineraries/:id/details inlines reaction summaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth.authenticate as jest.Mock).mockImplementation((req, _res, next) => {
      (req as any).user = { userId: 'user-1' };
      next();
    });
  });

  test('attaches a reaction summary to every detail row', async () => {
    (db.listItineraryDetails as jest.Mock).mockResolvedValue([
      { id: 'd1', itineraryId: 'i1', day: 1, time: '09:00', activity: 'Visit Hagia Sophia', cost: null },
      { id: 'd2', itineraryId: 'i1', day: 1, time: '13:00', activity: 'Lunch', cost: 30 },
    ]);
    (db.getItineraryDetailReactionSummaries as jest.Mock).mockResolvedValue({
      d1: { score: 2, upCount: 2, downCount: 0, userValue: 1 },
      d2: { score: 0, upCount: 0, downCount: 0, userValue: null },
    });

    const res = await request(buildApp()).get('/api/itineraries/i1/details').expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: 'd1', reactions: { score: 2, upCount: 2, downCount: 0, userValue: 1 } });
    expect(res.body[1]).toMatchObject({ id: 'd2', reactions: { score: 0, upCount: 0, downCount: 0, userValue: null } });
    expect(db.getItineraryDetailReactionSummaries).toHaveBeenCalledTimes(1);
    expect(db.getItineraryDetailReactionSummaries).toHaveBeenCalledWith('user-1', ['d1', 'd2']);
  });

  test('falls back to a zero summary when an id is missing from the result map', async () => {
    (db.listItineraryDetails as jest.Mock).mockResolvedValue([
      { id: 'd1', itineraryId: 'i1', day: 1, time: null, activity: 'Walk', cost: null },
    ]);
    (db.getItineraryDetailReactionSummaries as jest.Mock).mockResolvedValue({});

    const res = await request(buildApp()).get('/api/itineraries/i1/details').expect(200);
    expect(res.body[0].reactions).toEqual({ score: 0, upCount: 0, downCount: 0, userValue: null });
  });

  test('returns an empty list without calling the summary fetch when there are no details', async () => {
    (db.listItineraryDetails as jest.Mock).mockResolvedValue([]);

    const res = await request(buildApp()).get('/api/itineraries/i1/details').expect(200);
    expect(res.body).toEqual([]);
    expect(db.getItineraryDetailReactionSummaries).not.toHaveBeenCalled();
  });
});
