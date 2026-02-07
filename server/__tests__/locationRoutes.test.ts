import request from 'supertest';
import { app } from '../src/app';
import * as auth from '../src/auth';
import * as db from '../src/db';

jest.mock('../src/auth');
jest.mock('../src/db');

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
});
