/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb } from '../src/db';
import { registerAndLoginDeviceUser, cleanupTestUsersByEmail } from './helpers';

describe('Pending group members display names', () => {
  const owner = { email: 'pending-owner@example.com', firstName: 'Owner', lastName: 'Pending', password: 'testtest' };
  const invitee = { email: 'pending-invitee@example.com', firstName: 'Pending', lastName: 'Member', password: 'testtest' };
  const benEmail = 'ben.london@gmail.com';
  let ownerToken: string;
  let groupId: string;

  beforeAll(async () => {
    await initDb();
    await cleanupTestUsersByEmail([owner.email, invitee.email, benEmail]);

    const ownerLogin = await registerAndLoginDeviceUser(owner);
    ownerToken = ownerLogin.token;

    // Register invitee so they exist as a user
    await registerAndLoginDeviceUser(invitee);

    const groupsRes = await request(app).get('/api/groups').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    groupId = groupsRes.body[0]?.id as string;
    if (!groupId) {
      const created = await request(app)
        .post('/api/groups')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Pending Group', members: [] })
        .expect(201);
      groupId = created.body.id;
    }

    // Use the HTTP API to create a pending invite for the existing invitee user
    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: invitee.email })
      .expect(201);
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([owner.email, invitee.email, benEmail]);
    await closePool();
  });

  it('surfaces first and last names for pending members', async () => {
    const members = await request(app)
      .get(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const pending = members.body.find(
      (m: any) => m.status === 'pending' && (m.email ?? m.invitee_email) === invitee.email
    );
    expect(pending).toBeTruthy();
    expect(pending.firstName).toBe(invitee.firstName);
    expect(pending.lastName).toBe(invitee.lastName);
  });

  it('adds a pending member with provided names and email', async () => {
    const pendingName = { firstName: 'Ben', lastName: 'London', email: benEmail };
    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(pendingName)
      .expect(201);

    const members = await request(app)
      .get(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const ben = members.body.find((m: any) => (m.email ?? m.invitee_email) === pendingName.email);
    expect(ben).toBeTruthy();
    expect(ben.firstName).toBe('Ben');
    expect(ben.lastName).toBe('London');
  });

  it('rejects whitespace-only names on registration', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ firstName: '   ', lastName: 'User', email: 'bad-names@example.com', password: 'testtest', passwordConfirm: 'testtest' })
      .expect(400);
  });

  it('rejects blank pending member names when provided', async () => {
    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: 'blank.names@example.com', firstName: '   ', lastName: '' })
      .expect(400);
  });
});
