/// <reference types="jest" />

import request from 'supertest';
import { app } from '../src/app';
import {
  initDb,
  closePool,
  createEmailVerification,
  findUserByEmail,
  setPasswordSetupRequired,
  addUserEmail,
  markAccountEmailVerified,
} from '../src/db';
import {
  cleanupTestUsersByEmail,
  confirmWebUser,
  loginWebUser,
  registerAndLoginWebUser,
  registerWebUser,
  setUserTierInDb,
} from './helpers';

describe('Password validation', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([
      'password-test+mismatch@example.com',
      'password-test+change@example.com',
      'demographics-test@example.com',
      'profile-test+optional@example.com',
      'password-test+guard@example.com',
    ]);
    await closePool();
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
    await cleanupTestUsersByEmail([email]);
    const { token } = await registerAndLoginWebUser({
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
    await cleanupTestUsersByEmail([email]);

    const { token } = await registerAndLoginWebUser({
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

  it('persists demographics after saving them', async () => {
    const email = 'demographics-save-test@example.com';
    await cleanupTestUsersByEmail([email]);

    const { token } = await registerAndLoginWebUser({
      firstName: 'Traits',
      lastName: 'Saver',
      email,
      password: 'testtest',
    });

    await request(app)
      .post('/api/traits/profile/demographics')
      .set('Authorization', `Bearer ${token}`)
      .send({
        age: 41,
        gender: 'male',
      })
      .expect(204);

    const resp = await request(app)
      .get('/api/traits/profile/demographics')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(resp.body).toEqual({ age: 41, gender: 'male' });
  });

  it('supports optional home address/preferred airport and persists map/appearance preferences on account profile', async () => {
    const email = 'profile-test+optional@example.com';
    await cleanupTestUsersByEmail([email]);

    const { token } = await registerAndLoginWebUser({
      firstName: 'Profile',
      lastName: 'Fields',
      email,
      password: 'testtest',
    });

    const updateRes = await request(app)
      .patch('/api/account/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        homeAddress: '123 Main St, Austin, TX',
        preferredAirport: 'AUS',
        mapPreference: 'apple',
        appearancePreference: 'dark',
        temperatureUnit: 'celsius',
      })
      .expect(200);

    expect(updateRes.body.user.homeAddress).toBe('123 Main St, Austin, TX');
    expect(updateRes.body.user.preferredAirport).toBe('AUS');
    expect(updateRes.body.user.mapPreference).toBe('apple');
    expect(updateRes.body.user.appearancePreference).toBe('dark');
    expect(updateRes.body.user.temperatureUnit).toBe('celsius');

    const profileRes = await request(app)
      .get('/api/account')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(profileRes.body.homeAddress).toBe('123 Main St, Austin, TX');
    expect(profileRes.body.preferredAirport).toBe('AUS');
    expect(profileRes.body.mapPreference).toBe('apple');
    expect(profileRes.body.appearancePreference).toBe('dark');
    expect(profileRes.body.temperatureUnit).toBe('celsius');

    const clearRes = await request(app)
      .patch('/api/account/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        homeAddress: '',
        preferredAirport: '',
      })
      .expect(200);

    expect(clearRes.body.user.homeAddress).toBeNull();
    expect(clearRes.body.user.preferredAirport).toBeNull();
  });

  it('restricts non-invite endpoints until password setup is completed', async () => {
    const email = 'password-test+guard@example.com';
    await cleanupTestUsersByEmail([email]);

    const { token, userId } = await registerAndLoginWebUser({
      firstName: 'Guard',
      lastName: 'User',
      email,
      password: 'testtest',
    });

    await setPasswordSetupRequired(userId, true);

    await request(app)
      .get('/api/groups/invites')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app)
      .get('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    await request(app)
      .patch('/api/account/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'newpass1', newPasswordConfirm: 'newpass1' })
      .expect(200);

    await request(app)
      .get('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});

describe('Family relationships', () => {
  const owner = { email: 'family-owner@example.com', firstName: 'Owner', lastName: 'Test', password: 'testtest' };
  const member = { email: 'family-member@example.com', firstName: 'Member', lastName: 'User', password: 'testtest' };
  const guestEmail = 'family-guest@example.com';
  let ownerToken: string;
  let memberToken: string;
  let guestRelationshipId: string;
  let userRelationshipId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await cleanupTestUsersByEmail([owner.email, member.email, guestEmail]);
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([owner.email, member.email, guestEmail]);
    await closePool();
  });

  it('creates relationships, accepts, edits, and removes', async () => {
    const ownerLogin = await registerAndLoginWebUser(owner);
    ownerToken = ownerLogin.token;

    const memberLogin = await registerAndLoginWebUser(member);
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
  const accountLifecycleId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = { email: `acct-owner+${accountLifecycleId}@example.com`, firstName: 'Acct', lastName: 'Owner', password: 'testtest' };
  const joiner = { email: `acct-joiner+${accountLifecycleId}@example.com`, firstName: 'Acct', lastName: 'Joiner', password: 'testtest' };
  let ownerToken: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await cleanupTestUsersByEmail([owner.email, joiner.email]);
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([owner.email, joiner.email]);
    await closePool();
  });

  it('adds and removes a member for a trip via account routes', async () => {
    const ownerLogin = await registerAndLoginWebUser(owner);
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

describe('Group user search', () => {
  let createdPrimaryEmail: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
  });

  afterAll(async () => {
    if (createdPrimaryEmail) {
      await cleanupTestUsersByEmail([createdPrimaryEmail]);
    }
    await closePool();
  });

  it('finds users by name and alternate email on the shared search endpoint', async () => {
    const primaryEmail = `search-users-test+primary${Date.now()}@example.com`;
    createdPrimaryEmail = primaryEmail;
    const alternateEmail = `search-users-test+alias${Date.now()}@example.com`;

    const { token, userId } = await registerAndLoginWebUser({
      firstName: 'Searchable',
      lastName: 'Traveler',
      email: primaryEmail,
      password: 'testtest',
    });

    await addUserEmail(userId, alternateEmail);
    await markAccountEmailVerified(userId, alternateEmail);

    const nameRes = await request(app)
      .get('/api/groups/search-users?q=Searchable%20Traveler')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(nameRes.body.some((user: any) => user.id === userId)).toBe(true);

    const emailRes = await request(app)
      .get(`/api/groups/search-users?q=${encodeURIComponent(alternateEmail)}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(emailRes.body.some((user: any) => user.id === userId)).toBe(true);
  });
});

describe('Pending group invites', () => {
  const inviteTestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = { email: `invite-owner+${inviteTestId}@example.com`, firstName: 'Owner', lastName: 'Pending', password: 'testtest' };
  const invitee = { email: `invitee-login+${inviteTestId}@example.com`, firstName: 'Invitee', lastName: 'Login', password: 'testtest' };
  let ownerToken: string;
  let tripId: string;
  let rejectInviteeEmail: string | undefined;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await cleanupTestUsersByEmail([owner.email, invitee.email]);
  });

  afterAll(async () => {
    const emails = [owner.email, invitee.email];
    if (rejectInviteeEmail) emails.push(rejectInviteeEmail);
    await cleanupTestUsersByEmail(emails);
    await closePool();
  });

  it('claims a pending invite for an existing email on login', async () => {
    const ownerLogin = await registerAndLoginWebUser(owner);
    ownerToken = ownerLogin.token;
    await setUserTierInDb(ownerLogin.userId, 'premium');

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

    const inviteeLogin = await registerAndLoginWebUser(invitee);

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
    if (!ownerToken) {
      const ownerLogin = await registerAndLoginWebUser(owner);
      ownerToken = ownerLogin.token;
      await setUserTierInDb(ownerLogin.userId, 'premium');
    }

    const suffix = Date.now();
    const rejectInvitee = {
      email: `reject-invitee+${suffix}@example.com`,
      firstName: 'Reject',
      lastName: 'Invitee',
      password: 'testtest',
    };
    rejectInviteeEmail = rejectInvitee.email;

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
      .post('/api/transfers')
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
      .post('/api/activities')
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

    const rejectLogin = await registerAndLoginWebUser(rejectInvitee);
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

    const transfers = await request(app)
      .get(`/api/transfers?tripId=${rejectTripId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(transfers.body.length).toBe(0);

    const lodgings = await request(app)
      .get(`/api/lodgings?tripId=${rejectTripId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(lodgings.body.length).toBe(0);

    const activities = await request(app)
      .get(`/api/activities?tripId=${rejectTripId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(activities.body.length).toBe(0);

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
  let ownerToken: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await cleanupTestUsersByEmail([owner.email, invited.email, solo.email]);
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([owner.email, invited.email, solo.email]);
    await closePool();
  });

  it('returns trips only after an invited user accepts the invite', async () => {
    const regOwner = await registerAndLoginWebUser(owner);
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

    const invitedLogin = await registerAndLoginWebUser(invited);

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
    const soloLogin = await registerAndLoginWebUser(solo);

    const trips = await request(app)
      .get('/api/trips')
      .set('Authorization', `Bearer ${soloLogin.token}`)
      .expect(200);
    expect(Array.isArray(trips.body)).toBe(true);
    expect(trips.body).toHaveLength(0);
  });
});

describe('Web Authentication', () => {
  const webAuthTestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const testUser = {
    firstName: 'WebAuth',
    lastName: 'Tester',
    email: `webauth+${webAuthTestId}@example.com`,
    password: 'password123',
  };
  const expiredEmail = `expire-user+${webAuthTestId}@example.com`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await cleanupTestUsersByEmail([testUser.email]);
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([testUser.email, expiredEmail]);
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
    await confirmWebUser(testUser.email);
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
      email: expiredEmail,
      password: 'password123',
    };
    await cleanupTestUsersByEmail([expired.email]);
    await registerWebUser(expired);
    const found = await findUserByEmail(expired.email);
    const userId = found?.id as string | undefined;
    expect(userId).toBeTruthy();
    const verification = await createEmailVerification(userId as string, -1);

    await request(app)
      .get('/api/web-auth/confirm')
      .query({ token: verification.token })
      .expect(410);

    const after = await findUserByEmail(expired.email);
    expect(after).toBeFalsy();
  });
});
