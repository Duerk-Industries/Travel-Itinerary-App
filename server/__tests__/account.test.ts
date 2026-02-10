import request from 'supertest';
import { Pool } from 'pg';
import { app } from '../src/app';
import { initDb, closePool, createWebUser, createEmailVerification } from '../src/db';
import { confirmWebUser, loginWebUser, registerAndLoginWebUser, registerWebUser } from './helpers';

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
    const { token } = await registerAndLoginWebUser(pool, {
      firstName: 'Change',
      lastName: 'User',
      email,
      password: 'oldpass',
    });

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

  it('returns 503 when datastore is unavailable during login', async () => {
    const db = require('../src/db');
    const err = new Error('UNAVAILABLE: datastore down');
    (err as any).code = 'UNAVAILABLE';
    const spy = jest.spyOn(db, 'verifyWebUserCredentials').mockRejectedValue(err);

    await request(app)
      .post('/api/web-auth/login')
      .send({ email: 'anyone@example.com', password: 'irrelevant' })
      .expect(503)
      .expect((res) => {
        expect(res.body.error).toMatch(/temporarily unavailable/i);
      });

    spy.mockRestore();
  });

  it('returns 503 when datastore is unavailable during registration', async () => {
    const db = require('../src/db');
    const err = new Error('ECONNREFUSED');
    (err as any).code = 'UNAVAILABLE';
    const spy = jest.spyOn(db, 'createWebUser').mockRejectedValue(err);

    await request(app)
      .post('/api/web-auth/register')
      .send({
        firstName: 'Unavailable',
        lastName: 'User',
        email: 'unavailable@example.com',
        password: 'testtest',
        passwordConfirm: 'testtest',
      })
      .expect(503)
      .expect((res) => {
        expect(res.body.error).toMatch(/temporarily unavailable/i);
      });

    spy.mockRestore();
  });

  it('returns demographics with null age/gender for a new user', async () => {
    const email = 'demographics-test@example.com';
    await pool.query('DELETE FROM users WHERE email = $1', [email]);

    const { token } = await registerAndLoginWebUser(pool, {
      firstName: 'Demo',
      lastName: 'Graphics',
      email,
      password: 'testtest',
    });
    const resp = await request(app)
      .get('/api/traits/profile/demographics')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(resp.body).toEqual({ age: null, gender: null });
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
    const ownerLogin = await registerAndLoginWebUser(pool, owner);
    ownerToken = ownerLogin.token;

    const memberLogin = await registerAndLoginWebUser(pool, member);
    memberToken = memberLogin.token;

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
  const owner = { email: 'acct-owner@example.com', firstName: 'Acct', lastName: 'Owner', password: 'testtest' };
  const joiner = { email: 'acct-joiner@example.com', firstName: 'Acct', lastName: 'Joiner', password: 'testtest' };
  let pool: Pool;
  let ownerToken: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [owner.email, joiner.email]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [owner.email, joiner.email]);
      await pool.end();
    }
    await closePool();
  });

  it('adds and removes a member for a trip via account routes', async () => {
    const ownerLogin = await registerAndLoginWebUser(pool, owner);
    ownerToken = ownerLogin.token;

    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Trip Members', description: 'Test trip members', destination: 'NYC', participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id as string;
    expect(tripId).toBeTruthy();

    await registerWebUser(joiner);

    await request(app)
      .post(`/api/account/trips/${tripId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: joiner.email })
      .expect(201);

    const members = await request(app)
      .get(`/api/account/trips/${tripId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const added = members.body.find((m: any) => (m.email ?? m.userEmail) === joiner.email);
    expect(added).toBeTruthy();

    await request(app)
      .delete(`/api/account/trips/${tripId}/members/${added.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    const membersAfter = await request(app)
      .get(`/api/account/trips/${tripId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const removedMember = membersAfter.body.find((m: any) => (m.email ?? m.userEmail) === joiner.email);
    expect(removedMember?.status).toBe('pending');
  });
});

describe('Pending group invites', () => {
  const owner = { email: 'invite-owner@example.com', firstName: 'Owner', lastName: 'Pending', password: 'testtest' };
  const invitee = { email: 'invitee-login@example.com', firstName: 'Invitee', lastName: 'Login', password: 'testtest' };
  let pool: Pool;
  let ownerToken: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [owner.email, invitee.email]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2)', [owner.email, invitee.email]);
      await pool.end();
    }
    await closePool();
  });

  it('claims a pending invite for an existing email on login', async () => {
    const ownerLogin = await registerAndLoginWebUser(pool, owner);
    ownerToken = ownerLogin.token;

    const tripRes = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Claim Invite Trip', description: 'Test pending invite claim', destination: 'Paris', participants: [] })
      .expect(201);
    tripId = tripRes.body.trip?.id as string;
    expect(tripId).toBeTruthy();

    await request(app)
      .post(`/api/account/trips/${tripId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: invitee.email })
      .expect(201);

    const pendingMembers = await request(app)
      .get(`/api/account/trips/${tripId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const pending = pendingMembers.body.find((m: any) => m.email === invitee.email && m.status === 'pending');
    expect(pending).toBeTruthy();

    const inviteeLogin = await registerAndLoginWebUser(pool, invitee);

    const inviteList = await request(app)
      .get('/api/groups/invites')
      .set('Authorization', `Bearer ${inviteeLogin.token}`)
      .expect(200);
    expect(Array.isArray(inviteList.body)).toBe(true);
    const invite = inviteList.body.find((inv: any) => inv.groupId && inv.inviteeEmail === invitee.email);
    expect(invite).toBeTruthy();

    await request(app)
      .post(`/api/groups/invites/${invite.id}/accept`)
      .set('Authorization', `Bearer ${inviteeLogin.token}`)
      .expect(204);

    const membersAfter = await request(app)
      .get(`/api/account/trips/${tripId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const claimed = membersAfter.body.find((m: any) => m.email === invitee.email && m.status === 'active');
    expect(claimed).toBeTruthy();
    expect(claimed.firstName).toBe(invitee.firstName);
  });

  it('removes pending member data when an invite is rejected', async () => {
    const suffix = Date.now();
    const rejectInvitee = {
      email: `reject-invitee+${suffix}@example.com`,
      firstName: 'Reject',
      lastName: 'Invitee',
      password: 'testtest',
    };

    const groups = await request(app)
      .get('/api/groups')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const groupId = groups.body[0]?.id as string;
    expect(groupId).toBeTruthy();

    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Reject Trip ${suffix}`, groupId })
      .expect(201);
    const rejectTripId = tripRes.body.id as string;

    await request(app)
      .post(`/api/account/trips/${rejectTripId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: rejectInvitee.email })
      .expect(201);

    const members = await request(app)
      .get(`/api/account/trips/${rejectTripId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const pending = members.body.find((m: any) => m.email === rejectInvitee.email && m.status === 'pending');
    expect(pending).toBeTruthy();
    const pendingMemberId = pending.id;

    await request(app)
      .post('/api/flights')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        passengerIds: [pendingMemberId],
        departureDate: '2026-06-01',
        departureTime: '08:00',
        arrivalTime: '10:00',
        carrier: 'AA',
        flightNumber: 'RJ1',
        bookingReference: 'RJ-REF',
        tripId: rejectTripId,
        cost: 100,
        paidBy: [pendingMemberId],
      })
      .expect(201);

    await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        tripId: rejectTripId,
        name: 'Reject Lodging',
        checkInDate: '2026-06-01',
        checkOutDate: '2026-06-03',
        rooms: '1',
        totalCost: '200',
        costPerNight: '100',
        paidBy: [pendingMemberId],
        travelerIds: [pendingMemberId],
      })
      .expect(201);

    await request(app)
      .post('/api/tours')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        tripId: rejectTripId,
        date: '2026-06-02',
        name: 'Reject Tour',
        startLocation: 'Test',
        startTime: '09:00',
        duration: '2h',
        cost: '50',
        paidBy: [pendingMemberId],
      })
      .expect(201);

    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        tripId: rejectTripId,
        expenseDate: '2026-06-02',
        category: 'Lunch',
        amount: 20,
        currency: 'USD',
        amountInTripCurrency: 20,
        exchangeRateToTripCurrency: 1,
        exchangeRateDate: '2026-06-02',
        payerIds: [pendingMemberId],
        forIds: [pendingMemberId],
      })
      .expect(201);

    const rejectLogin = await registerAndLoginWebUser(pool, rejectInvitee);
    const inviteList = await request(app)
      .get('/api/groups/invites')
      .set('Authorization', `Bearer ${rejectLogin.token}`)
      .expect(200);
    const invite = inviteList.body.find((inv: any) => inv.inviteeEmail === rejectInvitee.email);
    expect(invite).toBeTruthy();

    await request(app)
      .post(`/api/groups/invites/${invite.id}/reject`)
      .set('Authorization', `Bearer ${rejectLogin.token}`)
      .expect(204);

    const flights = await request(app)
      .get(`/api/flights?tripId=${rejectTripId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(flights.body.length).toBe(0);

    const lodgings = await request(app)
      .get(`/api/lodgings?tripId=${rejectTripId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(lodgings.body.length).toBe(0);

    const tours = await request(app)
      .get(`/api/tours?tripId=${rejectTripId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(tours.body.length).toBe(0);

    const expenses = await request(app)
      .get(`/api/expenses?tripId=${rejectTripId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(expenses.body.length).toBe(0);
  });
});

