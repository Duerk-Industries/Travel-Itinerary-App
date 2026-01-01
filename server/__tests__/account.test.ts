import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';

describe('Password validation', () => {
  let pool: Pool;
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email LIKE $1', ['password-test+%@example.com']);
    await pool.end();
  });

  it('rejects registration when passwords do not match', async () => {
    await request(app)
      .post('/api/web-auth/register')
      .send({
        firstName: 'Mismatch',
        lastName: 'User',
        email: 'password-test+mismatch@example.com',
        password: 'testtest',
        passwordConfirm: 'testtest1',
      })
      .expect(400);
  });

  it('requires correct current password and matching confirms when changing password', async () => {
    const email = 'password-test+change@example.com';
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
    const reg = await request(app)
      .post('/api/web-auth/register')
      .send({
        firstName: 'Change',
        lastName: 'User',
        email,
        password: 'oldpass',
        passwordConfirm: 'oldpass',
      })
      .expect(201);
    const token = reg.body.token as string;

    await request(app)
      .patch('/api/account/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrong', newPassword: 'newpass1', newPasswordConfirm: 'newpass1' })
      .expect(401);

    await request(app)
      .patch('/api/account/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'oldpass', newPassword: 'newpass1', newPasswordConfirm: 'newpass2' })
      .expect(400);

    await request(app)
      .patch('/api/account/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'oldpass', newPassword: 'newpass1', newPasswordConfirm: 'newpass1' })
      .expect(200);

    await request(app)
      .post('/api/web-auth/login')
      .send({ email, password: 'newpass1' })
      .expect(200);
  });
});

