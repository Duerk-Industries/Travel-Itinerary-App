import request from 'supertest';
import { app } from '../src/app';
import * as auth from '../src/auth';
import * as db from '../src/db';
import * as placeService from '../src/services/placeService';
import * as locationServices from '../src/services/locationServices';

jest.mock('../src/auth');
jest.mock('../src/db');
jest.mock('../src/services/placeService', () => ({
  autocompletePlaces: jest.fn(),
  getPlaceDetailsFromGoogle: jest.fn(),
}));
jest.mock('../src/services/locationServices', () => ({
  searchCountryStateOptions: jest.fn(),
  searchCityOptions: jest.fn(),
  getLocationOptionsByIds: jest.fn(),
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

  it('returns country/state location options from JSON storage proxy', async () => {
    (locationServices.searchCountryStateOptions as jest.Mock).mockResolvedValue([
      { id: 'country:33', sourceType: 'country', name: 'France' },
    ]);
    const res = await request(app)
      .get('/api/places/location-options?kind=country_state&q=fra&limit=5')
      .expect(200);
    expect(res.body).toEqual([{ id: 'country:33', sourceType: 'country', name: 'France' }]);
    expect(locationServices.searchCountryStateOptions).toHaveBeenCalledWith('fra', 5);
  });

  it('returns city options filtered by selected locations', async () => {
    (locationServices.searchCityOptions as jest.Mock).mockResolvedValue([
      {
        id: 'city:1',
        sourceType: 'city',
        name: 'Paris',
        countryId: 'country:33',
        countryName: 'France',
        stateId: 'state:10',
        stateName: 'Ile-de-France',
      },
    ]);
    const res = await request(app)
      .get('/api/places/location-options?kind=city&q=par&countryIds=country:33&stateIds=state:10&limit=5')
      .expect(200);
    expect(res.body).toEqual([
      {
        id: 'city:1',
        sourceType: 'city',
        name: 'Paris',
        countryId: 'country:33',
        countryName: 'France',
        stateId: 'state:10',
        stateName: 'Ile-de-France',
      },
    ]);
    expect(locationServices.searchCityOptions).toHaveBeenCalledWith('par', {
      countryIds: ['country:33'],
      stateIds: ['state:10'],
      limit: 5,
    });
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

  it('does not call Google places for unknown non-local ids in batch request', async () => {
    (db.getLocationsByIds as jest.Mock).mockResolvedValue([]);

    const res = await request(app).post('/api/places/batch').send({ ids: ['new-place-1'] }).expect(200);

    expect(placeService.getPlaceDetailsFromGoogle).not.toHaveBeenCalled();
    expect(db.upsertLocation).not.toHaveBeenCalled();
    expect(res.body).toEqual([]);
  });

  it('falls back to id labels when local id resolution has transient network failure', async () => {
    (db.getLocationsByIds as jest.Mock).mockResolvedValue([]);
    (locationServices.getLocationOptionsByIds as jest.Mock).mockRejectedValue(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));

    const res = await request(app).post('/api/places/batch').send({ ids: ['city:123'] }).expect(200);

    expect(res.body).toEqual([
      {
        id: 'city:123',
        place_id: 'city:123',
        name: 'City 123',
      },
    ]);
  });
});
