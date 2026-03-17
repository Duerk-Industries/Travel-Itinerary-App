import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb } from '../src/db';
import { registerAndLoginWebUser, cleanupTestUsersByEmail } from './helpers';

describe('Trip wizard flow', () => {
  let token: string;
  const owner = { email: 'wizard-owner@example.com', firstName: 'Wizard', lastName: 'Owner', password: 'testtest' };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await cleanupTestUsersByEmail([owner.email]);

    const login = await registerAndLoginWebUser(owner);
    token = login.token;
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([owner.email]);
    await closePool();
  });

  it('creates a trip, group, invites, and fellow travelers', async () => {
    const create = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Trip',
        description: 'A **bold** trip',
        locationIds: ['paris-abc123', 'london-def456'],
        startDate: '2027-03-01',
        endDate: '2027-03-05',
        participants: [
          { firstName: 'Casey', lastName: 'Guest' },
          { firstName: 'Pat', lastName: 'Invite', email: 'pat-invite@example.com' },
        ],
      })
      .expect(201);

    expect(create.body.trip).toBeTruthy();
    expect(create.body.trip.locationIds).toEqual(['paris-abc123', 'london-def456']);
    expect(create.body.invites.length).toBe(1);
    expect(create.body.invites[0].email).toBe('pat-invite@example.com');

    const fellow = await request(app)
      .get('/api/account/fellow-travelers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const hasGuest = fellow.body.some((t: any) => t.firstName === 'Casey' && t.lastName === 'Guest');
    expect(hasGuest).toBe(true);

    const search = await request(app)
      .get('/api/trips/participants/search?q=casey')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const hasSearch = search.body.some((t: any) => t.firstName === 'Casey' && t.lastName === 'Guest');
    expect(hasSearch).toBe(true);
  });

  it('requires a trip name', async () => {
    await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${token}`)
      .send({ participants: [{ firstName: 'Sam', lastName: 'Name' }] })
      .expect(400);
  });

  it('requires participant names', async () => {
    await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'No Names Trip', participants: [{ firstName: 'Sam', lastName: '' }] })
      .expect(400);
  });

  it('rejects duplicate participant emails', async () => {
    await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Dup Email Trip',
        participants: [
          { firstName: 'Sam', lastName: 'Dup', email: 'dup@example.com' },
          { firstName: 'Alex', lastName: 'Dup', email: 'dup@example.com' },
        ],
      })
      .expect(400);
  });
});
