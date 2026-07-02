/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { initDb, closePool } from '../src/db';
import { cleanupTestUsersByEmail, registerAndLoginWebUser, setUserTierInDb } from './helpers';

/**
 * Exercises POST /api/groups/invites/bulk-cancel — a small ergonomic wrapper
 * that loops `removeGroupInvite` server-side so the UI can cancel multiple
 * stale pending invites in one request. Single-invite DELETE is already
 * covered by account.test.ts; this suite asserts the partial-success
 * semantics of the batch endpoint.
 */
describe('POST /api/groups/invites/bulk-cancel', () => {
  const owner = {
    email: `bulk-cancel-owner-${Date.now()}@example.com`,
    firstName: 'Owner',
    lastName: 'Cancel',
    password: 'testtest',
  };
  let ownerToken: string;
  let ownerId: string;
  let groupId: string;
  let tripId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await cleanupTestUsersByEmail([owner.email]);
    const login = await registerAndLoginWebUser(owner);
    ownerToken = login.token;
    ownerId = login.userId;
    await setUserTierInDb(ownerId, 'premium');

    const groupsRes = await request(app)
      .get('/api/groups')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    groupId = groupsRes.body[0].id as string;

    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Bulk Cancel Trip ${Date.now()}`, groupId })
      .expect(201);
    tripId = tripRes.body.id as string;
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([owner.email]);
    await closePool();
  });

  let inviteeCounter = 0;
  const invitePendingMember = async (suffix: string): Promise<string> => {
    inviteeCounter += 1;
    const inviteeEmail = `bc-inv-${suffix}${inviteeCounter}-${Date.now()}@example.com`;
    await request(app)
      .post(`/api/account/trips/${tripId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: inviteeEmail })
      .expect(201);
    const regRes = await request(app)
      .post('/api/web-auth/register')
      .send({
        firstName: 'Inv',
        lastName: `${suffix}${inviteeCounter}`,
        email: inviteeEmail,
        password: 'testtest',
        passwordConfirm: 'testtest',
      });
    if (regRes.status !== 201) {
      // eslint-disable-next-line no-console
      console.error('[probe] register failed', regRes.status, regRes.body, 'email=', inviteeEmail);
      throw new Error(`register returned ${regRes.status}: ${JSON.stringify(regRes.body)}`);
    }
    // Confirm via the verification token returned from register (skipping the mailer step).
    const verifyToken = (regRes.body as any).verificationToken as string | undefined;
    if (verifyToken) {
      await request(app).get('/api/web-auth/confirm').query({ token: verifyToken }).expect((r) => {
        if (r.status !== 200 && r.status !== 302) throw new Error(`confirm status ${r.status}`);
      });
    }
    const loginRes = await request(app)
      .post('/api/web-auth/login')
      .send({ email: inviteeEmail, password: 'testtest' })
      .expect(200);
    const inviteToken = loginRes.body.token as string;
    const inviteList = await request(app)
      .get('/api/groups/invites')
      .set('Authorization', `Bearer ${inviteToken}`)
      .expect(200);
    const invite = inviteList.body.find((inv: any) => inv.groupId === groupId && inv.inviteeEmail === inviteeEmail);
    expect(invite).toBeTruthy();
    return invite.id as string;
  };

  it('rejects an empty or missing inviteIds array with 400', async () => {
    await request(app)
      .post('/api/groups/invites/bulk-cancel')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(400);
    await request(app)
      .post('/api/groups/invites/bulk-cancel')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ inviteIds: [] })
      .expect(400);
    await request(app)
      .post('/api/groups/invites/bulk-cancel')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ inviteIds: ['  ', '   '] })
      .expect(400);
  });

  it('cancels all provided invites owned by the caller in one request', async () => {
    const id1 = await invitePendingMember('a');
    const id2 = await invitePendingMember('b');
    const id3 = await invitePendingMember('c');

    const res = await request(app)
      .post('/api/groups/invites/bulk-cancel')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ inviteIds: [id1, id2, id3] })
      .expect(200);

    expect(res.body.cancelled).toBe(3);
    expect(res.body.failed).toBe(0);
    expect(new Set(res.body.cancelledIds)).toEqual(new Set([id1, id2, id3]));
  });

  it('returns partial success when one id is not owned by the caller — failures do not abort the batch', async () => {
    // Spin up a separate owner in their own group, create one of their
    // invites, and try to bulk-cancel that foreign invite alongside one of
    // the caller's own invites.
    const otherOwner = {
      email: `bulk-cancel-foreign-${Date.now()}@example.com`,
      firstName: 'Other',
      lastName: 'Owner',
      password: 'testtest',
    };
    const foreignLogin = await registerAndLoginWebUser(otherOwner);
    await setUserTierInDb(foreignLogin.userId, 'premium');
    const foreignGroups = await request(app)
      .get('/api/groups')
      .set('Authorization', `Bearer ${foreignLogin.token}`)
      .expect(200);
    const foreignGroupId = foreignGroups.body[0].id as string;
    const foreignTripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${foreignLogin.token}`)
      .send({ name: `Foreign Trip ${Date.now()}`, groupId: foreignGroupId })
      .expect(201);
    const foreignTripId = foreignTripRes.body.id as string;
    const foreignInviteeEmail = `bulk-cancel-foreign-invitee-${Date.now()}@example.com`;
    await request(app)
      .post(`/api/account/trips/${foreignTripId}/members`)
      .set('Authorization', `Bearer ${foreignLogin.token}`)
      .send({ email: foreignInviteeEmail })
      .expect(201);
    // Register + login the foreign invitee so we can read the invite id.
    const inviteeRegRes = await request(app).post('/api/web-auth/register').send({
      firstName: 'Foreign', lastName: 'Invitee', email: foreignInviteeEmail, password: 'testtest', passwordConfirm: 'testtest',
    });
    const foreignVerify = (inviteeRegRes.body as any).verificationToken as string | undefined;
    if (foreignVerify) await request(app).get('/api/web-auth/confirm').query({ token: foreignVerify });
    const inviteeLogin = await request(app)
      .post('/api/web-auth/login')
      .send({ email: foreignInviteeEmail, password: 'testtest' })
      .expect(200);
    const inviteList = await request(app)
      .get('/api/groups/invites')
      .set('Authorization', `Bearer ${inviteeLogin.body.token}`)
      .expect(200);
    const foreignInvite = inviteList.body.find((inv: any) => inv.inviteeEmail === foreignInviteeEmail);
    expect(foreignInvite).toBeTruthy();
    const foreignInviteId = foreignInvite.id as string;

    // Now the real assertion: caller's own id cancels, foreign id is rejected.
    const ownId = await invitePendingMember('d');
    const res = await request(app)
      .post('/api/groups/invites/bulk-cancel')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ inviteIds: [ownId, foreignInviteId] })
      .expect(200);

    expect(res.body.cancelled).toBe(1);
    expect(res.body.failed).toBe(1);
    expect(res.body.cancelledIds).toEqual([ownId]);
    expect(res.body.failedIds[0].id).toBe(foreignInviteId);
    expect(typeof res.body.failedIds[0].error).toBe('string');

    // Cleanup the foreign owner.
    await cleanupTestUsersByEmail([otherOwner.email, foreignInviteeEmail]);
  });
});
