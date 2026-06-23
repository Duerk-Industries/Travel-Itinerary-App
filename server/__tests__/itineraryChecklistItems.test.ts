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

describe('Itinerary checklist-item routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth.authenticate as jest.Mock).mockImplementation((req, _res, next) => {
      (req as any).user = { userId: 'user-1' };
      next();
    });
    (entitlementService.isFeatureEnabled as jest.Mock).mockResolvedValue(true);
  });

  describe('POST /details/:detailId/checklist-items', () => {
    test('appends a child item to a checklist parent', async () => {
      (db.addItineraryChecklistItem as jest.Mock).mockResolvedValue({
        id: 'c1',
        detailId: 'd1',
        position: 0,
        label: 'Passport',
        checkedBy: null,
        checkedAt: null,
        createdAt: '2026-04-25T00:00:00Z',
      });
      const res = await request(buildApp())
        .post('/api/itineraries/details/d1/checklist-items')
        .send({ label: 'Passport' })
        .expect(201);
      expect(res.body.label).toBe('Passport');
      expect(db.addItineraryChecklistItem).toHaveBeenCalledWith('user-1', 'd1', { label: 'Passport', position: undefined });
    });

    test('rejects empty labels with 400', async () => {
      await request(buildApp())
        .post('/api/itineraries/details/d1/checklist-items')
        .send({ label: '   ' })
        .expect(400);
      expect(db.addItineraryChecklistItem).not.toHaveBeenCalled();
    });

    test('returns 403 FEATURE_DISABLED when flag is off', async () => {
      (entitlementService.isFeatureEnabled as jest.Mock).mockResolvedValue(false);
      await request(buildApp())
        .post('/api/itineraries/details/d1/checklist-items')
        .send({ label: 'X' })
        .expect(403);
      expect(db.addItineraryChecklistItem).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /checklist-items/:itemId', () => {
    test('toggles checked = true and the server records who checked it', async () => {
      (db.updateItineraryChecklistItem as jest.Mock).mockResolvedValue({
        id: 'c1',
        detailId: 'd1',
        position: 0,
        label: 'Passport',
        checkedBy: 'user-1',
        checkedAt: '2026-04-25T01:00:00Z',
        createdAt: '2026-04-25T00:00:00Z',
      });
      const res = await request(buildApp())
        .patch('/api/itineraries/checklist-items/c1')
        .send({ checked: true })
        .expect(200);
      expect(res.body.checkedBy).toBe('user-1');
      expect(db.updateItineraryChecklistItem).toHaveBeenCalledWith('user-1', 'c1', { checked: true });
    });

    test('toggles checked = false and clears checkedBy/checkedAt', async () => {
      (db.updateItineraryChecklistItem as jest.Mock).mockResolvedValue({
        id: 'c1',
        detailId: 'd1',
        position: 0,
        label: 'Passport',
        checkedBy: null,
        checkedAt: null,
        createdAt: '2026-04-25T00:00:00Z',
      });
      const res = await request(buildApp())
        .patch('/api/itineraries/checklist-items/c1')
        .send({ checked: false })
        .expect(200);
      expect(res.body.checkedBy).toBeNull();
    });

    test('updates label', async () => {
      (db.updateItineraryChecklistItem as jest.Mock).mockResolvedValue({
        id: 'c1',
        detailId: 'd1',
        position: 0,
        label: 'New label',
        checkedBy: null,
        checkedAt: null,
        createdAt: '2026-04-25T00:00:00Z',
      });
      await request(buildApp())
        .patch('/api/itineraries/checklist-items/c1')
        .send({ label: 'New label' })
        .expect(200);
      expect(db.updateItineraryChecklistItem).toHaveBeenCalledWith('user-1', 'c1', { label: 'New label' });
    });

    test('rejects empty label with 400', async () => {
      await request(buildApp())
        .patch('/api/itineraries/checklist-items/c1')
        .send({ label: '' })
        .expect(400);
      expect(db.updateItineraryChecklistItem).not.toHaveBeenCalled();
    });

    test('returns 403 when flag is off', async () => {
      (entitlementService.isFeatureEnabled as jest.Mock).mockResolvedValue(false);
      await request(buildApp())
        .patch('/api/itineraries/checklist-items/c1')
        .send({ checked: true })
        .expect(403);
      expect(db.updateItineraryChecklistItem).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /checklist-items/:itemId', () => {
    test('deletes a checklist child', async () => {
      (db.deleteItineraryChecklistItem as jest.Mock).mockResolvedValue(undefined);
      await request(buildApp()).delete('/api/itineraries/checklist-items/c1').expect(204);
      expect(db.deleteItineraryChecklistItem).toHaveBeenCalledWith('user-1', 'c1');
    });

    test('returns 403 when flag is off', async () => {
      (entitlementService.isFeatureEnabled as jest.Mock).mockResolvedValue(false);
      await request(buildApp()).delete('/api/itineraries/checklist-items/c1').expect(403);
      expect(db.deleteItineraryChecklistItem).not.toHaveBeenCalled();
    });
  });
});