describe('Family relationships', () => {
  const owner = { email: 'family-owner@example.com', firstName: 'Owner', lastName: 'Test', password: 'testtest' };
  const member = { email: 'family-member@example.com', firstName: 'Member', lastName: 'User', password: 'testtest' };
  const guestEmail = 'family-guest@example.com';
  let pool: Pool;
  let ownerToken: string;
  let memberToken: string;
  let guestRelationshipId: string;
  let userRelationshipId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM users WHERE email IN ($1, $2, $3)', [owner.email, member.email, guestEmail]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2, $3)', [owner.email, member.email, guestEmail]);
      await pool.end();
    }
    await closePool();
  });

  it('creates relationships, accepts, edits, and removes', async () => {
    const regOwner = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: owner.firstName, lastName: owner.lastName, email: owner.email, password: owner.password, passwordConfirm: owner.password })
      .expect(201);
    ownerToken = regOwner.body.token as string;

    const regMember = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: member.firstName, lastName: member.lastName, email: member.email, password: member.password, passwordConfirm: member.password })
      .expect(201);
    memberToken = regMember.body.token as string;

    // Add a non-user family profile (auto-accepted, editable)
    const addGuest = await request(app)
      .post('/api/account/family')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ givenName: 'Grand', middleName: 'G', familyName: 'Parent', email: guestEmail, relationship: 'Grandparent' })
      .expect(201);
    const guestEntry = addGuest.body.find((r: any) => r.relative?.email === guestEmail);
    expect(guestEntry).toBeTruthy();
    expect(guestEntry.editableProfile).toBe(true);
    guestRelationshipId = guestEntry.id;

    // Edit the non-user profile
    const updatedGuest = await request(app)
      .patch(`/api/account/family/${guestRelationshipId}/profile`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ givenName: 'Updated', familyName: 'Relative', relationship: 'Sibling' })
      .expect(200);
    const guestUpdatedRow = updatedGuest.body.find((r: any) => r.id === guestRelationshipId);
    expect(guestUpdatedRow.relative.firstName).toBe('Updated');
    expect(guestUpdatedRow.relationship).toBe('Sibling');

    // Request relationship with an existing user (requires acceptance)
    const addMemberRel = await request(app)
      .post('/api/account/family')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ givenName: member.firstName, familyName: member.lastName, email: member.email, relationship: 'Sibling' })
      .expect(201);
    const pending = addMemberRel.body.find((r: any) => r.relative?.email === member.email);
    expect(pending.status).toBe('pending');
    userRelationshipId = pending.id;

    // Member sees pending inbound request
    const memberPending = await request(app)
      .get('/api/account/family')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    const inbound = memberPending.body.find((r: any) => r.relative?.email === owner.email);
    expect(inbound.status).toBe('pending');
    expect(inbound.direction).toBe('inbound');

    // Accept request
    await request(app)
      .patch(`/api/account/family/${inbound.id}/accept`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    const ownerAfterAccept = await request(app).get('/api/account/family').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    const accepted = ownerAfterAccept.body.find((r: any) => r.relative?.email === member.email);
    expect(accepted.status).toBe('accepted');

    // Remove relationship
    const ownerAfterRemove = await request(app)
      .delete(`/api/account/family/${accepted.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(ownerAfterRemove.body.some((r: any) => r.relative?.email === member.email)).toBe(false);
  });
});

describe('Account lifecycle API with shared trip', () => {
  const user1 = { email: 'acct-user1@example.com', firstName: 'Acct', lastName: 'One', password: 'testtest' };
  const user2 = { email: 'acct-user2@example.com', firstName: 'Acct', lastName: 'Two', password: 'testtest' };
  let pool: Pool;
  let token1: string;
  let token2: string;
  let groupId: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [user1.email, user2.email]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [user1.email, user2.email]);
      await pool.end();
    }
    await closePool();
  });

  it('creates two users and shares a trip', async () => {
    const reg1 = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: user1.firstName, lastName: user1.lastName, email: user1.email, password: user1.password, passwordConfirm: user1.password })
      .expect(201);
    token1 = reg1.body.token as string;

    const groups1 = await request(app).get('/api/groups').set('Authorization', `Bearer ${token1}`).expect(200);
    groupId = groups1.body[0]?.id as string;
    expect(groupId).toBeTruthy();

    const trip = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${token1}`)
      .send({ name: 'Test Trip', groupId })
      .expect(201);
    tripId = trip.body.id as string;
    expect(tripId).toBeTruthy();

    const reg2 = await request(app)
      .post('/api/web-auth/register')
      .send({ firstName: user2.firstName, lastName: user2.lastName, email: user2.email, password: user2.password, passwordConfirm: user2.password })
      .expect(201);
    token2 = reg2.body.token as string;

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ email: user2.email })
      .expect(201);

    const groups1After = await request(app).get('/api/groups').set('Authorization', `Bearer ${token1}`).expect(200);
    expect(groups1After.body[0]?.members?.some((m: any) => (m.userEmail ?? m.email) === user2.email)).toBe(true);

    const groups2 = await request(app).get('/api/groups').set('Authorization', `Bearer ${token2}`).expect(200);
    expect(groups2.body.some((g: any) => g.id === groupId)).toBe(true);

    const trips2 = await request(app).get('/api/trips').set('Authorization', `Bearer ${token2}`).expect(200);
    expect(trips2.body.some((t: any) => t.id === tripId)).toBe(true);
  });

  it('keeps trip after deleting first user', async () => {
    await request(app).delete('/api/account').set('Authorization', `Bearer ${token1}`).expect(204);
    const user1Check = await pool.query('SELECT 1 FROM users WHERE email = $1', [user1.email]);
    expect(user1Check.rowCount).toBe(0);
    const tripStillThere = await pool.query('SELECT 1 FROM trips WHERE id = $1', [tripId]);
    expect(tripStillThere.rowCount).toBe(1);

    const trips2After = await request(app).get('/api/trips').set('Authorization', `Bearer ${token2}`).expect(200);
    expect(trips2After.body.some((t: any) => t.id === tripId)).toBe(true);
  });

  it('removes trip after deleting last user', async () => {
    await request(app).delete('/api/account').set('Authorization', `Bearer ${token2}`).expect(204);
    const user2Check = await pool.query('SELECT 1 FROM users WHERE email = $1', [user2.email]);
    expect(user2Check.rowCount).toBe(0);
    const tripGone = await pool.query('SELECT 1 FROM trips WHERE id = $1', [tripId]);
    expect(tripGone.rowCount).toBe(0);
  });
});
