import request from 'supertest';
import { app } from '../src/app';
import * as auth from '../src/auth';
import * as db from '../src/db';
import * as placeService from '../src/services/placeService';

jest.mock('../src/auth');
jest.mock('../src/db');
jest.mock('../src/services/placeService', () => ({
  autocompletePlaces: jest.fn(),
  getPlaceDetailsFromGoogle: jest.fn(),
}));

describe('/api/places location endpoints', () => {
  beforeEach(() => {
    (auth.authenticate as jest.Mock).mockImplementation((req, _res, next) => {
      (req as any).user = { userId: 'user-1' };
      next();
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('searches locations', async () => {
    (db.searchLocations as jest.Mock).mockResolvedValue([
      { id: 'rome-1', sourceType: 'city', name: 'Rome', address: 'Italy' },
    ]);
    const res = await request(app).get('/api/places/search?q=rom').expect(200);
    expect(res.body).toHaveLength(1);
    expect(db.searchLocations).toHaveBeenCalledWith('user-1', 'rom', undefined, 15);
  });

  it('returns batched locations by ids', async () => {
    (db.getLocationsByIds as jest.Mock).mockResolvedValue([
      { id: 'rome-1', sourceType: 'city', name: 'Rome', address: 'Italy' },
      { id: 'milan-1', sourceType: 'city', name: 'Milan', address: 'Italy' },
    ]);
    const res = await request(app)
      .post('/api/places/batch')
      .send({ ids: ['rome-1', 'milan-1'] })
      .expect(200);
    expect(res.body).toHaveLength(2);
    expect(db.getLocationsByIds).toHaveBeenCalledWith('user-1', ['rome-1', 'milan-1']);
  });

  it('caches missing locations in batch request', async () => {
    (db.getLocationsByIds as jest.Mock).mockResolvedValue([]);
    (placeService.getPlaceDetailsFromGoogle as jest.Mock).mockResolvedValue({
      place_id: 'new-place-1',
      name: 'New Place',
      formatted_address: 'Address',
      geometry: { location: { lat: 10, lng: 20 } },
      types: ['point_of_interest'],
    });
    (db.upsertLocation as jest.Mock).mockResolvedValue({
      id: 'new-place-1',
      name: 'New Place',
    });

    const res = await request(app).post('/api/places/batch').send({ ids: ['new-place-1'] }).expect(200);
    
    expect(placeService.getPlaceDetailsFromGoogle).toHaveBeenCalledWith('new-place-1');
    expect(db.upsertLocation).toHaveBeenCalled();
    expect(res.body).toHaveLength(1);
  });
});