describe('Account onboarding trip flow', () => {
  const suffix = Date.now();
  const owner = { email: `onboard-owner+${suffix}@example.com`, firstName: 'Onboard', lastName: 'Owner', password: 'testtest' };
  const invited = { email: `onboard-invitee+${suffix}@example.com`, firstName: 'Onboard', lastName: 'Invitee', password: 'testtest' };
  const solo = { email: `onboard-solo+${suffix}@example.com`, firstName: 'Onboard', lastName: 'Solo', password: 'testtest' };
  let pool: Pool;
  let ownerToken: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM users WHERE email IN ($1, $2, $3)', [owner.email, invited.email, solo.email]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email IN ($1, $2, $3)', [owner.email, invited.email, solo.email]);
      await pool.end();
    }
    await closePool();
  });

  it('returns trips only after an invited user accepts the invite', async () => {
    const regOwner = await registerAndLoginWebUser(pool, owner);
    ownerToken = regOwner.token;

    const tripRes = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Onboard Trip', description: 'Onboard invite flow', destination: 'Rome', participants: [] })
      .expect(201);
    tripId = tripRes.body.trip?.id as string;
    expect(tripId).toBeTruthy();

    await request(app)
      .post(`/api/account/trips/${tripId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: invited.email })
      .expect(201);

    const invitedLogin = await registerAndLoginWebUser(pool, invited);

    const preTrips = await request(app)
      .get('/api/trips')
      .set('Authorization', `Bearer ${invitedLogin.token}`)
      .expect(200);
    expect(Array.isArray(preTrips.body)).toBe(true);
    expect(preTrips.body.length).toBe(0);

    const inviteList = await request(app)
      .get('/api/groups/invites')
      .set('Authorization', `Bearer ${invitedLogin.token}`)
      .expect(200);
    const invite = inviteList.body.find((inv: any) => inv.groupId && inv.inviteeEmail === invited.email);
    expect(invite).toBeTruthy();

    await request(app)
      .post(`/api/groups/invites/${invite.id}/accept`)
      .set('Authorization', `Bearer ${invitedLogin.token}`)
      .expect(204);

    const trips = await request(app)
      .get('/api/trips')
      .set('Authorization', `Bearer ${invitedLogin.token}`)
      .expect(200);
    expect(Array.isArray(trips.body)).toBe(true);
    expect(trips.body.some((t: any) => t.id === tripId)).toBe(true);
  });

  it('returns no trips for a newly registered user without invites', async () => {
    const soloLogin = await registerAndLoginWebUser(pool, solo);

    const trips = await request(app)
      .get('/api/trips')
      .set('Authorization', `Bearer ${soloLogin.token}`)
      .expect(200);
    expect(Array.isArray(trips.body)).toBe(true);
    expect(trips.body).toHaveLength(0);
  });
});

describe('Web Authentication', () => {
  let pool: Pool;
  const testUser = {
    firstName: 'WebAuth',
    lastName: 'Tester',
    email: 'webauth@example.com',
    password: 'password123',
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DELETE FROM users WHERE email = $1', [testUser.email]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM users WHERE email = $1', [testUser.email]);
      await pool.end();
    }
    await closePool();
  });

  it('successfully registers a new user', async () => {
    const res = await registerWebUser(testUser);
    expect(res.body.verificationRequired).toBe(true);
    expect(res.body.token).toBeUndefined();
  });

  it('rejects registration for an existing user', async () => {
    await request(app)
      .post('/api/web-auth/register')
      .send({
        ...testUser,
        passwordConfirm: testUser.password,
      })
      .expect(409);
  });

  it('rejects login before email confirmation', async () => {
    const res = await request(app)
      .post('/api/web-auth/login')
      .send({
        email: testUser.email,
        password: testUser.password,
      })
      .expect(403);

    expect(res.body.error).toMatch(/confirm/i);
  });

  it('successfully logs in an existing user after confirmation', async () => {
    await confirmWebUser(pool, testUser.email);
    const res = await loginWebUser(testUser);

    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe(testUser.email);
  });

  it('rejects login with an incorrect password', async () => {
    await request(app)
      .post('/api/web-auth/login')
      .send({
        email: testUser.email,
        password: 'wrongpassword',
      })
      .expect(401);
  });

  it('rejects login for a non-existent user', async () => {
    await request(app)
      .post('/api/web-auth/login')
      .send({
        email: 'nobody@example.com',
        password: 'password123',
      })
      .expect(401);
  });

  it('deletes unconfirmed users after expiration', async () => {
    const expired = {
      firstName: 'Expire',
      lastName: 'Soon',
      email: 'expire-user@example.com',
      password: 'password123',
    };
    await pool.query('DELETE FROM users WHERE email = $1', [expired.email]);
    await registerWebUser(expired);
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [expired.email]);
    const userId = rows[0]?.id as string | undefined;
    expect(userId).toBeTruthy();
    const verification = await createEmailVerification(userId as string, -1);

    await request(app)
      .get('/api/web-auth/confirm')
      .query({ token: verification.token })
      .expect(410);

    const after = await pool.query('SELECT id FROM users WHERE email = $1', [expired.email]);
    expect(after.rows.length).toBe(0);
  });
});
