/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import { registerAndLoginWebUser } from './helpers';

// Item lists carry thumbs-up/down counts and who voted each way, so clients can show voter
// avatars next to the counts — not just the net total.
describe('vote summaries include per-direction counts and voter ids', () => {
  const uniq = Date.now();
  const userA = { email: `voters-a+${uniq}@example.com`, firstName: 'Ava', lastName: 'Voter', password: 'testtest' };
  const userB = { email: `voters-b+${uniq}@example.com`, firstName: 'Ben', lastName: 'Voter', password: 'testtest' };
  let a: { token: string; userId: string };
  let b: { token: string; userId: string };
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    a = await registerAndLoginWebUser(userA);
    b = await registerAndLoginWebUser(userB);

    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${a.token}`).expect(200);
    const groupId = groups.body[0]?.id as string;
    const trip = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: `Voters Trip ${uniq}`, groupId })
      .expect(201);
    tripId = trip.body.id as string;

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ email: userB.email })
      .expect(201);
    const invites = await request(app).get('/api/groups/invites').set('Authorization', `Bearer ${b.token}`).expect(200);
    for (const invite of invites.body ?? []) {
      await request(app).post(`/api/groups/invites/${invite.id}/accept`).set('Authorization', `Bearer ${b.token}`).expect(204);
    }
  });

  afterAll(async () => {
    await closePool();
  });

  it('returns upVotes/downVotes and the voters for each lodging', async () => {
    const lodging = await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ tripId, status: 'Proposed', name: 'Option A', checkInDate: '2030-05-01', checkOutDate: '2030-05-03', totalCost: 400 })
      .expect(201);
    const lodgingId = lodging.body.id as string;

    await request(app).post(`/api/lodgings/${lodgingId}/vote`).set('Authorization', `Bearer ${a.token}`).send({ value: 1 }).expect(200);
    await request(app).post(`/api/lodgings/${lodgingId}/vote`).set('Authorization', `Bearer ${b.token}`).send({ value: -1 }).expect(200);

    const list = await request(app).get(`/api/lodgings?tripId=${tripId}`).set('Authorization', `Bearer ${a.token}`).expect(200);
    const row = list.body.find((l: any) => l.id === lodgingId);
    expect(row).toMatchObject({ netVotes: 0, userVote: 1, upVotes: 1, downVotes: 1 });
    expect(row.upVoterIds).toEqual([a.userId]);
    expect(row.downVoterIds).toEqual([b.userId]);
  });
});
