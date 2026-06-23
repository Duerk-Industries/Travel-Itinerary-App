/// <reference types="jest" />
/// <reference types="node" />
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

describe('Itinerary detail kinds — POST /api/itineraries/:id/details', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth.authenticate as jest.Mock).mockImplementation((req, _res, next) => {
      (req as any).user = { userId: 'user-1' };
      next();
    });
    (entitlementService.isFeatureEnabled as jest.Mock).mockResolvedValue(true);
  });

  test('creates an activity-kind row when kind is omitted (default behaviour preserved)', async () => {
    (db.addItineraryDetail as jest.Mock).mockImplementation(async (_uid, _itineraryId, payload) => ({
      id: 'd1',
      itineraryId: 'i1',
      ...payload,
      kind: payload.kind ?? 'activity',
    }));

    const res = await request(buildApp())
      .post('/api/itineraries/i1/details')
      .send({ day: 1, activity: 'Walk' })
      .expect(201);

    expect(res.body.kind).toBe('activity');
    expect(db.addItineraryDetail).toHaveBeenCalledWith(
      'user-1',
      'i1',
      expect.objectContaining({ kind: 'activity', activity: 'Walk', placeId: null, noteBody: null }),
    );
  });

  test('creates a place-kind row with placeId text', async () => {
    (db.addItineraryDetail as jest.Mock).mockImplementation(async (_uid, _itineraryId, payload) => ({
      id: 'd2',
      itineraryId: 'i1',
      ...payload,
    }));

    const res = await request(buildApp())
      .post('/api/itineraries/i1/details')
      .send({ day: 1, activity: 'Hagia Sophia', kind: 'place', placeId: 'ChIJabc123' })
      .expect(201);

    expect(res.body.kind).toBe('place');
    expect(db.addItineraryDetail).toHaveBeenCalledWith(
      'user-1',
      'i1',
      expect.objectContaining({ kind: 'place', placeId: 'ChIJabc123', activity: 'Hagia Sophia' }),
    );
  });

  test('creates a note-kind row with noteBody', async () => {
    (db.addItineraryDetail as jest.Mock).mockImplementation(async (_uid, _itineraryId, payload) => ({
      id: 'd3',
      itineraryId: 'i1',
      ...payload,
    }));

    const res = await request(buildApp())
      .post('/api/itineraries/i1/details')
      .send({ day: 1, activity: 'Reminders', kind: 'note', noteBody: 'Pack umbrella.\nBuy SIM.' })
      .expect(201);

    expect(res.body.kind).toBe('note');
    expect(db.addItineraryDetail).toHaveBeenCalledWith(
      'user-1',
      'i1',
      expect.objectContaining({ kind: 'note', noteBody: 'Pack umbrella.\nBuy SIM.' }),
    );
  });

  test('creates a checklist-kind row with children atomically', async () => {
    (db.addItineraryDetail as jest.Mock).mockImplementation(async (_uid, _itineraryId, payload) => ({
      id: 'd4',
      itineraryId: 'i1',
      ...payload,
      checklistItems: payload.checklistItems?.map((c: any, idx: number) => ({
        id: `c${idx}`,
        detailId: 'd4',
        position: idx,
        label: c.label,
        checkedBy: null,
        checkedAt: null,
        createdAt: '2026-04-25T00:00:00Z',
      })),
    }));

    const res = await request(buildApp())
      .post('/api/itineraries/i1/details')
      .send({
        day: 2,
        activity: 'Packing list',
        kind: 'checklist',
        checklistItems: [{ label: 'Passport' }, { label: 'Medicine' }],
      })
      .expect(201);

    expect(res.body.kind).toBe('checklist');
    expect(res.body.checklistItems).toHaveLength(2);
    expect(db.addItineraryDetail).toHaveBeenCalledWith(
      'user-1',
      'i1',
      expect.objectContaining({
        kind: 'checklist',
        checklistItems: [{ label: 'Passport' }, { label: 'Medicine' }],
      }),
    );
  });

  test('rejects an invalid kind with 400', async () => {
    await request(buildApp())
      .post('/api/itineraries/i1/details')
      .send({ day: 1, activity: 'Walk', kind: 'video' })
      .expect(400);
    expect(db.addItineraryDetail).not.toHaveBeenCalled();
  });

  test('rejects checklist with empty-label children with 400', async () => {
    await request(buildApp())
      .post('/api/itineraries/i1/details')
      .send({ day: 1, activity: 'Empty', kind: 'checklist', checklistItems: [{ label: '' }] })
      .expect(400);
    expect(db.addItineraryDetail).not.toHaveBeenCalled();
  });

  test('returns 403 FEATURE_DISABLED when kind is provided but flag is off', async () => {
    (entitlementService.isFeatureEnabled as jest.Mock).mockResolvedValue(false);

    const res = await request(buildApp())
      .post('/api/itineraries/i1/details')
      .send({ day: 1, activity: 'Hagia Sophia', kind: 'place' })
      .expect(403);

    expect(res.body.code).toBe('FEATURE_DISABLED');
    expect(db.addItineraryDetail).not.toHaveBeenCalled();
  });

  test('still allows plain activity-kind add when flag is off (legacy path preserved)', async () => {
    (entitlementService.isFeatureEnabled as jest.Mock).mockResolvedValue(false);
    (db.addItineraryDetail as jest.Mock).mockResolvedValue({
      id: 'd5',
      itineraryId: 'i1',
      day: 1,
      activity: 'Legacy',
      kind: 'activity',
    });

    await request(buildApp())
      .post('/api/itineraries/i1/details')
      .send({ day: 1, activity: 'Legacy' })
      .expect(201);

    expect(db.addItineraryDetail).toHaveBeenCalled();
  });
});
