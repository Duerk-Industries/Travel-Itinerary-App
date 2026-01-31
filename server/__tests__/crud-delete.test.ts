import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb } from '../src/db';

describe('CRUD delete endpoints for flights, lodgings, tours, and trips', () => {
  jest.setTimeout(60000);
  const uniq = Date.now();
  const user = { email: `delete+${uniq}@example.com`, firstName: 'Delete', lastName: 'Tester', password: 'testtest' };
  let token: string;
  let groupId: string;
  let memberId: string;
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
    groupId = groups.body[0]?.id as string;
    expect(groupId).toBeTruthy();

    const members = await request(app).get(`/api/groups/${groupId}/members`).set('Authorization', `Bearer ${token}`).expect(200);
    memberId = members.body.find((m: any) => (m.email ?? m.userEmail) === user.email)?.id as string;
    expect(memberId).toBeTruthy();

    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Delete Trip ${uniq}`, groupId })
      .expect(201);
    tripId = tripRes.body.id as string;
    expect(tripId).toBeTruthy();
  });

  afterAll(async () => {
    await closePool();
  });

  it('creates and deletes a flight, lodging, and tour', async () => {
    const flightRes = await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${token}`)
      .send({
        passengerIds: [memberId],
        departureDate: '2026-05-10',
        departureTime: '08:00',
        arrivalTime: '10:00',
        tripId,
        cost: 100,
        carrier: '',
        flightNumber: '',
        bookingReference: '',
        paidBy: [memberId],
      })
      .expect(201);
    const flightId = flightRes.body.id as string;
    expect(flightId).toBeTruthy();

    const lodgingRes = await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        name: 'Delete Hotel',
        checkInDate: '2026-05-10',
        checkOutDate: '2026-05-12',
        rooms: '1',
        totalCost: '200',
        costPerNight: '100',
        paidBy: [memberId],
      })
      .expect(201);
    const lodgingId = lodgingRes.body.id as string;
    expect(lodgingId).toBeTruthy();

    const tourRes = await request(app)
      .post('/api/tours')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tripId,
        date: '2026-05-11',
        name: 'Delete Tour',
        startLocation: 'Test',
        startTime: '09:00',
        duration: '2h',
        cost: '50',
        paidBy: [memberId],
      })
      .expect(201);
    const tourId = tourRes.body.id as string;
    expect(tourId).toBeTruthy();

    await request(app).delete(`/api/flights/${flightId}`).set('Authorization', `Bearer ${token}`).expect(204);
    await request(app).delete(`/api/lodgings/${lodgingId}`).set('Authorization', `Bearer ${token}`).expect(204);
    await request(app).delete(`/api/tours/${tourId}`).set('Authorization', `Bearer ${token}`).expect(204);

    const flights = await request(app).get(`/api/flights?tripId=${tripId}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(flights.body).toHaveLength(0);
    const lodgings = await request(app).get(`/api/lodgings?tripId=${tripId}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(lodgings.body).toHaveLength(0);
    const tours = await request(app).get(`/api/tours?tripId=${tripId}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(tours.body).toHaveLength(0);
  });

  it('deletes a trip and removes it from the list', async () => {
    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Delete Trip 2 ${uniq}`, groupId })
      .expect(201);
    const deleteTripId = tripRes.body.id as string;

    await request(app).delete(`/api/trips/${deleteTripId}`).set('Authorization', `Bearer ${token}`).expect(204);

    const trips = await request(app).get('/api/trips').set('Authorization', `Bearer ${token}`).expect(200);
    const exists = (trips.body as any[]).some((t) => t.id === deleteTripId);
    expect(exists).toBe(false);
  });
});
