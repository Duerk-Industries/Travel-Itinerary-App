/// <reference types="jest" />
/// <reference types="node" />
import express from 'express';
import request from 'supertest';
import flightRoutes from '../src/routes/transferRoutes';
import lodgingRoutes from '../src/routes/lodgingRoutes';
import activityRoutes from '../src/routes/activityRoutes';
import carRentalRoutes from '../src/routes/carRentalRoutes';
import * as auth from '../src/auth';
import * as db from '../src/db';

jest.mock('../src/auth');
jest.mock('../src/db');

describe('Item vote routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth.authenticate as jest.Mock).mockImplementation((req, _res, next) => {
      (req as any).user = { userId: 'user-1' };
      next();
    });
    // `db` is auto-mocked for this file; activityRoutes' GET / reserves API usage via
    // reserveApiUsageOrThrow, which calls this counter under the hood. Without a
    // resolved return value the auto-mock resolves to `undefined` and the route 500s.
    (db.atomicIncrementApiUsageIfUnderLimit as jest.Mock).mockResolvedValue({ allowed: true, newCount: 1 });
  });

  const appFor = (path: string, router: any) => {
    const app = express();
    app.use(express.json());
    app.use(path, router);
    return app;
  };

  test.each([
    ['/api/transfers', flightRoutes],
    ['/api/flights', flightRoutes],
    ['/api/lodgings', lodgingRoutes],
    ['/api/activities', activityRoutes],
    ['/api/car-rentals', carRentalRoutes],
  ])('retires proposal voting at %s', async (path, router) => {
    const app = appFor(path, router);
    await request(app).post(`${path}/item/vote`).send({ value: 1 }).expect(410);
    expect(db.castItemVote).not.toHaveBeenCalled();
  });

  test('allows rating on completed flight', async () => {
    (db.getFlightById as jest.Mock).mockResolvedValue({ id: 'f1', tripId: 't1', status: 'Completed' });
    (db.ensureUserInTrip as jest.Mock).mockResolvedValue({ groupId: 'g1' });
    (db.castItemVote as jest.Mock).mockResolvedValue(undefined);
    (db.getItemVoteSummaries as jest.Mock).mockResolvedValue({ f1: { netVotes: -1, userVote: -1 } });

    const app = appFor('/api/transfers', flightRoutes);
    const res = await request(app).post('/api/transfers/f1/rating').send({ value: -1 }).expect(200);

    expect(db.castItemVote).toHaveBeenCalledWith('user-1', 't1', 'flight', 'f1', -1, 'rating');
    expect(res.body).toEqual({ itemId: 'f1', netRating: -1, userRating: -1 });
  });

  test('rejects rating when item is not completed', async () => {
    (db.getActivityById as jest.Mock).mockResolvedValue({ id: 'to1', tripId: 't1', status: 'Booked' });
    (db.ensureUserInTrip as jest.Mock).mockResolvedValue({ groupId: 'g1' });

    const app = appFor('/api/activities', activityRoutes);
    await request(app).post('/api/activities/to1/rating').send({ value: 1 }).expect(400);
    expect(db.castItemVote).not.toHaveBeenCalled();
  });
});


