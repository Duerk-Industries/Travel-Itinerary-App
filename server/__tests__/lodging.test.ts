// c:\Git\Tristan\Travel-Itinerary-App\server\__tests__\lodging.test.ts

import request from 'supertest';

jest.mock('../src/googlePlaces', () => ({
  findPlacePhoto: jest.fn().mockResolvedValue('https://example.com/mock-lodging.jpg'),
}));

// Also mock image-service in case the controller uses it
jest.mock('../src/image-service', () => ({
  getGooglePlaceImage: jest.fn().mockResolvedValue('https://example.com/mock-lodging.jpg'),
}));

import { app } from '../src/app';
import { closePool, initDb } from '../src/db';

describe('Lodging creation with image URL', () => {
  const uniq = Date.now();
  const user = { email: `lodging+${uniq}@example.com`, firstName: 'Lodging', lastName: 'Tester', password: 'testtest' };
  let token: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();

    const reg = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: user.firstName, lastName: user.lastName, email: user.email, password: user.password, passwordConfirm: user.password })
      .expect(201);
    token = reg.body.token as string;

    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${token}`).expect(200);
    const groupId = groups.body[0]?.id as string;
    expect(groupId).toBeTruthy();

    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Lodging Trip ${uniq}`, groupId })
      .expect(201);
    tripId = tripRes.body.id as string;
  });

  afterAll(async () => {
    await closePool();
  });

  it('should create a new lodging with an image URL', async () => {
    const newLodging = {
      name: 'Test Hotel',
      checkInDate: '2026-01-01',
      checkOutDate: '2026-01-05',
      tripId,
      rooms: 1,
      totalCost: 200,
      costPerNight: 50,
      address: '123 Test St',
    };

    const response = await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${token}`)
      .send(newLodging)
      .expect(201);

    expect(response.body.name).toBe(newLodging.name);
    expect(response.body.imageUrl).toBe('https://example.com/mock-lodging.jpg');
  });
});
