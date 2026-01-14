import request from 'supertest';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { app } from '../src/app';
import { closePool, getPool, initDb } from '../src/db';

describe('Pending group members display names', () => {
  const owner = { email: 'pending-owner@example.com', firstName: 'Owner', lastName: 'Pending', password: 'testtest' };
  const invitee = { email: 'pending-invitee@example.com', firstName: 'Pending', lastName: 'Member', password: 'testtest' };
  const benEmail = 'ben.london@gmail.com';
  let pool: Pool;
  let ownerToken: string;
  let ownerId: string;
  let inviteeId: string;
  let groupId: string;

  beforeAll(async () => {
    pool = getPool();
    await initDb();
    await pool.query('DELETE FROM group_invites WHERE invitee_email IN ($1, $2, $3)', [owner.email, invitee.email, benEmail]);
    await pool.query('DELETE FROM group_members WHERE invite_email IN ($1, $2, $3)', [owner.email, invitee.email, benEmail]);
    await pool.query('DELETE FROM users WHERE email IN ($1, $2, $3)', [owner.email, invitee.email, benEmail]);

    const ownerRes = await request(app)
      .post('/api/auth/register')
      .send({ ...owner, passwordConfirm: owner.password })
      .expect(201);
    ownerToken = ownerRes.body.token;
    ownerId = ownerRes.body.user.id;

    const inviteeRes = await request(app)
      .post('/api/auth/register')
      .send({ ...invitee, passwordConfirm: invitee.password })
      .expect(201);
    inviteeId = inviteeRes.body.user.id;

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

    const inviteId = randomUUID();
    await pool.query(
      `INSERT INTO group_invites (id, group_id, inviter_id, invitee_user_id, invitee_email, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [inviteId, groupId, ownerId, inviteeId, invitee.email]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM group_invites WHERE invitee_email IN ($1, $2)', [owner.email, invitee.email]);
    await pool.query('DELETE FROM group_members WHERE invite_email IN ($1, $2)', [owner.email, invitee.email]);
    await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [owner.email, invitee.email]);
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
